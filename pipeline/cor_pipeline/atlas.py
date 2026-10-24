"""BodyParts3D heart parts: the atlas layer of the atlas-grade heart (docs/atlas-heart.md).

BodyParts3D 4.0 (DBCLS, CC BY-SA 2.1 Japan) ships one OBJ per *element* (FJ id, millimetres, body frame with +Z
superior). `partof_element_parts.txt` lists which elements make up each FMA concept. Concepts nest (the anterior
interventricular branch includes its diagonals), so a part is "these concepts minus those concepts".

    python -m cor_pipeline.atlas --fetch --report     # download into data/bodyparts3d and list what is present
"""

from __future__ import annotations

import argparse
import io
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Literal

import numpy as np
import trimesh

BASE_URL = "https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/"
MESH_ZIP = "partof_BP3D_4.0_obj_99.zip"
MESH_DIR = "partof_BP3D_4.0_obj_99"
ELEMENTS = "partof_element_parts.txt"
DEFAULT_ROOT = Path(__file__).resolve().parents[2] / "data" / "bodyparts3d"
ATTRIBUTION = "BodyParts3D, (c) The Database Center for Life Science, licensed under CC Attribution-Share Alike 2.1 Japan"

Kind = Literal["coronary_artery", "coronary_vein", "great_artery", "great_vein", "chamber", "valve"]


@dataclass(frozen=True)
class AtlasPart:
    key: str
    fma: list[str]          # concepts whose elements are included
    exclude: list[str]      # concepts whose elements are removed (nested branches)
    kind: Kind
    vessel: str | None      # coronary vessel name used by coronary.py (None for non-coronary parts)


def _p(key, fma, kind, vessel=None, exclude=()):
    return key, AtlasPart(key, list(fma), list(exclude), kind, vessel)


# FMA ids checked against partof_element_parts.txt (BodyParts3D 4.0), 2026-10-24.
ATLAS_PARTS: dict[str, AtlasPart] = dict([
    # coronary arteries (right-dominant specimen: the posterior interventricular branch arises from the RCA)
    _p("LM", ["FMA3855"], "coronary_artery", "LM"),                                   # trunk of left coronary artery
    _p("LAD", ["FMA3862"], "coronary_artery", "LAD",                                  # anterior interventricular branch
       exclude=["FMA3860", "FMA3868", "FMA3872", "FMA3874", "FMA3876"]),
    _p("D1", ["FMA3860"], "coronary_artery", "D1"),                                   # diagonal branch(es)
    _p("conal", ["FMA3868"], "coronary_artery", "conal"),                             # conus branch of the LAD
    _p("LCx", ["FMA3895"], "coronary_artery", "LCx"),                                 # circumflex branch
    _p("RCA", ["FMA3802"], "coronary_artery", "RCA"),                                 # trunk of right coronary artery
    _p("acute_marginal", ["FMA3818"], "coronary_artery", "acute_marginal"),           # marginal branch of RCA
    _p("PDA", ["FMA3840"], "coronary_artery", "PDA"),                                 # posterior interventricular branch of RCA
    _p("PLB", ["FMA3837"], "coronary_artery", "PLB"),                                 # first posterior ventricular branch of RCA
    # cardiac veins
    _p("great_cardiac_vein", ["FMA4707"], "coronary_vein", "great_cardiac_vein"),
    _p("middle_cardiac_vein", ["FMA4713"], "coronary_vein", "middle_cardiac_vein"),
    _p("small_cardiac_vein", ["FMA4714"], "coronary_vein", "small_cardiac_vein"),
    _p("posterior_lv_vein", ["FMA4712"], "coronary_vein", "posterior_lv_vein"),
    _p("left_marginal_vein", ["FMA4708"], "coronary_vein", "left_marginal_vein"),
    _p("coronary_sinus", ["FMA4706"], "coronary_vein", "coronary_sinus"),
    # great vessels (intrapulmonary parts and distal branches excluded)
    _p("ascending_aorta", ["FMA3736"], "great_artery"),
    _p("aortic_arch", ["FMA3768"], "great_artery"),
    _p("descending_thoracic_aorta", ["FMA87217"], "great_artery"),
    _p("brachiocephalic_trunk", ["FMA3932"], "great_artery", exclude=["FMA3953", "FMA3941"]),
    _p("left_common_carotid", ["FMA4058"], "great_artery"),
    _p("left_subclavian", ["FMA4694"], "great_artery"),
    _p("pulmonary_trunk", ["FMA8612"], "great_artery"),
    _p("right_pulmonary_artery", ["FMA50872"], "great_artery", exclude=["FMA67994", "FMA68658"]),
    _p("left_pulmonary_artery", ["FMA50873"], "great_artery", exclude=["FMA67995"]),
    _p("svc", ["FMA4720"], "great_vein"),
    _p("ivc", ["FMA10951"], "great_vein"),
    _p("lspv", ["FMA49916"], "great_vein", exclude=["FMA68004"]),
    _p("lipv", ["FMA49913"], "great_vein", exclude=["FMA68005"]),
    _p("rspv", ["FMA49914"], "great_vein", exclude=["FMA68002"]),
    _p("ripv", ["FMA49911"], "great_vein", exclude=["FMA68003"]),
    # chambers and valves (registration landmarks and the epicardial surface)
    _p("left_atrium", ["FMA7097"], "chamber"),
    _p("right_atrium", ["FMA7096"], "chamber"),
    _p("left_ventricle", ["FMA7101"], "chamber"),
    _p("right_ventricle", ["FMA7098"], "chamber"),
    _p("aortic_valve", ["FMA7236"], "valve"),
    _p("mitral_valve", ["FMA7235"], "valve"),
    _p("tricuspid_valve", ["FMA7234"], "valve"),
    _p("pulmonary_valve", ["FMA7246"], "valve"),
])

