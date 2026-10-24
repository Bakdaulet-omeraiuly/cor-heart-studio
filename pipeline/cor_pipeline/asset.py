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

from .labels import LABEL_MAPS
from .mesh import RAS_TO_APP

FINE_MM = 0.75
WALL_MM = {"rv": 3.0, "la": 2.0, "ra": 2.0, "aorta": 2.0, "pulmonary_artery": 1.5}
MARGIN_MM = WALL_MM["rv"] + 4 * FINE_MM
ISO_OFFSET_MM = 0.013
MIN_PIECE_MM3 = 500.0
VALVE_MIN_DEPTH_MM = 6.0
# Soft-max membership, as in scripts/heart-asset/build.ts (tau 0.28 model units ~ 3.2 mm there).
WEIGHT_TAU_MM = 3.0
KIND_MYOCARDIUM, KIND_GREAT_ARTERY = 0, 1
REGION = {"lv": 0, "rv": 1, "la": 2, "ra": 3, "aorta": 4, "pulmonary_artery": 5}
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
    """Boolean masks keyed by role: lv_cavity, lv_myocardium, rv, la, ra, aorta, pulmonary_artery."""
    masks = {}
    for value, structure in LABEL_MAPS[source].items():
        role = structure.key if structure.region == "lv" else structure.region
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
    f = {
        "lv_outer": grid.sdf(lv_solid),
        "lv_cavity": grid.sdf(fine["lv_cavity"]),
    }
    for role in ("rv", "la", "ra", "aorta", "pulmonary_artery"):
        f[role] = grid.sdf(fine[role])
        f[f"{role}_outer"] = f[role] - WALL_MM[role]
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
        "lv_outer", "rv_outer", "la_outer", "ra_outer", "aorta_outer", "pulmonary_artery_outer",
        "outer", "cavity", "lv_cavity", "rv", "la", "ra", "aorta", "pulmonary_artery",
    )}
    vessel_outer = np.minimum(s["aorta_outer"], s["pulmonary_artery_outer"])
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

    lumens = np.stack([s["lv_cavity"], s["rv"], s["la"], s["ra"], s["aorta"], s["pulmonary_artery"]], axis=1)
    nearest_lumen = lumens.argmin(axis=1)  # region ids 0..5 line up with REGION
    chamber_outer = np.stack([s["lv_outer"], s["rv_outer"], s["la_outer"], s["ra_outer"]], axis=1)
    vessel_dominant = vessel_outer < chamber_outer.min(axis=1) - 0.5
    vessel_region = np.where(s["aorta_outer"] <= s["pulmonary_artery_outer"], REGION["aorta"], REGION["pulmonary_artery"])

    endo = depth > 0.5
    region = np.where(endo, nearest_lumen, np.where(vessel_dominant, vessel_region, w[:, :4].argmax(axis=1)))
    # As in build.ts: off the endocardium the kind is the nearest vessel's (all arteries here); the shader
    # blends its colour by the anchored weight, so chamber walls stay myocardium-coloured.
    kind = np.where(endo & (nearest_lumen < 4), KIND_MYOCARDIUM, KIND_GREAT_ARTERY)

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


def build_asset(labels, affine, source: str, case_id: str, dataset: dict | None, lods=(("high", 300_000), ("low", 120_000)), ct=None):
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

    glbs, tissue_by_lod, points_by_lod = {}, {}, {}
    from .glb import write_glb

    for lod, mesh in meshes.items():
        weights, tissue = vertex_attributes(mesh.vertices, fields, grid)
        points = frame.point(mesh.vertices).astype(np.float32)
        normals = (np.asarray(mesh.vertex_normals) @ RAS_TO_APP.T * 10).astype(np.float32)
        glbs[lod] = write_glb([{
            "name": "heart_tissue",
            "attributes": {"POSITION": points, "NORMAL": normals, "_WEIGHTS": weights, "_TISSUE": tissue},
            "indices": mesh.faces,
            "extras": {"structure": "myocardium", "layers": ["outer", "chambers", "vessels"]},
        }], {"assetId": f"cor-ct-{case_id}", "version": "1.0.0"})
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

    limitations = [
        "Shape from a CT segmentation, not reviewed by a clinician",
        "Single phase, cardiac phase unknown: motion is the template's illustrative motion",
        f"Only the LV wall is from imaging; RV ({WALL_MM['rv']} mm), atrial ({WALL_MM['la']} mm) and vessel walls are a fixed thickness",
        "No coronary arteries, veins, venae cavae or pulmonary veins in the labels; their label anchors are placed on the atria",
        "Valves are generated at runtime at the label-derived annulus; leaflets are illustrative",
        "Papillary muscles and coronary ostia positions are illustrative (placed from the LV frame)",
        "No epicardial fat in the labels",
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
            "tissueKinds": {"myocardium": 0, "greatArtery": 1, "greatVein": 2, "coronaryArtery": 3, "coronaryVein": 4},
            "regions": ["lv", "rv", "la", "ra", "aorta", "pulmonary_artery", "vena_cava", "pulmonary_veins", "coronary_vessels"],
        },
        "structureToMesh": {
            "myocardium": {"mesh": "heart_tissue", "note": "LV wall from imaging; other walls fixed thickness"},
            **{k: {"mesh": "heart_tissue", "region": v} for k, v in REGION.items()},
            **{k: {"mesh": None, "region": None, "absent": True, "note": "not in the segmentation labels"}
               for k in ("vena_cava", "pulmonary_veins", "coronary_vessels")},
            "mitral_valve": {"runtime": "valve generator"}, "aortic_valve": {"runtime": "valve generator"},
            "tricuspid_valve": {"runtime": "valve generator"}, "pulmonary_valve": {"runtime": "valve generator"},
        },
        "deformation": {
            "method": "Same vertex-shader handles as the procedural asset, on chamber frames measured from the segmentation",
            "lv": {k: _r(lv[k]) for k in ("base", "axis", "septalDir", "anteriorDir", "cavityBaseAlong", "cavityApexAlong",
                                          "epiApexAlong", "meanCavityRadius", "meanWallThickness")},
            "rv": {"center": _r(rv_c), "axis": _r(lv["axis"]), "septalDir": _r(rv_sep), "wall": WALL_MM["rv"] / 10},
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
        "coronaryOstia": {
            "left": _r(ao["center"] + ao["normal"] * 0.8 + _unit(np.cross(ao["normal"], np.cross([1.0, 0, 0], ao["normal"]))) * ao["radius"]),
            "right": _r(ao["center"] + ao["normal"] * 0.8 + _unit(np.cross(ao["normal"], np.cross([0, 0, 1.0], ao["normal"]))) * ao["radius"]),
        },
        "anchors": {k: _r(v) for k, v in anchors.items()},
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
