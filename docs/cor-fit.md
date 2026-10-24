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

| Model | Tolerance (1 voxel) | Surface within tolerance | Mean distance | Worst HD95 | Volume / notes |
|---|---|---|---|---|---|
| Heart CT s0270 (high / low LOD) | 1.5 mm | 99.7% / 99.8% | 0.38 mm | 0.86 mm | LV cavity -1.21% · LV epicardium 99.7% |
| Heart CT s0338 (high / low LOD) | 1.5 mm | 99.8% / 99.8% | 0.38 mm | 1.07 mm | LV cavity -1.2% · LV epicardium 99.5% |
| Brain MRI MMRR-21-5, all 84 structures | 1.2 mm | 99.6% | 0.26 mm | 1.64 mm | deep structures ≤ 1.6% |
| — cortex (62 manual regions) | 1.2 mm | 99.5% | 0.27 mm | 1.64 mm | — |
| — deep structures (22) | 1.2 mm | 100.0% | 0.24 mm | 0.63 mm | |

How the numbers got here (each step measured by this report):

| Step | Brain overall | Brain cortex | Heart LV epicardium | Kind of change |
|---|---|---|---|---|
| Blur + closing + plain Taubin, 90k-face cortex | 67.6 % | 59.8 % | 93.4 % | — |
| Constrained smoothing (±0.5 voxel) | 96.3 % | 95.0 % | — | geometry |
| Medial non-cortical surface no longer painted as cortex | 96.4 % | 95.2 % | — | geometry (region labels) |
| Border triangles count for both regions | 98.9 % | 98.5 % | — | **measurement** correction |
| Cortex published undecimated (normals computed in browser) | 99.6 % | 99.5 % | — | geometry |
| Synthetic walls Voronoi-clipped against the LV; 1.2 mm minimal LV wall where the label has no myocardium | — | — | 99.5–99.7 % | geometry |

## Known weak spots (visible in the report)

- Brain: worst structure Parahippocampal (right) 94.2 % (inferior medial surface next to
  the cerebellum); the label→mesh direction is the weaker one.
- Heart: the RV, atrial and vessel *outer* walls are a fixed thickness (not imaged) and are not scored;
  where they meet the LV they are clipped at the midline between the two (Voronoi split), which leaves
  a shallow groove along the interventricular sulci.
- Where the LV cavity label has no myocardium around it (≈ 6 % of its boundary, mostly the valve
  plane) a 1.2 mm minimal wall is added, below the 1.5 mm tolerance.
- The cortex GLB is ~13 MB because it is not decimated.
