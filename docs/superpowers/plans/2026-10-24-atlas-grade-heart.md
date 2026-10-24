# Atlas-grade heart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the default and Tier B hearts look like an anatomy atlas while staying measured where CT allows. Great vessels run full length. Coronary arteries and cardiac veins come from the BodyParts3D atlas, fitted into this heart's grooves. The surface is photo-real, with a Netter-colour toggle. Every layer is labelled with its provenance.

**Architecture:** The new pipeline module `atlas.py` loads named BodyParts3D heart parts (OBJ, CC BY-SA). `register.py` fits the atlas onto a target heart: landmark rigid alignment, then thin-plate spline. From there the two kinds of atlas data take different paths:

- **Coronary arteries and veins** are turned into centrelines. The centrelines are fitted into the grooves and rebuilt as tubes by the existing `coronary.build_vessels`, so `_CORO`, stenosis and fat keep working.
- **Great vessels** are voxelised into the asset's signed-distance fields, so the tissue stays one watertight mesh.

A new per-vertex `_PROV` attribute carries provenance into the shader and the UI. The web app adds the atlas-colour mode, a provenance-aware layer legend, vessel naming on selection, and 4K tileable detail maps.

**Tech Stack:** Python (trimesh, scipy, scikit-image, nibabel), TotalSegmentator `total` (in `pipeline/.venv-seg`), Three.js/R3F GLSL, KTX2 (basisu), vitest, Playwright, pytest.

**Spec:** `docs/superpowers/specs/2026-10-24-atlas-grade-heart-design.md`

## Global Constraints

- Every atlas or illustrative layer is labelled as such. Measured surface is never trimmed out of COR-Fit to raise the score; if the template stays under 95%, it ships with "below accuracy gate" and the reason.
- Licences:
  - BodyParts3D CC BY-SA 2.1 JP and Z-Anatomy CC BY-SA 4.0: heart parts only; derived meshes are CC BY-SA, attributed in the manifest, `docs/atlas-heart.md`, README credits and the ⓘ text.
  - Rodero CC BY 4.0.
  - TotalSegmentator `total`: no key, usage stats off.
- Stenosis input format unchanged: `VESSEL_ID` LM 1, LAD 2, LCx 3, RCA 4, PDA 5, segments proximal/mid/distal.
- Where a patient CT ends, the atlas continues the vessel; the seam is marked (`_PROV` changes) and named behind ⓘ.
- Missing atlas branch: procedural along its standard course, labelled "illustrative". The specimen's dominance is kept, not edited.
- Performance:
  - 60 fps at 1600×950 on an M2 Air in the default view.
  - Default heart download ≤ 25 MB.
  - Detail maps ≤ 4K, KTX2 with a 2K fallback.
- Look: natural mode = dissection photograph; atlas colours = arteries red, veins blue, saturated; clinical overlay unchanged.
- Before any TotalSegmentator run: remind the user to close Docker Desktop and heavy Chrome tabs (8 GB Mac).
- Workflow:
  - branch `atlas-heart`;
  - pytest + `npm test` + `npm run build` then `npx playwright test` (e2e only after a fresh build);
  - visual review screenshots;
  - ask the user before the ff-merge to main → push → `vercel deploy --prod --yes` → prod e2e.

## Review Focus

1. **Atlas centreline crossing a chamber.** A registered atlas centreline that crosses through a chamber (e.g. an LCx cutting the LA) instead of staying on the epicardium must be caught by the fit report and fail the build, not ship. Test: Task 3 `test_snap_never_inside_tissue`.
2. **Stenosis and LAD length.** A stenosis on the LAD must still land at the right thirds when the atlas LAD is longer or shorter than the old routed one. Test: Task 4 `test_coro_t_spans_vessel`.
3. **Seam at a CT edge.** A Tier B aorta where the CT ends mid-arch must have no gap and no visible step at the join. Test: Task 5 `test_join_gap_under_1mm`.
4. **Weak GPU.** On the low quality tier (phones, weak devices) the 4K maps are skipped and the heart still renders with the procedural look. Test: Task 7 `low tier uses no detail maps`.
5. **Selecting a vessel.** Selecting an atlas branch shows its name and "Atlas, fitted to this heart (not imaged)", never "measured". Test: Task 8 `selected branch shows atlas provenance`.

---

### Task 1: Atlas parts — download, select, load, verify branches

