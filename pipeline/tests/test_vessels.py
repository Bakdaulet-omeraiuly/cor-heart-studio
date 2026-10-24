import subprocess
from pathlib import Path

import nibabel as nib
import numpy as np
import trimesh
from scipy import ndimage

from cor_pipeline import vessels
from cor_pipeline.vessels import PROV, extend_vessels, segment_great_vessels

AORTA = 6  # rodero2021 / totalseg_v1 aorta label value


def ct_volume():
    """1 mm grid; a vertical 'aorta' (radius 8 mm) that runs off the top of the scan."""
    lab = np.zeros((60, 60, 50), np.int32)
    x, y, z = np.ogrid[:60, :60, :50]
    lab[((x - 30) ** 2 + (y - 30) ** 2 <= 64) & (z >= 5)] = AORTA
    lab[20:40, 20:40, 0:8] = 1  # a bit of "LV" so the heart exists
    return lab, np.eye(4)


def atlas_tube(offset):
    """Atlas aorta continuing upward from z=40 to z=110 mm, laterally offset by `offset` mm."""
    m = trimesh.creation.cylinder(radius=8.0, height=70.0, sections=48)
    m.apply_translation([30 + offset, 30, 75])
    return m


def test_join_gap_under_1mm():
    lab, aff = ct_volume()
    out, out_aff, prov, report = extend_vessels(lab, aff, {"aortic_arch": atlas_tube(2.0)}, lambda p: p, "rodero2021", pad_mm=70)
    aorta = out == AORTA
    n = ndimage.label(aorta)[1]
    assert n == 1
    assert report["joinGapMm"]["aorta"] <= 1.0
    assert out.shape[2] > lab.shape[2]          # the volume grew to hold the continuation


def test_prov_marks_continuation():
    lab, aff = ct_volume()
    out, out_aff, prov, report = extend_vessels(lab, aff, {"aortic_arch": atlas_tube(0.0)}, lambda p: p, "rodero2021", pad_mm=70)
    top = np.argwhere(out == AORTA)[:, 2].max()
    assert prov[30 + 70, 30 + 70, top] == PROV["atlas"]          # beyond the scan: atlas
    # inside the original scan: CT
    assert prov[30 + 70, 30 + 70, 70 + 20] == PROV["ct"]


def test_ct_voxels_never_replaced():
    lab, aff = ct_volume()
    out, out_aff, prov, report = extend_vessels(lab, aff, {"aortic_arch": atlas_tube(3.0)}, lambda p: p, "rodero2021", pad_mm=70)
    core = out[70:70 + 60, 70:70 + 60, 70:70 + 50]
    assert np.array_equal(core[lab > 0], lab[lab > 0])
    assert (prov[70:130, 70:130, 70:120][lab > 0] == PROV["ct"]).all()


def test_segment_great_vessels_reads_total_outputs(tmp_path, monkeypatch):
    def fake_run(cmd, **kw):
        out = Path(cmd[cmd.index("-o") + 1])
        out.mkdir(parents=True, exist_ok=True)
        for name in vessels.TOTAL_CLASSES:
            m = np.zeros((10, 10, 10), np.uint8)
            m[2:4, 2:4, 2:4] = 1
            nib.save(nib.Nifti1Image(m, np.eye(4)), out / f"{name}.nii.gz")
        return subprocess.CompletedProcess(cmd, 0, "", "")
    monkeypatch.setattr(vessels.subprocess, "run", fake_run)
    ct = tmp_path / "ct.nii.gz"
    nib.save(nib.Nifti1Image(np.zeros((10, 10, 10), np.int16), np.eye(4)), ct)
    got = segment_great_vessels(ct, tmp_path / "w")
    assert set(got) == set(vessels.TOTAL_CLASSES)
    assert all(m.sum() == 8 for m in got.values())


def test_detached_continuation_is_shifted_onto_the_ct_end():
    lab, aff = ct_volume()
    far = trimesh.creation.cylinder(radius=8.0, height=50.0, sections=48)
    far.apply_translation([33, 30, 85])         # starts at z=60: a 10 mm gap above the CT aorta end (z=49)
    out, out_aff, prov, report = extend_vessels(lab, aff, {"aortic_arch": far}, lambda p: p, "rodero2021", pad_mm=70)
    assert ndimage.label(out == AORTA)[1] == 1
    assert report["joinGapMm"]["aorta"] <= 1.0
    assert report["shiftMm"]["aorta"] >= 9.0


def test_continuations_stop_near_the_heart():
    """Whole-body atlas vessels (IVC, subclavian) are cut ~2.5 cm beyond the measured heart, as atlas plates show them."""
    lab, aff = ct_volume()
    long = trimesh.creation.cylinder(radius=6.0, height=200.0, sections=32)
    long.apply_translation([30, 30, 140])                      # runs 150 mm above the scan top
    out, out_aff, prov, report = extend_vessels(lab, aff, {"aortic_arch": long}, lambda p: p, "rodero2021",
                                                pad_mm=70, beyond_mm=25)
    z_top_mm = (np.argwhere(out == AORTA)[:, 2].max() - 70)     # back to the original grid (1 mm voxels)
    heart_top = np.argwhere(lab > 0)[:, 2].max()
    assert z_top_mm - heart_top <= 26


def test_atlas_piece_away_from_its_vessel_is_dropped():
    from cor_pipeline.vessels import PROV_NONE, drop_unattached
    lab, _ = ct_volume()
    prov = np.where(lab > 0, PROV["ct"], PROV_NONE).astype(np.uint8)
    joined = np.zeros(lab.shape, bool); joined[39:42, 28:32, 20:30] = True      # against the aorta wall (x = 38)
    floating = np.zeros(lab.shape, bool); floating[2:8, 2:8, 40:46] = True       # touches nothing
    crumb = np.zeros(lab.shape, bool); crumb[21, 30, 40] = True                  # 1 voxel at the aorta
    assert not (lab[joined | floating | crumb]).any()
    for m in (joined, floating, crumb):
        lab[m], prov[m] = AORTA, PROV["atlas"]
    dropped = drop_unattached(lab, prov, "totalseg_v1")
    assert dropped["aorta"] == floating.sum() + crumb.sum()
    assert (lab[floating] == 0).all() and (prov[floating] == PROV_NONE).all() and (lab[joined] == AORTA).all()
