from pathlib import Path

import numpy as np

from cor_pipeline import atlas
from cor_pipeline.atlas import ATLAS_PARTS, NOT_IN_ATLAS, AtlasPart, load_parts, missing_parts

MINI = Path(__file__).parent / "fixtures" / "bp3d_mini"


def test_load_parts_reads_named_obj(monkeypatch):
    monkeypatch.setattr(atlas, "ATLAS_PARTS", {"whole": AtlasPart("whole", ["FMA1"], [], "great_artery", None),
                                               "trunk": AtlasPart("trunk", ["FMA1"], ["FMA2"], "great_artery", None)})
    parts = load_parts(MINI, ["whole", "trunk"])
    assert len(parts["whole"].vertices) == 8   # FJ1 + FJ2
    assert len(parts["trunk"].vertices) == 4   # FJ1 only: the branch's element is excluded
    assert np.allclose(parts["trunk"].bounds, [[0, 0, 1], [10, 10, 11]])  # millimetres, as in the files


def test_missing_parts_lists_absent_keys(monkeypatch):
    monkeypatch.setattr(atlas, "ATLAS_PARTS", {"here": AtlasPart("here", ["FMA1"], [], "great_artery", None),
                                               "gone": AtlasPart("gone", ["FMA999"], [], "coronary_artery", "LAD")})
    assert missing_parts(MINI) == ["gone"]


def test_every_coronary_key_has_fma_ids():
    for key, part in ATLAS_PARTS.items():
        assert part.fma, key
        if part.kind in ("coronary_artery", "coronary_vein"):
            assert part.vessel, key


def test_required_keys_present():
    required = {"LM", "LAD", "D1", "LCx", "RCA", "conal", "acute_marginal", "PDA", "PLB",
                "great_cardiac_vein", "middle_cardiac_vein", "small_cardiac_vein", "coronary_sinus",
                "ascending_aorta", "aortic_arch", "pulmonary_trunk", "svc", "ivc",
                "lspv", "lipv", "rspv", "ripv", "left_atrium", "right_atrium", "left_ventricle", "right_ventricle",
                "aortic_valve", "mitral_valve", "tricuspid_valve", "pulmonary_valve"}
    assert required <= set(ATLAS_PARTS)


def test_branches_the_atlas_lacks_are_declared():
    # BodyParts3D 4.0 has no obtuse marginal, septal or SA-nodal artery: Task 4 draws them as illustrative
    assert set(NOT_IN_ATLAS) == {"OM", "septal", "SA_nodal"}
    assert not set(NOT_IN_ATLAS) & set(ATLAS_PARTS)
