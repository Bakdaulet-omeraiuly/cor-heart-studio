# Atlas-grade heart

Spec: docs/superpowers/specs/2026-10-24-atlas-grade-heart-design.md · Plan: docs/superpowers/plans/2026-10-24-atlas-grade-heart.md

## Atlas parts

Source: **BodyParts3D 4.0** (DBCLS), part-of tree, OBJ meshes `partof_BP3D_4.0_obj_99.zip` (millimetres, body frame, +Z superior). Licence CC BY-SA 2.1 Japan; attribution: "BodyParts3D, (c) The Database Center for Life Science, licensed under CC Attribution-Share Alike 2.1 Japan". Meshes derived from it ship under CC BY-SA. Z-Anatomy (CC BY-SA 4.0) is built on the same models; we read BodyParts3D directly.

Parts are FMA concepts minus nested branch concepts (`pipeline/cor_pipeline/atlas.py`). `python -m cor_pipeline.atlas --fetch --report` on 2026-10-24:


Notes:

* The specimen is **right-dominant**: the posterior interventricular branch (PDA) belongs to the RCA concept.
* Not modelled in BodyParts3D 4.0 and therefore drawn along their standard course, labelled *illustrative*: obtuse marginal, septal perforators, SA-nodal artery. The single "diagonal branch" concept (10 elements) is used as the diagonal system (D1).
* Left subclavian, left common carotid and IVC are whole-body length; they are cropped near the heart when they are joined (Task 5).
