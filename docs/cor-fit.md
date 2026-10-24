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
| Heart CT s0270, atlas-grade (high / low LOD) | 1.5 mm | 99.6% / 99.7% | 0.38 mm | 1.27 mm | LV cavity -1.22% · LV epicardium 99.5% · measured layers only |
| Heart CT s0338, atlas-grade (high / low LOD) | 1.5 mm | 99.7% / 99.7% | 0.38 mm | 1.03 mm | LV cavity -1.2% · LV epicardium 99.6% · worst pulmonary artery 98.5% |
| Brain MRI MMRR-21-5, all 84 structures | 1.2 mm | 100.0% | 0.25 mm | 0.72 mm | deep structures ≤ 1.6% |
| — cortex (62 manual regions) | 1.2 mm | 100.0% | 0.26 mm | 0.72 mm | worst region Parahippocampal (left) 99.4% |
| — deep structures (22) | 1.2 mm | 100.0% | 0.24 mm | 0.63 mm | |

How the numbers got here (each step measured by this report):

| Step | Brain overall | Brain cortex | Heart LV epicardium | Kind of change |
|---|---|---|---|---|
| Blur + closing + plain Taubin, 90k-face cortex | 67.6 % | 59.8 % | 93.4 % | — |
| Constrained smoothing (±0.5 voxel) | 96.3 % | 95.0 % | — | geometry |
| Medial non-cortical surface no longer painted as cortex | 96.4 % | 95.2 % | — | geometry (region labels) |
| Border triangles count for both regions | 98.9 % | 98.5 % | — | **measurement** correction |
| Cortex published undecimated (normals computed in browser) | 99.6 % | 99.5 % | — | geometry |
| Surface vertices take the region of the voxel half a voxel *inward* (not across a sulcus) | 100.0 % | 100.0 % | — | geometry (region labels) |
| Synthetic walls Voronoi-clipped against the LV; 1.2 mm minimal LV wall where the label has no myocardium | — | — | 99.5–99.7 % | geometry |

Atlas layers of the two open-CT hearts (2026-10-24, `fidelity.atlas`; fitted, never scored above):

| Heart | Atlas coronaries / veins drawn | Worst shift to the epicardium | Worst inside the tissue | Join gap | Atlas voxels left out (not attached) |
|---|---|---|---|---|---|
| s0270 | 18 / 18 | PLB 7.6 mm | coronary sinus 4.5 mm | 0 mm | aorta 4270, vena cava 4581, pulmonary veins 914 |
| s0338 | 17 / 18 (coronary sinus not drawn: 9.1 mm inside) | RCA 11.7 mm | posterior LV vein 4.1 mm | 0 mm | aorta 3135, vena cava 1177, pulmonary veins 3306 |

Limits 12 mm off / 6 mm inside (unchanged). The fit is close to them on these hearts (RCA 11.7 mm on s0338), and
small changes of the epicardium move individual branches across them: which side branch fails can change between
builds. LM, LAD, LCx, RCA and PDA (the stenosis vessels) failing still fails the build.

## Known weak spots (visible in the report)

- Brain: worst structure Parahippocampal (left) 99.4 %. Before the inward lookup,
  18 % of the right parahippocampal surface was painted as fusiform (the neighbour across the
  collateral sulcus) because a vertex on a voxel face can round to the outside voxel.
- Heart: the RV, atrial and vessel *outer* walls are a fixed thickness (not imaged) and are not scored;
  where they meet the LV they are clipped at the midline between the two (Voronoi split), which leaves
  a shallow groove along the interventricular sulci.
- Where the LV cavity label has no myocardium around it (≈ 6 % of its boundary, mostly the valve
  plane) a 1.2 mm minimal wall is added, below the 1.5 mm tolerance.
- The cortex GLB is ~13 MB because it is not decimated.

## Rodero template: why the great-artery stumps scored 66–84 % (diagnosed 2026-10-24)

The Rodero 2021 source meshes end where the authors cut the great arteries. Rasterised, each lumen label then has
two kinds of boundary faces: faces covered by the vessel's own measured wall, and faces that open straight onto
background at the cut. Scored separately against the rendered mesh (0.75 mm tolerance, high LOD):

| Lumen | Faces onto own wall | within 0.75 mm | Faces onto background (cut ends) | within 0.75 mm |
|---|---|---|---|---|
| Aorta | 75.5 % | 99.8 % | 24.5 % | 21.8 % |
| Pulmonary artery | 52.0 % | 100.0 % | 48.0 % | 28.8 % |

So the reconstruction of the vessels is accurate; the low score comes from the cut itself, which is not an
anatomical surface (the rendered stump is an open tube). The atlas-grade heart fixes this by **reconstruction**,
not by scoring less: the BodyParts3D continuation (cor_pipeline/vessels.py) continues each vessel past its cut, so
the cut faces become interior faces between measured and atlas voxels of the same vessel. Scoring then counts every
measured (CT/source) voxel's boundary except faces shared with the atlas continuation; atlas voxels themselves are
reported separately (`fidelity.atlas`) and never enter the COR-Fit gate.