# Branches the plan asks for that BodyParts3D 4.0 does not model: drawn along their standard course, "illustrative".
NOT_IN_ATLAS = ["OM", "septal", "SA_nodal"]


def _elements(root: Path) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for line in (Path(root) / ELEMENTS).read_text(encoding="utf-8").splitlines()[1:]:
        cols = line.split("\t")
        if len(cols) >= 3 and cols[0].startswith("FMA"):
            out.setdefault(cols[0], set()).add(cols[2].strip())
    return out


def _part_elements(part: AtlasPart, elements: dict[str, set[str]]) -> list[str]:
    keep = set().union(*(elements.get(f, set()) for f in part.fma))
    drop = set().union(*(elements.get(f, set()) for f in part.exclude)) if part.exclude else set()
    return sorted(keep - drop)


def _read_obj(path: Path) -> trimesh.Trimesh:
    v, f = [], []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith("v "):
            v.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("f "):
            f.append([int(tok.split("/")[0]) - 1 for tok in line.split()[1:4]])
    return trimesh.Trimesh(np.asarray(v, float), np.asarray(f, np.int64), process=False)


def load_parts(root: Path, keys: Iterable[str]) -> dict[str, trimesh.Trimesh]:
    root = Path(root)
    elements = _elements(root)
    out = {}
    for key in keys:
        files = _part_elements(ATLAS_PARTS[key], elements)
        meshes = [_read_obj(root / MESH_DIR / f"{fj}.obj") for fj in files if (root / MESH_DIR / f"{fj}.obj").exists()]
        if meshes:
            out[key] = trimesh.util.concatenate(meshes)
    return out


def missing_parts(root: Path) -> list[str]:
    elements = _elements(Path(root))
    return [k for k, p in ATLAS_PARTS.items()
            if not any((Path(root) / MESH_DIR / f"{fj}.obj").exists() for fj in _part_elements(p, elements))]


def fetch_bodyparts3d(dest: Path = DEFAULT_ROOT) -> Path:
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    for name in (ELEMENTS, "partof_parts_list_e.txt"):
        if not (dest / name).exists():
            urllib.request.urlretrieve(BASE_URL + name, dest / name)
    if not (dest / MESH_DIR).exists():
        data = urllib.request.urlopen(BASE_URL + MESH_ZIP).read()
        zipfile.ZipFile(io.BytesIO(data)).extractall(dest)
    return dest


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=str(DEFAULT_ROOT))
    ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()
    root = fetch_bodyparts3d(Path(args.root)) if args.fetch else Path(args.root)
    if args.report:
        elements = _elements(root)
        parts = load_parts(root, ATLAS_PARTS)
        print("| part | kind | elements | triangles | length of bounds (mm) |\n|---|---|---|---|---|")
        for key, p in ATLAS_PARTS.items():
            m = parts.get(key)
            n = len(_part_elements(p, elements))
            print(f"| {key} | {p.kind} | {n} | {len(m.faces) if m else 'MISSING'} | "
                  f"{np.round(np.ptp(m.bounds, axis=0), 1).tolist() if m else '-'} |")
        print(f"\nNot in the atlas (illustrative): {', '.join(NOT_IN_ATLAS)}")
        pda = parts.get("PDA")
        print("Dominance: right (posterior interventricular branch is part of the RCA concept, FMA3840)" if pda else "Dominance: unknown")


if __name__ == "__main__":
    main()
