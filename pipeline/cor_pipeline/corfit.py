"""COR-Fit constrained smoothing: smooth surfaces that cannot leave their source voxels.

1. Marching cubes on the binary label mask (no blur): every vertex lies exactly on a voxel face,
   i.e. on the boundary of the segmentation.
2. Taubin smoothing (shrink-free low-pass) in voxel-index space, where after every half-step each
   vertex is clamped to the box of +/- `bound` voxel around its original position.
3. Optional decimation (quadric error), measured afterwards by the fidelity report.

So the smoothed surface is guaranteed to stay within `bound` voxel (per axis) of the label boundary,
while the voxel staircase is removed. Mapping to world coordinates happens last, through the scan's
affine, so the bound holds in the scan's own geometry.
"""

import numpy as np
import trimesh
from skimage import measure


def constrained_surface(mask: np.ndarray, affine: np.ndarray, iterations: int = 30, bound: float = 0.5,
                        lamb: float = 0.5, mu: float = -0.53, faces: int | None = None) -> trimesh.Trimesh:
    padded = np.pad(mask.astype(np.float32), 1)
    verts, tris, _, _ = measure.marching_cubes(padded, level=0.5)
    mesh = trimesh.Trimesh(verts - 1.0, tris, process=True)
    if mesh.volume < 0:
        mesh.invert()
    v = np.asarray(mesh.vertices, dtype=np.float64).copy()
    lo, hi = v - bound, v + bound
    L = trimesh.smoothing.laplacian_calculation(mesh, equal_weight=True)
    for _ in range(iterations):
        for weight in (lamb, mu):
            v += weight * (L.dot(v) - v)
            np.clip(v, lo, hi, out=v)
    world = v @ affine[:3, :3].T + affine[:3, 3]
    out = trimesh.Trimesh(world, mesh.faces, process=False)
    if out.volume < 0:
        out.invert()
    if faces and len(out.faces) > faces:
        out = out.simplify_quadric_decimation(face_count=faces)
    return out
