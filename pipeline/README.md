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

## App asset (step 3): `--asset`

`cor_pipeline/asset.py` writes `asset/heart-{high,low}.glb` (300k / 120k triangles), `manifest.json`,
`lv-cavity-proxy.json` and, via `preview`, `preview.png` (regions + wall-depth cut). Same contract as
the procedural heart (docs/asset-pipeline.md), `provenanceTier: "B"`:

- Signed distance fields on a 0.75 mm grid: `outer` = LV (myocardium + cavity) ∪ every other blood
  pool grown by a fixed wall (RV 3 mm, atria 2 mm, aorta 2 mm, PA 1.5 mm); `cavity` = blood pools;
  tissue = outer − cavity → one closed solid (cavity surfaces inside, so cuts show wall thickness).
- `_WEIGHTS`, `_TISSUE` (depth, kind, region) follow `vertexAttributes()` in
  `scripts/heart-asset/build.ts`; fat is 0.
- Manifest geometry is measured: LV frame by PCA of the cavity (base at the mitral plane, septal
  direction toward the RV), mitral/tricuspid annulus from where the blood pools touch, aortic/pulmonary
  valves at the vessel root. Papillary muscles and coronary ostia are illustrative (LV frame).
- Not in the labels, so not in the mesh: coronary vessels, venae cavae, pulmonary veins.

Publish a built case into the app (copies GLBs, manifest, LV-cavity test fixture and the sample
record), then add its manifest to `src/scene/asset-adapters/registry.ts`:

```bash
.venv/bin/python -m cor_pipeline.publish ../data/out/s0270 --meta ../data/totalseg_v1/meta.csv
```

Valves: AV annuli use label contacts ≥ 6 mm inside the heart (outer AV-groove contacts are ignored);
papillary points are snapped ≥ 3–5 mm inside their cavity.

Not done yet: TotalSegmentator inference for unlabelled scans; aortic annulus radius tends to read
small (0.74–1.08 cm on the five cases) because the root slab tapers.

## Brain (Mindboggle-101): `cor_pipeline/brain.py`

```bash
# one subject's folder from the MMRR-21_volumes archive (osf.io/9ahyp), under ../data/mindboggle/
.venv/bin/python -m cor_pipeline.brain ../data/mindboggle/MMRR-21_volumes/MMRR-21-5 ../data/out/brain-MMRR-21-5 --app
```

Uses `labels.DKT31.manual+aseg` (manual cortex + automatic FreeSurfer deep structures) and the
skull-stripped `t1weighted_brain`. Per hemisphere one cortex mesh (outer surface of that hemisphere's
labels) whose vertices carry the nearest cortical region (`_REGION`); every deep structure is its own
mesh. Writes `brain-manifest.json` (84 structures: labels, method, colour, volume), `mri.u8.gz` /
`labels.u8.gz` (cropped 8-bit volumes for the slice views, voxel→app matrix in the manifest).
Not used: OASIS-TRT-20 subjects (OASIS data-use agreement forbids 3D head renderings and needs a
signed DUA).

## Anatomy template: Rodero 2021 healthy CT meshes (CC BY 4.0)

The default heart for records without their own mesh is a CT-derived healthy adult heart:
Rodero C, Strocchi M, et al. *Linking statistical shape models and simulated function in the healthy adult
human heart*, PLoS Comput Biol 2021, doi:10.1371/journal.pcbi.1008851, data zenodo.org/records/4590294.

```bash
curl -L -o ../data/rodero2021/raw/01.tar.gz "https://zenodo.org/records/4590294/files/01.tar.gz?download=1"
tar -xzf ../data/rodero2021/raw/01.tar.gz -C ../data/rodero2021/raw/x01
.venv/bin/python -m cor_pipeline.rodero ../data/rodero2021/raw/x01/01.vtk ../data/out/rodero-01 --case 01   # ~2 min
```

`rodero.py` reads the tetrahedral VTK (LPS mm), rasterises the element tags at 0.75 mm, takes the closed cavities
as chamber blood pools (valve planes join the downstream pool), closes the open great-artery stumps on a coarse grid
to get their lumen, and hands pools + **measured walls for every chamber and great artery** to `asset.py`.
Case 01 COR-Fit at 0.75 mm: chambers and LV epicardium 95–99.9 %, great-artery stumps 66–84 % (the cut ends).
No coronaries, fat, venae cavae or pulmonary veins in the source; valves are runtime-generated as before.
Published to `public/models/template/rodero-01/` and `src/scene/asset-adapters/template/rodero-01.manifest.json`.