**Files:**
- Create: `pipeline/cor_pipeline/atlas.py`, `docs/atlas-heart.md` (section "Atlas parts")
- Test: `pipeline/tests/test_atlas.py`, fixture `pipeline/tests/fixtures/bp3d_mini/` (two tiny OBJ files + a parts list)

**Interfaces:**
- Produces:
  - `ATLAS_PARTS: dict[str, AtlasPart]`, where `AtlasPart(key: str, fma: list[str], kind: Literal["coronary_artery","coronary_vein","great_artery","great_vein","chamber","valve"], vessel: str | None)`. The keys cover:
    - LM, LAD, diagonal 1–2, septal, LCx, obtuse marginal, RCA, conal, SA-nodal, acute marginal, PDA, PLB;
    - great cardiac vein, middle cardiac vein, small cardiac vein, anterior cardiac veins, coronary sinus;
    - aortic arch with brachiocephalic trunk, left common carotid and left subclavian; ascending aorta; pulmonary trunk with right and left pulmonary arteries; SVC; IVC; four pulmonary veins;
    - epicardial surface of the chambers and the four valve annuli, used as landmarks.
  - `fetch_bodyparts3d(dest: Path) -> Path`, which downloads `partof_BP3D_4.0_obj_99.zip` and the parts lists into `data/bodyparts3d/`.
  - `load_parts(root: Path, keys: Iterable[str]) -> dict[str, trimesh.Trimesh]` (mm, BP3D frame).
  - `missing_parts(root: Path) -> list[str]`.

- [ ] **Step 1: Write the failing tests.** Run them against the fixture:
  - `test_load_parts_reads_named_obj`: the vertex count is correct and the bounds are in mm.
  - `test_missing_parts_lists_absent_keys`.
  - `test_every_coronary_key_has_fma_ids`: no empty list.
- [ ] **Step 2: Run** `cd pipeline && .venv/bin/pytest tests/test_atlas.py -v`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `atlas.py`.** Get the FMA ids from `partof_parts_list_e.txt`. Already-checked names include "great cardiac vein" FMA4707, "coronary sinus" FMA4706, "circumflex branch of left coronary artery" FMA3895, "diagonal branch…" FMA3860 and "arch of aorta" FMA3768. Search the list for every other key and record the chosen ids in a comment table.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Real data check.** Run `python -m cor_pipeline.atlas --fetch --report`. It prints, for every key: found or missing, triangle count, and the dominance verdict (PDA arising from the RCA or the LCx). Paste the output into `docs/atlas-heart.md`.
- [ ] **Step 6: Commit** (the data stays in `/data`, which is gitignored).

### Task 2: Centrelines from atlas vessel meshes

**Files:**
- Create: `pipeline/cor_pipeline/centreline.py`
- Test: `pipeline/tests/test_centreline.py`

**Interfaces:**
- Produces: `centreline(mesh: trimesh.Trimesh, voxel_mm: float = 0.25, start_hint: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]`. It returns ordered points (N×3 mm, from the end nearest `start_hint`) and the lumen radius per point (mm). The method: voxelise, `skimage.morphology.skeletonize`, longest graph path, radius from the distance transform, then resample every 0.5 mm.

- [ ] **Step 1: Write the failing tests:**
  - `test_centreline_of_curved_tube`: a helix tube of radius 1.5 mm gives every point within 0.25 mm of the true curve and a median radius within 10% of 1.5.
  - `test_order_follows_start_hint`.
  - `test_tapered_tube_radius_decreases`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 3: Register the atlas onto a target heart and snap vessels into the grooves

**Files:**
- Create: `pipeline/cor_pipeline/register.py`
- Test: `pipeline/tests/test_register.py`

**Interfaces:**
- Consumes: Task 1 `load_parts`; the target manifest (`valves`, `deformation` apex/base, `coronaryOstia`) and the target tissue mesh.
- Produces:
  - `Landmarks = dict[Literal["apex","aortic","mitral","tricuspid","pulmonary"], np.ndarray]`
  - `atlas_landmarks(parts) -> Landmarks` and `target_landmarks(manifest: dict) -> Landmarks`
  - `fit(atlas_epi: trimesh.Trimesh, target_epi: trimesh.Trimesh, a: Landmarks, b: Landmarks) -> Warp`. `Warp.__call__(pts: np.ndarray) -> np.ndarray` applies the rigid + scale transform from the landmarks, then a thin-plate spline over the landmarks plus 300 surface correspondences (closest point, 3 ICP rounds).
  - `snap_to_surface(pts: np.ndarray, radius: np.ndarray, target_epi: trimesh.Trimesh, lift: float = 1.9) -> tuple[np.ndarray, dict]`. It projects onto the epicardium, then lifts by radius×lift (the same rule as `build_vessels`). It also returns a report `{withinMm1Percent, maxInsideMm}`.
  - `class FitError(Exception)`, raised when the report has `maxInsideMm > 0.5` (a vessel passes through tissue).

