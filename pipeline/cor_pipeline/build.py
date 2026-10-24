"""Build per-structure meshes, measurements and a QA report from one label volume.

    python -m cor_pipeline.build <labels.nii.gz> <out_dir> [--source mmwhs] [--case-id ID]
    python -m cor_pipeline.build <case_dir> <out_dir> --source totalseg_v1
    python -m cor_pipeline.build --synthetic <out_dir>

Outputs (all under out_dir, which must stay inside the git-ignored data/ folder):
    structures.glb   one named mesh per structure, app frame, centimetres
    report.json      provenance, measurements, QA issues, mesh stats
    asset/           with --asset: heart-high.glb, heart-low.glb, manifest.json, lv-cavity-proxy.json
                     in the app's attribute contract (see asset.py)
"""

import argparse
import json
from pathlib import Path

import numpy as np
import trimesh

from .labels import LABEL_MAPS

DATASETS = {
    "totalseg_v1": {
        "name": "TotalSegmentator dataset v1.0 (Wasserthal et al., Radiology: AI 2023)",
        "url": "https://zenodo.org/records/6802614",
        "license": "CC BY 4.0",
        "knownLimitations": [
            "Labels are 1.5 mm resampled; scans are mostly not ECG-gated, so the cardiac phase is unknown.",
            "RV volume is consistently ~1.5x LV in sampled cases: the RV/atrial labels may include their"
            " walls (only LV myocardium is a separate label). Unverified - do not report RV volume as RVEDV.",
        ],
    },
}
from .measure import measure_labels, qa_checks
from .mesh import extract_surface, main_components, ras_to_app

# Vessel pieces smaller than this fraction of the largest piece are dropped as fragments.
VESSEL_MIN_FRACTION = 0.1


def build_case(labels: np.ndarray, affine: np.ndarray, source: str, case_id: str, input_name: str) -> tuple[trimesh.Scene, dict]:
    label_map = LABEL_MAPS[source]
    measurements = measure_labels(labels, affine, label_map)

    meshes, mesh_info = {}, {}
    for value, structure in label_map.items():
        mask = labels == value
        if not mask.any():
            continue
        mask, components, kept = main_components(mask, VESSEL_MIN_FRACTION if structure.kind == "vessel" else 1.0)
        mesh = extract_surface(mask, affine)
        meshes[structure.key] = mesh
        mesh_info[structure.key] = {
            "region": structure.region,
            "kind": structure.kind,
            "vertices": len(mesh.vertices),
            "faces": len(mesh.faces),
            "watertight": bool(mesh.is_watertight),
            "components": int(components),
            "componentsKept": int(kept),
        }

    # Centre the heart at the origin (bounding box of all structures), then convert to the app frame.
    all_points = np.vstack([m.vertices for m in meshes.values()]) if meshes else np.zeros((1, 3))
    centre_mm = (all_points.min(axis=0) + all_points.max(axis=0)) / 2
    scene = trimesh.Scene()
    for key, mesh in meshes.items():
        mesh.vertices = ras_to_app(mesh.vertices - centre_mm)
        scene.add_geometry(mesh, node_name=key, geom_name=key)

    report = {
        "caseId": case_id,
        "input": input_name,
        "provenance": {
            "geometry": f"CT segmentation ({source} labels)",
            "dataset": DATASETS.get(source),
            "reviewedByClinician": False,
            "motion": "none (single phase)",
        },
        "units": "cm",
        "axes": "+X patient left, +Y superior, +Z anterior",
        "centreRasMm": [round(float(v), 2) for v in centre_mm],
        "voxelSpacingMm": [round(float(v), 3) for v in np.linalg.norm(affine[:3, :3], axis=0)],
        "measurements": measurements,
        "meshes": mesh_info,
        "qa": qa_checks(measurements, mesh_info, label_map),
    }
    return scene, report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("labels", nargs="?", help="label volume (.nii / .nii.gz), or a case folder for totalseg_v1")
    parser.add_argument("out_dir")
    parser.add_argument("--source", default="mmwhs", choices=sorted(LABEL_MAPS))
    parser.add_argument("--case-id")
    parser.add_argument("--synthetic", action="store_true", help="use the built-in synthetic volume")
    parser.add_argument("--asset", action="store_true", help="also write the app asset (asset/: GLBs, manifest)")
    args = parser.parse_args()

    if args.synthetic:
        from .synthetic import make_volume

        labels, affine = make_volume()
        input_name, case_id = "synthetic", args.case_id or "synthetic"
    elif args.labels:
        from .sources import load

        labels, affine = load(Path(args.labels), args.source)
        input_name = Path(args.labels).name
        case_id = args.case_id or input_name.split(".")[0]
    else:
        parser.error("give a labels file or --synthetic")

    scene, report = build_case(labels, affine, args.source, case_id, input_name)
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    scene.export(out / "structures.glb")
    (out / "report.json").write_text(json.dumps(report, indent=2))

    print(f"{case_id}: {len(report['meshes'])} structures -> {out}")
    for key, ml in report["measurements"]["volumes_ml"].items():
        print(f"  {key:18s} {ml:8.1f} mL")
    for issue in report["qa"]:
        print(f"  [{issue['level']}] {issue['structure']}: {issue['message']}")

    if args.asset:
        from .asset import build_asset

        glbs, manifest, proxy, qa = build_asset(labels, affine, args.source, case_id, DATASETS.get(args.source))
        asset_dir = out / "asset"
        asset_dir.mkdir(exist_ok=True)
        for lod, data in glbs.items():
            (asset_dir / f"heart-{lod}.glb").write_bytes(data)
        (asset_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
        (asset_dir / "lv-cavity-proxy.json").write_text(json.dumps(proxy))
        print(f"  asset -> {asset_dir} ({', '.join(f'{k} {len(v) / 1e6:.1f} MB' for k, v in glbs.items())})")
        for issue in qa:
            print(f"  [{issue['level']}] {issue['structure']}: {issue['message']}")


if __name__ == "__main__":
    main()
