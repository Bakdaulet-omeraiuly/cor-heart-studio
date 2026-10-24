# Implementation Plan

Each top-level task is one small push: run `npm run typecheck && npm run lint && npm test` before pushing (UI tasks also
`npm run build && npm run test:e2e`). A push to `main` deploys to production, so every task leaves the app working.
Before the first task, read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and
`.../03-api-reference/03-file-conventions/route.md`.

- [ ] 1. Engine boundary and fixtures
  - Create `src/app/api/assistant/__fixtures__/types.ts` as a TEMPORARY copy of the agreed `Assessment`, `Finding`,
    `Evidence` types from `docs/tasks/kerimku1.md`, with a header comment saying it is replaced by
    `src/domain/diagnosis/types.ts`.
  - Create fixture Assessments: aortic stenosis (SYN-004 values), concentric wall thickening (SYN-003 values), an empty
    one with `missing` items, one with a red flag, one whose record-quoted text contains an injection string.
  - Create `assessFixture(patient)` and `src/app/api/assistant/engine.ts` re-exporting it as `assess`.
  - _Requirements: 3.1, 3.5_

- [ ] 2. Ids and refs
  - [ ] 2.1 Implement `withIds()` and `refsFor()` in `ids.ts`.
    - _Requirements: 3.2, 7.1_
  - [ ] 2.2 Unit tests `tests/unit/assistant/ids.test.ts` (deterministic ids, refs fields).
    - _Requirements: 12.1_

- [ ] 3. Output guard
  - [ ] 3.1 Implement `extractNumbers()` with units, decimals, commas, ranges, percentages; strip ids and list markers.
    - _Requirements: 6.1, 6.7_
  - [ ] 3.2 Implement `allowedNumbers()` and `matchNumber()` (precision rule, unit aliases).
    - _Requirements: 6.2_
  - [ ] 3.3 Implement `checkCitations()` (unknown ids, uncited clinical sentences) and `guard()`.
    - _Requirements: 6.3, 6.4_
  - [ ] 3.4 Implement `fallbackText()` and a test that its output always passes `guard()`.
    - _Requirements: 6.5_
  - [ ] 3.5 Table-driven unit tests `tests/unit/assistant/guard.test.ts`.
    - _Requirements: 12.1_

- [ ] 4. Request parsing
  - [ ] 4.1 Implement `AssistantRequest` schema and `parseRequest()` with the 1 MB cap in `request.ts`.
    - _Requirements: 2.2, 2.3, 2.4_
  - [ ] 4.2 Unit tests `tests/unit/assistant/request.test.ts`.
    - _Requirements: 12.1_

- [ ] 5. Prompt and tool definition
  - [ ] 5.1 Write `SYSTEM_PROMPT`, `toolDefinitions` (with `strict: true`) and `assessmentForModel()` in `prompt.ts`;
    record-quoted strings wrapped as `recordText` and capped at 200 characters; cache_control on system and tools.
    - _Requirements: 3.3, 3.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_
  - [ ] 5.2 Unit tests `tests/unit/assistant/prompt.test.ts`, including "no record free text reaches the model".
    - _Requirements: 12.1_

- [ ] 6. Claude loop with an injected client
  - [ ] 6.1 Add the dependency `@anthropic-ai/sdk` (exact version, like the other dependencies).
    - _Requirements: 4.1_
  - [ ] 6.2 Implement `runChat()` in `chat.ts`: forced first tool call, tool_result, `auto` after, max 3 calls,
    `max_tokens` cap, abort signal, `max_tokens` stop on the final call → error.
    - _Requirements: 3.3, 4.4_
  - [ ] 6.3 Unit tests `tests/unit/assistant/chat.test.ts` with a fake client.
    - _Requirements: 12.1_

- [ ] 7. Route handler
  - [ ] 7.1 Implement `rateLimit.ts` (10 / 60 s per IP + session, per instance).
    - _Requirements: 8.2_
  - [ ] 7.2 Implement `route.ts`: `runtime = "nodejs"`, `maxDuration = 60`, no `dynamic`/`revalidate`/`fetchCache`;
    pipeline parse → key check → normalize → assess → ids → runChat (45 s) → guard → response; error mapping table;
    `cache-control: no-store`; one content-free log line.
    - _Requirements: 2.1, 2.5, 3.1, 4.2, 4.3, 4.6, 6.6, 7.1, 7.2, 7.3, 8.1, 8.3, 9.1, 9.2, 9.3_
  - [ ] 7.3 Unit tests `tests/unit/assistant/route.test.ts` (ok, fallback, 503 without key, 400, 413, 429).
    - _Requirements: 12.1_
  - [ ] 7.4 Manual check with a local key in `.env.local` (never committed): ask about SYN-004 and SYN-003.
    - _Requirements: 4.1_

- [ ] 8. Chat panel
  - [ ] 8.1 Implement `useAssistant()` (in-memory state, reset on record change, fetch with abort).
    - _Requirements: 1.3, 1.4, 1.5, 1.6_
  - [ ] 8.2 Implement `AssistantPanel` and `ReplyText` per `docs/design-system.md`: header, always-visible disclaimer,
    messages with `aria-live`, input, send/cancel, id buttons with InfoTip, fallback and error states with retry,
    disabled state without a selected record, collapse toggle.
    - _Requirements: 1.1, 1.2, 7.2, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_
  - [ ] 8.3 Mount `<AssistantPanel />` in `src/components/workspace/InspectorColumn.tsx` (one import, one element —
    shared file, tell the team).
    - _Requirements: 10.7_

- [ ] 9. Links to the 3D view
  - [ ] 9.1 Implement `focusTarget()`: structure selection, valve close-ups, coronary view like the inspector's
    `LESION_VIEW`, safe no-op otherwise.
    - _Requirements: 11.1, 11.2, 11.3_

- [ ] 10. End-to-end test
  - [ ] 10.1 Write `tests/e2e/assistant.spec.ts` with `page.route("**/api/assistant")` canned responses: disclaimer,
    reply with id link, click selects the structure, fallback, error + retry.
    - _Requirements: 12.2, 12.3_

- [ ] 11. Evaluation script
  - [ ] 11.1 Write `scripts/eval-assistant.ts` reusing the route's functions; arms per `EVAL_MODELS` plus the LLM-only
    control; 3 runs; metrics and Markdown table as in `docs/research/assistant-chat.md` §7; clean exit without a key
    or cases.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_
  - [ ] 11.2 Add `"eval:assistant": "tsx scripts/eval-assistant.ts"` to `package.json`.
    - _Requirements: 13.1_

- [ ] 12. Switch to the real engine (after @HyorinmaruK pushes `src/domain/diagnosis/types.ts` and `assess()`)
  - Change the two lines in `engine.ts`; delete the TEMPORARY type copy; adjust `route.ts` if `assess` takes
    `PatientRecord`; re-run all tests and `npm run eval:assistant`; fill the results table in
    `docs/research/assistant-chat.md`.
  - _Requirements: 3.1, 3.5, 13.4_
