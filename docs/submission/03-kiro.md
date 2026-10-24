# How did you use Kiro to build your project?

We built COR Studio with **Kiro Web** and **Kiro's spec task runner**, with Claude Code alongside for research, and
everything Kiro used is committed in [`/.kiro`](../../.kiro).

**Specs drove the work.** Each of us owned one spec, joined by a single shared contract (`types.ts`) that we published
on day one so the engine and the chat could be built in parallel.
- `diagnosis-engine` has 13 EARS requirements, such as *"WHEN Vmax ≥ 4.0 m/s OR mean gradient ≥ 40 mmHg THEN the engine
  SHALL report severe AS"*.
- Its design is a rules table: 41 rule ids, each with inputs, thresholds and a guideline DOI.
- Its tasks were built one disease group per commit, and every threshold became a test on both sides of the boundary
  (Vmax 3.99/4.00, EF 40/41, QTc 449/450).
- `assistant-chat` was executed task by task with the spec task runner (44 recorded executions).

Compared with vibe prompting, the spec forced every number to trace to a source and settled edge cases up front:
discordant aortic stenosis, unknown sex, formula-dependent QTc.

**Kiro Web did the full loop.** It cloned the repo, followed our shared `AGENTS.md` rules (pull first; typecheck, lint
and test before every push; stay in your own folders), and verified every commit in a clean worktree before pushing to
production. It also:
- worked around blockers: with no npm access, it built a stand-in test runner from packages already on disk;
- used its Kiro-documentation sub-agent to confirm the exact steering and hook formats;
- remembered our preferences across sessions through **learnings**.

**Steering kept it on the rules.**
- `product.md` and `tech.md` are always on: the "not a diagnosis" boundary, folder ownership, and existing functions to
  reuse instead of rewriting.
- `diagnosis-engine.md` loads only for engine files and holds the clinical rules (never read free text, no digits
  without evidence, ask for missing facts instead of guessing).
- `clinical-sources.md` is loaded on request and gives the procedure for verifying a guideline threshold.

**Hooks automate the gates for teammates in the IDE and CLI:**
- run the engine tests on save;
- regenerate the data dictionary when the field registry changes;
- remind the agent of the guideline-sourcing rules before each spec task;
- run the full checks when the agent stops.

Kiro Web itself doesn't run hooks, which is why these are aimed at the IDE and CLI.

**Testing paid off the most.** From the spec's correctness properties we wrote property-based tests: 15 properties,
each run on 1,000 random records. They caught **two bugs that 94 hand-written cases missed**:
- digits in labels that no evidence value backed;
- a contract mismatch where the chat's number checker would have rejected **every** reply about coronary, brain and
  low-flow aortic stenosis records.

**The same process carried new work:**
- a guideline verification pass, which led us to downgrade a superseded right-atrium threshold;
- the new management-options feature (PR #3), which went from requirement to rules table to tasks and shows only
  options whose class and level of evidence are confirmed.

We didn't use MCP servers or Kiro powers; the built-in GitHub connection and web search covered our needs.

Full write-up: [`KIRO.md`](../../KIRO.md).
