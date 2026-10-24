import math

import numpy as np
import pytest

from cor_pipeline.build import build_case
from cor_pipeline.labels import MMWHS
from cor_pipeline.mesh import ras_to_app
from cor_pipeline.synthetic import make_volume


@pytest.fixture(scope="module")
def built():
    labels, affine = make_volume()
    return build_case(labels, affine, "mmwhs", "synthetic", "synthetic")


def test_ras_to_app_axes():
    # 10 mm right, anterior, superior -> app: -1 cm X (left is +X), +1 cm Z, +1 cm Y
    assert np.allclose(ras_to_app(np.array([[10.0, 0, 0]])), [[-1, 0, 0]])
    assert np.allclose(ras_to_app(np.array([[0, 10.0, 0]])), [[0, 0, 1]])
    assert np.allclose(ras_to_app(np.array([[0, 0, 10.0]])), [[0, 1, 0]])


def test_all_structures_meshed_and_closed(built):
    scene, report = built
    assert set(report["meshes"]) == {s.key for s in MMWHS.values()}
    for key, info in report["meshes"].items():
        assert info["watertight"], key
    assert not [i for i in report["qa"] if i["level"] == "error"]


def test_lv_cavity_volume_matches_ellipsoid(built):
    _, report = built
    expected_ml = 4 / 3 * math.pi * 22 * 22 * 35 / 1000
    assert report["measurements"]["volumes_ml"]["lv_cavity"] == pytest.approx(expected_ml, rel=0.03)


def test_mesh_volume_close_to_voxel_volume(built):
    scene, report = built
    mesh = scene.geometry["lv_cavity"]
    mesh_ml = mesh.volume  # cm^3 == mL
    assert mesh_ml > 0, "winding must be outward even for an LPS-stored volume"
    assert mesh_ml == pytest.approx(report["measurements"]["volumes_ml"]["lv_cavity"], rel=0.05)


def test_orientation_lv_left_aorta_superior(built):
    scene, _ = built
    lv = scene.geometry["lv_cavity"].centroid
    rv = scene.geometry["rv_cavity"].centroid
    aorta = scene.geometry["ascending_aorta"].centroid
    assert lv[0] > rv[0], "LV must be on the patient's left (+X)"
    assert aorta[1] > lv[1], "aorta must be superior (+Y) to the LV"


def test_missing_label_is_reported():
    labels, affine = make_volume()
    labels[labels == 600] = 0
    _, report = build_case(labels, affine, "mmwhs", "no-rv", "synthetic")
    assert {"level": "error", "structure": "rv_cavity", "message": "label missing from segmentation"} in report["qa"]


def test_vessel_crop_keeps_near_heart_and_drops_far():
    from cor_pipeline.sources import crop_vessels_to_heart

    labels, affine = make_volume()
    # Extend the volume 80 mm inferiorly, then put a vessel stub at the very bottom (~90 mm below the heart).
    labels = np.pad(labels, ((0, 0), (0, 0), (80, 0)))
    affine = affine.copy()
    affine[2, 3] -= 80
    labels[70, 70, 0:3] = 820
    cropped = crop_vessels_to_heart(labels, affine, "mmwhs")
    assert cropped[70, 70, 0] == 0
    assert np.count_nonzero(cropped == 820) == np.count_nonzero(labels == 820) - 3


def test_main_components_keeps_large_pieces_only():
    from cor_pipeline.mesh import main_components

    mask = np.zeros((30, 30, 30), dtype=bool)
    mask[2:12, 2:12, 2:12] = True  # 1000 voxels
    mask[18:26, 18:26, 18:26] = True  # 512 voxels
    mask[28, 28, 28] = True  # stray voxel
    _, found, kept = main_components(mask, 0.1)
    assert (found, kept) == (3, 2)
    largest, _, kept = main_components(mask)
    assert kept == 1 and largest.sum() == 1000


def test_atlas_flag_needs_asset_and_a_totalseg_case(monkeypatch, tmp_path):
    from cor_pipeline import build
    monkeypatch.setattr("sys.argv", ["build", "--synthetic", str(tmp_path), "--atlas"])
    with pytest.raises(SystemExit):
        build.main()
