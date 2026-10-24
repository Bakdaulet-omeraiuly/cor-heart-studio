"""Label volume -> app heart asset (step 3 of docs/plan-tier-b-ct.md).

Produces what src/scene/asset-adapters expects from the procedural heart (docs/asset-pipeline.md):
one closed `heart_tissue` mesh (outer surface + cavity surfaces, so wall thickness shows in a cut)
with the `_WEIGHTS` / `_TISSUE` attribute contract, and a manifest with the same fields.

Everything is computed on a fine grid (0.75 mm) of signed distance fields in millimetres:
    outer  = epicardial surface: LV (myocardium + cavity) plus every other blood pool grown by a wall
    cavity = union of blood pools
    solid  = outer minus cavity  (negative inside tissue)

Only the LV wall is measured (TotalSegmentator and MM-WHS label LV myocardium only). RV, atrial and
vessel walls are a fixed thickness and say so in the manifest.
"""

import numpy as np
import trimesh
from scipy import ndimage
from scipy.spatial import cKDTree
from skimage import measure

from .fidelity import boundary_points, gate, summarise, surface_metrics
from .labels import GREAT_VEINS, LABEL_MAPS
from .mesh import RAS_TO_APP

FINE_MM = 0.75
WALL_MM = {"rv": 3.0, "la": 2.0, "ra": 2.0, "aorta": 2.0, "pulmonary_artery": 1.5, "vena_cava": 1.5, "pulmonary_veins": 1.5}
MARGIN_MM = WALL_MM["rv"] + 4 * FINE_MM
ISO_OFFSET_MM = 0.013
MIN_PIECE_MM3 = 500.0
LV_MIN_WALL_MM = 1.2  # below one CT voxel (1.5 mm), so it stays within the fidelity tolerance
VALVE_MIN_DEPTH_MM = 6.0
# Soft-max membership, as in scripts/heart-asset/build.ts (tau 0.28 model units ~ 3.2 mm there).
WEIGHT_TAU_MM = 3.0
KIND_MYOCARDIUM, KIND_GREAT_ARTERY, KIND_GREAT_VEIN = 0, 1, 2
REGION = {"lv": 0, "rv": 1, "la": 2, "ra": 3, "aorta": 4, "pulmonary_artery": 5, "vena_cava": 6, "pulmonary_veins": 7}
VESSEL_ROLES = ("aorta", "pulmonary_artery", "vena_cava", "pulmonary_veins")
VALVES = {  # upstream -> downstream (normal points along the flow), default radius cm if not found
    "mitral_valve": ("la", "lv_cavity", 1.5),
    "aortic_valve": ("lv_cavity", "aorta", 1.2),
    "tricuspid_valve": ("ra", "rv", 1.7),
    "pulmonary_valve": ("rv", "pulmonary_artery", 1.2),
}


def _unit(v):
    v = np.asarray(v, dtype=float)
    return v / np.linalg.norm(v)


# --------------------------------------------------------------------------------------------------
# Masks and fields


def structure_masks(labels: np.ndarray, source: str) -> dict[str, np.ndarray]:
    """Boolean masks keyed by role: lv_cavity, lv_myocardium, rv, la, ra, aorta, pulmonary_artery (+ <region>_wall when measured)."""
    masks = {}
    for value, structure in {**LABEL_MAPS[source], **GREAT_VEINS}.items():
        # LV keeps cavity / myocardium keys; other regions: blood pool under the region name, measured wall as <region>_wall
        role = structure.key if structure.region == "lv" else (f"{structure.region}_wall" if structure.kind == "wall" else structure.region)
        masks[role] = masks.get(role, False) | (labels == value)
    return masks


class FineGrid:
    """Heart bounding box resampled to FINE_MM; maps between fine indices and RAS mm."""

    def __init__(self, masks: dict[str, np.ndarray], affine: np.ndarray):
        spacing = np.linalg.norm(affine[:3, :3], axis=0)
        union = np.zeros(next(iter(masks.values())).shape, dtype=bool)
        for m in masks.values():
            union |= m
        idx = np.argwhere(union)
        margin = np.ceil(MARGIN_MM / spacing).astype(int)
        self.low = idx.min(axis=0) - margin
        high = idx.max(axis=0) + margin
        self.factor = spacing / FINE_MM  # fine steps per coarse voxel, per axis
        self.shape = tuple(np.ceil((high - self.low) * self.factor).astype(int) + 1)
        scale = np.diag(np.append(1.0 / self.factor, 1.0))
        shift = np.eye(4)
        shift[:3, 3] = self.low
        self.affine = affine @ shift @ scale  # fine index -> RAS mm
        self.inverse = np.linalg.inv(self.affine)
        self.coarse_affine = affine
        self._coords = None

    def coarse_coords(self):
        if self._coords is None:
            axes = [self.low[a] + np.arange(self.shape[a]) / self.factor[a] for a in range(3)]
            self._coords = np.meshgrid(*axes, indexing="ij")
        return self._coords

    def upsample(self, mask: np.ndarray) -> np.ndarray:
        """Smooth binary mask, trilinear onto the fine grid, threshold: a smooth fine mask."""
        blurred = ndimage.gaussian_filter(mask.astype(np.float32), sigma=0.6)
        return ndimage.map_coordinates(blurred, self.coarse_coords(), order=1, mode="constant") > 0.5

    def sdf(self, fine_mask: np.ndarray) -> np.ndarray:
        """Signed distance in mm, negative inside."""
        if not fine_mask.any():
            return np.full(fine_mask.shape, 1e3, dtype=np.float32)
        outside = ndimage.distance_transform_edt(~fine_mask, sampling=FINE_MM)
        inside = ndimage.distance_transform_edt(fine_mask, sampling=FINE_MM)
        return (outside - inside).astype(np.float32)

    def sample(self, field: np.ndarray, points_mm: np.ndarray) -> np.ndarray:
        idx = points_mm @ self.inverse[:3, :3].T + self.inverse[:3, 3]
        return ndimage.map_coordinates(field, idx.T, order=1, mode="nearest")


def build_fields(masks: dict[str, np.ndarray], grid: FineGrid) -> dict[str, np.ndarray]:
    fine = {role: grid.upsample(m) for role, m in masks.items()}
    lv_solid = fine["lv_cavity"] | fine["lv_myocardium"]
    f = {"lv_cavity": grid.sdf(fine["lv_cavity"])}
    # Where the LV cavity label has no myocardium around it (mostly the valve plane), a minimal wall
    # keeps the LV closed instead of relying on neighbouring synthetic walls to cover it.
    f["lv_outer"] = np.minimum(grid.sdf(lv_solid), f["lv_cavity"] - LV_MIN_WALL_MM)
    for role in WALL_MM:
        if role not in fine:
            fine[role] = np.zeros(grid.shape, bool)
        f[role] = grid.sdf(fine[role])
        # Measured wall when the source has one (Rodero meshes); otherwise a fixed-thickness wall. Either way only
        # where this blood pool is nearer than the LV epicardium (Voronoi split), so it never covers the LV outer surface.
        wall = f"{role}_wall"
        own = grid.sdf(fine[role] | fine[wall]) if wall in fine else f[role] - WALL_MM[role]
        f[f"{role}_outer"] = np.maximum(own, f[role] - f["lv_outer"])
    f["outer"] = np.minimum.reduce([f["lv_outer"]] + [f[f"{r}_outer"] for r in WALL_MM])
    f["cavity"] = np.minimum.reduce([f["lv_cavity"]] + [f[r] for r in WALL_MM])
    f["solid"] = np.maximum(f["outer"], -f["cavity"])
    return f


