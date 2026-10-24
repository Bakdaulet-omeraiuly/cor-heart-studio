import io
import json
from pathlib import Path

import numpy as np
import pytest
import trimesh

from cor_pipeline.asset import build_asset
from cor_pipeline.synthetic import make_volume

PROCEDURAL_MANIFEST = Path(__file__).parents[2] / "src/scene/asset-adapters/procedural-heart-v1.manifest.json"


@pytest.fixture(scope="module")
def asset():
    labels, affine = make_volume()
    glbs, manifest, proxy, qa = build_asset(labels, affine, "mmwhs", "synthetic", None, lods=(("high", 40_000), ("low", 15_000)))
    mesh = next(iter(trimesh.load(io.BytesIO(glbs["low"]), file_type="glb").geometry.values()))
    return glbs, manifest, proxy, qa, mesh


def _keys(d, prefix=""):
    out = set()
    for k, v in d.items():
        out.add(prefix + k)
        if isinstance(v, dict) and k not in ("valves", "anchors", "files"):
            out |= _keys(v, prefix + k + ".")
    return out


def test_manifest_has_every_field_the_app_reads(asset):
    _, manifest, *_ = asset
    procedural = json.loads(PROCEDURAL_MANIFEST.read_text())
    missing = _keys(procedural) - _keys(manifest)
    assert not missing, missing
    assert set(manifest["valves"]) == set(procedural["valves"])
    assert set(manifest["anchors"]) >= set(procedural["anchors"])
    assert manifest["provenanceTier"] == "B"


def test_attribute_contract(asset):
    *_, mesh = asset
    w = np.asarray(mesh.vertex_attributes["_WEIGHTS"])
    t = np.asarray(mesh.vertex_attributes["_TISSUE"])
    assert w.dtype == np.uint8 and t.dtype == np.uint8 and w.shape[1] == t.shape[1] == 4
    assert (w.astype(int).sum(axis=1) <= 255 + 2).all()  # remainder = anchored vessels
    depth = t[:, 0]
    assert (depth < 20).mean() > 0.3 and (depth > 235).mean() > 0.2  # both epicardium and cavity surfaces
    assert set(np.unique(t[:, 3])) <= set(range(6))
    assert set(np.unique(t[:, 2])) <= {0, 1}


def test_lv_frame_is_orthonormal_and_points_to_apex(asset):
    _, manifest, *_ = asset
    lv = manifest["deformation"]["lv"]
    a, s, n = (np.array(lv[k]) for k in ("axis", "septalDir", "anteriorDir"))
    assert np.allclose([a @ a, s @ s, n @ n], 1, atol=1e-3)
    assert np.allclose([a @ s, a @ n, s @ n], 0, atol=1e-3)
    # synthetic LV: atrium on top, so base -> apex runs inferior (-Y)
    assert a[1] < -0.8
    assert lv["cavityApexAlong"] > lv["cavityBaseAlong"]
    assert 1.0 < lv["meanWallThickness"] * 10 < 1.4 * 10  # synthetic wall is 10 mm (cm in manifest)


def test_valve_normals_follow_the_flow(asset):
    _, manifest, *_ = asset
    v = manifest["valves"]
    # synthetic aorta and pulmonary artery run superiorly
    assert v["aortic_valve"]["normal"][1] > 0.8
    assert v["pulmonary_valve"]["normal"][1] > 0.8


def test_lv_cavity_proxy_volume(asset):
    _, manifest, proxy, *_ = asset
    mesh = trimesh.Trimesh(np.reshape(proxy["positions"], (-1, 3)), np.reshape(proxy["indices"], (-1, 3)))
    assert mesh.volume == pytest.approx(manifest["baseline"]["lvEndDiastolicVolumeMl"], rel=0.05)



def test_snap_inside_moves_a_point_into_a_crescent_cavity():
    from scipy import ndimage

    from cor_pipeline.asset import Frame, snap_inside, voxel_points

    # RV-like crescent: a shell between two spheres, open on one side; its centroid is outside it
    g = np.indices((60, 60, 60)) - 30
    r = np.sqrt((g**2).sum(axis=0))
    mask = (r > 12) & (r < 27) & (g[0] > 0)  # 15 voxels thick: room for 3 mm depth
    affine = np.eye(4)
    frame = Frame([0, 0, 0])
    centroid = frame.point(voxel_points(mask, affine).mean(axis=0))
    from cor_pipeline.mesh import RAS_TO_APP

    idx = lambda p: tuple(np.round(np.linalg.solve(RAS_TO_APP, p)).astype(int))  # identity affine: voxel = RAS mm
    assert not mask[idx(centroid)]
    p = snap_inside(centroid, mask, affine, frame, 3.0)
    depth = ndimage.distance_transform_edt(mask)
    assert mask[idx(p)] and depth[idx(p)] >= 3.0
