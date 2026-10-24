import numpy as np
import trimesh

from cor_pipeline.centreline import branches, centreline


def tube(path: np.ndarray, radius) -> trimesh.Trimesh:
    """Closed tube mesh around a polyline (radius scalar or per point)."""
    radius = np.broadcast_to(np.asarray(radius, float), (len(path),))
    rings, n = [], 24
    for i, p in enumerate(path):
        t = path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]
        t /= np.linalg.norm(t)
        a = np.cross(t, [0, 0, 1.0]) if abs(t[2]) < 0.9 else np.cross(t, [1.0, 0, 0])
        a /= np.linalg.norm(a)
        b = np.cross(t, a)
        ang = np.linspace(0, 2 * np.pi, n, endpoint=False)
        rings.append(p + radius[i] * (np.cos(ang)[:, None] * a + np.sin(ang)[:, None] * b))
    v = np.vstack(rings)
    f = []
    for i in range(len(path) - 1):
        for j in range(n):
            a0, a1, b0, b1 = i * n + j, i * n + (j + 1) % n, (i + 1) * n + j, (i + 1) * n + (j + 1) % n
            f += [[a0, b0, a1], [a1, b0, b1]]
    m = trimesh.Trimesh(v, f, process=False)
    trimesh.repair.fill_holes(m)
    return m


def helix(n=400):
    s = np.linspace(0, 3 * np.pi, n)
    return np.c_[12 * np.cos(s), 12 * np.sin(s), 4 * s]


def test_centreline_of_curved_tube():
    true = helix()
    pts, r = centreline(tube(true, 1.5))
    fine = helix(6000)  # distance to the curve itself, not to its 0.3 mm samples
    d = np.min(np.linalg.norm(pts[:, None] - fine[None], axis=2), axis=1)
    assert d.max() < 0.25
    assert abs(np.median(r) - 1.5) / 1.5 < 0.10
    arc = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    assert np.allclose(arc, 0.5, atol=0.06)            # resampled every 0.5 mm
    assert np.linalg.norm(pts[0] - true[0]) < 1.6 or np.linalg.norm(pts[0] - true[-1]) < 1.6


def test_order_follows_start_hint():
    true = helix()
    pts, _ = centreline(tube(true, 1.5), start_hint=true[-1])
    assert np.linalg.norm(pts[0] - true[-1]) < np.linalg.norm(pts[-1] - true[-1])


def test_tapered_tube_radius_decreases():
    true = np.c_[np.zeros(200), np.zeros(200), np.linspace(0, 60, 200)]
    pts, r = centreline(tube(true, np.linspace(2.0, 0.8, 200)), start_hint=true[0])
    assert r[:20].mean() > r[-20:].mean() + 0.6


def test_branches_splits_a_y():
    trunk = np.c_[np.zeros(120), np.zeros(120), np.linspace(0, 40, 120)]
    side = np.c_[np.linspace(0, 25, 100), np.zeros(100), 20 + np.linspace(0, 25, 100)]
    y = trimesh.util.concatenate([tube(trunk, 1.4), tube(side, 1.0)])  # overlapping bodies, like atlas elements
    paths = branches(y, min_length_mm=10, start_hint=trunk[0])
    assert len(paths) == 2
    assert max(len(p[0]) for p in paths) * 0.5 > 35   # the longest path runs the trunk


def test_disconnected_bodies_all_returned():
    a = np.c_[np.zeros(100), np.zeros(100), np.linspace(0, 30, 100)]
    b = a + [15, 0, 0]
    paths = branches(trimesh.util.concatenate([tube(a, 1.0), tube(b, 1.0)]), min_length_mm=10, start_hint=a[0])
    assert len(paths) == 2