- [ ] **Step 1: Write the failing tests:**
  - `test_fit_recovers_known_transform`: an ellipsoid "heart", rotated 20°, scaled 1.1 and bent by a smooth warp, has residual landmark error < 0.5 mm and surface distance (mean) < 0.5 mm.
  - `test_snap_never_inside_tissue`: a centreline pushed 3 mm into the ellipsoid comes back on or above the surface with `maxInsideMm ≤ 0.5`.
  - `test_fit_error_on_bad_path`: a path through the middle raises `FitError`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** (scipy `RBFInterpolator(kernel="thin_plate_spline")`).
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 4: Atlas coronary tree and veins as `_CORO` tubes

**Files:**
- Modify: `pipeline/cor_pipeline/coronary.py` (add branch and vein ids, calibres and a source per vessel)
- Modify: `pipeline/cor_pipeline/asset.py` (a `coronaries="atlas"|"routed"` switch in `build_asset`)
- Modify: `src/domain/coronary.ts` (branch names for display only; `VESSEL_ID` 1–5 unchanged)
- Test: `pipeline/tests/test_coronary_atlas.py`, `tests/unit/coronary.test.ts` (extend)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `VESSELS` gains these ids. Diameters cite Dodge 1992 where it gives them; otherwise they are marked assumed.
    - Arteries: 6 D1, 7 D2, 8 septal, 9 OM, 10 conal, 11 SA-nodal, 12 acute marginal, 13 PLB.
    - Veins: 20 great cardiac vein, 21 middle cardiac vein, 22 small cardiac vein, 23 anterior cardiac vein, 24 coronary sinus. Veins are tissue kind 4; vein calibres are cited or marked assumed.
  - `atlas_coronaries(parts, warp, target_epi) -> dict[str, np.ndarray]` returns centrelines keyed by name, in the shape `build_vessels` takes. Each vessel gets a manifest entry `coronary.vessels[id].source` ∈ {"atlas","illustrative"}.
  - A missing branch falls back to the routed path for that vessel, or to a standard-course spline for branches, with `source: "illustrative"`.
  - Manifest field `coronary.dominance`.
  - `DISPLAY_NAME: Record<number, string>` in `src/domain/coronary.ts`, for ids 1–24.

- [ ] **Step 1: Write the failing pytest tests** (synthetic parts and a synthetic ellipsoid heart):
  - `test_coro_t_spans_vessel`: `_CORO.y` covers 0→1 along LAD, RCA and LCx; the proximal-third vertices are nearest the ostium.
  - `test_ids_1_to_5_unchanged`.
  - `test_missing_branch_is_illustrative`.
  - `test_veins_kind_4`.
- [ ] **Step 2: Write the failing vitest test** `DISPLAY_NAME covers every manifest vessel id`. It loads `rodero-01.manifest.json` once Task 6 regenerates it, so mark it `.todo` until then and flip it in Task 6.
- [ ] **Step 3: Run** both suites. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** both suites. Expected: PASS (except the `.todo`).
- [ ] **Step 6: Commit.**

### Task 5: Great vessels full length, and the `_PROV` attribute

**Files:**
- Create: `pipeline/cor_pipeline/vessels.py`
- Modify: `pipeline/cor_pipeline/asset.py` (vessel masks join the SDF fields; write `_PROV`), `pipeline/cor_pipeline/glb.py` (if needed for a new uint8 attribute), `docs/asset-pipeline.md` (contract row for `_PROV`)
- Test: `pipeline/tests/test_vessels.py`

