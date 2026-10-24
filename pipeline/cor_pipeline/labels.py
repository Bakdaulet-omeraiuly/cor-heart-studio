"""Label maps for supported segmentation sources, mapped to the app's region names.

Region names match the `_TISSUE.w` region bytes in docs/asset-pipeline.md.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Structure:
    key: str  # canonical id used in the output
    region: str  # app region (lv, rv, la, ra, aorta, pulmonary_artery, ...)
    kind: str  # "cavity" (blood pool), "wall" (myocardium) or "vessel"


# MM-WHS 2017 ground-truth label values (CT and MR use the same codes).
MMWHS = {
    500: Structure("lv_cavity", "lv", "cavity"),
    205: Structure("lv_myocardium", "lv", "wall"),
    600: Structure("rv_cavity", "rv", "cavity"),
    420: Structure("la_cavity", "la", "cavity"),
    550: Structure("ra_cavity", "ra", "cavity"),
    820: Structure("ascending_aorta", "aorta", "vessel"),
    850: Structure("pulmonary_artery", "pulmonary_artery", "vessel"),
}

# TotalSegmentator v1 dataset: one binary file per structure. The loader (sources.py) merges them into
# one volume with these values. Its "aorta" and "pulmonary_artery" are the whole vessels.
TOTALSEG_V1 = {
    1: Structure("lv_cavity", "lv", "cavity"),
    2: Structure("lv_myocardium", "lv", "wall"),
    3: Structure("rv_cavity", "rv", "cavity"),
    4: Structure("la_cavity", "la", "cavity"),
    5: Structure("ra_cavity", "ra", "cavity"),
    6: Structure("aorta", "aorta", "vessel"),
    7: Structure("pulmonary_artery", "pulmonary_artery", "vessel"),
}
TOTALSEG_V1_FILES = {
    1: "heart_ventricle_left",
    2: "heart_myocardium",
    3: "heart_ventricle_right",
    4: "heart_atrium_left",
    5: "heart_atrium_right",
    6: "aorta",
    7: "pulmonary_artery",
}

# Rodero 2021 four-chamber meshes, rasterised by rodero.py: every chamber and great-artery wall is measured.
RODERO2021 = {
    1: Structure("lv_cavity", "lv", "cavity"),
    2: Structure("lv_myocardium", "lv", "wall"),
    3: Structure("rv_cavity", "rv", "cavity"),
    4: Structure("la_cavity", "la", "cavity"),
    5: Structure("ra_cavity", "ra", "cavity"),
    6: Structure("aorta", "aorta", "vessel"),
    7: Structure("pulmonary_artery", "pulmonary_artery", "vessel"),
    8: Structure("rv_wall", "rv", "wall"),
    9: Structure("la_wall", "la", "wall"),
    10: Structure("ra_wall", "ra", "wall"),
    11: Structure("aorta_wall", "aorta", "wall"),
    12: Structure("pulmonary_artery_wall", "pulmonary_artery", "wall"),
}

# Great veins: no source labels them; atlas continuations (vessels.py) and Tier B AI segmentation write these values
# into the label volume, on top of any source's own map.
GREAT_VEINS = {
    20: Structure("vena_cava", "vena_cava", "vessel"),
    21: Structure("pulmonary_veins", "pulmonary_veins", "vessel"),
}

LABEL_MAPS = {"mmwhs": MMWHS, "totalseg_v1": TOTALSEG_V1, "rodero2021": RODERO2021}
