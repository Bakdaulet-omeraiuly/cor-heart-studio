"""COR-Fit fidelity: how closely a built 3D surface follows the source segmentation.

For each structure we compare the rendered mesh surface with the boundary of the label it was built
from, in both directions:

    mesh -> labels   every mesh vertex to the nearest point of the label boundary
    labels -> mesh   points on the label boundary to the nearest point on the mesh surface

and report
    NSD   normalized surface Dice (Nikolov et al. 2018): share of both point sets within a tolerance
          (one voxel) of the other surface, in %
    mean  mean symmetric surface distance, mm
    HD95  95th percentile Hausdorff distance (max of the two directions), mm

The label boundary is the voxel boundary itself: the faces between a labelled voxel and an outside
neighbour, each face sampled at 3 x 3 points. Faces shared with another structure that is not
rendered as a surface there (e.g. the mitral orifice between LA and LV blood pools) are excluded.

This measures fidelity to the segmentation, not anatomical or clinical accuracy.
"""

import numpy as np
import trimesh
from scipy.spatial import cKDTree

FACE_SAMPLES = (-1 / 3, 0.0, 1 / 3)


def boundary_points(mask: np.ndarray, affine: np.ndarray, exclude: np.ndarray | None = None) -> np.ndarray:
    """World (mm) points on the voxel faces between `mask` and its outside, skipping faces whose
    outside neighbour is in `exclude`."""
    padded = np.pad(mask, 1)
    excl = np.pad(exclude, 1) if exclude is not None else None
    pts = []
    for axis in range(3):
        for step in (-1, 1):
            neighbour = np.roll(padded, -step, axis=axis)
            face = padded & ~neighbour
            if excl is not None:
                face &= ~np.roll(excl, -step, axis=axis)
            idx = np.argwhere(face).astype(np.float64) - 1.0  # undo padding
            if not len(idx):
                continue
            idx[:, axis] += 0.5 * step  # face centre
            others = [a for a in range(3) if a != axis]
            for du in FACE_SAMPLES:
                for dv in FACE_SAMPLES:
                    p = idx.copy()
                    p[:, others[0]] += du
                    p[:, others[1]] += dv
                    pts.append(p)
    if not pts:
        return np.zeros((0, 3))
    ijk = np.vstack(pts)
    return ijk @ affine[:3, :3].T + affine[:3, 3]


def surface_metrics(mesh: trimesh.Trimesh, vertex_ids: np.ndarray, label_pts: np.ndarray, tol_mm: float,
                    max_label_pts: int = 40_000, seed: int = 0) -> dict | None:
    """Symmetric surface agreement between the mesh faces spanned by `vertex_ids` and label points."""
    if len(vertex_ids) < 10 or len(label_pts) < 10:
        return None
    selected = np.zeros(len(mesh.vertices), dtype=bool)
    selected[vertex_ids] = True
    # a triangle on the border between two regions belongs to both (any vertex in the region)
    faces = np.flatnonzero(selected[mesh.faces].any(axis=1))
    if len(faces) < 10:
        return None
    sub = mesh.submesh([faces], append=True)
    d_mesh = cKDTree(label_pts).query(np.asarray(mesh.vertices)[vertex_ids])[0]
    rng = np.random.default_rng(seed)
    sample = label_pts if len(label_pts) <= max_label_pts else label_pts[rng.choice(len(label_pts), max_label_pts, replace=False)]
    _, d_label, _ = trimesh.proximity.closest_point(sub, sample)
    both = np.concatenate([d_mesh, d_label])
    return {
        "nsdPercent": round(float(100 * np.mean(both <= tol_mm)), 1),
        "meanMm": round(float(both.mean()), 2),
        "hd95Mm": round(float(max(np.percentile(d_mesh, 95), np.percentile(d_label, 95))), 2),
        "maxMm": round(float(max(d_mesh.max(), d_label.max())), 2),
        # per direction: how much of the mesh sits on the labels / how much of the labels is covered
        "meshToLabelPercent": round(float(100 * np.mean(d_mesh <= tol_mm)), 1),
        "labelToMeshPercent": round(float(100 * np.mean(d_label <= tol_mm)), 1),
        "points": int(len(both)),
    }


def summarise(rows: list[dict], tol_mm: float) -> dict:
    """Point-weighted overall NSD and mean distance across measured structures."""
    measured = [r for r in rows if r.get("nsdPercent") is not None]
    if not measured:
        return {}
    w = np.array([r["points"] for r in measured], dtype=float)
    return {
        "nsdPercent": round(float(np.average([r["nsdPercent"] for r in measured], weights=w)), 1),
        "meanMm": round(float(np.average([r["meanMm"] for r in measured], weights=w)), 2),
        "hd95MmWorst": max(r["hd95Mm"] for r in measured),
        "toleranceMm": tol_mm,
        "structures": len(measured),
    }


# Publication gate: a model reaches the app only if it follows its labels this closely.
GATE_NSD_PERCENT = 95.0
GATE_VOLUME_ERROR_PERCENT = 5.0


def gate(overall: dict, volume_errors: list[float]) -> list[str]:
    """Reasons a model fails the COR-Fit gate (empty = passes)."""
    problems = []
    if not overall or overall.get("nsdPercent", 0) < GATE_NSD_PERCENT:
        problems.append(f"surface agreement {overall.get('nsdPercent') if overall else None}% < {GATE_NSD_PERCENT}% within one voxel")
    bad = [e for e in volume_errors if abs(e) > GATE_VOLUME_ERROR_PERCENT]
    if bad:
        problems.append(f"volume error {max(bad, key=abs):+.1f}% exceeds ±{GATE_VOLUME_ERROR_PERCENT}%")
    return problems
