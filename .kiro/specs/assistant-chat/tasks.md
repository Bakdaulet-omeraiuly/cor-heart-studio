# Implementation Plan

Each top-level task is one small push: run `npm run typecheck && npm run lint && npm test` before pushing (UI tasks also
`npm run build && npm run test:e2e`). A push to `main` deploys to production, so every task leaves the app working.
Before the first task, read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and
`.../03-api-reference/03-file-conventions/route.md`.

- [x] 1. Engine boundary and fixtures
  - Create `src/app/api/assistant/__fixtures__/types.ts` as a TEMPORARY copy of the agreed `Assessment`, `Finding`,
    `Evidence` types from `docs/tasks/kerimku1.md`, with a header comment saying it is replaced by
    `src/domain/diagnosis/types.ts`.
  - Create fixture Assessments: aortic stenosis (SYN-004 values), concentric wall thickening (SYN-003 values), an empty
    one with `missing` items, one with a red flag, one whose record-quoted text contains an injection string.
  - Create `assessFixture(patient)` and `src/app/api/assistant/engine.ts` re-exporting it as `assess`.
  - _Requirements: 3.1, 3.5_

- [x] 2. Ids and refs
  - [x] 2.1 Implement `withIds()` and `refsFor()` in `ids.ts`.
    - _Requirements: 3.2, 7.1_
  - [x] 2.2 Unit tests `tests/unit/assistant/ids.test.ts` (deterministic ids, refs fields).
    - _Requirements: 12.1_

- [x] 3. Output guard
  - [x] 3.1 Implement `extractNumbers()` with units, decimals, commas, ranges, percentages; strip ids and list markers.
    - _Requirements: 6.1, 6.7_
  - [x] 3.2 Implement `allowedNumbers()` and `matchNumber()` (precision rule, unit aliases).
    - _Requirements: 6.2_
  - [x] 3.3 Implement `checkCitations()` (unknown ids, uncited clinical sentences) and `guard()`.
    - _Requirements: 6.3, 6.4_
  - [x] 3.4 Implement `fallbackText()` and a test that its output always passes `guard()`.
    - _Requirements: 6.5_
  - [x] 3.5 Table-driven unit tests `tests/unit/assistant/guard.test.ts`.
    - _Requirements: 12.1_

- [x] 4. Request parsing
  - [x] 4.1 Implement `AssistantRequest` schema and `parseRequest()` with the 1 MB cap in `request.ts`.
    - _Requirements: 2.2, 2.3, 2.4_
  - [x] 4.2 Unit tests `tests/unit/assistant/request.test.ts`.
    - _Requirements: 12.1_

- [x] 5. Prompt and tool definition
  - [x] 5.1 Write `SYSTEM_PROMPT`, `toolDefinitions` (with `strict: true`) and `assessmentForModel()` in `prompt.ts`;
    record-quoted strings wrapped as `recordText` and capped at 200 characters; cache_control on system and tools.
    - _Requirements: 3.3, 3.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_
  - [x] 5.2 Unit tests `tests/unit/assistant/prompt.test.ts`, including "no record free text reaches the model".
    - _Requirements: 12.1_

- [x] 6. Claude loop with an injected client
  - [x] 6.1 Add the dependency `@anthropic-ai/sdk` (exact version, like the other dependencies).
    - _Requirements: 4.1_
  - [x] 6.2 Implement `runChat()` in `chat.ts`: forced first tool call, tool_result, `auto` after, max 3 calls,
    `max_tokens` cap, abort signal, `max_tokens` stop on the final call → error.
    - _Requirements: 3.3, 4.4_
  - [x] 6.3 Unit tests `tests/unit/assistant/chat.test.ts` with a fake client.
    - _Requirements: 12.1_

- [x] 7. Route handler
  - [x] 7.1 Implement `rateLimit.ts` (10 / 60 s per IP + session, per instance).
    - _Requirements: 8.2_
  - [x] 7.2 Implement `route.ts`: `runtime = "nodejs"`, `maxDuration = 60`, no `dynamic`/`revalidate`/`fetchCache`;
    pipeline parse → key check → normalize → assess → ids → runChat (45 s) → guard → response; error mapping table;
    `cache-control: no-store`; one content-free log line.
    - _Requirements: 2.1, 2.5, 3.1, 4.2, 4.3, 4.6, 6.6, 7.1, 7.2, 7.3, 8.1, 8.3, 9.1, 9.2, 9.3_
  - [x] 7.3 Unit tests `tests/unit/assistant/route.test.ts` (ok, fallback, 503 without key, 400, 413, 429).
    - _Requirements: 12.1_
  - [x] 7.4 Manual check with a local key in `.env.local` (never committed): ask about SYN-004 and SYN-003. Re-run
    after task 13 with the default model (`claude-sonnet-5-5`).
    - _Requirements: 4.1_

