"""Atlas-grade heart from any label volume (docs/atlas-heart.md): the Rodero template and the open-CT patients.

Pass 1 builds a quick heart to find its landmarks and epicardium; the BodyParts3D atlas is fitted to it, the great
vessels are continued past the scan / source-mesh edge (vessels.extend_vessels), and pass 2 builds the asset with
atlas coronaries and veins and per-vertex provenance. Measured layers alone enter COR-Fit.
"""

from __future__ import annotations

import io

import numpy as np
import trimesh

from .asset import RAS_TO_APP, build_asset
from .atlas import ATLAS_PARTS, DEFAULT_ROOT, load_parts
from .register import atlas_landmarks, bp3d_to_app_mm, fit, target_landmarks
from .vessels import PROV, ROLE_OF_PART, extend_vessels


def build_atlas_heart(labels: np.ndarray, affine: np.ndarray, source: str, case_id: str, dataset: dict | None,
                      lods=(("high", 300_000), ("low", 120_000)), ct: np.ndarray | None = None,
                      dataset_prov: np.ndarray | None = None, atlas_fit: str = "all"):
    """(glbs, manifest, proxy, qa, volumes, prov). `dataset_prov`: voxels labelled by the dataset itself (e.g. the
    TotalSegmentator v1 IVC) that are not part of the scored heart labels: provenance "dataset". `atlas_fit`: see
    asset._atlas_coronaries ("shell" for the open-CT patients)."""
    g1, m1, *_ = build_asset(labels, affine, source, case_id, None, lods=(("low", 60_000),))
    centre = np.asarray(m1["frameCentreRasMm"], float)
    to_ras = lambda p: np.asarray(p, float) @ RAS_TO_APP * 100 + centre          # app cm -> RAS mm
    tissue = trimesh.load(io.BytesIO(g1["low"]), file_type="glb").geometry["heart_tissue"]
    depth = np.asarray(tissue.vertex_attributes["_TISSUE"])[:, 0]
    epi = trimesh.Trimesh(to_ras(tissue.vertices), tissue.faces[(depth[tissue.faces] < 40).all(axis=1)], process=True)
    b = {k: to_ras(v[None] / 10.0)[0] for k, v in target_landmarks(m1).items()}
    keys = [k for k, p in ATLAS_PARTS.items() if p.kind in ("chamber", "valve") or k in ROLE_OF_PART]
    parts = load_parts(DEFAULT_ROOT, keys)
    atlas_to_ras = lambda p: to_ras(bp3d_to_app_mm(p) / 10.0)
    a = {k: to_ras(v[None] / 10.0)[0] for k, v in atlas_landmarks(parts).items()}
    chambers = trimesh.util.concatenate([parts[k] for k in ("left_ventricle", "right_ventricle", "left_atrium", "right_atrium")])
    w = fit(trimesh.Trimesh(atlas_to_ras(chambers.vertices), chambers.faces, process=False), epi, a, b,
            n_surface=1500, rounds=6, smoothing=2.0)
    vessels = {k: m for k, m in parts.items() if k in ROLE_OF_PART}
    labels2, affine2, prov, report = extend_vessels(labels, affine, vessels, lambda p: w(atlas_to_ras(p)), source)
    pad = np.rint(np.linalg.solve(affine[:3, :3], affine[:3, 3] - affine2[:3, 3])).astype(int)
    if dataset_prov is not None:
        prov[tuple(np.argwhere(dataset_prov).T + pad[:, None])] = PROV["dataset"]
    ct2 = None
    if ct is not None:
        ct2 = np.full(labels2.shape, -1024, dtype=ct.dtype)
        ct2[pad[0]:pad[0] + ct.shape[0], pad[1]:pad[1] + ct.shape[1], pad[2]:pad[2] + ct.shape[2]] = ct
    glbs, manifest, proxy, qa, volumes = build_asset(labels2, affine2, source, case_id, dataset, lods=lods, ct=ct2,
                                                     with_coronaries=True, coronaries="atlas", prov=prov,
                                                     atlas_fit=atlas_fit)
    manifest["fidelity"]["atlas"] = {**report, "coronary": manifest.get("coronary", {}).get("fit"),
                                     "note": "atlas layers are fitted, not measured: reported here, never in the COR-Fit gate"}
    return glbs, manifest, proxy, qa, volumes, prov
