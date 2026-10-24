# Treatment scenarios on the Outlook screen (heart and brain)

Status: approved to start by the user on 2026-10-24 ("pick the most accurate one and start the work"). Date: 2026-10-24.

## Intent

A clinician sees one patient's anatomy next to a projected version of it N years ahead. Next to the projection sit
**treatment buttons** (drug classes and lifestyle changes). Switching a button on or off changes the projected 3D
organ. With every button off, the projection is the disease left to run on its own. The assistant chat reads the
record and the clinician's diagnosis and proposes which buttons make sense; each proposal appears as one of these
buttons. The 3D model is the point: the clinician should see what a decision does to the organ.

Everything shown must rest on cited science. This is a scenario view built from published cohort averages, never a
forecast for one person and never a diagnosis or treatment order. That framing is kept from `docs/outlook.md`.

## Goals

* Heart: two conditions, **aortic stenosis** and **hypertensive LVH**. Brain: **Alzheimer's disease**. No others in v1.
* Two 3D views side by side: **Now** (left, always the patient's current anatomy) and **In N years** (right, driven
  only by the buttons that are on). Same layout in the Heart and Brain modules (module switch at the top).
* There is no "no treatment" button. All treatment buttons off means the natural course.
* The chat proposes treatments for the diagnosis and each proposal becomes a button. The buttons, not the chat text,
  drive the model.
* Every button carries its evidence behind an ⓘ (study, effect size, spread, what the number applies to), following
  `docs/design-system.md` rule 7 (one line on screen, detail behind ⓘ).
* The result is a range (likely / best / worst), never a single value.
* The project owns its architecture: pure domain code (evidence table, projection), UI, and the existing assistant
  route stay separate and individually testable.

## Non-goals

* Other diseases, other organs, individual forecasts, dosing, drug choice for a person, interactions beyond the
  documented ones.
* Using the model for diagnosis. The wording stays clinician decision support.
* Changing the CT or MRI source models, the COR-Fit pipeline, or the atlas heart.

## Anti-goals (failure even if it works)

* A number or an effect on screen that is not traceable to a cited source.
* A treatment button that implies a benefit the literature does not show (see "Science facts the design depends on").
* Adding two effects as if independent when the sources do not support that.
* A single confident number where the data only support a range.

## Patients

The Open CT hearts `OPEN-CT-s0270` and `OPEN-CT-s0338` are the patients the feature must work on. Of the eight
synthetic patients `SYN-001…SYN-008`, only `SYN-008` (the comprehensive example) stays. `SYN-001…SYN-007` are removed
from the sample files and from the tests and docs that rely on them. Git history keeps them. The brain module keeps its
one subject (Mindboggle MMRR-21-5).

## How the buttons combine

* Each button has an effect on a named quantity (for example the LV mass index, valve area per year, hippocampal
  volume rate). The right-hand model is computed from the quantities after all active effects.
* Effects that overlap (two blood-pressure drugs act on the same pathway) are NOT summed. The builder defines a
  combination rule per group, in `docs/outlook.md`, and gives each rule a source or labels it an assumption.
* Turning off every button gives the natural-course rate from the same evidence table.

## Science facts the design depends on (to be verified from primary sources before any number ships)

These come from the assistant's recall and the existing `docs/outlook.md`; none is verified yet.

* **Existing note:** `docs/outlook.md` says "There is no untreated arm. No verified per-year rate of progression in
  untreated hypertension was found." The new design needs one for LVH. If no verified rate exists, the LVH natural
  course cannot be shown as a number (see open question 1).
* **Aortic stenosis:** randomised trials of statins (SALTIRE, SEAS, ASTRONOMER) did not slow progression, to the best of
  recall. If that holds, there is no drug button for stenosis that changes the valve; the real treatments are valve
  replacement (SAVR/TAVI), plus blood-pressure control for the afterload. This changes what the stenosis buttons can be.
* **Alzheimer's brain:** drug effects on atrophy rate are small or contested (some anti-amyloid antibodies show more
  volume loss, not less). Exercise has an RCT showing hippocampal volume change (Erickson 2011), to be verified. This
  affects which brain buttons are honest.
* **LVH:** the LIFE substudy (Devereux 2004) already gives LVMI change on losartan-based vs atenolol-based treatment.
  Klingbeil 2003 gives class effects. Both are in `docs/outlook.md`.

## Constraints

* Next.js 16 app in this repo; read `node_modules/next/dist/docs/` before writing Next code (see `AGENTS.md`).
* Reuse what exists: `src/domain/outlook/` (evidence, projection), `src/outlook/` (store, UI),
  `src/brain/BrainOutlook.tsx`, `src/app/api/assistant/` (chat route, built by friends in their own area; the chat UI
  on the site does not exist yet).
* The assistant is Claude only. `ANTHROPIC_API_KEY` must be added to the Vercel environment by the user.
* Honest provenance labels and the data rules in `AGENTS.md` stay. The user deploys only when they ask.
* Pre-push checks: typecheck, lint, unit tests; for UI also build and e2e.
* Two 3D canvases are already supported by the existing compare view (`CompareCanvas`); known limitation: clipping does
  not apply in side-by-side views.

## Decided by the user

* Layout A: two models side by side (Now | In N years), chat and buttons on the left, active list and uncertainty on
  the right. Mockup: `.superpowers/brainstorm/…/content/layout-a-v2.html`.