- [x] 8. Chat panel
  - [x] 8.1 Implement `useAssistant()` (in-memory state, reset on record change, fetch with abort).
    - _Requirements: 1.3, 1.4, 1.5, 1.6_
  - [x] 8.2 Implement `AssistantPanel` and `ReplyText` per `docs/design-system.md`: header, always-visible disclaimer,
    messages with `aria-live`, input, send/cancel, id buttons with InfoTip, fallback and error states with retry,
    disabled state without a selected record, collapse toggle.
    - _Requirements: 1.1, 1.2, 7.2, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_
  - [x] 8.3 Mount `<AssistantPanel />` in `src/components/workspace/InspectorColumn.tsx` (one import, one element —
    shared file, tell the team).
    - _Requirements: 10.7_

- [x] 9. Links to the 3D view
  - [x] 9.1 Implement `focusTarget()`: structure selection, valve close-ups, coronary view like the inspector's
    `LESION_VIEW`, safe no-op otherwise.
    - _Requirements: 11.1, 11.2, 11.3_

- [x] 10. End-to-end test
  - [x] 10.1 Write `tests/e2e/assistant.spec.ts` with `page.route("**/api/assistant")` canned responses: disclaimer,
    reply with id link, click selects the structure, fallback, error + retry.
    - _Requirements: 12.2, 12.3_

- [x] 11. Evaluation script
  - [x] 11.1 Write `scripts/eval-assistant.ts` reusing the route's functions; arms per `EVAL_MODELS` plus the LLM-only
    control; 3 runs; metrics and Markdown table as in `docs/research/assistant-chat.md` §7; clean exit without a key
    or cases.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_
  - [x] 11.2 Add `"eval:assistant": "tsx scripts/eval-assistant.ts"` to `package.json`.
    - _Requirements: 13.1_

- [x] 13. Live-check fixes (from task 7.4)
  - [x] 13.1 `chat.ts` / `route.ts`: `tool_choice: { type: "auto" }` on every call; a first response without a
    `get_assessment` tool_use → `assessmentCalled: false`, no further call, route returns the fallback (status
    `fallback`, log reason `no_tool`); `SYSTEM_PROMPT` tells the model to call `get_assessment` before answering.
    Unit tests in `chat.test.ts` and `route.test.ts`.
    - _Requirements: 3.3, 4.2, 5.2, 12.1_
  - [x] 13.2 M ids: `withIds` assigns `M1`, `M2`, … to `missing[]`; `refsFor` adds `kind: "missing"` refs with `field`
    and `why`; `assessmentForModel` exposes the ids; the guard accepts known `M#` ids as citations; `fallbackText`
    cites them; `focusTarget` is a no-op for `M#`; `ReplyText` renders `M#` buttons with an InfoTip (not focusable in
    3D). Unit tests (ids, guard, prompt, fallback); update the e2e canned responses if the refs shape changes.
    - _Requirements: 3.2, 5.4, 6.3, 6.5, 7.1, 10.3, 11.3, 12.1, 12.2_
  - [x] 13.3 Plain text: `SYSTEM_PROMPT` says plain text, no Markdown, and cite `[M#]` for missing-data sentences;
    `ReplyText` strips stray `**` and leading "- ". Unit tests.
    - _Requirements: 5.4, 5.9, 10.8, 12.1_
  - [x] 13.4 503 message exactly "Assistant is not configured"; update the route test.
    - _Requirements: 4.6, 12.1_
  - [x] 13.5 Eval script: the A arm applies the route's first-call rule (no `get_assessment` → fallback);
    `EVAL_RUNS` (default 3). Unit tests in `evalAssistant.test.ts`.
    - _Requirements: 13.2, 13.6_

- [x] 12. Switch to the real engine (after @HyorinmaruK pushes `src/domain/diagnosis/types.ts` and `assess()`)
  - Change the two lines in `engine.ts`; delete the TEMPORARY type copy; adjust `route.ts` if `assess` takes
    `PatientRecord`; re-run all tests.
  - Run only a smoke eval, not the full evaluation: `EVAL_MODELS=claude-sonnet-5-5`, `EVAL_CASES` limited to about
    5 cases (one AS, one LV, one ECG, one injection, one out-of-scope), `EVAL_RUNS=1`; record the results in
    `docs/research/assistant-chat.md`, clearly labelled as a smoke run.
  - _Requirements: 3.1, 3.5, 13.2, 13.4_

