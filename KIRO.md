# How we used Kiro — COR Heart Studio diagnostic assistant

**Challenge track:** Healthcare & Biotech

**Why this track:** it is clinical decision support for cardiology and neurology. The tool grades aortic stenosis,
LV function, CAD-RADS, QTc and brain atrophy by current guidelines (ACC/AHA, ASE/EACVI, ESC, SCCT). It shows the
evidence and DOI behind every statement, so a clinician can check it. All data is synthetic or open, and the app is
labelled "not a medical device, no diagnosis".

**Project.** COR Heart Studio is a 3D heart and brain viewer driven by a patient record. We added a guideline-based
diagnostic assistant for clinicians, in two parts:
- **The engine**, `assess(record) → Assessment`. It grades every condition the site shows by its guideline and adds a
  differential, the data that is missing, and red flags. Each statement carries a rule id and a guideline DOI.
- **A Claude chat** that explains the engine's result and moves the 3D view to the structure involved.

The core design rule is that code computes every number and the LLM only explains it.

Everything Kiro uses is committed under [`/.kiro`](.kiro): specs, steering and hooks. `/.kiro` is not in `.gitignore`.

| `/.kiro` content | What it is |
|---|---|
| `specs/diagnosis-engine/` | requirements (EARS), design (rules table, correctness properties), tasks (12, all done) |
| `specs/assistant-chat/` | the chat side's spec, executed task by task with Kiro's spec task runner (`tasks.meta.json` records **44 task executions**) |
| `steering/product.md`, `steering/tech.md` | always-included context: the product boundary, who owns which folders, the stack and push rules |
| `steering/diagnosis-engine.md` | `fileMatch` steering that loads only when engine files or cases are in play |
| `steering/clinical-sources.md` | `manual` steering (`#clinical-sources`): the procedure for adding or checking a guideline threshold |
| `hooks/diagnosis-engine.json` | four agent hooks (v1 schema): tests on save, data-dictionary regeneration, a guideline guard before each task, and full checks on stop |

---

## 1. Which Kiro tools we used, and how they differed

| Tool | Who | Used for |
|---|---|---|
| **Kiro Web** (agent session, connected to GitHub) | @HyorinmaruK | All of the engine. Research, then the spec, then 12 implementation tasks, a 94-case test set, property tests and the threshold-verification pass. Kiro cloned the repo, ran the checks, committed under the contributor's name and pushed to `main`. |
| **Kiro spec task runner** | @kerimku1 | Ran the whole `assistant-chat` spec (tasks 1–13: ids, number guard, request, prompt, Claude loop, route, rate limit, chat panel, e2e, evaluation script, switch to the real engine) as 44 recorded executions in `tasks.meta.json`. |
| **Claude Code / claude.ai** | whole team | Research and second opinions. `AGENTS.md` holds the shared rules for both agents (`CLAUDE.md` points to it), so Kiro and Claude Code follow the same rules. |

**What stood out in Kiro Web:**
- **It works with no local setup.** The agent cloned the repo, read `AGENTS.md`, worked and pushed. The tradeoff
  showed in our sandbox: it had no npm registry access. Kiro built a stand-in for the test runner from packages already
  on disk (the exact `zod` 4.6.7 and TypeScript 5.9 versions). It type-checked strictly with the repo's own
  `tsconfig` settings and verified **every intermediate commit in a clean git worktree** before pushing. A teammate
  then confirmed with the real `npm ci && typecheck && lint && test && build && test:e2e` (23/23 Playwright).
- **The sub-agent that answers questions about Kiro** read kiro.dev to confirm exact formats before we wrote any
  `/.kiro` file: steering front matter, the v1 hook schema, and which surfaces run hooks and PBT.
- **Learnings remember preferences across sessions.** Two standing rules came from our feedback: "always
  `git pull --rebase` before work" and "commit as the contributor, not as the bot". Kiro applied both on every
  later push.
- **Kiro Web reported blockers instead of working around them.** When GitHub refused writes because the Kiro GitHub app
  was not installed on the repo owner's account, it explained the cause and gave the exact fix (install the app for
  this repo only). It also produced a tested hand-off script so the work could be pushed another way.

We did not use the Kiro CLI or Crew.

---

## 2. Spec-driven development

**How we structured the spec**, in `.kiro/specs/diagnosis-engine/`:

1. **Research first** (`docs/research/diagnosis-engine.md`): the official criteria per condition, with DOIs. It also
   says what to do when criteria conflict (e.g. severe Vmax but non-severe valve area means discordant aortic
   stenosis) and how the differential works.