**Interfaces:**
- Consumes: Tasks 1, 3; TotalSegmentator `total` (Tier B only) via a `segment.py`-style subprocess in `pipeline/.venv-seg`.
- Produces:
  - `PROV = {"ct": 0, "ai": 1, "dataset": 2, "atlas": 3, "illustrative": 4}`
  - `extend_vessels(labels: np.ndarray, affine: np.ndarray, parts, warp, prov_ct: np.ndarray) -> tuple[np.ndarray, np.ndarray]`: new labels with the atlas continuations voxelised past the label ends, plus a per-voxel provenance volume.
  - `_PROV` uint8 vertex attribute: x = provenance code, sampled from the nearest voxel.
  - `segment_great_vessels(ct: Path, work: Path) -> dict[str, np.ndarray]` (Tier B): SVC, IVC, pulmonary_vein, aorta and the arch-branch labels from `total`. The pulmonary veins are split into four only if the merged label has four clean components; otherwise the atlas veins are fitted to its ostia.
  - Join report `{joinGapMm: {aorta, pulmonary_artery, svc, ivc}}` in the manifest's `fidelity.atlas`.

- [ ] **Step 1: Write the failing tests:**
  - `test_join_gap_under_1mm`: a synthetic CT tube ends at a volume edge; the atlas tube is registered with a 2 mm offset; the joined mask is one connected component and the gap is ≤ 1 mm.
  - `test_prov_marks_continuation`: the voxels beyond the edge get `atlas`, those inside get `ct`.
  - `test_ct_voxels_never_replaced`: every original label voxel keeps its label and `ct` provenance.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new tests and the full `pipeline/tests`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 6: Rebuild the template and the Tier B hearts, with fidelity and gate

**Files:**
- Modify: `pipeline/cor_pipeline/rodero.py` (atlas coronaries + vessels, stump reconstruction fix, run `fidelity.gate`), `pipeline/cor_pipeline/publish.py` (same for Tier B)
- Regenerate: `public/models/template/rodero-01/*`, `src/scene/asset-adapters/template/rodero-01.manifest.json`, `public/models/ct/s0270|s0338/*`, their manifests, `tests/fixtures/lv-cavity-proxy.json`
- Modify: `docs/cor-fit.md` (new results table rows and the stump fix explained), `docs/coronary.md` (atlas source)
- Test: `pipeline/tests/test_rodero_gate.py`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: rebuilt assets. Manifest `fidelity.lods.*` covers the measured layers only. `fidelity.atlas` = `{coronaryWithin1mmPercent, maxInsideMm, joinGapMm}`. `provenance.layers` lists each layer with its source and licence.

- [ ] **Step 1: Diagnose the stump scores.** Today the aorta is at 83.7% and the pulmonary artery at 66.7%. Find out why on the current labels (e.g. an open cut end scored against a closed label boundary, or a wall-thickness band). Write the cause in `docs/cor-fit.md` before changing anything.
- [ ] **Step 2: Write the failing test** `test_template_gate`. It builds the template at `voxel_mm=1.5` (fast) and asserts either NSD ≥ 95% on the measured layers, or that `manifest["fidelity"]["belowGate"]` is true with a non-empty `reason`. It also asserts that no label voxel was dropped from scoring compared with the current build.
- [ ] **Step 3: Run** it. Expected: FAIL.
- [ ] **Step 4: Implement** the reconstruction fix and the gate call.
- [ ] **Step 5: Run** it. Expected: PASS.
- [ ] **Step 6: Run the full builds.**
  - Template: `python -m cor_pipeline.rodero …` (the commands in `docs/asset-pipeline.md`).
  - Tier B: remind the user to close Docker and Chrome first, then run TotalSegmentator `total` on `data/totalseg_v1/s0270|s0338/ct.nii.gz` and publish.
  - Record the NSD, coronary fit and join gaps in `docs/cor-fit.md`.
- [ ] **Step 7: Flip the Task 4 `.todo` to a real test.** Run `npm test` and the full pytest suite. Expected: all PASS.
- [ ] **Step 8: Commit.**

### Task 7: Photo-real material, atlas-colour mode, 4K detail maps

**Files:**
- Create: `scripts/detail-maps/bake.ts` (tileable 4K myocardium/fat/vessel-wall normal + roughness, written as KTX2 and as 2K PNG), `public/textures/heart/*`
- Modify: `src/scene/materials/tissueMaterial.ts` (triplanar detail sampling; fibre direction from the LV frame helix angle, +60° endocardium → −60° epicardium (Streeter 1969); `uColourMode` 0 natural, 1 atlas, 2 clinical), `src/state/store.ts` (`DisplayMode` gains `"atlas"`), `src/components/workspace/SceneToolbar.tsx` (segmented control Natural | Atlas colours | Clinical overlay), `src/scene/performance/quality.ts` (low tier: no maps)
- Test: `tests/unit/display-mode.test.ts`, `tests/e2e/atlas-heart.spec.ts`

