# COR Heart Studio

Explainable 3D cardiac visualization of structured observations. Import or enter a patient record,
see the anatomical heart change, and trace every visual change back to its input, rule and evidence
class. **Visualization demo with synthetic data — not a medical device, no diagnosis.**

How the team used Kiro (specs, steering, hooks, property-based tests): [`KIRO.md`](KIRO.md). Kiro files: [`.kiro/`](.kiro).

## Quick start

```bash
npm ci
npm run dev            # http://localhost:3000 — synthetic samples load automatically
```

Production: `npm run build && npm run start`. Any Node host works (Vercel: import the repo, defaults).

## Tests

```bash
npm run typecheck
npm test               # Vitest: domain, import, mapping, rendered-volume tests
npm run build && npm run test:e2e   # Playwright with local Google Chrome (real WebGL + no-WebGL fallback)
node tests/perf/measure.mjs          # with `npm run start -- -p 3200` running
```

## Importing patients

Import dialog (⇪ in the patient panel): JSON (`{ "schemaVersion": "1.0.0", "patients": [...] }`,
or a bare array / single record) or CSV (one patient-study per row, units in column names).
Preview shows valid / warning / rejected / duplicate rows with fixes; duplicates of `(patientId, studyId)`
need an explicit replace/skip. Templates: `public/samples/`. Schema: `public/schema/`.
Everything is processed in the browser tab and forgotten when it closes.

## Regenerating assets and data

```bash
npm run build:asset    # procedural heart GLBs + manifest (~2.5 min)
npm run build:data     # CSV twin, templates, JSON Schema
npx tsx scripts/generate-data-dictionary.ts
```

CT-derived hearts (Tier B) come from the Python pipeline in `pipeline/` (see `pipeline/README.md`):
fetch an open case → `build --asset` → `publish` → register it in `src/scene/asset-adapters/registry.ts`.

## Docs

- `docs/data-to-visual-mapping.md` — rules, formulas, bounds, limitations
- `docs/medical-data-dictionary.md` — every category, units, CSV mapping, rendering eligibility
- `docs/asset-pipeline.md` — how the heart is built, attribute contract, replacement
- `docs/anatomy-review.md` — checklist, rubric, known defects (self-review only)
- `docs/architecture.md`, `docs/verification.md`

## Honest limits

Tier A: a procedural anatomical heart adapted to measurements. Shape beyond measured dimensions,
motion waveform, valve geometry and flow particles are illustrative.

Tier B (two bundled "Open CT" cases): chamber and great-artery shape from an open CT segmentation,
not reviewed by a clinician. Single-phase scans, so motion is the same illustrative motion; only the
LV wall is from imaging (other walls fixed thickness); no coronaries or veins; valves are placed at
label-derived annuli but leaflets are illustrative. The viewport badge and Inspector say this per
patient. Next to each Tier B heart, the source CT is shown in axial, coronal and sagittal views with
the segmentation overlaid and a crosshair shared with the 3D model (the evidence for the shape). No
DICOM is processed in the app or deployed (the open-dataset CT is shipped as a cropped 8-bit volume,
HU −300…700); no CFD or clinical thresholds.

Tools used: code only (no Blender/Figma/Meshy/Tripo). License: MIT (see `LICENSE`).

## COR-Fit: measured model accuracy

Every CT/MRI-derived model is built and verified by COR-Fit (`docs/cor-fit.md`): label-faithful
surface reconstruction (voxel-constrained smoothing for the brain) plus a per-structure report of
how closely the 3D surface follows the scan's segmentation (NSD within one voxel, mean distance,
HD95, volume error), with a publication gate (≥ 95 % within one voxel, volume error ≤ 5 %). Shipped
models: hearts 99.7–99.8 % within 1.5 mm (mean 0.38 mm); brain 100.0 % within 1.2 mm (mean 0.25 mm; worst region 99.4 %). This is
fidelity to the segmentation, not clinical accuracy.

## Brain module

"Brain" in the header opens a second organ module: one healthy adult brain (Mindboggle-101 subject
MMRR-21-5) as a 3D model built from its MRI segmentation, next to the source T1 MRI in axial,
coronal and sagittal views with the segmentation overlaid and one shared crosshair — the slices are
the evidence for the 3D shape. 84 structures with voxel-count volumes; cortical regions are manual
(DKT31), deep structures automatic (FreeSurfer aseg) and marked as such. Only the skull-stripped
image is published, so no face can be rendered. Build: `python -m cor_pipeline.brain <subject_dir>
<out_dir> --app` (see `pipeline/README.md`).

## Data credits

The Tier B hearts (`public/models/ct/`, `src/scene/asset-adapters/ct/`, `public/samples/open-ct-patients.json`)
are derived from the TotalSegmentator dataset v1.0 — Wasserthal J. et al., "TotalSegmentator: Robust
Segmentation of 104 Anatomic Structures in CT Images", Radiology: Artificial Intelligence 2023 —
https://zenodo.org/records/6802614, licensed CC BY 4.0. Changes: label masks were converted to meshes,
measurements and the app's attribute contract by `pipeline/`; the CT images of the two published cases
were cropped to the heart and rescaled to 8 bit (HU −300…700) for the slice views.

The brain module (`public/brain/`) is derived from Mindboggle-101 release 3 — Klein A., Tourville J.,
"101 labeled brain images and a consistent human cortical labeling protocol", Frontiers in
Neuroscience 2012, doi:10.3389/fnins.2012.00171 — https://osf.io/nhtur/, licensed CC BY 4.0 (as listed
on OSF). Subject MMRR-21-5 comes from the Multi-Modal MRI Reproducibility Resource (Landman et al.,
NeuroImage 2011). Changes: labels converted to meshes and measurements, the skull-stripped T1 cropped
and rescaled to 8 bit for display.
