"""Great vessels at full length: atlas continuations joined to the measured (CT) vessel ends, with provenance.

The label volume is padded so vessels can continue past the scan / source-mesh edge. Every atlas part is warped into
this heart, voxelised, and written only into empty voxels: CT voxels are never replaced. A continuation that does
not touch its CT vessel is shifted onto it (the gap is reported), then the seam is closed. `prov` records where
each voxel came from (PROV codes, also written per vertex as `_PROV`).
"""

from __future__ import annotations

from pathlib import Path

import nibabel as nib
import numpy as np
import subprocess
from scipy import ndimage

from .labels import GREAT_VEINS, LABEL_MAPS
from .centreline import _closed

PROV = {"ct": 0, "ai": 1, "dataset": 2, "atlas": 3, "illustrative": 4}
PROV_NONE = 255
ROLE_OF_PART = {
    "ascending_aorta": "aorta", "aortic_arch": "aorta", "descending_thoracic_aorta": "aorta", "brachiocephalic_trunk": "aorta",
    "left_common_carotid": "aorta", "left_subclavian": "aorta",
    "pulmonary_trunk": "pulmonary_artery", "right_pulmonary_artery": "pulmonary_artery", "left_pulmonary_artery": "pulmonary_artery",
    "svc": "vena_cava", "ivc": "vena_cava",
    "lspv": "pulmonary_veins", "lipv": "pulmonary_veins", "rspv": "pulmonary_veins", "ripv": "pulmonary_veins",
}
# TotalSegmentator `total` classes used for Tier B great vessels (no licence key needed)
TOTAL_CLASSES = ["aorta", "pulmonary_vein", "brachiocephalic_trunk", "subclavian_artery_left",
                 "common_carotid_artery_left", "superior_vena_cava", "inferior_vena_cava"]


def role_value(source: str, role: str) -> int:
    for value, s in {**LABEL_MAPS[source], **GREAT_VEINS}.items():
        if s.region == role and s.kind != "wall":
            return value
    raise KeyError(f"{source} has no label for {role}")


def _voxelise(mesh, affine: np.ndarray, shape) -> np.ndarray:
    pitch = float(np.linalg.norm(affine[:3, :3], axis=0).min())
    inv = np.linalg.inv(affine)
    out = np.zeros(shape, bool)
    for body in mesh.split(only_watertight=False) or [mesh]:
        if len(body.faces) < 4:
            continue
        pts = _closed(body).voxelized(pitch * 0.7).fill().points
        idx = np.rint(pts @ inv[:3, :3].T + inv[:3, 3]).astype(int)
        ok = np.all((idx >= 0) & (idx < shape), axis=1)
        out[tuple(idx[ok].T)] = True
    return ndimage.binary_closing(out, iterations=1)


def extend_vessels(labels: np.ndarray, affine: np.ndarray, parts: dict, warp, source: str, pad_mm: float = 40.0,
                   beyond_mm: float = 25.0):
    """(labels, affine, prov, report): padded labels with atlas continuations of every great vessel in `parts`.

    Continuations stop `beyond_mm` outside the measured heart's bounding box: atlas plates show the great vessels as
    short trunks (arch branches, IVC, SVC), and the whole-body atlas vessels would otherwise run to the limbs.
    """
    spacing = np.linalg.norm(affine[:3, :3], axis=0)
    pad = np.ceil(pad_mm / spacing).astype(int)
    out = np.pad(labels, [(p, p) for p in pad])
    shift = np.eye(4)
    shift[:3, 3] = -pad
    out_aff = affine @ shift
    prov = np.where(out > 0, PROV["ct"], PROV_NONE).astype(np.uint8)
    report = {"joinGapMm": {}, "shiftMm": {}, "beyondHeartMm": beyond_mm}
    by_role: dict[str, np.ndarray] = {}
    heart = np.argwhere(out > 0)
    margin = np.ceil(beyond_mm / spacing).astype(int)
    keep = np.zeros(out.shape, bool)
    lo, hi = np.maximum(heart.min(axis=0) - margin, 0), np.minimum(heart.max(axis=0) + margin + 1, out.shape)
    keep[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]] = True
    for key, mesh in parts.items():
        role = ROLE_OF_PART.get(key)
        if role is None:
            continue
        m = mesh.copy()
        m.vertices = warp(np.asarray(m.vertices, float))
        by_role[role] = by_role.get(role, np.zeros(out.shape, bool)) | (_voxelise(m, out_aff, out.shape) & keep)
    for role, atlas in by_role.items():
        value = role_value(source, role)
        ct = out == value
        atlas &= out == 0
        gap = 0.0
        if ct.any() and atlas.any() and not (ndimage.binary_dilation(ct) & atlas).any():
            d_ct = ndimage.distance_transform_edt(~ct, sampling=spacing)
            a_idx = np.argwhere(atlas)
            near = a_idx[np.argmin(d_ct[tuple(a_idx.T)])]
            _, ind = ndimage.distance_transform_edt(~ct, return_indices=True)
            target = ind[:, near[0], near[1], near[2]]
            move = target - near
            atlas = ndimage.shift(atlas.astype(np.uint8), move, order=0).astype(bool) & (out == 0)
            report["shiftMm"][role] = round(float(np.linalg.norm(move * spacing)), 1)
        if ct.any() and atlas.any():
            touching = ndimage.binary_dilation(ct, iterations=1) & atlas
            gap = 0.0 if touching.any() else float(ndimage.distance_transform_edt(~ct, sampling=spacing)[atlas].min())
            # close the seam between the two pieces (only into empty voxels)
            both = ct | atlas
            seam = ndimage.binary_closing(both, structure=ndimage.generate_binary_structure(3, 2), iterations=2) & ~both & (out == 0)
            near_seam = ndimage.binary_dilation(ct, iterations=3) & ndimage.binary_dilation(atlas, iterations=3)
            atlas |= seam & near_seam
        out[atlas] = value
        prov[atlas] = PROV["atlas"]
        report["joinGapMm"][role] = round(gap, 2)
    report["droppedAtlasVoxels"] = drop_unattached(out, prov, source)
    return out, out_aff, prov, report


