# CT → heart mesh pipeline (Tier B, step 2 of docs/plan-tier-b-ct.md)

Runs locally on the Mac. Input and output live in the git-ignored `data/` folder: never commit or deploy
real scans.

```bash
cd pipeline
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest                                   # synthetic-volume tests
.venv/bin/python -m cor_pipeline.build --synthetic ../data/out/synthetic
.venv/bin/python -m cor_pipeline.build ../data/mmwhs/ct_train_1001_label.nii.gz ../data/out/1001

# Open data, no registration: TotalSegmentator v1 (CC BY 4.0), per-case download via HTTP ranges
.venv/bin/python -m cor_pipeline.fetch_totalseg --meta ../data/totalseg_v1      # meta.csv (80 "ct heart*" cases)
.venv/bin/python -m cor_pipeline.fetch_totalseg ../data/totalseg_v1 s0270 s0368  # labels only, ~100-400 KB/case
.venv/bin/python -m cor_pipeline.build ../data/totalseg_v1/s0270 ../data/out/s0270 --source totalseg_v1
.venv/bin/python -m cor_pipeline.preview ../data/out/s0270                        # preview.png
```

Sources: `mmwhs` (one label volume) and `totalseg_v1` (a case folder of per-structure masks). Vessels
are cropped to the heart box + 40 mm; vessel pieces ≥ 10 % of the largest are kept (so ascending and
descending aorta both survive); chambers keep only their largest piece.

TotalSegmentator v1 caveats (also written into each `report.json`): 1.5 mm resampled, mostly not
ECG-gated (phase unknown), and RV ≈ 1.5 × LV in every sampled case — the RV/atrial labels may include
their walls. Attribution required (CC BY): Wasserthal et al., Radiology: AI 2023, zenodo.org/records/6802614.

Per structure: largest connected component → light Gaussian blur → marching cubes → voxel affine to
RAS mm → Taubin smoothing → quadric decimation (20k faces) → app frame (cm, +X left, +Y superior,
+Z anterior), centred on the heart's bounding box.

Outputs `structures.glb` (one named mesh per structure) and `report.json` (provenance, voxel-count
volumes, LV mass = myocardium × 1.05 g/mL, mesh stats, QA: missing labels, implausible volumes,
non-watertight meshes, fragments).

Not done yet: attribute contract (`_WEIGHTS`, `_TISSUE`) for the app's deformation (step 3), wall
thickness, TotalSegmentator for unlabelled scans.
