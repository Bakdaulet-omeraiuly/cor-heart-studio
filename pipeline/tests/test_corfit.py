import numpy as np
import pytest

from cor_pipeline.corfit import constrained_surface
from cor_pipeline.fidelity import boundary_points, surface_metrics


def sphere_mask(n=40, r=12.0):
    g = np.indices((n, n, n)) - n / 2
    return np.sqrt((g**2).sum(axis=0)) <= r


@pytest.mark.parametrize("spacing", [(1.0, 1.0, 1.0), (1.5, 1.0, 1.2)])
def test_constrained_surface_never_leaves_the_voxel_bound(spacing):
    mask = sphere_mask()
    affine = np.diag([*spacing, 1.0])
    mesh = constrained_surface(mask, affine, iterations=40)
    # every vertex within half a voxel per axis of a voxel face => within sqrt(3)/2 voxel of the boundary
    pts = boundary_points(mask, affine)
    from scipy.spatial import cKDTree
    d = cKDTree(pts).query(mesh.vertices)[0]
    assert d.max() <= np.sqrt(3) / 2 * max(spacing) + 0.35 * max(spacing)  # + face sampling spacing
    assert mesh.is_watertight


def test_smoothing_removes_the_staircase_but_keeps_the_volume():
    mask = sphere_mask()
    mesh = constrained_surface(mask, np.eye(4), iterations=40)
    raw = constrained_surface(mask, np.eye(4), iterations=0)
    # smoother: lower mean curvature noise -> less surface area than the voxel staircase
    assert mesh.area < raw.area * 0.95
    assert mesh.volume == pytest.approx(mask.sum(), rel=0.03)


def test_fidelity_of_a_constrained_sphere_is_near_perfect():
    mask = sphere_mask()
    mesh = constrained_surface(mask, np.eye(4), iterations=40)
    m = surface_metrics(mesh, np.arange(len(mesh.vertices)), boundary_points(mask, np.eye(4)), tol_mm=1.0)
    assert m["nsdPercent"] >= 99.0
    assert m["hd95Mm"] <= 1.0
