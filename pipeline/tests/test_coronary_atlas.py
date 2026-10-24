"""Atlas coronaries on a synthetic sphere 'heart' (field = distance to a sphere of radius R)."""
import numpy as np
import pytest
import trimesh

from cor_pipeline import coronary
from cor_pipeline.coronary import VESSELS, atlas_coronaries, build_vessels

R = 40.0
AORTIC = np.array([0.0, 0.0, R + 5])          # "ostium side": top of the sphere


def outer_at(p):
    return np.linalg.norm(p, axis=1) - R


def normals_at(p):
    return p / np.linalg.norm(p, axis=1, keepdims=True)


def surface_at(p):
    return normals_at(p) * R


def arc(a0, a1, phi, n=120, r=R + 2.5):
    """A vessel riding 2.5 mm above the sphere along a meridian (polar angle a0 -> a1)."""
    t = np.linspace(a0, a1, n)
    return np.c_[r * np.sin(t) * np.cos(phi), r * np.sin(t) * np.sin(phi), r * np.cos(t)]


def tube(path, radius=1.2):
    ang = np.linspace(0, 2 * np.pi, 16, endpoint=False)
    rings = []
    for i, p in enumerate(path):
        tgt = path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]
        tgt /= np.linalg.norm(tgt)
        a = np.cross(tgt, [0.3, 0.5, 0.8]); a /= np.linalg.norm(a)
        b = np.cross(tgt, a)
        rings.append(p + radius * (np.cos(ang)[:, None] * a + np.sin(ang)[:, None] * b))
    v = np.vstack(rings)
    n, f = 16, []
    for i in range(len(path) - 1):
        for j in range(n):
            a0, a1, b0, b1 = i * n + j, i * n + (j + 1) % n, (i + 1) * n + j, (i + 1) * n + (j + 1) % n
            f += [[a0, b0, a1], [a1, b0, b1]]
    return trimesh.Trimesh(v, f, process=False)


def parts():
    # atlas frame == our frame here (identity warp); LAD starts at the top (ostium side) and runs down
    return {"LM": tube(arc(0.15, 0.30, 0.0)), "LAD": tube(arc(0.30, 2.6, 0.0)), "LCx": tube(arc(0.30, 1.6, 1.2)),
            "RCA": tube(arc(0.15, 2.0, 3.0)), "PDA": tube(arc(2.0, 2.8, 3.0)),
            "great_cardiac_vein": tube(arc(0.4, 2.4, 0.4), 1.6)}


def run(**kw):
    return atlas_coronaries(parts(), lambda p: p, surface_at, normals_at, outer_at, AORTIC, apex=np.array([0, 0, -R]), **kw)


def test_coro_t_spans_vessel():
    lines, radii, sources, report = run()
    for name in ("LAD", "RCA", "LCx"):
        c = lines[name]
        # proximal end (t=0) is the end nearest the aortic root, and the line lies on the surface
        assert np.linalg.norm(c[0] - AORTIC) < np.linalg.norm(c[-1] - AORTIC)
        assert np.abs(outer_at(c)).max() < 0.2
    pos, nrm, faces, t, r, vid = build_vessels({k: lines[k] for k in ("LAD",)}, normals_at, radii={"LAD": radii["LAD"]})
    assert t.min() == 0 and t.max() == 1
    prox = pos[t < 1 / 3]
    assert np.linalg.norm(prox.mean(0) - AORTIC) < np.linalg.norm(pos[t > 2 / 3].mean(0) - AORTIC)


def test_ids_1_to_5_unchanged():
    assert {i: VESSELS[i][0] for i in range(1, 6)} == {1: "LM", 2: "LAD", 3: "LCx", 4: "RCA", 5: "PDA"}


def test_missing_branch_is_illustrative():
    lines, radii, sources, report = run()
    for name in ("LM", "LAD", "LCx", "RCA", "PDA", "great_cardiac_vein"):
        assert sources[name] == "atlas"
    assert sources["OM"] == "illustrative"          # BodyParts3D has no obtuse marginal: drawn from the LCx
    assert "OM" in lines and np.abs(outer_at(lines["OM"])).max() < 0.2
    assert "septal" not in lines                      # intramyocardial: never drawn on the surface


def test_veins_kind_4():
    kinds = {VESSELS[i][0]: coronary.VESSEL_KIND[i] for i in VESSELS}
    assert kinds["great_cardiac_vein"] == 4 and kinds["coronary_sinus"] == 4
    assert kinds["LAD"] == 3


def test_vessel_through_tissue_fails():
    bad = parts()
    bad["LAD"] = tube(np.c_[np.zeros(80), np.zeros(80), np.linspace(R + 2, -R - 2, 80)])  # straight through
    with pytest.raises(coronary.FitError):
        atlas_coronaries(bad, lambda p: p, surface_at, normals_at, outer_at, AORTIC, apex=np.array([0, 0, -R]))


def test_failed_side_branch_is_left_out_when_not_required():
    from cor_pipeline.asset import STENOSIS_VESSELS
    bad = parts()
    bad["great_cardiac_vein"] = tube(np.c_[np.zeros(80), np.zeros(80), np.linspace(R + 2, -R - 2, 80)])  # through
    lines, radii, sources, report = atlas_coronaries(bad, lambda p: p, surface_at, normals_at, outer_at, AORTIC,
                                                     apex=np.array([0, 0, -R]), required=STENOSIS_VESSELS)
    assert "great_cardiac_vein" not in lines and report["great_cardiac_vein"]["drawn"] is False
    assert "not drawn" in report["great_cardiac_vein"]["reason"]
    bad["LAD"] = bad.pop("great_cardiac_vein")       # a stenosis vessel still fails the build
    with pytest.raises(coronary.FitError):
        atlas_coronaries(bad, lambda p: p, surface_at, normals_at, outer_at, AORTIC, apex=np.array([0, 0, -R]),
                         required=STENOSIS_VESSELS)
