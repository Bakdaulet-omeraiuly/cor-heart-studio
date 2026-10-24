# COR-Fit — label-faithful 3D reconstruction with a measured accuracy report

COR-Fit is how COR Studio turns a segmented CT or MRI into the 3D model you see, and proves how closely
that model follows the scan's segmentation. Code: `pipeline/cor_pipeline/corfit.py` (brain surfaces),
`asset.py` (heart), `fidelity.py` (measurement and gate).

## What it guarantees — and what it does not

- **Guaranteed / measured:** the 3D surface follows the *source segmentation* of that scan. Every
  published model ships with its own report (per structure) and passed the publication gate.
- **Not claimed:** anatomical or clinical accuracy. That depends on the segmentation itself
  (dataset labels; for the brain, deep structures are automatic FreeSurfer labels; nothing is
  clinician-reviewed) and on scan resolution. COR Studio is not a medical device.

## Pipeline

1. **Labels → surface.** Brain: marching cubes on each binary label mask, so every vertex starts
   exactly on a voxel face of the segmentation. Heart: one solid built from signed-distance fields on a
   0.75 mm grid (LV wall from imaging; RV, atrial and vessel walls a fixed thickness and reported as
   "not from imaging").
2. **Constrained smoothing (brain).** Taubin smoothing (shrink-free) in voxel space, but after every
   half-step each vertex is clamped to ±0.5 voxel around its starting point. The staircase disappears;
   the surface can never drift more than half a voxel per axis from the label boundary. (Builds on
   the idea of constrained elastic surface nets, Gibson 1998.)
3. **Decimation** to a web budget (quadric error), then measured — not assumed.
4. **Fidelity report** (`fidelity.py`), per structure, both directions:
   mesh vertices → label boundary, and label boundary (voxel faces, 3×3 samples each) → mesh triangles.
   - **NSD @ 1 voxel** (normalized surface Dice, Nikolov et al. 2018): % of points within one voxel.
   - **Mean** symmetric surface distance and **HD95** (95th percentile Hausdorff), mm.
   - **Volume error** for closed surfaces (mesh volume vs voxel-count volume).
   Label faces between two structures that are not rendered as a surface there (e.g. the mitral
   orifice between LA and LV blood pools; a cortical region's border with white matter) are excluded.
5. **Gate.** A model is published only if overall NSD ≥ 95 % and every volume error ≤ 5 %
   (`publish.py`, `brain.py --app`; `--force` overrides and is never used for the shipped models).
6. **Evidence in the app.** The source CT/MRI slices with the segmentation overlaid sit next to every
   model with a shared crosshair; the report is shown on the model (badge, CT panel "COR-Fit
   accuracy" tab, brain summary and per-structure card).

## Results of the shipped models

| Model | Tolerance (1 voxel) | Surface within tolerance | Mean distance | Worst HD95 | Volume error |
|---|---|---|---|---|---|
| Heart CT s0270 (high / low LOD) | 1.5 mm | 98.3% / 97.9% | 0.46 mm | 2.6 mm | LV cavity -1.22% |
| Heart CT s0338 (high / low LOD) | 1.5 mm | 98.3% / 98.0% | 0.46 mm | 2.37 mm | LV cavity -1.22% |
| Brain MRI MMRR-21-5, all 84 structures | 1.2 mm | 96.4% | 0.35 mm | 5.56 mm | deep structures ≤ 1.6% |
| — cortex (62 manual regions) | 1.2 mm | 95.2% | 0.39 mm | 5.56 mm | — |
| — deep structures (22) | 1.2 mm | 100.0% | 0.24 mm | 0.63 mm | |

Before constrained smoothing (blur + closing + plain Taubin) the brain scored 67.6 % overall and
59.8 % on the cortex: smoothing had filled sulci and shrunk deep structures by up to 8 %. The report
is what exposed it.

## Known weak spots (visible in the report)

- Heart LV epicardium ≈ 93 %: near the septum the fixed-thickness RV wall covers the LV outer surface.
- Brain medial cortex (cingulate, parahippocampal) 79–89 %: region borders on the medial wall.
- Small label fragments below 0.5 mL (heart) are dropped from the mesh and count as misses.
