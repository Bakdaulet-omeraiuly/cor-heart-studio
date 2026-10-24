"""Measurements and QA from a label volume.

Volumes come from voxel counts (exact for the segmentation), not from the smoothed mesh.
"""

import numpy as np

from .labels import Structure

MYOCARDIUM_DENSITY_G_PER_ML = 1.05

# Very loose adult plausibility bounds (mL). Outside them -> QA warning, not failure:
# disease can legitimately exceed them, but a missed/merged label usually lands far outside.
PLAUSIBLE_ML = {
    "lv_cavity": (30, 400),
    "rv_cavity": (30, 400),
    "la_cavity": (15, 250),
    "ra_cavity": (15, 300),
    "lv_myocardium": (50, 400),
}


def voxel_volume_ml(affine: np.ndarray) -> float:
    return abs(float(np.linalg.det(affine[:3, :3]))) / 1000.0


def measure_labels(labels: np.ndarray, affine: np.ndarray, label_map: dict[int, Structure]) -> dict:
    voxel_ml = voxel_volume_ml(affine)
    volumes = {}
    for value, structure in label_map.items():
        volumes[structure.key] = round(float(np.count_nonzero(labels == value)) * voxel_ml, 1)

    derived = {}
    if volumes.get("lv_myocardium"):
        derived["lv_mass_g"] = round(volumes["lv_myocardium"] * MYOCARDIUM_DENSITY_G_PER_ML, 1)
    return {"volumes_ml": volumes, "derived": derived}


def qa_checks(measurements: dict, mesh_info: dict, label_map: dict[int, Structure]) -> list[dict]:
    issues = []
    volumes = measurements["volumes_ml"]
    for structure in label_map.values():
        key = structure.key
        if volumes.get(key, 0) == 0:
            issues.append({"level": "error", "structure": key, "message": "label missing from segmentation"})
            continue
        low, high = PLAUSIBLE_ML.get(key, (0, float("inf")))
        if not low <= volumes[key] <= high:
            issues.append({
                "level": "warning",
                "structure": key,
                "message": f"volume {volumes[key]} mL outside plausible range {low}-{high} mL",
            })
        info = mesh_info.get(key)
        if info and not info["watertight"]:
            issues.append({"level": "warning", "structure": key, "message": "mesh is not watertight"})
        if info and info["components"] > info["componentsKept"]:
            issues.append({
                "level": "info",
                "structure": key,
                "message": f"{info['components']} disconnected pieces; kept {info['componentsKept']}",
            })
    return issues
