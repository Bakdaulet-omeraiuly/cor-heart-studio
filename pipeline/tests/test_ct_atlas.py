"""Open-CT patient (Tier B) as an atlas-grade heart: dataset IVC, atlas continuations, measured-only COR-Fit."""
from pathlib import Path

import numpy as np
import pytest

from cor_pipeline.atlas import DEFAULT_ROOT
from cor_pipeline.vessels import PROV

CASE = Path(__file__).parents[2] / "data/totalseg_v1/s0270"
pytestmark = pytest.mark.skipif(not ((CASE / "segmentations/inferior_vena_cava.nii.gz").exists()
                                     and (DEFAULT_ROOT / "partof_element_parts.txt").exists()),
                                reason="needs data/totalseg_v1/s0270 with the IVC label and data/bodyparts3d")


@pytest.fixture(scope="module")
def built():
    from cor_pipeline.build import load_ct_case
    from cor_pipeline.atlas_heart import build_atlas_heart
    labels, affine, ct, ivc = load_ct_case(CASE)
    # as built for the app (build.py --atlas): the dataset's 1.5 mm grid, the shipped high LOD (the coronaries are
    # seated on it, so a coarser grid or LOD moves the fit) and the outer-shell atlas fit
    out = build_atlas_heart(labels, affine, "totalseg_v1", "s0270", None, lods=(("high", 300_000),), ct=ct,
                            dataset_prov=ivc, atlas_fit="shell")
    return labels, ivc, out


def test_ivc_is_a_dataset_label(built):
    labels, ivc, (glbs, manifest, proxy, qa, volumes, prov) = built
    assert ivc.any() and (prov == PROV["dataset"]).sum() > 0


def test_measured_only_gate(built):
    _, _, (glbs, manifest, *_rest) = built
    fid = manifest["fidelity"]
    assert fid["measuredOnly"] and (fid["lods"]["high"]["overall"]["nsdPercent"] >= 95 or fid["belowGate"])
    assert fid["lods"]["high"]["overall"]["hd95MmWorst"] < 20.0
    assert {"great_cardiac_vein", "LAD", "RCA"} <= {v["name"] for v in manifest["coronary"]["vessels"].values()}


def test_left_out_branches_are_named(built):
    _, _, (glbs, manifest, *_rest) = built
    drawn = {v["name"] for v in manifest["coronary"]["vessels"].values()}
    fit = manifest["fidelity"]["atlas"]["coronary"]
    for name, r in fit.items():
        if isinstance(r, dict) and r.get("drawn") is False:
            assert name not in drawn and any(l.startswith(name.replace("_", " ")) for l in manifest["knownLimitations"])


def test_ct_slices_follow_the_padded_grid(built):
    _, _, (glbs, manifest, proxy, qa, volumes, prov) = built
    meta, image, index = volumes
    assert image.shape == index.shape and image.max() > 0


def test_ivc_cropped_to_the_heart_box(built):
    labels, ivc, _ = built
    import nibabel as nib
    from cor_pipeline.sources import outside_heart_box
    assert ivc.any() and not (ivc & outside_heart_box(labels, nib.load(CASE / "ct.nii.gz").affine, "totalseg_v1")).any()


def test_atlas_layers_are_labelled_not_imaged(built):
    _, _, (glbs, manifest, *_rest) = built
    s2m = manifest["structureToMesh"]
    for key in ("coronary_vessels", "vena_cava", "pulmonary_veins"):
        assert not s2m[key].get("absent") and "not imaged" in s2m[key]["note"]
    assert "dataset's own label" in s2m["vena_cava"]["note"]
    assert not any("routed along the grooves" in l for l in manifest["knownLimitations"])