# --------------------------------------------------------------------------------------------------
# Mesh and attributes


def tissue_mesh(fields: dict[str, np.ndarray], grid: FineGrid, target_faces: int) -> trimesh.Trimesh:
    padded = np.pad(-fields["solid"], 1, constant_values=-1e3)  # positive inside tissue
    # Distances and wall thicknesses are multiples of the grid step, so many samples are exactly 0;
    # a level exactly at 0 yields degenerate triangles (and holes once they are removed).
    verts, faces, _, _ = measure.marching_cubes(padded, level=ISO_OFFSET_MM)
    verts -= 1.0
    world = verts @ grid.affine[:3, :3].T + grid.affine[:3, 3]
    mesh = trimesh.Trimesh(world, faces, process=True)
    if mesh.volume < 0:
        mesh.invert()
    # Drop sub-0.5 mL bubbles where labels leave slivers. Closed atrial cavities are separate inner
    # surfaces of the same solid (negative volume), so the size test uses |volume|.
    pieces = mesh.split(only_watertight=False)
    mesh = trimesh.util.concatenate([p for p in pieces if abs(p.volume) >= MIN_PIECE_MM3])
    trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=-0.53, iterations=8)
    if len(mesh.faces) > target_faces:
        mesh = mesh.simplify_quadric_decimation(face_count=target_faces)
        # Decimation can pinch off a few slivers; drop them again.
        mesh = trimesh.util.concatenate([p for p in mesh.split(only_watertight=False) if abs(p.volume) >= MIN_PIECE_MM3])
    return mesh


def open_edge_count(mesh: trimesh.Trimesh) -> int:
    """Edges not shared by exactly two faces (0 for a closed manifold surface)."""
    return int(np.count_nonzero(np.bincount(mesh.edges_unique_inverse) != 2))


def vertex_attributes(points_mm: np.ndarray, fields: dict[str, np.ndarray], grid: FineGrid):
    """(weights uint8 n x 4, tissue uint8 n x 4) following build.ts vertexAttributes()."""
    s = {k: grid.sample(fields[k], points_mm) for k in (
        "lv_outer", "rv_outer", "la_outer", "ra_outer", *(f"{r}_outer" for r in VESSEL_ROLES),
        "outer", "cavity", "lv_cavity", "rv", "la", "ra", *VESSEL_ROLES,
    )}
    vessel_outers = np.stack([s[f"{r}_outer"] for r in VESSEL_ROLES], axis=1)
    vessel_outer = vessel_outers.min(axis=1)
    membership = np.stack([
        s["lv_outer"] - 1.2,
        np.maximum(s["rv_outer"], -s["lv_outer"]),  # RV only outside the LV (septum belongs to the LV)
        s["la_outer"],
        s["ra_outer"],
        vessel_outer + 0.8,
    ], axis=1)
    e = np.exp(-(membership - membership.min(axis=1, keepdims=True)) / WEIGHT_TAU_MM)
    w = e / e.sum(axis=1, keepdims=True)

    d_out, d_cav = s["outer"], s["cavity"]
    depth = np.clip(-d_out / (-d_out + np.maximum(d_cav, 1e-4)), 0, 1)
    depth[d_out > 0] = 0

    lumens = np.stack([s["lv_cavity"], s["rv"], s["la"], s["ra"], *(s[r] for r in VESSEL_ROLES)], axis=1)
    nearest_lumen = lumens.argmin(axis=1)  # region ids 0..7 line up with REGION
    chamber_outer = np.stack([s["lv_outer"], s["rv_outer"], s["la_outer"], s["ra_outer"]], axis=1)
    vessel_dominant = vessel_outer < chamber_outer.min(axis=1) - 0.5
    nearest_vessel = vessel_outers.argmin(axis=1)
    vessel_region = REGION["aorta"] + nearest_vessel

    endo = depth > 0.5
    region = np.where(endo, nearest_lumen, np.where(vessel_dominant, vessel_region, w[:, :4].argmax(axis=1)))
    # As in build.ts: off the endocardium the kind is the nearest vessel's (all arteries here); the shader
    # blends its colour by the anchored weight, so chamber walls stay myocardium-coloured.
    vein = np.where(endo, nearest_lumen >= REGION["vena_cava"], nearest_vessel >= 2)
    kind = np.where(endo & (nearest_lumen < 4), KIND_MYOCARDIUM, np.where(vein, KIND_GREAT_VEIN, KIND_GREAT_ARTERY))

    weights = np.round(w[:, :4] * 255).astype(np.uint8)
    tissue = np.stack([
        np.round(depth * 255), np.zeros_like(depth), kind, region,  # no epicardial fat in the labels
    ], axis=1).astype(np.uint8)
    return weights, tissue


# --------------------------------------------------------------------------------------------------
# Manifest geometry (app frame, cm)


class Frame:
    """RAS mm <-> app cm with the heart centred."""

    def __init__(self, centre_mm):
        self.centre_mm = np.asarray(centre_mm, dtype=float)

    def point(self, p_mm):
        return (np.asarray(p_mm, dtype=float) - self.centre_mm) @ RAS_TO_APP.T

    def direction(self, d_ras):
        return _unit(np.asarray(d_ras, dtype=float) @ RAS_TO_APP.T)


def voxel_points(mask: np.ndarray, affine: np.ndarray) -> np.ndarray:
    idx = np.argwhere(mask)
    return idx @ affine[:3, :3].T + affine[:3, 3]


def find_valve(up: np.ndarray, down: np.ndarray, affine: np.ndarray, frame: Frame, default_radius: float, heart: np.ndarray):
    """Valve plane from the voxels where two blood pools touch, away from the heart's outer surface.

    Labels can also meet along the outside of the AV groove (where they include wall); those contacts
    would drag the annulus to the epicardium, so only contacts >= VALVE_MIN_DEPTH_MM inside count.
    """
    touching = up & ndimage.binary_dilation(down, iterations=2)
    touching |= down & ndimage.binary_dilation(up, iterations=2)
    spacing = np.linalg.norm(affine[:3, :3], axis=0)
    touching &= ndimage.distance_transform_edt(heart, sampling=spacing) >= VALVE_MIN_DEPTH_MM
    up_c = frame.point(voxel_points(up, affine).mean(axis=0))
    down_c = frame.point(voxel_points(down, affine).mean(axis=0))
    flow = _unit(down_c - up_c)
    if np.count_nonzero(touching) >= 12:
        pts = frame.point(voxel_points(touching, affine))
        centre = pts.mean(axis=0)
        _, _, vt = np.linalg.svd(pts - centre, full_matrices=False)
        normal = vt[2] if vt[2] @ flow >= 0 else -vt[2]
        in_plane = (pts - centre) - np.outer((pts - centre) @ normal, normal)
        radius = float(np.sqrt(2 * np.mean(np.sum(in_plane**2, axis=1))))
        return {"center": centre, "normal": normal, "radius": radius, "found": True}
    # Not touching in the labels: midpoint of the closest pair of voxels, flow direction as normal.
    a, b = frame.point(voxel_points(up, affine)), frame.point(voxel_points(down, affine))
    dist, j = cKDTree(b).query(a)
    i = int(np.argmin(dist))
    return {"center": (a[i] + b[j[i]]) / 2, "normal": flow, "radius": default_radius, "found": False}


