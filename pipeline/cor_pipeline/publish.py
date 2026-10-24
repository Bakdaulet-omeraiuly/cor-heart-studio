"""Publish a built CT case into the app (step 5 of docs/plan-tier-b-ct.md).

    python -m cor_pipeline.publish ../data/out/s0270 [--meta ../data/totalseg_v1/meta.csv]

Copies asset/heart-{low,high}.glb to public/models/ct/<case>/, the manifest to
src/scene/asset-adapters/ct/<case>.manifest.json (file URLs made absolute), the LV cavity proxy to
tests/fixtures/ct/ (deformation volume tests) and adds or replaces the case's record in
public/samples/open-ct-patients.json. Register a new case in src/scene/asset-adapters/registry.ts.

Only label-derived meshes and measurements are published, never CT images. Use only open-licensed
cases (the record and manifest carry the dataset license and attribution).
"""

import argparse
import csv
import json
import shutil
import sys
from pathlib import Path

from .fidelity import gate

REPO = Path(__file__).resolve().parents[2]
SAMPLES = REPO / "public/samples/open-ct-patients.json"


def patient_record(case_id: str, manifest: dict, report: dict, meta: dict | None) -> dict:
    volumes = report["measurements"]["volumes_ml"]
    base = manifest["baseline"]
    source = f"CT segmentation, {manifest['attribution']} ({manifest['license']}); not reviewed by a clinician"
    finding = lambda category, text, value, unit: {
        "modality": "CT", "category": category, "finding": text, "value": value, "unit": unit, "source": source,
    }
    record = {
        "patientId": f"OPEN-CT-{case_id}",
        "studyId": f"TOTALSEG-V1-{case_id}",
        "displayName": f"Open CT · {case_id} · CT-derived shape",
        "synthetic": False,
        "clinicianNotes": (
            "De-identified case from an open research dataset. Only the 3D shape and the volumes below come "
            "from imaging (automatic + expert-refined segmentation). No echo, ECG or diagnosis is available: "
            "motion and timing are illustrative defaults. Cardiac phase of the scan is unknown."
        ),
        "imaging": {
            "findings": [
                finding("ventricular_volume", "LV cavity volume (segmentation, phase unknown)", volumes.get("lv_cavity"), "mL"),
                finding("myocardial_thickness", "LV myocardium volume (segmentation)", volumes.get("lv_myocardium"), "mL"),
                finding("myocardial_thickness", "LV wall thickness, septal, mid-basal level", base["ivsThicknessMm"], "mm"),
                finding("myocardial_thickness", "LV wall thickness, lateral, mid-basal level", base["lvPosteriorWallThicknessMm"], "mm"),
                finding("chamber_geometry", "LA volume (segmentation)", volumes.get("la_cavity"), "mL"),
                finding("chamber_geometry", "RV label volume (may include the RV wall)", volumes.get("rv_cavity"), "mL"),
            ],
            "assets": [{
                "kind": "mesh",
                "reference": manifest["assetId"],
                "format": "glTF 2.0 (COR attribute contract)",
                "deidentified": True,
                "units": "cm",
                "orientation": "+X patient left, +Y superior, +Z anterior",
                "structureLabels": ["lv", "lv_myocardium", "rv", "la", "ra", "aorta", "pulmonary_artery"],
                "license": manifest["license"],
            }],
        },
    }
    if meta:
        record["demographics"] = {"age": {"value": int(meta["age"]), "unit": "years"}, "biologicalSex": {"m": "male", "f": "female"}.get(meta["gender"], meta["gender"])}
    return record


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("case_out", help="data/out/<case> (built with --asset)")
    parser.add_argument("--meta", help="TotalSegmentator meta.csv for age/sex")
    parser.add_argument("--force", action="store_true", help="publish even if the COR-Fit gate fails")
    args = parser.parse_args()

    case_out = Path(args.case_out)
    case_id = case_out.name
    manifest = json.loads((case_out / "asset/manifest.json").read_text())
    report = json.loads((case_out / "report.json").read_text())
    fid = manifest.get("fidelity")
    problems = ["no COR-Fit fidelity report (rebuild with --asset)"] if not fid else [
        f"{lod}: {p}" for lod, f in fid["lods"].items() for p in gate(f["overall"], [fid["volume"]["errorPercent"]])]
    if problems and not args.force:
        sys.exit(f"{case_id}: COR-Fit gate failed — " + "; ".join(problems))

    models = REPO / "public/models/ct" / case_id
    models.mkdir(parents=True, exist_ok=True)
    for lod in manifest["files"]:
        shutil.copyfile(case_out / "asset" / f"heart-{lod}.glb", models / f"heart-{lod}.glb")
        manifest["files"][lod]["url"] = f"/models/ct/{case_id}/heart-{lod}.glb"
    if "imaging" in manifest:  # CT slice volumes for the evidence panel (derived from CC BY CT images)
        for key in ("image", "labels"):
            name = manifest["imaging"][key]
            shutil.copyfile(case_out / "asset" / name, models / name)
            manifest["imaging"][key] = f"/models/ct/{case_id}/{name}"
    adapters = REPO / "src/scene/asset-adapters/ct"
    adapters.mkdir(parents=True, exist_ok=True)
    (adapters / f"{case_id}.manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    fixtures = REPO / "tests/fixtures/ct"
    fixtures.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(case_out / "asset/lv-cavity-proxy.json", fixtures / f"{case_id}-lv-cavity-proxy.json")

    meta = None
    if args.meta:
        with open(args.meta, encoding="utf-8-sig") as f:
            meta = next((row for row in csv.DictReader(f, delimiter=";") if row["image_id"] == case_id), None)

    data = json.loads(SAMPLES.read_text()) if SAMPLES.exists() else {"schemaVersion": "1.0.0", "patients": []}
    record = patient_record(case_id, manifest, report, meta)
    data["patients"] = [p for p in data["patients"] if p["patientId"] != record["patientId"]] + [record]
    data["patients"].sort(key=lambda p: p["patientId"])
    SAMPLES.write_text(json.dumps(data, indent=2) + "\n")
    print(f"{case_id}: models -> {models.relative_to(REPO)}, manifest -> {adapters.relative_to(REPO)}, record -> {SAMPLES.relative_to(REPO)}")


if __name__ == "__main__":
    main()
