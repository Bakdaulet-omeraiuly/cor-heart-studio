# Atlas-grade heart — design

Date: 2026-10-24 · Status: approved by the user (2026-10-24), builder-checked

## Intent

The user finds the current heart "weak". They want it to look like **the most realistic anatomy atlas**:
detailed great vessels, coronary arteries, cardiac veins, and a believable surface, "like 4K". They also
said, as a standing rule, that everything built must strive for **accuracy, realism and real scientific
grounding**.

Those two goals pull in different directions. An atlas heart is beautiful, but it is one textbook
specimen, not measured. The user chose the **hybrid (option A)**:
- what can be measured from CT stays measured;
- what CT cannot resolve comes from an expert-built open atlas, fitted onto the measured heart;
- every layer says which of the two it is.

This comes before the planned "how the disease progresses" engine, which will draw on this heart.

## Decisions made by the user

- Option A, the CT + atlas hybrid (chosen in the visual companion over "pure atlas" and "pure CT").
- **Look:** natural-tissue mode is **photo-realistic**, like a dissection photograph: brown-red muscle,
  yellow lobulated fat, vessels in their natural colour. One toggle switches to **atlas colours**,
  Netter-style: arteries red, veins blue, saturated. The clinical overlay stays a separate mode.
- Quality bar: "the most realistic anatomy atlas", as detailed as possible. The user left the source
  choices to the designer ("өзің таңда… бәрін қолдан керек болса").

## Layers and where each comes from

