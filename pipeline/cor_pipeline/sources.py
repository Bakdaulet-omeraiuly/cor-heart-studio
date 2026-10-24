"""Loaders that turn a dataset's files into (labels, affine) for build_case."""

from pathlib import Path

import nibabel as nib
import numpy as np

from .labels import LABEL_MAPS, TOTALSEG_V1_FILES

# Vessels are cropped to the heart's bounding box plus this margin, so a whole-body aorta label
# becomes the root, arch and the descending segment behind the heart.
VESSEL_MARGIN_MM = 40.0


def load_nifti_labels(path: Path) -> tuple[np.ndarray, np.ndarray]:
    image = nib.load(path)
    return np.asarray(image.dataobj).astype(np.int32), image.affine


def load_totalseg_v1(case_dir: Path) -> tuple[np.ndarray, np.ndarray]:
    labels, affine = None, None
    for value, name in TOTALSEG_V1_FILES.items():
        image = nib.load(case_dir / "segmentations" / f"{name}.nii.gz")
        mask = np.asarray(image.dataobj) > 0
        if labels is None:
            labels, affine = np.zeros(mask.shape, dtype=np.int32), image.affine
        labels[mask & (labels == 0)] = value
    return labels, affine


def outside_heart_box(labels: np.ndarray, affine: np.ndarray, source: str) -> np.ndarray | None:
    """Voxels farther than VESSEL_MARGIN_MM outside the heart's bounding box (None when there is no heart)."""
    label_map = LABEL_MAPS[source]
    vessel_values = [v for v, s in label_map.items() if s.kind == "vessel"]
    heart = np.isin(labels, [v for v in label_map if v not in vessel_values])
    if not heart.any():
        return None
    margin = np.ceil(VESSEL_MARGIN_MM / np.linalg.norm(affine[:3, :3], axis=0)).astype(int)
    idx = np.argwhere(heart)
    low = np.maximum(idx.min(axis=0) - margin, 0)
    high = np.minimum(idx.max(axis=0) + margin + 1, labels.shape)
    outside = np.ones(labels.shape, dtype=bool)
    outside[low[0]:high[0], low[1]:high[1], low[2]:high[2]] = False
    return outside


def crop_vessels_to_heart(labels: np.ndarray, affine: np.ndarray, source: str) -> np.ndarray:
    outside = outside_heart_box(labels, affine, source)
    if outside is None:
        return labels
    vessel_values = [v for v, s in LABEL_MAPS[source].items() if s.kind == "vessel"]
    cropped = labels.copy()
    cropped[outside & np.isin(labels, vessel_values)] = 0
    return cropped


def load(path: Path, source: str) -> tuple[np.ndarray, np.ndarray]:
    labels, affine = load_totalseg_v1(path) if source == "totalseg_v1" else load_nifti_labels(path)
    return crop_vessels_to_heart(labels, affine, source), affine