2. **`requirements.md`:** 12 requirements in EARS form, e.g. *"WHEN Vmax ≥ 4.0 m/s OR mean gradient ≥ 40 mmHg THEN
   the engine SHALL report AS grade severe (rule-defined)"*. Requirements 1, 2 and 11 are cross-cutting:
   purity/determinism, citation and "no invented numbers", and prompt-injection invariance. Those became properties.
3. **`design.md`:** a module map and a **rules table**. Each of the 40+ `R-DX-*` rules has its input fields,
   thresholds, output, source and the visual rule it sits next to. The design also lists the existing code to
   **reuse rather than copy**, and the correctness properties P1–P12.
4. **`tasks.md`:** 12 tasks, one disease group per task and per commit (valves → LV → chambers → coronaries → ECG →
   brain → differential, then the case set and PBT). Each task lists its boundary values and the requirements it
   covers.

**How the spec changed the work:**
- **The interface shipped on day one.** The spec fixed the `Assessment` contract first (task 1), so @kerimku1 built the
  chat against it in parallel. The only coupling between the two people is `types.ts`.
- **Boundary tests came from the spec, not from memory.** Every threshold in the rules table became a two-sided unit
  test (Vmax 3.99/4.00, EF 40/41, QTc 449/450, LAVI 34.9/35 …): 239 unit, property and case tests in total.
- **The spec kept the history bisectable.** Following `tasks.md`, Kiro made one commit per disease group and verified
  each intermediate commit in a clean worktree, so any commit on `main` builds and passes.
- **Every spec change is visible.** When a later check found that the right-atrium minor-axis limit (ASE 2010) had
  been superseded by ASE 2025, the change went through requirement 6.4, the design table, a unit test and case
  `ch-07`, all in one commit.

**Compared with vibe coding:** we tried both. Quick fixes ("move the brain fields into the shared registry", "push
from my account") were faster as vibe prompts. For a clinical engine, though, vibe coding produces plausible-looking
thresholds with no paper trail. The spec forced:
- every number to be traced to a source;
- conflict cases (discordant AS, sex unknown, formula-dependent QTc) to be decided up front, instead of whenever the
  model happened to hit them.

---

## 3. Agent hooks

`/.kiro/hooks/diagnosis-engine.json` (v1 schema, read by Kiro IDE 1.0+ and CLI v3):

| Hook | Trigger | What it automates |
|---|---|---|
| Diagnosis tests on save | `PostFileSave`, matcher on engine, test and case files | `vitest run tests/unit/diagnosis`: unit + property + 94 cases in about 2 s, so a threshold edit gets immediate feedback |
| Data dictionary on field-registry save | `PostFileSave` on `fields.ts` | regenerates `docs/medical-data-dictionary.md`. When we added the brain fields to the shared registry, this table had to be regenerated by hand |
| Guideline guard | `PreTaskExec` (agent prompt) | before each spec task, injects the rules: no threshold without a rule id, DOI and status row; never change a threshold to pass a test; stay in your own folders |
| Full check before finishing | `Stop` | `typecheck && lint && test`, the same gate `CONTRIBUTING.md` requires, because every push to `main` deploys to production |

Kiro Web sessions don't run hooks (per kiro.dev). In this project the same gates were run explicitly by the Web agent
before every push, and the hooks enforce them for teammates in the IDE and CLI.

---

## 4. Steering docs

- **`AGENTS.md`, always included.** It made the biggest difference. One file is read by both Kiro and Claude Code: "not
  a medical device", `git pull --rebase` before every push, the three checks, and "stay in your own folders". Kiro
  followed it without being reminded, and flagged every shared file it touched (`fields.ts`, `Inspector.tsx`) so the
  team could be told.
- **`product.md` and `tech.md`, always.** They hold the ownership table, the contract boundary, and the "reuse, don't
  copy" list (`normalizeRecord`, `cadRads`, `qtcBazett`, `lvMassAse`, …). Telling the agent which existing pure
  functions to call stopped it from writing parallel versions of CAD-RADS or QTc.
- **`diagnosis-engine.md`, `fileMatch`.** It loads only for engine files and pulls in the design and the contract
  with `#[[file:…]]`. It holds the invariants that caused real bugs when missed: basis words, no free text, no digits
  without evidence, ask for sex instead of guessing.
- **`clinical-sources.md`, `manual` (`#clinical-sources`).** The A/S/M verification procedure and how to handle a
  superseded guideline. We load it only for threshold work, so it doesn't use context otherwise.

**The strategy that worked best:** keep the always-on steering short and about the boundaries, and put
domain invariants in `fileMatch` steering next to the code they protect.

---

## 5. MCP and Kiro powers

**We did not add custom MCP servers or activate a power.** The capabilities we needed came with Kiro Web:
- the GitHub connection (clone, push, commit status, Vercel deployment checks through the GitHub API);
- web search, which produced the source table in `docs/research/diagnosis-engine.md` §7 for the threshold-verification
  pass;
- Kiro's sub-agents and learnings.

Powers were available in the session (`github-cli`, `playwright`, `agent-browser`). The natural next step is the
**playwright** power: it would let the Kiro agent drive the deployed site itself and screenshot the 3D view each
finding points to (`target`). Today a teammate runs `test:e2e` locally instead.

---

## 6. Property-based testing

Kiro's built-in spec PBT runs in the IDE. We worked in Kiro Web, so we wrote the properties from the spec's correctness
section as a dependency-free property suite, `tests/unit/diagnosis/properties.test.ts`:
- a seeded PRNG generates 1000 schema-valid random records per property, covering every module, units and missing
  values;
- 14 properties are mapped to requirements (P1–P12 in the design);
- a failure prints the seed and the full counterexample record;
- `PBT_SEED=<n>` replays it.

**It caught a bug that the unit tests and all 94 cases missed.** Requirement 2.4 says digits shown to the user must
also appear as `Evidence` values, because the chat's number checker rejects any number it can't trace. Property P4
generated low-gradient aortic-stenosis records with reduced and preserved EF, a combination no hand-written case had.
The labels said "…(stage D2)" and "…(stage D3)": the "2" and "3" were on screen but in no `Evidence` item. The chat's
checker would have rejected every reply that repeated those labels. The fix moved the ACC/AHA stage into
`derived.accAhaStage` evidence. Afterwards the suite ran clean across 40 seeds × 1000 records × 13 properties.

**A second property caught a cross-team bug.** We added "the chat's fallback text always passes the chat's own number
guard", run on random records and on all 94 cases. It failed on 12 cases: the guard didn't understand the CAD-RADS grade
"4A", signed rates such as "-4.8 %/year", or `cm²/m²`. Every chat reply about those records would have been rejected in
production. The guard fix is in `src/app/api/assistant/guard.ts`, and the contract is now a test both sides run
(`tests/unit/diagnosis/chat-contract.test.ts`).

**Requirements we enabled PBT for:**
- determinism (Req 1);
- citations, no invented numbers, evidenced digits (Req 2);
- AS monotonicity and unit invariance (Req 3, 5);
- CAD-RADS monotonicity (Req 7);
- sex-unknown safety for QTc and the EF grade (Req 5.3, 8.3);
- brain output differential-only (Req 9.3);
- prompt-injection invariance (Req 11).

---

## Results (end to end, first smoke run)

@kerimku1's `scripts/eval-assistant.ts` ran the real engine plus Claude on 5 of our cases (1 run each, so a tiny
sample). The run was severe AS, mildly reduced LVEF, prolonged QTc, an injection case and an out-of-scope question.

