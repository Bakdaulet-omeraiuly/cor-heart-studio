import numpy as np
import pytest
import trimesh

from cor_pipeline.register import FitError, bp3d_to_app_mm, fit, snap_to_surface, target_landmarks

KEYS = ("apex", "aortic", "mitral", "tricuspid", "pulmonary")


def egg(subdiv=4):
    m = trimesh.creation.icosphere(subdivisions=subdiv, radius=1.0)
    m.vertices *= [30.0, 40.0, 55.0]
    return m


def landmarks(m: trimesh.Trimesh):
    v = m.vertices
    picks = {"apex": v[np.argmin(v[:, 2])], "aortic": v[np.argmax(v[:, 2])], "mitral": v[np.argmax(v[:, 0])],
             "tricuspid": v[np.argmin(v[:, 0])], "pulmonary": v[np.argmax(v[:, 1])]}
    return {k: picks[k] for k in KEYS}


def rot(deg):
    a = np.radians(deg)
    return np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])


def bend(p):
    return p + np.c_[0.04 * p[:, 2] ** 2 / 55, np.zeros(len(p)), np.zeros(len(p))]


def test_fit_recovers_known_transform():
    src = egg()
    dst = src.copy()
    dst.vertices = bend((src.vertices @ rot(20).T) * 1.1 + [5.0, -3.0, 8.0])
    warp = fit(src, dst, landmarks(src), landmarks(dst))
    moved = warp(src.vertices)
    err = {k: np.linalg.norm(warp(landmarks(src)[k][None])[0] - landmarks(dst)[k]) for k in KEYS}
    assert max(err.values()) < 0.5
    d = dst.nearest.on_surface(moved)[1]
    assert d.mean() < 0.5


def test_snap_never_inside_tissue():
    m = egg()
    # a meridian path pushed 3 mm inside the surface
    s = np.linspace(-1.2, 1.2, 80)
    path = np.c_[30 * np.cos(s), np.zeros_like(s), 55 * np.sin(s)] * 0.95
    out, report = snap_to_surface(path, np.full(len(path), 1.5), m)
    signed = trimesh.proximity.signed_distance(m, out)  # positive inside
    assert signed.max() <= 0.5
    assert report["maxInsideMm"] <= 0.5
    assert report["withinMm1Percent"] == pytest.approx(100.0)


def test_fit_error_on_bad_path():
    m = egg()
    path = np.c_[np.zeros(50), np.zeros(50), np.linspace(-40, 40, 50)]  # straight through the middle
    with pytest.raises(FitError):
        snap_to_surface(path, np.full(50, 1.5), m, max_shift_mm=6.0)


def test_bp3d_frame_to_app_mm():
    # BodyParts3D: +X left, +Y posterior, +Z superior (LV is left of RV, RV anterior of LA)
    assert np.allclose(bp3d_to_app_mm(np.array([[1.0, 2.0, 3.0]])), [[1.0, 3.0, -2.0]])


def test_target_landmarks_from_manifest():
    man = {"valves": {"aortic_valve": {"center": [0, 1, 0]}, "mitral_valve": {"center": [1, 0, 0]},
                      "tricuspid_valve": {"center": [-1, 0, 0]}, "pulmonary_valve": {"center": [0, 2, 1]}},
           "deformation": {"lv": {"base": [1, 0, 0], "axis": [0, -1, 0], "epiApexAlong": 8.0}}}
    lm = target_landmarks(man)
    assert np.allclose(lm["apex"], [10, -80, 0])          # cm -> mm
    assert np.allclose(lm["aortic"], [0, 10, 0])


def test_outer_shell_drops_internal_faces():
    from cor_pipeline.register import outer_shell
    a = trimesh.creation.box((40, 40, 40))
    b = a.copy(); b.apply_translation((40, 0, 0))     # two chambers sharing a wall at x = 20
    shell = outer_shell(trimesh.util.concatenate([a, b]), pitch_mm=2.0)
    inner = (np.abs(shell.vertices[:, 0] - 20) < 2) & (np.abs(shell.vertices[:, 1]) < 15) & (np.abs(shell.vertices[:, 2]) < 15)
    assert not inner.any()


def test_shell_fit_recovers_known_transform():
    src = egg()
    dst = src.copy()
    dst.vertices = bend((src.vertices @ rot(20).T) * 1.1 + [5.0, -3.0, 8.0])
    warp = fit(src, dst, landmarks(src), landmarks(dst), surface="shell")
    assert dst.nearest.on_surface(warp(src.vertices))[1].mean() < 1.0