**Interfaces:**
- Consumes: `_PROV` and `_TISSUE` kind from Task 5.
- Produces: `DisplayMode = "natural" | "atlas" | "clinical"`; `useDetailMaps(tier): THREE.Texture[] | null`.

- [ ] **Step 1: Write the failing tests:**
  - unit `display mode cycles natural → atlas → clinical and persists in the session`;
  - e2e `atlas colours paints arteries red and veins blue`: sample canvas pixels at a known coronary and a vein after framing them with the camera preset; the artery is red-dominant and the vein blue-dominant;
  - e2e `low tier uses no detail maps`: force the low tier through the existing quality override; no `/textures/heart/` requests are made.
- [ ] **Step 2: Run** them (after `npm run build`). Expected: FAIL.
- [ ] **Step 3: Implement.** Natural-mode targets:
  - muscle sRGB around (122, 40, 36), deep and not glossy;
  - serous coat specular is roughness 0.35 on a 0.6 base;
  - fat (226, 190, 110), lobulated;
  - arteries pale tan-pink;
  - veins dark purple-blue.
- [ ] **Step 4: Run** `npm test`, `npm run build`, then the e2e. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 8: Provenance in the UI — layer legend and vessel naming

**Files:**
- Modify: `src/components/workspace/Legend.tsx` (one row per layer: name, provenance chip, ⓘ with source and licence from `manifest.provenance.layers`), `src/scene/HeartModel.tsx` (picking on the coronary meshes reads `_CORO.x`, then `DISPLAY_NAME`), `src/components/inspector/Inspector.tsx` (vessel card: name, source, calibre)
- Test: `tests/e2e/atlas-heart.spec.ts` (extend), `tests/unit/legend.test.ts`

**Interfaces:**
- Consumes: Task 4 `DISPLAY_NAME`, Task 6 `provenance.layers`, Task 5 `_PROV`.
- Produces: none for later tasks.

- [ ] **Step 1: Write the failing tests:**
  - unit `legend shows one row per manifest layer with its provenance label`;
  - e2e `selected branch shows atlas provenance`: click a known diagonal; the inspector reads "Diagonal branch" and "Atlas, fitted to this heart (not imaged)".
  - e2e `Tier B seam is named`: on s0270 the aorta ⓘ mentions "atlas continuation beyond the scan".
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 9: Performance, visual review, docs, release

**Files:**
- Modify: `tests/perf/measure.mjs` (record fps and MB for the default view), `docs/atlas-heart.md` (complete), `docs/anatomy-review.md` (new review), `README.md` (credits: BodyParts3D, Z-Anatomy, CC BY-SA), `docs/visual-review/*` (anterior, posterior, base, left-lateral for the template and s0270 in natural and atlas modes, each next to a BodyParts3D reference render made by `atlas.py --render`)

- [ ] **Step 1: Run** `node tests/perf/measure.mjs` against the production build. Expected: ≥ 60 fps in the default view and ≤ 25 MB for the default heart. If it misses, reduce the high LOD or the map size and re-measure.
- [ ] **Step 2: Generate the review set** and look at every image. Fix any vessel crossing a chamber, any join step or any plastic sheen. Re-render.
- [ ] **Step 3: Run** the full gates: `pipeline/.venv/bin/pytest`, `npm test`, `npm run build`, `npx playwright test`. Expected: all PASS.
- [ ] **Step 4: Commit.** Show the user the review images and **ask** before the ff-merge to main. After approval: push, `vercel deploy --prod --yes`, then prod e2e (the temporary prod Playwright config used on 2026-10-24).

---

## Self-review notes

- **Spec coverage:**
  - layers (T1–T6); natural and atlas look (T7);
  - provenance and seam (T5, T8); stenosis unchanged (T4);
  - missing branch / dominance (T1, T4); gate without trimming (T6);
  - Tier B via `total` + dataset PA + atlas continuation (T5, T6);
  - performance (T7, T9); licences and credits (T1, T9); review images (T9).
- **Out of scope** (spec non-goals): valve leaflets and chordae; SCCT 18-segment input; patient-specific coronaries; the progression engine.
