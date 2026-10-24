# Treatment scenarios on the Outlook screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Outlook screen, treatment buttons (drugs, lifestyle) change a "In N years" 3D organ next to a "Now" organ, for LVH and aortic stenosis (heart) and Alzheimer's disease (brain), with every number coming from a cited evidence file in git.

**Architecture:** A new pure domain module `src/domain/treatments/` holds the evidence file (JSON, zod-validated), button selection rules and the projections that combine the existing natural-course models with active buttons. The existing Outlook UI (`src/outlook/`, `src/brain/BrainOutlook.tsx`) gets a button bar and a second 3D view for the brain. A new route `src/app/api/treatments/route.ts` lets Claude propose buttons from a closed list; the existing assistant route and panel are not modified.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before Next code), React Three Fiber, zustand, zod, Vitest, Playwright, `@anthropic-ai/sdk` (already a dependency).

**Spec:** `docs/superpowers/specs/2026-10-24-treatment-scenarios-design.md`

## Global Constraints

- Work on branch `treatment-scenarios`; commit under the user's own git identity with **no** `Co-Authored-By` trailer; do not push or deploy (the user does that when they ask).
- Before finishing: `npm run typecheck && npm run lint && npm test`; UI tasks also `npm run build && npm run test:e2e`.
- Do not edit `src/app/api/assistant/**`, `src/components/assistant/**`, `src/domain/diagnosis/**`, `tests/assistant/**`, `docs/tasks/**` (friends' areas). Exception: Task 8 changes file paths only in the tests/scripts listed there.
- A number may move the 3D model as a **treatment effect** only if its source is a randomised trial or a meta-analysis of trials. The **natural course** may come from a placebo arm or a prospective cohort, labelled as such. Observational treatment findings never move the model.
- Never commit real patient data, DICOM, `.env*`, keys. Keep honest provenance labels; Outlook is cohort averages, never an individual forecast.
- Every on-screen detail sits behind ⓘ (`InfoTip` in `ui/primitives`); one line on screen (`docs/design-system.md` rule 7).
- Output is a range: likely / best / worst (existing `Pace`: `mean` = likely, `slow` = best, `fast` = worst).
- Assistant model is Claude only; `ANTHROPIC_API_KEY` is added to Vercel by the user. No key means the chat is hidden and the buttons still work.
- Brain scope is Alzheimer's disease only; heart scope is aortic stenosis and LVH only.

## Review Focus

- All treatment buttons off: the right-hand organ equals the natural course, not "today" (LVH shows the placebo change, not zero).
- Two buttons in the same exclusive group (two blood-pressure regimens): effects are not summed; the newer one replaces the older.
- Years beyond a study's duration: the change is held at its last measured value and the UI says so (no extrapolation).
- The model returns an id outside the list, or a reason containing a digit: the id is dropped, the reason is replaced by the table's text.
- The key is missing or the model call fails: the chat shows "unavailable" and every button still works.

---

### Task 1: Evidence schema and loader

**Files:**
- Create: `src/domain/treatments/types.ts`, `src/domain/treatments/schema.ts`, `src/domain/treatments/load.ts`, `src/domain/treatments/evidence.json` (empty skeleton: `{ "sources": {}, "entries": [] }`)
- Test: `tests/unit/treatments/evidence.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export type ConditionId = "lvh" | "as" | "ad";
  export type StudyType = "rct" | "meta-analysis" | "placebo-arm" | "prospective-cohort" | "observational" | "guideline";
  export type Quantity = "lvmi_gm2" | "hippocampus_pct";
  export interface EvidenceSource { id: string; cite: string; title: string; journal: string; doi: string; studyType: StudyType; n: number; durationMonths: number; population: string }
  export interface Effect { quantity: Quantity; likely: number; best: number; worst: number; evidenceYears: number }
  export interface EvidenceEntry { id: string; condition: ConditionId; kind: "natural" | "treatment"; label: string; group?: string; why: string; caveat: string; sources: string[]; effect?: Effect }
  export interface EvidenceFile { sources: Record<string, EvidenceSource>; entries: EvidenceEntry[] }
  ```
  An entry **without** `effect` is listed with "no measured effect on the model". `best`/`worst` are the favourable/unfavourable ends of the change over `evidenceYears` (units of `quantity`).
- Produces (`load.ts`): `export const EVIDENCE: EvidenceFile` (parsed once, throws on invalid), `export function entriesFor(condition: ConditionId, kind: "natural" | "treatment"): EvidenceEntry[]`, `export function sourceById(id: string): EvidenceSource`.

- [ ] **Step 1: Write failing tests** in `tests/unit/treatments/evidence.test.ts`: `rejects an entry with no DOI on its source`, `rejects an entry with an empty caveat`, `rejects a treatment effect whose sources are not rct or meta-analysis`, `rejects a source id that is not in sources`, `accepts a natural-course entry from a placebo-arm source`, `accepts a treatment entry with no effect` (all call `EvidenceFileSchema.safeParse` on small inline objects).
- [ ] **Step 2: Run** `npx vitest run tests/unit/treatments/evidence.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `EvidenceFileSchema` (zod) in `schema.ts` with a `superRefine` for the three rules above; `load.ts` imports `evidence.json` and parses it.
- [ ] **Step 4: Run** the test file. Expected: PASS.
- [ ] **Step 5: Commit** `feat(treatments): evidence schema and loader` on branch `treatment-scenarios` (create it first with `git switch -c treatment-scenarios`).

### Task 2: Fill the evidence file from primary papers

**Files:**
- Modify: `src/domain/treatments/evidence.json`
- Test: `tests/unit/treatments/evidence-data.test.ts`

**Interfaces:**
- Consumes: `EVIDENCE`, `entriesFor`, `sourceById` (Task 1).
- Produces entry ids used later: `lvh-natural`, `lvh-losartan`, `lvh-atenolol`, `lvh-bp-control` (group `bp-regimen`), `as-natural`, `as-statin` (no effect), `ad-natural`, `ad-exercise` (group `lifestyle`), `ad-antiamyloid` (no effect, group `drug`); optionally `as-valve-replacement`.

- [ ] **Step 1: Write failing tests** `lvh has a natural entry`, `lvh-losartan and lvh-atenolol share group bp-regimen`, `as-statin has no effect and cites a randomised source`, `ad-exercise effect spans zero (worst <= 0 <= best)`, `every entry with an effect has all of likely, best, worst`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Fill `evidence.json`.** Open each paper (PubMed or DOI) and copy numbers from the abstract; do not use the numbers in the spec without checking:
  - LVH natural: Simpson 2009 (Heart; placebo arm, LVMI +1.97 ± 6.68 g/m² at 12 months, n=12) → `likely +1.97`, `best` and `worst` = mean − SD / mean + SD sign-corrected, `evidenceYears: 1`. Studytype `placebo-arm`.
  - LVH treatments: Devereux 2004 LIFE (losartan −21.7 ± 21.8, atenolol −17.7 ± 19.6 g/m², `evidenceYears: 4.8` from Gerdts 2009); Simpson 2009 active arm (−4.68 ± 7.31, 12 months, entry `lvh-bp-control`).
  - AS: Chan 2010 ASTRONOMER (rosuvastatin vs placebo: +6.3 vs +6.1 mmHg/y, p=0.83) → entry `as-statin` without `effect`; fetch SEAS (Rossebø 2008) and SALTIRE (Cowell 2005) abstracts and cite them if concordant. Natural course stays the existing Otto 1997 model (`as-natural`, `prospective-cohort`, no effect object; referenced only for its label and sources).
  - AD: natural = existing `BRAIN_SCENARIOS.alzheimers` (entry `ad-natural`, no effect object). Exercise: Erickson 2011 (PNAS), ten Brinke 2014 (BJSM), Tarumi 2022 (J Intern Med), Baker 2025 EXERT (Alzheimer's & Dementia). `best` from the largest positive RCT, `worst` 0, `likely` = sample-size-weighted mean of the four trials' hippocampal volume differences vs control, calculation written into the entry's `caveat`; `evidenceYears: 1`. Anti-amyloid: entry without `effect` until CLARITY-AD and TRAILBLAZER-ALZ 2 hippocampal numbers are read from the primary papers; if read, add `effect` only when the source is a randomised trial.
  - Valve replacement: if an RCT/meta-analysis gives post-replacement valve area and LV mass change, add `as-valve-replacement` with an effect; if not found in this task, do not add the button and note it in `docs/outlook.md` (Task 9).
  - Each entry: `why` is one sentence without digits; `caveat` states population, n, duration and the main limit.
- [ ] **Step 4: Run** `npx vitest run tests/unit/treatments`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(treatments): evidence entries with primary sources`.

### Task 3: Button selection and projections

**Files:**
- Create: `src/domain/treatments/select.ts`, `src/domain/treatments/project.ts`
- Test: `tests/unit/treatments/project.test.ts`

**Interfaces:**
- Consumes: `entriesFor`, `EvidenceEntry`, existing `projectLvh` input type `LvhInputs`, `LvhProjection`, `lvMassAse`, `wallsForMass` (`src/domain/outlook/project.ts`), `projectBrain`, `BrainProjection`, `Pace`, `compound`.
- Produces:
  ```ts
  export function toggleTreatment(active: string[], id: string): string[]; // turning one on removes others in its group
  export function activeEffects(active: string[]): EvidenceEntry[]; // only entries with an effect
  export function pickEffect(e: Effect, pace: Pace): number; // mean→likely, slow→best, fast→worst
  export function projectLvhTreated(inp: LvhInputs, active: string[], years: number, pace: Pace): LvhProjection & { heldBeyondEvidence: boolean };
  export function projectBrainTreated(baseline: Record<BrainTarget, number>, active: string[], years: number, pace: Pace): Record<BrainTarget, BrainProjection> & { heldBeyondEvidence: boolean };
  ```
  LVH: the LVMI change is `pickEffect` of the active `bp-regimen` effect if any, else of `lvh-natural`; scaled `min(1, years / evidenceYears)`; walls from `wallsForMass`. Brain: natural Alzheimer's rates via `projectBrain(baseline, "alzheimers", years, pace)`, then hippocampus volume multiplied by `1 + pickEffect(...)/100 · min(1, years / evidenceYears)`.

- [ ] **Step 1: Write failing tests**: `all buttons off equals the natural course (lvh): lvmiChange equals the lvh-natural likely value at 1 year`, `two bp-regimen buttons: toggling the second removes the first`, `lvh losartan at 4.8 years changes LVMI by -21.7 g/m2`, `lvh change is held after evidenceYears and heldBeyondEvidence is true at 10 years`, `brain with no buttons equals projectBrain alzheimers`, `brain exercise at best pace raises hippocampus ratio above natural`, `a button without an effect changes nothing`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/treatments/project.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both files as specified above.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(treatments): button selection and treated projections`.

### Task 4: Store and button bar

**Files:**
- Modify: `src/outlook/outlookStore.ts` (replace `lvhArm` with `active: string[]` and `toggle(id: string)`; keep other fields)
- Create: `src/outlook/TreatmentButtons.tsx`
- Test: `tests/unit/treatments/store.test.ts`

**Interfaces:**
- Consumes: `toggleTreatment`, `entriesFor`, `InfoTip`, `SourceList`, `sourceById`.
- Produces: `export function TreatmentButtons({ condition }: { condition: ConditionId }): JSX.Element` (toggle buttons with `data-testid="treatment-<entry id>"`, `aria-pressed`, one-line label, ⓘ with `why`, `caveat` and sources; entries without an effect show "no measured effect on the model" behind ⓘ); store field `active` is cleared when the condition or patient changes.

- [ ] **Step 1: Write failing tests** `toggle adds then removes an id`, `toggle in the same group replaces`, `switching heartScenario clears active`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the store change and the component; remove all `lvhArm` uses (compile errors point to `HeartOutlook.tsx`, fixed in Task 5).
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(outlook): treatment store and button bar`.

### Task 5: Heart outlook uses buttons

**Files:**
- Modify: `src/outlook/HeartOutlook.tsx` (LVH uses `projectLvhTreated` with the store's `active`; the arm `Segmented` is replaced by `<TreatmentButtons condition="lvh" />`; the aortic stenosis view shows `<TreatmentButtons condition="as" />` and its numbers stay unchanged; the right card is titled "In N years" and shows the held-beyond-evidence note behind ⓘ)
- Modify: `tests/unit/outlook.test.ts` only where it references `lvhArm`
- Test: `tests/e2e/treatments-heart.spec.ts`

- [ ] **Step 1: Write the failing e2e test** `LVH: turning the losartan button on lowers the projected LV mass shown on the right card; turning it off returns the natural-course value` (open sample `OPEN-CT-s0270`, Outlook, scenario LVH on treatment; read text of `data-testid` of the right LV mass card).
- [ ] **Step 2: Run** `npx playwright test tests/e2e/treatments-heart.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the wiring. Natural course of LVH with no button on uses `lvh-natural`.
- [ ] **Step 4: Run** the e2e test and `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(outlook): heart treatment buttons drive the projected heart`.

### Task 6: Brain side-by-side with buttons

**Files:**
- Modify: `src/brain/BrainOutlook.tsx` (uses `projectBrainTreated`; adds `<TreatmentButtons condition="ad" />` when the scenario is Alzheimer's), `src/brain/BrainWorkspace.tsx` and `src/brain/BrainCanvas.tsx` (when the outlook is open render two canvases: left "Now" undeformed, right "In N years" deformed; reuse the existing deformation code; add prop `mode: "today" | "projected"` to `BrainCanvas`)
- Test: `tests/e2e/treatments-brain.spec.ts`

**Interfaces:**
- Consumes: `projectBrainTreated`, `TreatmentButtons`, existing `useBrainProjection` (change it to read `active`).
- Produces: `BrainCanvas({ data, mode }: { data: BrainData; mode?: "today" | "projected" })`, default `"today"` unchanged behaviour when outlook is closed.

- [ ] **Step 1: Write the failing e2e test** `Brain: with Alzheimer's selected, turning exercise on raises the right panel hippocampus volume above the natural value, and two canvases are visible`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** as above. Read `src/brain/BrainCanvas.tsx` deformation section first; keep one `data` load shared by both canvases.
- [ ] **Step 4: Run** the e2e test plus `tests/e2e/brain.spec.ts` and `tests/e2e/outlook.spec.ts`. Expected: PASS (update the latter two only where the layout changed).
- [ ] **Step 5: Commit** `feat(outlook): brain Now | In N years with treatment buttons`.

### Task 7: Proposal route and chat

**Files:**
- Create: `src/domain/treatments/propose.ts`, `src/app/api/treatments/route.ts`, `src/outlook/TreatmentChat.tsx`
- Modify: `src/outlook/HeartOutlook.tsx`, `src/brain/BrainOutlook.tsx` (render `<TreatmentChat condition=... />` above the buttons)
- Test: `tests/unit/treatments/propose.test.ts`, `tests/unit/treatments/route.test.ts`

**Interfaces:**
- Produces (`propose.ts`):
  ```ts
  export interface Proposal { id: string; reason: string }
  export function allowedIds(condition: ConditionId): string[];
  export function sanitizeProposals(raw: unknown, condition: ConditionId): Proposal[]; // drops unknown ids, replaces a reason that contains a digit with the entry's `why`, max 5
  ```
- Route `POST /api/treatments`, body `{ condition: ConditionId, question: string (1..2000), record: PatientRecord, sessionId?: string }` validated with zod (reuse `PatientRecordSchema` from `src/domain/schema/record`); rate limiting by importing `rateLimit`/`rateLimitKey` from `src/app/api/assistant/rateLimit` (import only); response `{ ok: true, proposals: Proposal[], note: string } | { ok: false, code: "not_configured" | "rate_limited" | "model_error" | "bad_request" }`; model id from `process.env.ASSISTANT_MODEL ?? "claude-sonnet-5-5"`; one forced tool `propose_treatments` with `input_schema` enum = `allowedIds(condition)`; a `clientFactory` seam like the assistant route for tests. Prompt says: propose only from the list, no numbers, clinician decision support, not a diagnosis.
- `TreatmentChat`: a text box; a proposal renders as a button that, when pressed, calls `toggle(id)`; on `not_configured` shows "Chat unavailable" and nothing else changes.

- [ ] **Step 1: Write failing tests**: `sanitizeProposals drops an id not in the list`, `sanitizeProposals replaces a reason with a digit by the table text`, `sanitizeProposals caps at five`, `route returns 503-style not_configured without ANTHROPIC_API_KEY`, `route maps a model answer to sanitized proposals using a fake client`, `route rejects a record that fails the schema`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/treatments`. Expected: FAIL.
- [ ] **Step 3: Implement** `propose.ts`, the route (read `node_modules/next/dist/docs/` for route handler rules in this Next version first; the assistant route's header comment notes `cacheComponents: true` and that only `maxDuration` may be exported), and the component.
- [ ] **Step 4: Run** the unit tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(treatments): chat proposes buttons from a closed list`.

### Task 8: Keep only SYN-008 in the shipped samples

**Files:**
- Create: `tests/fixtures/synthetic-patients.full.json` (copy of today's `public/samples/synthetic-patients.json`)
- Modify: `public/samples/synthetic-patients.json` (only `SYN-008`), `public/samples/synthetic-patients.csv` and `public/samples/template.*` via `npx tsx scripts/generate-data-files.ts`
- Modify (path only): `tests/unit/helpers.ts:10`, `tests/unit/assistant/fallback.test.ts:49`, `tests/unit/diagnosis/assess.test.ts:11,80`, `tests/unit/import.test.ts:51,69`, `scripts/eval-assistant.ts:89` — point them at `tests/fixtures/synthetic-patients.full.json` where they need SYN-001…007; the CSV test uses a CSV generated from the fixture
- Test: `tests/e2e/app.spec.ts:47` (adjust expected patient count)

- [ ] **Step 1: Write the failing test** `shipped sample file contains only SYN-008` in `tests/unit/treatments/samples.test.ts`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Copy the fixture, trim the shipped file, change the paths** above; tell the user which of the friends' files received a path-only change.
- [ ] **Step 4: Run** `npx vitest run` and `npx playwright test`. Expected: all PASS.
- [ ] **Step 5: Commit** `chore(samples): keep SYN-008 in shipped samples, move the rest to test fixtures`.

### Task 9: Docs and full verification

**Files:**
- Modify: `docs/outlook.md` (treatment evidence table generated from `evidence.json`: one row per entry with study type, n, duration, DOI; the combination rules; "held beyond evidence"; valve replacement status), `docs/superpowers/specs/2026-10-24-treatment-scenarios-design.md` (the evidence rule: natural course may come from a placebo arm or prospective cohort)
- Test: all suites

- [ ] **Step 1: Update the docs** as listed.
- [ ] **Step 2: Run** `npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e`. Expected: all pass.
- [ ] **Step 3: Start the app** (`npm run dev`) and look at both modules with `OPEN-CT-s0270` and the brain: buttons, two models, ⓘ texts, chat hidden without a key. Report what was seen, not only that tests passed.
- [ ] **Step 4: Commit** `docs(outlook): treatment evidence and combination rules`.

---

## Self-review

- Spec coverage: two heart conditions and AD (Tasks 2, 5, 6); Now | In N years, both modules (5, 6); no "no treatment" button, off = natural course (3, 5); chat proposes buttons (7); ⓘ evidence (4); range (3); evidence file in git with test (1, 2); keep SYN-008 (8); docs (9).
- Types: `EvidenceEntry`, `Effect`, `ConditionId` used identically in Tasks 1–7; `toggleTreatment` signature is the same in Tasks 3 and 4.
- Proportion: tasks carry signatures, test names and the pinned values; bodies are left to the implementer.