| Layer | Source | Provenance label in the app |
|---|---|---|
| Chambers and LV wall | CT segmentation, as today (template: Rodero 2021 case 01; Tier B: the patient's CT), measured by COR-Fit | "Measured from CT" |
| Great vessels, full length: aortic root, ascending aorta, arch with its three branches, proximal descending aorta; pulmonary trunk and bifurcation; SVC, IVC; four pulmonary veins | Tier B: the patient's own CT via AI segmentation (TotalSegmentator `total` task, no licence key). Template (Rodero has meshes only, no CT image): the atlas, fitted to Rodero's vessel stumps | "AI segmentation of this CT" / "Atlas, fitted" |
| Coronary arteries (LM, LAD + diagonals + septals, LCx + obtuse marginals, RCA + conal, SA-nodal, acute marginal, PDA, PLB) and cardiac veins (great, middle, small cardiac veins, coronary sinus) | Atlas: BodyParts3D via Z-Anatomy (CC BY-SA), registered so the vessels lie in this heart's grooves | "Atlas, fitted to this heart (not imaged)" |
| Epicardial fat | Anatomy literature: AV and interventricular grooves, along the coronaries, acute margin, apex; thickness ranges cited | "Illustrative, literature-based" |
| Surface material | 4K PBR maps (albedo, normal, roughness, subsurface): thin glossy serous coat, muscle-fibre direction on the myocardium, lobulated fat, vessel walls | Look only, no data claim |

## Designer's calls from the builder check

- **Where a patient CT runs out** (s0270 and s0338 cover only about 14–15 cm, and the aorta touches both
  ends of the scan), the fitted atlas continues the vessel. One vessel can therefore carry two
  provenance segments, "from this CT" and "atlas continuation". The seam is shown in the clinical
  overlay and named behind ⓘ.
- **Pulmonary trunk and bifurcation for Tier B:** TotalSegmentator `total` has no pulmonary-artery
  label and only one merged pulmonary-vein label. Use the dataset's own `pulmonary_artery` label
  (labelled "dataset label") and the atlas beyond it. Split the pulmonary veins into four only if the
  merged label separates cleanly into four components; otherwise use the atlas veins, fitted to the
  merged label's ostia.
- **Stenosis input format is unchanged** (vessel LM/LAD/LCx/RCA/PDA, segment proximal/mid/distal). Only
  the drawing maps onto the new atlas tree. The SCCT 18-segment input is deferred.
- **If the atlas specimen lacks a required branch**, generate that branch procedurally along its standard
  course, labelled "illustrative". If the specimen is not right-dominant, keep its anatomy, note the
  dominance in the ⓘ text, and don't edit it into right-dominance.
- **The COR-Fit gate is met by better reconstruction, never by measuring less.** The Rodero
  great-artery stumps are not trimmed out of the score. The vessel-stump reconstruction in `rodero.py`
  is fixed. If the template still scores under 95%, it ships with the honest "below accuracy gate"
  label and the reason.

## Goals

- At normal viewing distance, a side-by-side render of the default heart reads as atlas-quality next to
  a Netter- or Sobotta-style anterior and posterior view: full great vessels with no stumps, a dense and
  correctly branched coronary tree, visible cardiac veins and coronary sinus, fat in the grooves, and no
  plastic look.
- **Anatomical correctness of the atlas layers.** The coronary tree follows the standard right-dominant
  pattern with named branches, so the existing CAD-RADS stenosis feature can map its segments onto it
  (SCCT segment model). Veins run with their arteries (great cardiac vein with the LAD, middle cardiac
  vein with the PDA).
- The fitting is measured, not eyeballed:
  - coronary and vein centrelines lie in or on the epicardial surface (distance reported);
  - great-vessel ends meet the CT vessel ends without gaps.
- The **default template passes the 95% COR-Fit gate**. Today it is at 89.1% because its great-artery
  stumps score 66–84% and `rodero.py` never ran the gate. The gate applies to the CT-measured layers
  only; atlas layers get their own fit report.
- The same method applies to Tier B CT hearts (s0270, s0338): their own CT supplies the great vessels,
  and the atlas supplies the coronaries and veins.
- Natural-tissue mode looks like a dissection photograph; the atlas-colour toggle looks like a Netter plate. The clinical-overlay mode keeps
  working and is unchanged in meaning.

## Non-goals (this round)

- Valve leaflets, chordae and papillary detail from the atlas. They stay as today: generated at runtime
  and labelled illustrative. *(Designer's call: they are only seen in cutaway and would double the
  registration work.)*
- Patient-specific coronaries from coronary-CT datasets: ASOCA is closed access and ImageCAS has no
  licence found. Revisit when one is available.
- The progression engine (next project).

## Anti-goals

- Passing atlas anatomy off as measured. Every atlas or illustrative layer is labelled as such, in the
  layer legend and behind ⓘ.
- Regressing what exists: CAD-RADS stenosis drawing, ECG lock to the cycle, deformation to reported
  measurements (Tier A), cutaway, Outlook scenarios, comparisons and the COR-Fit numbers must all keep
  working.
- A heavy page: the app must stay interactive on a laptop (MacBook Air M2 class).

## Constraints

- Licences:
  - **Z-Anatomy / BodyParts3D: CC BY-SA 4.0 / CC BY-SA 2.1 JP.** Derived meshes ship under CC BY-SA
    with attribution (asset licence, separate from the app's MIT code), recorded in the asset manifest,
    `docs/` and the ⓘ text. Some Z-Anatomy parts carry NC licences (inner ear, kidney); use heart parts
    only, and confirm each part's origin.
  - **Rodero 2021: CC BY 4.0.**
  - **TotalSegmentator `total`:** Apache code, open weights, no key. Usage stats stay off.
- Performance:
  - GPU: 60 fps at 1600×950 on an M2 Air in the default view.
  - Download for the default heart ≤ ~25 MB, with high detail loaded progressively or by LOD. Texture
    maps are 4K at most, compressed (KTX2/Basis) where supported, with a 2K fallback.
- Mac for processing: 8 GB RAM. Close Docker and heavy Chrome tabs before AI segmentation runs (this
  bit us on 2026-10-24).
- Existing workflow:
  - feature branch → tests (unit, e2e, pytest) → visual review screenshots;
  - ask the user before the ff-merge to main → `vercel deploy --prod` → prod e2e.

## What the user will look at

- Default heart: anterior, posterior, left-lateral and base views look complete and atlas-like.
- Layer legend: each layer toggles on and off and shows its provenance (measured, AI, atlas,
  illustrative). Full sources sit behind ⓘ, following the declutter rule in `docs/design-system.md` #7.
- Selecting a coronary or vein names it (e.g. "Great cardiac vein").

## Success looks like

- Visual review set of anterior, posterior, base and lateral views for the template and for s0270, each
  shown next to an atlas reference. The user judges "atlas-like" from these.
- COR-Fit: template ≥ 95% NSD on the measured layers. Fit report for the atlas layers: share of
  centreline within 1 mm of the epicardium, and gap at the vessel joins.
- All existing unit, e2e and pytest tests stay green. New tests cover the layer provenance labels and
  the coronary segment mapping for CAD-RADS.
- Performance numbers (fps, MB) recorded in docs.

## Left to the builder

- Extraction of the heart parts from the Z-Anatomy `.blend` (Blender CLI) or directly from the
  BodyParts3D OBJ download. Use whichever gives clean, named meshes; verify that the coronary branches
  and cardiac veins listed above exist.
- The registration method (rigid then non-rigid, e.g. CPD or landmark-based TPS with groove landmarks)
  and how the coronary centrelines are snapped to the grooves.
- How the textures are made (procedural bake or CC0 sources) and the shader changes.
- Mesh budgets, LODs, compression and loading strategy.