def find_vessel_valve(up: np.ndarray, vessel: np.ndarray, affine: np.ndarray, frame: Frame, default_radius: float):
    """Semilunar valve at the vessel root: the vessel's cross-section nearest the upstream chamber.

    Labels often leave a gap (or a tiny contact) between ventricle and great artery, so the contact
    patch is unreliable; the vessel's own root is not.
    """
    spacing = np.linalg.norm(affine[:3, :3], axis=0)
    dist = ndimage.distance_transform_edt(~up, sampling=spacing)[vessel]
    pts_mm = voxel_points(vessel, affine)
    d_min = float(dist.min())
    root = frame.point(pts_mm[dist <= d_min + 5.0])
    trunk = frame.point(pts_mm[dist <= d_min + 25.0])
    centre = root.mean(axis=0)
    _, _, vt = np.linalg.svd(trunk - trunk.mean(axis=0), full_matrices=False)
    normal = vt[0] if vt[0] @ (trunk.mean(axis=0) - centre) >= 0 else -vt[0]
    q = root - centre
    in_plane = q - np.outer(q @ normal, normal)
    radius = float(np.sqrt(2 * np.mean(np.sum(in_plane**2, axis=1))))
    # touching within ~2 voxels counts as found; otherwise the root is still a good estimate
    return {"center": centre, "normal": normal, "radius": radius if radius > 0.3 else default_radius,
            "found": d_min <= 2.5 * float(spacing.max()), "gapMm": round(d_min, 1)}


def lv_frame(masks, affine, frame: Frame, mitral_centre):
    cav = frame.point(voxel_points(masks["lv_cavity"], affine))
    solid = frame.point(voxel_points(masks["lv_cavity"] | masks["lv_myocardium"], affine))
    centroid = cav.mean(axis=0)
    _, _, vt = np.linalg.svd(cav - centroid, full_matrices=False)
    axis = vt[0] if vt[0] @ (centroid - mitral_centre) > 0 else -vt[0]  # base -> apex
    base = centroid + axis * ((mitral_centre - centroid) @ axis)
    rv_c = frame.point(voxel_points(masks["rv"], affine).mean(axis=0))
    sep = _unit((rv_c - base) - ((rv_c - base) @ axis) * axis)
    ant = np.cross(sep, axis)  # same handedness as build.ts (anteriorDir = septal x axis)

    def cyl(pts):
        q = pts - base
        along = q @ axis
        radial = q - np.outer(along, axis)
        return along, np.linalg.norm(radial, axis=1), np.degrees(np.arctan2(radial @ ant, radial @ sep)) % 360

    cav_along, cav_r, cav_th = cyl(cav)
    sol_along, sol_r, sol_th = cyl(solid)
    cav_base, cav_apex = 0.0, float(np.percentile(cav_along, 99.5))
    epi_apex = float(np.percentile(sol_along, 99.5))

    def ring_radius(along, r, th, s, theta, half_s=0.06, half_th=20):
        sel = (np.abs((along - cav_base) / (cav_apex - cav_base) - s) < half_s)
        sel &= np.abs((th - theta + 180) % 360 - 180) < half_th
        return float(np.percentile(r[sel], 95)) if sel.sum() > 3 else float("nan")

    endo, epi = [], []
    for s in (0.3, 0.4, 0.5, 0.6):
        for theta in range(0, 360, 30):
            endo.append(ring_radius(cav_along, cav_r, cav_th, s, theta))
            epi.append(ring_radius(sol_along, sol_r, sol_th, s, theta))
    endo, epi = np.array(endo), np.array(epi)
    ok = ~np.isnan(endo) & ~np.isnan(epi)
    level = 0.3
    measure_at = lambda theta: (ring_radius(cav_along, cav_r, cav_th, level, theta), ring_radius(sol_along, sol_r, sol_th, level, theta))
    sep_endo, sep_epi = measure_at(0)
    lat_endo, lat_epi = measure_at(180)
    return {
        "base": base, "axis": axis, "septalDir": sep, "anteriorDir": ant,
        "cavityBaseAlong": cav_base, "cavityApexAlong": cav_apex, "epiApexAlong": epi_apex,
        "meanCavityRadius": float(np.mean(endo[ok])), "meanWallThickness": float(np.mean(epi[ok] - endo[ok])),
        "lvEddMm": (sep_endo + lat_endo) * 10, "ivsMm": (sep_epi - sep_endo) * 10, "lvpwMm": (lat_epi - lat_endo) * 10,
        "measurementLevelAlong": cav_base + level * (cav_apex - cav_base),
    }


def snap_inside(target, mask: np.ndarray, affine: np.ndarray, frame: Frame, min_depth_mm: float):
    """Nearest point to `target` (app cm) that lies inside `mask` at least min_depth_mm from its wall.

    Papillary muscles are placed by rule; this keeps them (and their chordae) inside the cavity even
    when the cavity is a thin crescent like the RV.
    """
    spacing = np.linalg.norm(affine[:3, :3], axis=0)
    depth = ndimage.distance_transform_edt(mask, sampling=spacing)
    deep = depth >= min(min_depth_mm, 0.6 * float(depth.max()))
    pts = frame.point(voxel_points(deep, affine))
    return pts[np.argmin(np.sum((pts - np.asarray(target)) ** 2, axis=1))]


def lv_point(lv, s, theta_deg, r):
    along = lv["cavityBaseAlong"] + s * (lv["cavityApexAlong"] - lv["cavityBaseAlong"])
    t = np.radians(theta_deg)
    return lv["base"] + lv["axis"] * along + r * (np.cos(t) * lv["septalDir"] + np.sin(t) * lv["anteriorDir"])


def surface_anchor(points, tissue, region_id, direction):
    """Epicardial vertex of a region furthest along a direction (where a label line should point)."""
    sel = (tissue[:, 3] == region_id) & (tissue[:, 0] < 50)
    if not sel.any():
        return None
    cand = points[sel]
    return cand[np.argmax(cand @ _unit(direction))]


def _r(v, d=4):
    return [round(float(x), d) for x in v] if np.ndim(v) else round(float(v), d)


# Source-image evidence for the slice views: label index -> (key, name, colour). Colours follow the app's
# clinical-overlay legend (src/components/workspace/Legend.tsx).
CT_STRUCTURES = [
    ("lv_cavity", "LV cavity", (0.80, 0.33, 0.06)),
    ("lv_myocardium", "LV myocardium", (0.93, 0.55, 0.62)),
    ("rv", "RV (label may include wall)", (0.05, 0.38, 0.68)),
    ("la", "Left atrium", (0.86, 0.60, 0.10)),
    ("ra", "Right atrium", (0.30, 0.62, 0.85)),
    ("aorta", "Aorta", (0.72, 0.36, 0.55)),
    ("pulmonary_artery", "Pulmonary artery", (0.10, 0.58, 0.44)),
]
CT_HU_RANGE = (-300.0, 700.0)  # 8-bit display range: blood pool, myocardium, fat, contrast
CT_MARGIN_MM = 20.0


