"""A synthetic MM-WHS-style label volume with known geometry, for tests and dry runs.

Not anatomy: ellipsoids and cylinders placed roughly where the structures sit.
"""

import numpy as np


def _ellipsoid(grid, centre, radii):
    return sum(((g - c) / r) ** 2 for g, c, r in zip(grid, centre, radii)) <= 1.0


def _cylinder_z(grid, centre_xy, radius, z_range):
    x, y, z = grid
    return ((x - centre_xy[0]) ** 2 + (y - centre_xy[1]) ** 2 <= radius**2) & (z >= z_range[0]) & (z <= z_range[1])


def make_volume(spacing_mm: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    """Return (labels, affine). The affine is LPS-stored (x flipped), like many CT exports.

    World coordinates are RAS mm. The LV is on the patient's left (negative RAS x).
    """
    size = int(round(140 / spacing_mm))
    # Index i grows toward patient LEFT (x_ras decreases): det(affine) < 0.
    affine = np.diag([-spacing_mm, spacing_mm, spacing_mm, 1.0])
    affine[:3, 3] = [70.0, -70.0, -70.0]
    i, j, k = np.meshgrid(*(np.arange(size),) * 3, indexing="ij")
    grid = (affine[0, 0] * i + affine[0, 3], affine[1, 1] * j + affine[1, 3], affine[2, 2] * k + affine[2, 3])

    labels = np.zeros((size,) * 3, dtype=np.int16)
    lv_centre, lv_radii = (-25.0, 0.0, -15.0), (22.0, 22.0, 35.0)
    labels[_ellipsoid(grid, lv_centre, tuple(r + 10 for r in lv_radii))] = 205  # myocardium shell
    labels[_ellipsoid(grid, lv_centre, lv_radii)] = 500
    labels[_ellipsoid(grid, (15.0, 15.0, -15.0), (18.0, 14.0, 30.0)) & (labels == 0)] = 600
    labels[_ellipsoid(grid, (-15.0, -25.0, 35.0), (20.0, 15.0, 15.0)) & (labels == 0)] = 420
    labels[_ellipsoid(grid, (30.0, -10.0, 30.0), (18.0, 18.0, 18.0)) & (labels == 0)] = 550
    labels[_cylinder_z(grid, (0.0, 0.0), 13.0, (25.0, 65.0)) & (labels == 0)] = 820
    labels[_cylinder_z(grid, (-5.0, 30.0), 12.0, (20.0, 60.0)) & (labels == 0)] = 850
    return labels, affine