| Arm | Grade agreement | Invented numbers | Citations | Guard pass |
|---|---|---|---|---|
| **A** (engine + Claude tool use) | 100 % (4/4) | 0 / 6 replies | 100 % | 6/6 |
| **C** (Claude alone on the raw record) | 0 % (0/4) | 1 / 6 replies | 83 % | 5/6 |

This is the case for "code computes, the LLM explains". The full evaluation (all cases, both models, 3 runs) is in
`docs/research/assistant-chat.md` §7.

## In progress: guideline management options (PR #3)

The next feature follows the same spec-first path. It is Requirement 13 (EARS), a catalogue table in the design, and
tasks 14.x, on branch `engine/management-options`:
- for each finding it lists the cited guideline recommendation with that guideline's own COR/LOE;
- it never gives doses, chooses a drug or ranks options beyond COR;
- an option is shown only when both COR and LOE were confirmed from the guideline table.

One option is live so far (ARNi in HFrEF with NYHA II–III, COR 1 / LOE A). The other 11 are coded and tested and wait
for LOE verification.

The interface change in `types.ts` is non-breaking and open for @kerimku1's agreement. After his latest guard changes
(red-flag `[R#]` ids, stricter citations), the contract test still passes on all 102 cases.

## Results (diagnosis engine)

| Criterion from the task brief | Result |
|---|---|
| Rule-defined grades (AS, CAD-RADS, EF, QTc, …) | 100 % match on 94 cases |
| Invented numbers | 0 (checked per case and by property P3 on random records) |
| Citation | every evidence item has a rule id and a DOI |
| Missing data | always listed with a reason, never filled in |
| Prompt injection in the record | 0 changes to the `Assessment` (unit test + property P5) |
| Out-of-scope or patient-facing questions | the expected behaviour per case is recorded for the chat evaluation |

Details:
- [`docs/research/diagnosis-engine.md`](docs/research/diagnosis-engine.md)
- [`.kiro/specs/diagnosis-engine/`](.kiro/specs/diagnosis-engine/)
- [`tests/assistant/cases/README.md`](tests/assistant/cases/README.md)