def ct_volumes(ct: np.ndarray, masks: dict[str, np.ndarray], affine: np.ndarray, frame: Frame):
    """Crop the CT to the heart, rescale to 8 bit, and build a matching label-index volume."""
    heart = np.logical_or.reduce(list(masks.values()))
    spacing = np.linalg.norm(affine[:3, :3], axis=0)
    margin = np.ceil(CT_MARGIN_MM / spacing).astype(int)
    idx = np.argwhere(heart)
    lo = np.maximum(idx.min(axis=0) - margin, 0)
    hi = np.minimum(idx.max(axis=0) + margin + 1, heart.shape)
    crop = tuple(slice(a, b) for a, b in zip(lo, hi))
    lo_hu, hi_hu = CT_HU_RANGE
    image = np.clip((ct[crop].astype(np.float32) - lo_hu) / (hi_hu - lo_hu) * 255, 0, 255).round().astype(np.uint8)
    index = np.zeros(image.shape, dtype=np.uint8)
    structures = []
    voxel_ml = abs(np.linalg.det(affine[:3, :3])) / 1000
    for i, (key, name, colour) in enumerate(CT_STRUCTURES, start=1):
        m = masks[key][crop] & (index == 0)
        index[m] = i
        structures.append({"index": i, "key": key, "name": name, "colour": list(colour), "volumeMl": round(float(m.sum()) * voxel_ml, 1)})
    shift = np.eye(4)
    shift[:3, 3] = lo
    crop_affine = affine @ shift
    to_app = np.eye(4)
    to_app[:3, :3] = RAS_TO_APP @ crop_affine[:3, :3]
    to_app[:3, 3] = frame.point(crop_affine[:3, 3])
    meta = {
        "modality": "CT (contrast-enhanced, single phase)",
        "image": "ct.u8.gz", "labels": "ctlabels.u8.gz",
        "dims": [int(v) for v in image.shape], "order": "C (i slowest, k fastest)",
        "spacingMm": [round(float(v), 4) for v in np.linalg.norm(crop_affine[:3, :3], axis=0)],
        "voxelToApp": [[round(float(v), 6) for v in row] for row in to_app],
        "intensity": {"unit": "HU", "byte0": lo_hu, "byte255": hi_hu},
        "structures": structures,
    }
    return meta, image, index


FIDELITY_POOLS = [
    ("lv_cavity", "LV cavity (endocardium)"),
    ("rv", "RV blood pool"),
    ("la", "Left atrium"),
    ("ra", "Right atrium"),
    ("aorta", "Aorta lumen"),
    ("pulmonary_artery", "Pulmonary artery lumen"),
]


def heart_fidelity(mesh: trimesh.Trimesh, fields, grid: "FineGrid", masks, affine, prov: np.ndarray | None = None) -> dict:
    """COR-Fit report for the rendered tissue mesh (RAS mm), against the labels it was built from.

    A vertex lies on the cavity side where |cavity| < |outer| (the solid is max(outer, -cavity) = 0);
    the structure is the field component that is smallest there. Only imaging-derived surfaces are
    measured: every blood pool and the LV epicardium. Other outer walls are a fixed offset (not from
    imaging) and are listed as such. With `prov`, only measured (source) voxels are scored: atlas
    continuations are left out, and so are the faces a measured voxel shares with its own continuation
    (they are interior to the reconstructed vessel). No measured voxel is dropped.
    """
    from .vessels import PROV
    v = np.asarray(mesh.vertices)
    tol = float(np.linalg.norm(affine[:3, :3], axis=0).max())  # one voxel
    measured = np.ones(next(iter(masks.values())).shape, bool) if prov is None else prov == PROV["ct"]
    m_ = {k: m & measured for k, m in masks.items()}
    added = {k: m & ~measured for k, m in masks.items()}
    # faces a measured voxel shares with *any* atlas continuation are interior to the reconstructed heart
    # (a cut vessel end, a vein inlet on an atrium): no rendered surface exists there any more
    covered = np.logical_or.reduce(list(added.values()))
    added = {k: covered for k in masks}
    pools = [k for k, _ in FIDELITY_POOLS]
    # great veins take part in the nearest-structure test (so their surfaces are never given to a chamber) but
    # are not scored: no source labels them
    unscored = ["vena_cava", "pulmonary_veins"]
    pool_vals = np.stack([grid.sample(fields[k], v) for k in pools + unscored], axis=1)
    outer_keys = ["lv_outer"] + [f"{k}_outer" for k in pools[1:] + unscored]
    outer_vals = np.stack([grid.sample(fields[k], v) for k in outer_keys], axis=1)
    endo = np.abs(grid.sample(fields["cavity"], v)) < np.abs(grid.sample(fields["outer"], v))
    pool_id, outer_id = pool_vals.argmin(axis=1), outer_vals.argmin(axis=1)

    def on_measured(mask):
        """Vertices whose nearest voxel *of this structure* is measured: the atlas part of a vessel is never
        scored on the mesh side, even where it passes close to another measured structure."""
        if prov is None:
            return np.ones(len(v), bool)
        from scipy.spatial import cKDTree
        idx = np.argwhere(mask)
        if not len(idx):
            return np.zeros(len(v), bool)
        near = cKDTree(idx @ affine[:3, :3].T + affine[:3, 3]).query(v)[1]
        return measured[tuple(idx[near].T)]

    rows = []
    for i, (key, name) in enumerate(FIDELITY_POOLS):
        others = np.logical_or.reduce([masks[k] for k in pools if k != key]) | added[key]
        m = surface_metrics(mesh, np.flatnonzero(endo & (pool_id == i) & on_measured(masks[key])), boundary_points(m_[key], affine, exclude=others), tol)
        rows.append({"key": key, "name": name, "source": "CT label boundary", **(m or {"nsdPercent": None})})
    lv = m_["lv_cavity"] | m_["lv_myocardium"]
    others = np.logical_or.reduce([masks[k] for k in pools[1:]])
    m = surface_metrics(mesh, np.flatnonzero(~endo & (outer_id == 0) & on_measured(masks["lv_cavity"] | masks["lv_myocardium"])),
                        boundary_points(lv, affine, exclude=others), tol)
    rows.append({"key": "lv_epicardium", "name": "LV epicardium (myocardium outer)", "source": "CT label boundary", **(m or {"nsdPercent": None})})
    if all(f"{k}_wall" in masks for k in pools[1:]):
        # measured walls (Rodero meshes): each outer wall against the boundary of its own pool + wall label
        for i, (key, name) in enumerate(FIDELITY_POOLS[1:], start=1):
            own = m_[key] | m_[f"{key}_wall"]
            rest = np.logical_or.reduce([masks["lv_cavity"] | masks["lv_myocardium"]] + [masks[k] | masks[f"{k}_wall"] for k in pools[1:] if k != key]) | added[key]
            m = surface_metrics(mesh, np.flatnonzero(~endo & (outer_id == i) & on_measured(masks[key] | masks[f"{key}_wall"])),
                                boundary_points(own, affine, exclude=rest), tol)
            rows.append({"key": f"{key}_outer", "name": f"{name} outer wall", "source": "source mesh wall", **(m or {"nsdPercent": None})})
    else:
        rows.append({"key": "other_walls", "name": "RV, atrial and vessel outer walls", "source": "fixed thickness, not from imaging", "nsdPercent": None})
    scored = int(np.count_nonzero(np.logical_or.reduce(list(m_.values()))))
    return {"toleranceMm": round(tol, 2), "structures": rows, "overall": summarise(rows, round(tol, 2)), "scoredSourceVoxels": scored}


