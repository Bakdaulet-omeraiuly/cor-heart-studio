"""Label volume -> per-structure surface meshes in the app frame (centimetres).

App frame (docs/asset-pipeline.md): +X patient left, +Y superior, +Z anterior.
NIfTI world space is RAS+ in millimetres: +x right, +y anterior, +z superior.
"""

import numpy as np
import trimesh
from scipy import ndimage
from skimage import measure

# RAS mm -> app cm. A proper rotation (det = +1), so triangle winding is preserved.
RAS_TO_APP = np.array([[-1, 0, 0], [0, 0, 1], [0, 1, 0]], dtype=float) / 10.0


def ras_to_app(points_mm: np.ndarray) -> np.ndarray:
    return points_mm @ RAS_TO_APP.T


def main_components(mask: np.ndarray, min_fraction: float = 1.0) -> tuple[np.ndarray, int, int]:
    """Keep 26-connected components at least `min_fraction` of the largest one's size.

    1.0 keeps only the largest (chambers: drop stray voxels). Vessels cropped to the heart box use a
    lower fraction, so e.g. the ascending and descending aorta both survive.
    Returns (mask, components found, components kept).
    """
    labelled, count = ndimage.label(mask, structure=np.ones((3, 3, 3)))
    if count <= 1:
        return mask, count, count
    sizes = np.asarray(ndimage.sum(mask, labelled, index=range(1, count + 1)))
    keep = np.flatnonzero(sizes >= min_fraction * sizes.max()) + 1
    return np.isin(labelled, keep), count, len(keep)


def extract_surface(
    mask: np.ndarray,
    affine: np.ndarray,
    smooth_iterations: int = 20,
    target_faces: int | None = 20000,
) -> trimesh.Trimesh:
    """Marching cubes on a binary mask, mapped through the voxel affine to RAS mm."""
    padded = np.pad(mask.astype(np.float32), 1)
    # A light blur before meshing removes voxel staircase without moving the 0.5 iso-surface much.
    field = ndimage.gaussian_filter(padded, sigma=0.6)
    verts, faces, _, _ = measure.marching_cubes(field, level=0.5)
    verts -= 1.0  # undo padding
    world = verts @ affine[:3, :3].T + affine[:3, 3]

    mesh = trimesh.Trimesh(world, faces, process=True)
    # A left-handed voxel grid (det < 0, common for LPS-stored scans) flips winding.
    if mesh.volume < 0:
        mesh.invert()
    if smooth_iterations:
        trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=-0.53, iterations=smooth_iterations)
    if target_faces and len(mesh.faces) > target_faces:
        mesh = mesh.simplify_quadric_decimation(face_count=target_faces)
    return mesh
