"""Template build with atlas continuations: the COR-Fit gate on measured layers only, nothing measured dropped."""
from pathlib import Path

import numpy as np
import pytest

from cor_pipeline.atlas import DEFAULT_ROOT
from cor_pipeline.vessels import PROV

LABELS = Path(__file__).parents[2] / "data/out/rodero-01/labels.npz"
pytestmark = pytest.mark.skipif(not (LABELS.exists() and (DEFAULT_ROOT / "partof_element_parts.txt").exists()),
                                reason="needs data/out/rodero-01/labels.npz and data/bodyparts3d (local data)")


@pytest.fixture(scope="module")
def built():
    from cor_pipeline.rodero import build_template
    z = np.load(LABELS)
    labels = z["labels"][::2, ::2, ::2]                     # 1.5 mm: fast
    affine = z["affine"] @ np.diag([2.0, 2.0, 2.0, 1.0])
    return labels, build_template(labels, affine, "01", lods=(("high", 60_000),))


def test_template_gate(built):
    labels, (glbs, manifest, proxy, qa, prov) = built
    fid = manifest["fidelity"]
    nsd = fid["lods"]["high"]["overall"]["nsdPercent"]
    assert nsd >= 95.0 or (fid["belowGate"] and fid["reason"])
    assert fid["measuredOnly"] is True


def test_no_measured_voxel_dropped(built):
    labels, (glbs, manifest, proxy, qa, prov) = built
    # every source voxel is still in the padded volume with CT provenance, and the scoring used all of them
    assert int((prov == PROV["ct"]).sum()) == int((labels > 0).sum())
    assert manifest["fidelity"]["scoredSourceVoxels"] == int((labels > 0).sum())


def test_atlas_layers_reported(built):
    _, (glbs, manifest, *_rest) = built
    atlas = manifest["fidelity"]["atlas"]
    assert set(atlas["joinGapMm"]) >= {"aorta", "pulmonary_artery"}
    assert all(g <= 1.0 for g in atlas["joinGapMm"].values())
    assert "coronary" in atlas


def test_atlas_surface_never_scored(built):
    # mesh-side distances come from measured vertices only: scoring an atlas vessel against the source labels put
    # HD95 at 60-137 mm. The template's worst structure before any atlas work (RV outer wall) is ~12-15 mm.
    _, (glbs, manifest, *_rest) = built
    for lod in manifest["fidelity"]["lods"].values():
        assert lod["overall"]["hd95MmWorst"] < 20.0
        for row in lod["structures"]:
            if row["key"] in ("lv_cavity", "rv", "la", "ra", "aorta", "pulmonary_artery"):
                assert row["meshToLabelPercent"] > 99.0, row["key"]