# vessels the stenosis input addresses (VESSEL_ID LM 1, LAD 2, LCx 3, RCA 4, PDA 5): a heart without them cannot ship
STENOSIS_VESSELS = ("LM", "LAD", "LCx", "RCA", "PDA")


def _atlas_coronaries(hi, samples, grid, fields, valves, lv, to_ras_pt, aortic_ras, apex_app, surface_at, normals_at,
                      atlas_fit: str = "all"):
    """BodyParts3D coronaries and veins registered onto this heart (docs/atlas-heart.md).

    atlas_fit="shell" (Tier B): the warp pairs only the atlas's outer shell with the epicardium, and a branch outside
    STENOSIS_VESSELS that still fails the fit limits is left out (reported) instead of failing the build.
    """
    import trimesh
    from .atlas import ATLAS_PARTS, DEFAULT_ROOT, load_parts
    from .coronary import atlas_coronaries
    from .register import VALVE_KEYS, atlas_landmarks, bp3d_to_app_mm, fit

    keys = [k for k, p in ATLAS_PARTS.items() if p.kind in ("chamber", "valve", "coronary_artery", "coronary_vein")]
    parts = load_parts(DEFAULT_ROOT, keys)
    epi_v = (np.abs(samples["outer"]) < 0.8) & (samples["cavity"] > 0.9)
    epi = trimesh.Trimesh(hi.vertices, hi.faces[epi_v[hi.faces].all(axis=1)], process=True)
    to_target = lambda p: to_ras_pt(bp3d_to_app_mm(p) / 10.0)   # atlas frame -> this heart's RAS (orientation; the warp fits the rest)
    a = {k: to_ras_pt(v[None] / 10.0)[0] for k, v in atlas_landmarks(parts).items()}
    b = {k: to_ras_pt(np.asarray(valves[n]["center"], float)[None])[0] for k, n in VALVE_KEYS.items()}
    b["apex"] = to_ras_pt(np.asarray(apex_app, float)[None])[0]
    chambers = trimesh.util.concatenate([parts[k] for k in ("left_ventricle", "right_ventricle", "left_atrium", "right_atrium")])
    aepi = trimesh.Trimesh(to_target(chambers.vertices), chambers.faces, process=False)
    shell = atlas_fit == "shell"
    w = fit(aepi, epi, a, b, n_surface=1500, rounds=6, smoothing=2.0, surface="shell" if shell else "all")
    vessels = {k: m for k, m in parts.items() if ATLAS_PARTS[k].kind in ("coronary_artery", "coronary_vein")}
    outer_at = lambda p: grid.sample(fields["outer"], p)
    lines, radii, sources, report = atlas_coronaries(vessels, lambda p: w(to_target(p)), surface_at, normals_at, outer_at,
                                                     aortic_ras, to_ras_pt(np.asarray(apex_app, float)[None])[0], scale=w.s,
                                                     required=STENOSIS_VESSELS if shell else None)
    report["_registration"] = {"scale": round(float(w.s), 3), "method": "landmark similarity + thin-plate spline (6 ICP rounds)"
                               + (", surface pairs from the atlas outer shell" if shell else "")}
    return lines, radii, sources, report


def _prov_sampler(prov: np.ndarray | None, affine: np.ndarray):
    """Per-vertex provenance code from the labels-grid provenance volume (nearest labelled voxel); all CT without one."""
    from .vessels import PROV, PROV_NONE
    if prov is None:
        return lambda pts: np.full(len(pts), PROV["ct"], np.uint8)
    _, ind = ndimage.distance_transform_edt(prov == PROV_NONE, return_indices=True)
    inv = np.linalg.inv(affine)

    def sample(pts):
        ijk = np.rint(np.asarray(pts) @ inv[:3, :3].T + inv[:3, 3]).astype(int)
        ijk = np.clip(ijk, 0, np.array(prov.shape) - 1)
        near = ind[:, ijk[:, 0], ijk[:, 1], ijk[:, 2]]
        return prov[near[0], near[1], near[2]].astype(np.uint8)
    return sample


def _prov4(codes: np.ndarray) -> np.ndarray:
    return np.stack([codes, np.zeros_like(codes), np.zeros_like(codes), np.zeros_like(codes)], axis=1).astype(np.uint8)


