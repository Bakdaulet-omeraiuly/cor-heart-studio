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
    out = build_atlas_heart(labels[::2, ::2, ::2], affine @ np.diag([2.0, 2, 2, 1]), "totalseg_v1", "s0270", None,
                            lods=(("high", 60_000),), ct=ct[::2, ::2, ::2], dataset_prov=ivc[::2, ::2, ::2])
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


def test_ct_slices_follow_the_padded_grid(built):
    _, _, (glbs, manifest, proxy, qa, volumes, prov) = built
    meta, image, index = volumes
    assert image.shape == index.shape and image.max() > 0