- [x] 14. Red-flag ids, out-of-scope rule, clinical terms
  - Code changes stay in `src/app/api/assistant/` and `src/components/assistant/` (plus unit tests and the e2e canned
  responses). Nothing in `src/domain/diagnosis/` changes.
  - [x] 14.1 R ids end to end: `withIds` assigns `R1`, `R2`, … to `redFlags` in order (`IdedAssessment.redFlags`
    becomes `Ided<{ text: string }>[]`); `refsFor` adds `kind: "redFlag"` refs (label "Red flag", `text`, no
    target/organ); `assessmentForModel` sends each red flag as `{ id, text }`; the guard accepts known `R#` ids as
    citations (unknown `R#` → `unknown_id`) and strips `[R#]` before number extraction; `fallbackText` cites each red
    flag by its `R#` id; `replyParts.ts` / `ReplyText.tsx` render `R#` buttons with an InfoTip only; `focusTarget` is
    a no-op for a red-flag ref; the fallback list puts a space between each id and its label. Unit tests (ids,
    prompt, guard, fallback, replyParts, focusTarget); update the e2e canned responses for the new `redFlags` shape.
    - _Requirements: 3.2, 6.3, 6.5, 6.7, 7.1, 10.3, 11.3, 12.1, 12.2_
  - [x] 14.2 `SYSTEM_PROMPT`: rule 5 cites the red flag as `[R#]`; rule 6 declines without quoting record values or
    numbers, says the topic is not assessed and lists what the assistant can help with. Update `prompt.test.ts`.
    - _Requirements: 5.5, 5.6, 12.1_
  - [x] 14.3 Guard clinical terms: add the clinical-term list to the "clinical" sentence test, with the refusal /
    "what I can help with" exception. `guard.test.ts`: "Low oxygen saturation can strain the heart and lengthen the
    QT interval." → rejected (uncited); "Oxygen saturation is not something I assess." → accepted; "Urgent
    specialist referral is advised [R1]." → accepted for SYN-004 (real engine on the normalized SYN-004 sample
    record — if SYN-004 has no red flag, report it; do not change the engine); plus a few term cases. Confirm
    `fallbackText` still always passes `guard()`.
    - _Requirements: 6.4, 6.5, 12.1_
  - [x] 14.4 Full check: `npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e`; restore
    `docs/visual-review/` screenshots if they were rewritten without an intended visual change.
    - _Requirements: 12.3_

- [x] 15. Scope-topic exception and referral rule
  - Fixes the user report: a "what I can help with" sentence listing our own scope topics was blocked as uncited when
    it contained "QTc", "CAD-RADS 2.0" or "graded by". Code changes stay in `src/app/api/assistant/` and
    `tests/unit/assistant/`. Nothing in `src/domain/diagnosis/` changes.
  - [x] 15.1 Scope topics: export `SCOPE_TOPICS` from `prompt.ts` and build rule 6's covered-topic list from it. In
    `guard.ts`, the refusal / "what I can help with" exception accepts any list item equal to a scope topic
    (case-insensitive), including "coronary stenosis graded by CAD-RADS 2.0": for both the citation check (its grade
    word, number, clinical term or finding label/condition match does not make the sentence clinical) and the number
    check (its "2.0" is not checked). Non-scope items fall back to the short-noun-phrase rule; any claim word still
    blocks. The sentence split ends a sentence at a full stop right after a scope topic that ends in a digit. Unit
    tests in `guard.test.ts` and `prompt.test.ts`: "I can help with aortic stenosis, LV function and QTc.", "I can
    help with coronary stenosis graded by CAD-RADS 2.0." and "I can help with QTc." → accepted, against the inline
    fixture and against real-engine Assessments whose finding label/condition overlaps a scope topic (SYN-004 aortic
    stenosis, an ECG/QTc case); "Low oxygen saturation can lengthen the QT interval." → rejected; a non-scope list
    item is still checked; rule 6 text contains every `SCOPE_TOPICS` entry.
    - _Requirements: 5.6, 6.2, 6.4, 12.1_
  - [x] 15.2 Referral terms clinical: add `refer`, `refers`, `referred`, `referral`, `referrals` (whole words) to the
    clinical terms. Unit tests in `guard.test.ts`: "Urgent specialist referral is advised." uncited → rejected; with
    `[R1]` → accepted (SYN-004, real engine); other `refer` forms uncited → rejected. Confirm `fallbackText` still
    always passes `guard()` (`fallback.test.ts`).
    - _Requirements: 5.5, 6.4, 6.5, 12.1_
  - [x] 15.3 Check: `npm run typecheck && npm run lint && npm test`.
    - _Requirements: 12.3_

## Task Dependency Graph

Only incomplete leaf sub-tasks are listed. 15.1 and 15.2 both touch `guard.ts`, so they run one after the other;
15.3 runs last.

```json
{
  "waves": [
    { "id": 0, "tasks": ["15.1"] },
    { "id": 1, "tasks": ["15.2"] },
    { "id": 2, "tasks": ["15.3"] }
  ]
}
```