def build_asset(labels, affine, source: str, case_id: str, dataset: dict | None, lods=(("high", 300_000), ("low", 120_000)), ct=None, with_coronaries: bool = False,
                coronaries: str = "routed", prov: np.ndarray | None = None, atlas_fit: str = "all"):
    """Returns ({lod: glb bytes}, manifest dict, lv cavity proxy dict, qa list, volumes or None).

    With `ct` (the CT on the labels' grid), volumes = (meta, image u8, label-index u8) for the slice views.
    """
    masks = structure_masks(labels, source)
    grid = FineGrid(masks, affine)
    fields = build_fields(masks, grid)

    meshes = {lod: tissue_mesh(fields, grid, faces) for lod, faces in lods}
    first = meshes[lods[0][0]]
    centre_mm = (first.vertices.min(axis=0) + first.vertices.max(axis=0)) / 2
    frame = Frame(centre_mm)
    qa = []
    for lod, mesh in meshes.items():
        if (n := open_edge_count(mesh)) > 0:
            qa.append({"level": "info" if n < 50 else "warning", "structure": f"heart_tissue ({lod})", "message": f"{n} open edges after decimation"})

    heart = np.logical_or.reduce(list(masks.values()))
    valves = {}
    for name, (up, down, default_r) in VALVES.items():
        if down in ("aorta", "pulmonary_artery"):
            v = find_vessel_valve(masks[up], masks[down], affine, frame, default_r)
            if not v["found"]:
                qa.append({"level": "info", "structure": name, "message": f"{v['gapMm']} mm gap between chamber and vessel labels; valve placed at the vessel root"})
        else:
            v = find_valve(masks[up], masks[down], affine, frame, default_r, heart)
            if not v["found"]:
                qa.append({"level": "warning", "structure": name, "message": "blood pools do not touch; valve placed between them with a default radius"})
        if not 0.7 <= v["radius"] <= 2.5:
            qa.append({"level": "warning", "structure": name, "message": f"valve radius {v['radius']:.2f} cm outside 0.7-2.5 cm"})
        valves[name] = v

    lv = lv_frame(masks, affine, frame, valves["mitral_valve"]["center"])
    centroid = lambda role: frame.point(voxel_points(masks[role], affine).mean(axis=0))
    rv_c, la_c, ra_c = centroid("rv"), centroid("la"), centroid("ra")
    rv_sep = _unit((lv["base"] - rv_c) - ((lv["base"] - rv_c) @ lv["axis"]) * lv["axis"])

    ao = valves["aortic_valve"]
    ostia_app = {
        "left": ao["center"] + ao["normal"] * 0.8 + _unit(np.cross(ao["normal"], np.cross([1.0, 0, 0], ao["normal"]))) * ao["radius"],
        "right": ao["center"] + ao["normal"] * 0.8 + _unit(np.cross(ao["normal"], np.cross([0, 0, 1.0], ao["normal"]))) * ao["radius"],
    }
    coronary = None
    if with_coronaries:
        from scipy.spatial import cKDTree
        from .coronary import VESSELS, _smooth, build_vessels, route
        hi = meshes[lods[0][0]]
        to_ras_dir = lambda d: _unit(np.asarray(d, dtype=float) @ RAS_TO_APP)
        to_ras_pt = lambda p: np.asarray(p, dtype=float) @ RAS_TO_APP * 100 + frame.centre_mm
        samples = {k: grid.sample(fields[k], hi.vertices) for k in ("lv_outer", "rv_outer", "la_outer", "ra_outer", "outer", "cavity")}
        apex_app = lv["base"] + lv["axis"] * lv["epiApexAlong"]
        # ostia from the aortic root itself: flow direction = valve centre -> aortic lumen centroid; the left
        # ostium sits in the left (posterior) sinus, the right ostium in the right (anterior) sinus, ~1 cm above the annulus
        ao_c = to_ras_pt(ao["center"])
        flow = _unit(voxel_points(masks["aorta"], affine).mean(axis=0) - ao_c)
        lat = lambda d: _unit(np.asarray(d, float) - (np.asarray(d, float) @ flow) * flow)
        r_mm = ao["radius"] * 10
        ostia_ras = {"left": ao_c + flow * 10 + lat([-1.0, -0.5, 0]) * r_mm,   # RAS: -x = left, -y = posterior
                     "right": ao_c + flow * 10 + lat([1.0, 1.0, 0]) * r_mm}      # right and anterior
        ostia_app = {k: frame.point(p) for k, p in ostia_ras.items()}
        vessel_sources, vessel_fit, radii = {}, None, None
        if coronaries == "routed":
            centrelines, debug = route(hi, samples, {"anterior": np.array([0.0, 1.0, 0.0]), "axis": to_ras_dir(lv["axis"])},
                                       ostia_ras, to_ras_pt(apex_app))
        def normals_at(pts):
            # outward direction = gradient of the epicardial distance field (robust where the mesh normals are not)
            e = 0.75
            g = np.stack([grid.sample(fields["outer"], pts + e * np.eye(3)[k]) - grid.sample(fields["outer"], pts - e * np.eye(3)[k]) for k in range(3)], axis=1)
            return g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-6)

        def surface_at(pts):
            # project onto the epicardium (outer field = 0) so a groove path sits on the surface, not below it
            for _ in range(3):
                pts = pts - normals_at(pts) * grid.sample(fields["outer"], pts)[:, None]
            return pts
        if coronaries == "atlas":
            centrelines, radii, vessel_sources, vessel_fit = _atlas_coronaries(
                hi, samples, grid, fields, valves, lv, to_ras_pt, ao_c, apex_app, surface_at, normals_at, atlas_fit)
            debug = {}
        import os
        if os.environ.get("COR_CORONARY_DEBUG"):
            np.savez_compressed(os.environ["COR_CORONARY_DEBUG"], v=hi.vertices, faces=hi.faces, outer=samples["outer"],
                                **{f"g_{k}": x for k, x in debug.items()}, **{f"path_{k}": c for k, c in centrelines.items()})
        centrelines = {k: surface_at(c) for k, c in centrelines.items()}
        pos, nrm, faces, t, r, vid = build_vessels(centrelines, normals_at, radii=radii)
        line_tree = cKDTree(np.concatenate(list(centrelines.values())))
        coronary = {"pos": pos, "nrm": nrm, "faces": faces, "t": t, "r": r, "vid": vid, "line_tree": line_tree,
                    "lengthsMm": {k: round(float(np.linalg.norm(np.diff(_smooth(c), axis=0), axis=1).sum()), 1) for k, c in centrelines.items()},
                    "vessels": {i: v for i, v in VESSELS.items() if v[0] in centrelines},
                    "sources": vessel_sources, "fit": vessel_fit, "method": coronaries}

    glbs, tissue_by_lod, points_by_lod = {}, {}, {}
    from .glb import write_glb
    from .vessels import PROV
    prov_at = _prov_sampler(prov, affine)

    for lod, mesh in meshes.items():
        weights, tissue = vertex_attributes(mesh.vertices, fields, grid)
        points = frame.point(mesh.vertices).astype(np.float32)
        normals = (np.asarray(mesh.vertex_normals) @ RAS_TO_APP.T * 10).astype(np.float32)
        parts = [{
            "name": "heart_tissue",
            "attributes": {"POSITION": points, "NORMAL": normals, "_WEIGHTS": weights, "_TISSUE": tissue,
                           "_PROV": _prov4(prov_at(mesh.vertices))},
            "indices": mesh.faces,
            "extras": {"structure": "myocardium", "layers": ["outer", "chambers", "vessels"]},
        }]
        if coronary is not None:
            # epicardial fat follows the arteries in their grooves: full within 3 mm of a centreline, gone by 9 mm
            d = coronary["line_tree"].query(mesh.vertices)[0]
            epi = tissue[:, 0] < 40
            fat = np.clip(1 - (d - 3) / 6, 0, 1) * epi
            tissue[:, 1] = np.round(fat * 255).astype(np.uint8)
            near_all = cKDTree(mesh.vertices).query(coronary["pos"])[1]
            from .coronary import VESSEL_KIND, VESSELS as _V
            VESSELS_BY_ID = {i: v[0] for i, v in _V.items()}
            kind_of = np.vectorize(lambda i: VESSEL_KIND.get(int(i), 3))(coronary["vid"]) if len(coronary["vid"]) else np.zeros(0)
            for mesh_name, kind in (("coronary_arteries", 3), ("cardiac_veins", 4)):
                keep = kind_of == kind
                if not keep.any():
                    continue
                remap = -np.ones(len(keep), np.int64)
                remap[keep] = np.arange(keep.sum())
                f = coronary["faces"][keep[coronary["faces"]].all(axis=1)]
                n = int(keep.sum())
                parts.append({
                    "name": mesh_name,
                    "attributes": {
                        "POSITION": frame.point(coronary["pos"][keep]).astype(np.float32),
                        "NORMAL": (coronary["nrm"][keep] @ RAS_TO_APP.T * 10).astype(np.float32),
                        "_WEIGHTS": weights[near_all[keep]],
                        "_TISSUE": np.tile(np.array([0, 0, kind, 8], np.uint8), (n, 1)),
                        "_PROV": _prov4(np.vectorize(lambda i: PROV["atlas"] if coronary["sources"].get(VESSELS_BY_ID.get(int(i), ""), "routed") == "atlas" else PROV["illustrative"])(coronary["vid"][keep]).astype(np.uint8)),
                        "_CORO": np.stack([coronary["vid"][keep], np.round(coronary["t"][keep] * 255),
                                           np.clip(np.round(coronary["r"][keep] / 0.05), 0, 255), np.zeros(n)], axis=1).astype(np.uint8),
                    },
                    "indices": remap[f],
                    "extras": {"structure": "coronary_vessels", "layers": ["coronary"]},
                })
        glbs[lod] = write_glb(parts, {"assetId": f"cor-ct-{case_id}", "version": "1.0.0"})
        tissue_by_lod[lod], points_by_lod[lod] = tissue, points

    pts, tis = points_by_lod[lods[0][0]], tissue_by_lod[lods[0][0]]
    heart_c = pts.mean(axis=0)
    ao, pa = valves["aortic_valve"], valves["pulmonary_valve"]
    sep_r = lv["meanCavityRadius"]
    up = np.array([0.0, 1.0, 0.0])
    anchors = {
        "lv": lv_point(lv, 0.45, 180, lv["meanCavityRadius"] + lv["meanWallThickness"]),
        "rv": surface_anchor(pts, tis, REGION["rv"], rv_c - heart_c),
        "la": surface_anchor(pts, tis, REGION["la"], la_c - heart_c),
        "ra": surface_anchor(pts, tis, REGION["ra"], ra_c - heart_c),
        "apex": lv["base"] + lv["axis"] * (lv["epiApexAlong"] - 0.2),
        "aorta": surface_anchor(pts, tis, REGION["aorta"], ao["normal"]),
        "pulmonary_artery": surface_anchor(pts, tis, REGION["pulmonary_artery"], pa["normal"]),
        "vena_cava": surface_anchor(pts, tis, REGION["ra"], up),
        "pulmonary_veins": surface_anchor(pts, tis, REGION["la"], np.array([0.0, 0.5, -1.0])),
        "coronary_vessels": lv_point(lv, 0.35, 60, lv["meanCavityRadius"] + lv["meanWallThickness"]),
        "myocardium": lv_point(lv, 0.4, 180, lv["meanCavityRadius"] + lv["meanWallThickness"]),
        **{k: v["center"] for k, v in valves.items()},
    }
    missing = [k for k, v in anchors.items() if v is None]
    for k in missing:
        qa.append({"level": "warning", "structure": k, "message": "no surface vertex for the label anchor; using the heart centre"})
        anchors[k] = heart_c

    def inside(target, role, depth_mm):
        return snap_inside(target, masks[role], affine, frame, depth_mm)

    def pap(s_base, s_tip, theta):
        return {"base": _r(inside(lv_point(lv, s_base, theta, 0.85 * sep_r), "lv_cavity", 3.0)),
                "tip": _r(inside(lv_point(lv, s_tip, theta, 0.45 * sep_r), "lv_cavity", 5.0))}

    vox_ml = abs(np.linalg.det(affine[:3, :3])) / 1000
    ml = lambda role: float(np.count_nonzero(masks[role]) * vox_ml)
    rv_pts = frame.point(voxel_points(masks["rv"], affine))
    rv_along = (rv_pts - lv["base"]) @ lv["axis"]
    rv_slab = rv_pts[(rv_along > 0.5) & (rv_along < 1.5)]
    rv_basal = float(np.ptp(rv_slab @ rv_sep)) * 10 if len(rv_slab) else float("nan")
    ra_pts = frame.point(voxel_points(masks["ra"], affine))
    _, _, ra_vt = np.linalg.svd(ra_pts - ra_pts.mean(axis=0), full_matrices=False)
    ra_proj = (ra_pts - ra_pts.mean(axis=0)) @ ra_vt[2]
    ra_minor = float(np.percentile(ra_proj, 97.5) - np.percentile(ra_proj, 2.5)) * 10

    lv_cav_mesh = trimesh.Trimesh(*measure.marching_cubes(np.pad(grid.upsample(masks["lv_cavity"]).astype(np.float32), 1), 0.5)[:2])
    lv_cav_mesh.vertices = frame.point((lv_cav_mesh.vertices - 1) @ grid.affine[:3, :3].T + grid.affine[:3, 3])
    if lv_cav_mesh.volume < 0:
        lv_cav_mesh.invert()
    lv_cav_mesh = lv_cav_mesh.simplify_quadric_decimation(face_count=8000)

    # COR-Fit: measured agreement of every rendered imaging-derived surface with its source labels
    fidelity = {
        "method": "COR-Fit v1: symmetric surface distance between the rendered mesh and the voxel boundary of its source label (docs/cor-fit.md)",
        "lods": {lod: heart_fidelity(mesh, fields, grid, masks, affine, prov) for lod, mesh in meshes.items()},
        "volume": {
            "lvCavityMeshMl": round(float(lv_cav_mesh.volume), 1),
            "lvCavityLabelMl": round(ml("lv_cavity"), 1),
            "errorPercent": round(float(100 * (lv_cav_mesh.volume - ml("lv_cavity")) / ml("lv_cavity")), 2),
        },
    }
    # the publication gate (docs/cor-fit.md) on the measured layers of the first LOD; a template that misses it is
    # still shipped, labelled, with the reason (never by scoring less)
    first_fit = fidelity["lods"][lods[0][0]]
    problems = gate(first_fit["overall"], [fidelity["volume"]["errorPercent"]])
    fidelity.update({"measuredOnly": True, "scoredSourceVoxels": first_fit["scoredSourceVoxels"],
                     "belowGate": bool(problems), "reason": "; ".join(problems)})

    measured_walls = all(f"{r}_wall" in masks for r in WALL_MM if r not in ("vena_cava", "pulmonary_veins"))
    from .vessels import PROV as PROV_CODES
    atlas = coronary is not None and coronary["method"] == "atlas"
    dataset_ivc = prov is not None and bool((prov == PROV_CODES["dataset"]).any())
    limitations = [
        "Shape from a CT segmentation, not reviewed by a clinician",
        "Single phase, cardiac phase unknown: motion is the template's illustrative motion",
        "All chamber and great-artery walls come from the source mesh" if measured_walls else
        f"Only the LV wall is from imaging; RV ({WALL_MM['rv']} mm), atrial ({WALL_MM['la']} mm) and vessel walls are a fixed thickness",
        ("Great vessels past the labels, venae cavae and pulmonary veins: BodyParts3D atlas fitted to this heart (CC BY-SA), "
         "not imaged" + ("; the IVC near the heart is the dataset's own label" if dataset_ivc else "")) if atlas else
        "No venae cavae or pulmonary veins in the labels; their label anchors are placed on the atria" if coronary is not None else
        "No coronary arteries, veins, venae cavae or pulmonary veins in the labels; their label anchors are placed on the atria",
        "Valves are generated at runtime at the label-derived annulus; leaflets are illustrative",
        "Papillary muscles and coronary ostia positions are illustrative (placed from the LV frame)",
        *(["Coronary arteries and cardiac veins: BodyParts3D atlas specimen fitted to this heart's epicardium (not imaged)",
           "Epicardial fat is illustrative (around the artery courses)"] if atlas else
          ["Coronary arteries routed along the grooves from a typical right-dominant pattern with published calibres; not this heart's imaging",
           "Epicardial fat is illustrative (around the artery courses)"] if coronary is not None else ["No epicardial fat in the labels"]),
        *[f"{name.replace('_', ' ')}: {r['reason']}" for name, r in (coronary["fit"] if atlas else {}).items()
          if isinstance(r, dict) and r.get("drawn") is False],
    ] + list((dataset or {}).get("knownLimitations", []))

    manifest = {
        "manifestVersion": "1.0.0",
        "assetId": f"cor-ct-{case_id}",
        "assetVersion": "1.0.0",
        "source": f"CT segmentation ({source}), case {case_id}, built by pipeline/cor_pipeline/asset.py",
        "author": "COR Heart Studio project (generated code)",
        "license": (dataset or {}).get("license", "see dataset"),
        "attribution": (dataset or {}).get("name", source) + (f" — {dataset['url']}" if dataset else ""),
        "redistribution": "Derived from the dataset above; follow its license",
        "units": "cm",
        "axes": {"x": "patient left", "y": "superior", "z": "anterior"},
        "anatomicalOrientation": "Patient frame from the CT affine; anterior view looks along -Z",
        "center": [0, 0, 0],
        "frameCentreRasMm": _r(frame.centre_mm),
        "bounds": {"min": _r(pts.min(axis=0)), "max": _r(pts.max(axis=0))},
        "provenanceTier": "B",
        "provenance": {
            "geometry": f"CT segmentation ({source})",
            "reviewedByClinician": False,
            "motion": "illustrative (template handles); single-phase CT",
        },
        "files": {lod: {"url": f"heart-{lod}.glb", "bytes": len(glbs[lod]), "triangles": [len(meshes[lod].faces)]} for lod in glbs},
        "attributes": {
            "_weights": "uint8 normalized vec4: deformation membership (lv, rv, la, ra); remainder = anchored vessels",
            "_tissue": "uint8 normalized vec4: x wall depth (0 epicardium .. 1 endocardium), y epicardial fat (always 0), z tissue kind byte, w region byte",
            "_prov": "uint8 vec4: x provenance code (0 measured from CT, 1 AI segmentation, 2 dataset label, 3 atlas fitted to this heart, 4 illustrative)",
            "tissueKinds": {"myocardium": 0, "greatArtery": 1, "greatVein": 2, "coronaryArtery": 3, "coronaryVein": 4},
            "regions": ["lv", "rv", "la", "ra", "aorta", "pulmonary_artery", "vena_cava", "pulmonary_veins", "coronary_vessels"],
        },
        "structureToMesh": {
            "myocardium": {"mesh": "heart_tissue", "note": "all walls from the source mesh" if measured_walls else "LV wall from imaging; other walls fixed thickness"},
            **{k: {"mesh": "heart_tissue", "region": v} for k, v in REGION.items()},
            **({"vena_cava": {"mesh": "heart_tissue", "region": REGION["vena_cava"], "note": "BodyParts3D atlas fitted to this heart, not imaged"
                              + ("; the IVC near the heart is the dataset's own label" if dataset_ivc else "")},
                "pulmonary_veins": {"mesh": "heart_tissue", "region": REGION["pulmonary_veins"], "note": "BodyParts3D atlas fitted to this heart, not imaged"}}
               if atlas else
               {k: {"mesh": None, "region": None, "absent": True, "note": "not in the segmentation labels"} for k in ("vena_cava", "pulmonary_veins")}),
            **({} if coronary is not None else {"coronary_vessels": {"mesh": None, "region": None, "absent": True, "note": "not in the segmentation labels"}}),
            **({"coronary_vessels": {"mesh": "coronary_arteries", "region": 8, "note":
                "BodyParts3D atlas fitted to this heart's epicardium, not imaged" if atlas else
                "routed along the grooves (right-dominant pattern), not from imaging"}} if coronary is not None else {}),
            "mitral_valve": {"runtime": "valve generator"}, "aortic_valve": {"runtime": "valve generator"},
            "tricuspid_valve": {"runtime": "valve generator"}, "pulmonary_valve": {"runtime": "valve generator"},
        },
        "deformation": {
            "method": "Same vertex-shader handles as the procedural asset, on chamber frames measured from the segmentation",
            "lv": {k: _r(lv[k]) for k in ("base", "axis", "septalDir", "anteriorDir", "cavityBaseAlong", "cavityApexAlong",
                                          "epiApexAlong", "meanCavityRadius", "meanWallThickness")},
            "rv": {"center": _r(rv_c), "axis": _r(lv["axis"]), "septalDir": _r(rv_sep), "wall": WALL_MM["rv"] / 10},  # handle radius, not a measurement
            "la": {"center": _r(la_c)},
            "ra": {"center": _r(ra_c)},
            "segmentConvention": "AHA 17-segment; angle measured around the LV long axis from the septal direction toward anterior",
        },
        "valves": {k: {"center": _r(v["center"]), "normal": _r(v["normal"]), "radius": _r(v["radius"]), "fromImaging": v["found"]} for k, v in valves.items()},
        "papillary": {
            "anterolateral": pap(0.62, 0.35, 150),
            "posteromedial": pap(0.62, 0.35, 270),
            "rvAnterior": {"base": _r(inside(rv_c + lv["axis"] * 1.2 - rv_sep * 1.0, "rv", 3.0)),
                           "tip": _r(inside(rv_c + lv["axis"] * 0.3 - rv_sep * 0.3, "rv", 5.0))},
        },
        "coronaryOstia": {k: _r(p) for k, p in ostia_app.items()},
        "anchors": {k: _r(v) for k, v in anchors.items()},
        **({"coronary": {
            "pattern": ("BodyParts3D atlas coronary arteries and cardiac veins (right-dominant specimen), registered onto this heart's "
                        "epicardium; not imaged in this scan. Obtuse marginal and SA-nodal artery are illustrative (not in the atlas)"
                        if coronary["method"] == "atlas" else
                        "right-dominant; LM, LAD, LCx, RCA, PDA routed along the AV and interventricular grooves (not from imaging)"),
            "dominance": "right",
            "method": coronary["method"],
            **({"fit": coronary["fit"], "license": "CC BY-SA 2.1 JP (BodyParts3D, DBCLS) — derived vessel meshes are CC BY-SA"}
               if coronary["method"] == "atlas" else {}),
            "vessels": {str(i): {"name": n, "proximalDiameterMm": d0, "distalDiameterMm": d1, "distalAssumed": a, "lengthMm": coronary["lengthsMm"].get(n),
                                 "source": coronary["sources"].get(n, "routed")}
                        for i, (n, d0, d1, a) in coronary["vessels"].items()},
            "diameterSource": "Dodge JT et al. Circulation 1992;86:232-46, doi:10.1161/01.cir.86.1.232",
            "attribute": "_CORO uint8 vec4: vessel id, position along the vessel (0..255), lumen radius in 0.05 mm, 0",
            "fat": "epicardial fat attribute set within 3-9 mm of the artery centrelines (illustrative)",
        }} if coronary is not None else {}),
        "baseline": {
            "note": "Measured from this segmentation (cardiac phase unknown). Not a clinical report.",
            "lvEndDiastolicVolumeMl": round(ml("lv_cavity"), 1),
            "lvEpicardialVolumeMl": round(ml("lv_cavity") + ml("lv_myocardium"), 1),
            "lvEndDiastolicDiameterMm": round(lv["lvEddMm"], 1),
            "ivsThicknessMm": round(lv["ivsMm"], 1),
            "lvPosteriorWallThicknessMm": round(lv["lvpwMm"], 1),
            "laVolumeMl": round(ml("la"), 1),
            "rvBasalDiameterMm": round(rv_basal, 1),
            "raMinorDimensionMm": round(ra_minor, 1),
            "measurementLevelAlong": _r(lv["measurementLevelAlong"]),
        },
        "morphTargets": [],
        "layers": ["outer", "chambers", "vessels", "valves", "overlays"],
        "cutaway": "Clip plane with back-face section shading; closed solid mesh so wall thickness reads in section",
        "animationChannels": ["ventricular volume", "longitudinal shortening", "torsion", "atrial volume", "valve opening"],
        "knownLimitations": limitations,
        "fidelity": fidelity,
    }
    proxy = {
        "note": f"LV cavity of CT case {case_id} (segmentation, phase unknown), centimetres, app frame.",
        "positions": [round(float(v), 3) for v in lv_cav_mesh.vertices.ravel()],
        "indices": [int(i) for i in lv_cav_mesh.faces.ravel()],
    }
    volumes = None
    if ct is not None:
        meta, image, index = ct_volumes(ct, masks, affine, frame)
        manifest["imaging"] = meta
        volumes = (meta, image, index)
    return glbs, manifest, proxy, qa, volumes