* The brain gets the same screen.
* No "no treatment" button; natural course = every treatment button off.
* Scope: two heart conditions (aortic stenosis, LVH) and one brain condition (Alzheimer's disease).
* Keep `SYN-008`, remove the other synthetic patients.
* Chat proposes treatment types and decisions; each proposal is a button.
* The system architecture is the project's own.

## Left to the builder

* Visual design inside the layout, component structure, store shape, how chat proposals map to button identifiers.
* How the chat's structured output is validated so that a proposal can only name buttons that exist in the evidence
  table (the model proposes, the table decides what is possible).
* Which exact buttons exist per condition, subject to the evidence rule and the user's answer to the open questions.
* Combination rules per group, each sourced or labelled as an assumption.
* How the 3D organs are deformed for each quantity. The existing deformation (brain: scale about centroid and move
  cortex inward; heart: stenosis grade and LVH wall scaling) is the starting point.

## Evidence rule and research results (2026-10-24, user delegated: "pick the most accurate and start")

**Rule.** A number may drive the 3D model only if it comes from a randomised trial or a meta-analysis of trials.
Observational studies are shown as context behind ⓘ and never move the model. Each entry records study type, n,
duration, who it applies to, and a caveat.

The three earlier open questions are settled by the rule (the builder re-verifies each number from the primary paper):

1. **LVH natural course.** Use the placebo arm of Simpson 2009 (RCT, cardiac MRI, 12 months, LVH with normal BP):
   LVMI +1.97 ± 6.68 g/m² on placebo vs −4.68 ± 7.31 on treatment, n = 12 placebo / 23 active.
   [Heart 2009](https://consensus.app/papers/details/701dc52109795d98b5e5450ea7001a71/). Caveats shown in the UI: small
   n, normotensive patients, 1 year only. Treated arms stay LIFE (Devereux 2004: losartan −21.7, atenolol −17.7 g/m²
   over 4.8 y). No extrapolation beyond the trial durations; the range is wide.
2. **Aortic stenosis buttons.** ASTRONOMER (RCT, n = 269, 3.5 y): rosuvastatin 40 mg did not change progression
   (peak gradient +6.3 vs +6.1 mmHg/y, p = 0.83; Chan 2010, Circulation). SEAS and SALTIRE are reported as concordant
   but were only seen second-hand; the builder fetches both primaries. The observational Rosenhek 2004 finding
   (statins slow progression) is excluded by the rule. So **medical buttons do not change the valve**; the button list
   is: a **statin button that is shown with a zero effect on the valve and the reason**, a **blood-pressure control**
   button (afterload, no valve effect claimed), and **valve replacement (SAVR/TAVI)** whose effect on the model is
   still to be sourced (post-replacement valve area and LV mass regression).
3. **Brain buttons.** Buttons may exist without moving the model. A button either has an RCT-backed volume effect
   (moves the model) or is listed with "no measured volumetric effect" (no change). Evidence found:
   * Aerobic exercise is **contested**: Erickson 2011 (RCT, n = 120, 1 y) +2% hippocampus vs a decline in controls;
     ten Brinke 2014 (RCT, n = 86, MCI women, 6 mo) larger hippocampus than control; against that, Tarumi 2022 (RCT,
     n = 73, 1 y) no protection of brain volume, and EXERT 2025 (RCT, n = 296, MCI, 18 mo) no group difference, with
     about 0.51 % hippocampal loss in 12 months in both arms. So the exercise range is **from zero to +2 %**, with
     the likely value stated by the builder from a pooled estimate if one is found, otherwise the range stays
     un-pooled and labelled.
   * Anti-amyloid antibodies: a synthesis (Abushakra 2025, CNS Drugs) finds a linear relationship between slowing
     cognitive decline and slowing hippocampal atrophy across nine placebo-controlled trials. A small retrospective
     study (Inagawa 2026, n = 16) saw medial-temporal volume decrease after four lecanemab doses. The builder must
     extract the per-trial hippocampal and whole-brain volume numbers from the primary trial papers before the button
     moves the model; until then it is listed with no volumetric effect.

**Open-source code surveyed on GitHub** (no code is imported; licences were not verified):
[AD-DigitalTwin-Model](https://github.com/chunyanlimath/AD-DigitalTwin-Model) and
[MultiphysicsAtrophyFCModeling](https://github.com/kun-Jiang/MultiphysicsAtrophyFCModeling) (PDE atrophy models that
need ADNI data), [oasis-sustain](https://github.com/anna-briskina/oasis-sustain) (staging, not treatment),
[cardiotwin-ai](https://github.com/himanshumittal1439/cardiotwin-ai) and the heart-failure digital twin forks (0D
circulation what-if sandboxes, MIT for the first), and the UK Biobank cardiac digital twin pipeline (mesh
generation). None models treatment effects on anatomy with trial evidence, so the evidence-table approach stays.

## Evidence lives in git

All numbers sit in a typed evidence file in the repo (builder picks the location under `src/domain/outlook/`), one
entry per effect: organ, condition, quantity, effect, spread, study type, n, duration, population, DOI, caveat.
When the user later adds papers to git, the app reads them from that file with no code change. A unit test fails on
any entry that lacks a DOI, a study type, or a caveat, and on any entry that moves the model but is not an RCT or a
meta-analysis. `docs/outlook.md` is updated from the same entries.
