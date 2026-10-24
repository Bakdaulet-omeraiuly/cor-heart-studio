# Atlas-grade heart

Spec: docs/superpowers/specs/2026-10-24-atlas-grade-heart-design.md · Plan: docs/superpowers/plans/2026-10-24-atlas-grade-heart.md

## Atlas parts

Source: **BodyParts3D 4.0** (DBCLS), part-of tree, OBJ meshes `partof_BP3D_4.0_obj_99.zip` (millimetres, body frame, +Z superior). Licence CC BY-SA 2.1 Japan; attribution: "BodyParts3D, (c) The Database Center for Life Science, licensed under CC Attribution-Share Alike 2.1 Japan". Meshes derived from it ship under CC BY-SA. Z-Anatomy (CC BY-SA 4.0) is built on the same models; we read BodyParts3D directly.

Parts are FMA concepts minus nested branch concepts (`pipeline/cor_pipeline/atlas.py`). `python -m cor_pipeline.atlas --fetch --report` on 2026-10-24:


Notes:

* The specimen is **right-dominant**: the posterior interventricular branch (PDA) belongs to the RCA concept.
* Not modelled in BodyParts3D 4.0 and therefore drawn along their standard course, labelled *illustrative*: obtuse marginal, septal perforators, SA-nodal artery. The single "diagonal branch" concept (10 elements) is used as the diagonal system (D1).
* Left subclavian, left common carotid and IVC are whole-body length; they are cropped near the heart when they are joined (Task 5).

## Open-CT patients s0270 and s0338 (2026-10-24)

Built with `python -m cor_pipeline.build <case> <out> --source totalseg_v1 --asset --atlas`, published with
`cor_pipeline.publish`. Inputs are the dataset's own labels (`build.load_ct_case`): the seven heart labels, the CT,
and the dataset IVC cropped to the vessel box (written as vena cava, provenance *dataset*, not scored). No
TotalSegmentator run. The template is unchanged (not rebuilt).

Two fixes were needed for patient hearts (numbers in docs/cor-fit.md):

* **Outer-shell fit** (`register.fit(surface="shell")`, Tier B only). The coronary warp paired every atlas chamber
  vertex with the epicardium, including septa and chamber-contact faces that have no epicardium. On s0338 that put
  the RCA 7.2 mm inside the tissue (limit 6). Pairing only the outer shell of the atlas chambers passes both hearts
  except one side branch. Tried and rejected: symmetric ICP (worse, mean shift 17–22 mm), atlas vertices near the
  shell, finer shell, more smoothing (each fixed one heart and broke the other).
* **Per-branch rejection** (`atlas_coronaries(required=STENOSIS_VESSELS)`). A side branch that still fails the
  limits is not drawn; the reason is in `fidelity.atlas.coronary` and in the ⓘ limitations.
* **Unattached atlas pieces dropped** (`vessels.drop_unattached`). Arch branches and vein ends warped by the
  chamber fit can miss the patient's own vessels and floated free in space. A continuation is now drawn only where
  it joins its measured vessel (a vein: or its atrium); pieces under 27 voxels are dropped as seam crumbs.

Every layer keeps its label: coronaries and veins "BodyParts3D atlas fitted to this heart's epicardium, not imaged";
venae cavae and pulmonary veins the same, the IVC near the heart "the dataset's own label".
