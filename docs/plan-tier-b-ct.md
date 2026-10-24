# Next phase: patient-specific heart from CT (Tier B) — handoff plan

Status 2026-10-24: **decided, not started.** Read this first in a new session.

## Decisions (made with the user)

- Goal: build each patient's heart from real imaging, not by adapting the procedural asset.
- Start with an **open dataset**, not real patient DICOM.
- Hardware: **only the MacBook (Apple M2)** — no NVIDIA GPU. Processing runs locally (also a privacy
  advantage: competitors such as HeartFlow / Axial3D upload scans to their cloud).
- Keep the existing Tier A mode as the fallback for patients with echo numbers only.
- Our differentiator vs HeartFlow / Axial3D / Materialise: explainability — every structure labelled
  "from CT", "from echo measurement" or "illustrative" (valves stay illustrative: not reliably segmentable on CT).

## Research summary (sources in the conversation; re-verify before relying on them)

- Everyone uses CT/MRI → AI segmentation → expert review → mesh. Nobody builds exact 3D from echo.
- TotalSegmentator: CT. In v2 the chamber-level task `heartchambers_highres` is **free for
  non-commercial use only, may need a license key**; the default `total` task may only give a single
  "heart" label — **verify which task gives LV/RV/LA/RA/myocardium/aorta on a Mac before building**.
  Known to occasionally miss the LV → keep a QA step.
- Open data candidates: ImageCAS (~1000 CCTA, coronary labels, GitHub/Kaggle), MM-WHS (20+20 labelled
  CT/MR whole-heart), AI-CVM/Cardiac-CT on Hugging Face (gated). **License text not yet confirmed for any.**
- MRI alternative for real motion: UK Biobank open pipeline (2025, biventricular meshes); biv-me for 4D.

## Steps

1. Pick a dataset whose license allows this use; the user downloads it (needs a Kaggle/registration
   account — the agent must not create accounts). Store under `data/` (git-ignored, never deployed).
2. `pipeline/` (Python, venv): load NIfTI/DICOM → segmentation (TotalSegmentator on CPU/MPS, or
   use the dataset's ground-truth labels for the first demo) → per-label marching cubes (scikit-image)
   → Taubin smoothing → decimation → QA (watertight, volumes, missing labels).
3. Convert to the existing attribute contract (`docs/asset-pipeline.md`): region from label; wall depth
   from distance between epicardial and cavity surfaces; deformation weights by region.
4. Measure from the segmentation (LV/RV/LA/RA volumes, LV mass, wall thickness) → these become
   "derived from imaging" observations with provenance.
5. App: Tier B loader + manifest per patient, provenance badge "Geometry: CT segmentation (not reviewed by a clinician)",
   imaging tab; Tier A stays the default when no mesh exists. Real DICOM never goes to Vercel.
6. Motion: single-phase CT → shape real, motion illustrative (say so). Multi-phase CT/cine MRI later.