# a vein continuation may attach to its CT vessel or to the atrium it drains into
DRAINS_INTO = {"vena_cava": "ra", "pulmonary_veins": "la"}
MIN_ATLAS_PIECE = 27  # voxels: smaller atlas pieces are seam crumbs, not vessels


def drop_unattached(labels: np.ndarray, prov: np.ndarray, source: str) -> dict[str, int]:
    """Remove atlas pieces that do not continue this heart (in place); voxels dropped per role.

    A continuation is drawn only where it joins its measured vessel (or, for a vein, its atrium): a piece the warp put
    elsewhere, e.g. an arch branch that misses this patient's arch, would be a vessel this heart does not have.
    """
    regions = {**LABEL_MAPS[source], **GREAT_VEINS}
    dropped = {}
    for role in ROLE_OF_PART.values():
        if role in dropped:
            continue
        value = role_value(source, role)
        anchors = {role, DRAINS_INTO.get(role)}
        anchor = np.isin(labels, [v for v, st in regions.items() if st.region in anchors]) & (prov != PROV["atlas"])
        pieces, n = ndimage.label((labels == value) & (prov == PROV["atlas"]), structure=np.ones((3, 3, 3)))
        if not n:
            dropped[role] = 0
            continue
        touching = np.unique(pieces[ndimage.binary_dilation(anchor, structure=np.ones((3, 3, 3)))])
        sizes = np.bincount(pieces.ravel(), minlength=n + 1)
        keep = np.zeros(n + 1, bool)
        keep[touching] = True
        keep &= sizes >= MIN_ATLAS_PIECE
        keep[0] = False
        gone = (pieces > 0) & ~keep[pieces]
        labels[gone] = 0
        prov[gone] = PROV_NONE
        dropped[role] = int(gone.sum())
    return dropped


def segment_great_vessels(ct: Path, work: Path) -> dict[str, np.ndarray]:
    """TotalSegmentator `total` great-vessel masks on the CT grid (Tier B; no licence key; usage stats off)."""
    seg_python = Path(__file__).resolve().parents[1] / ".venv-seg/bin/python"
    seg_dir = Path(work) / "total"
    cmd = [seg_python, seg_python.parent / "TotalSegmentator", "-i", ct, "-o", seg_dir, "-ta", "total", "-d", "mps",
           "--roi_subset", *TOTAL_CLASSES]
    done = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, timeout=30 * 60)
    if done.returncode != 0:
        raise RuntimeError("TotalSegmentator failed: " + " ".join((done.stderr or done.stdout or "").strip().splitlines()[-3:]))
    return {name: np.asarray(nib.load(seg_dir / f"{name}.nii.gz").dataobj) > 0 for name in TOTAL_CLASSES
            if (seg_dir / f"{name}.nii.gz").exists()}
