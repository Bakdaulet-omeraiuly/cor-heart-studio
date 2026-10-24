# COR Heart Studio

Explainable 3D cardiac visualization of structured observations. Import or enter a patient record,
see the anatomical heart change, and trace every visual change back to its input, rule and evidence
class. **Visualization demo with synthetic data — not a medical device, no diagnosis.**

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
patient. No DICOM is processed in the app or deployed; no CFD or clinical thresholds.

Tools used: code only (no Blender/Figma/Meshy/Tripo). License: MIT (see `LICENSE`).

## Data credits

The Tier B hearts (`public/models/ct/`, `src/scene/asset-adapters/ct/`, `public/samples/open-ct-patients.json`)
are derived from the TotalSegmentator dataset v1.0 — Wasserthal J. et al., "TotalSegmentator: Robust
Segmentation of 104 Anatomic Structures in CT Images", Radiology: Artificial Intelligence 2023 —
https://zenodo.org/records/6802614, licensed CC BY 4.0. Changes: label masks were converted to meshes,
measurements and the app's attribute contract by `pipeline/`. Only labels were used, never the CT images.
