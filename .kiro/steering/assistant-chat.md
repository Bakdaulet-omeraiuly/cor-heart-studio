---
inclusion: fileMatch
fileMatchPattern: ["src/app/api/assistant/**", "src/components/assistant/**", "tests/unit/assistant/**", "tests/e2e/assistant.spec.ts", "scripts/eval-assistant.ts"]
---
# Assistant chat — invariants

Spec: #[[file:.kiro/specs/assistant-chat/design.md]]
Contract: #[[file:src/domain/diagnosis/types.ts]]

Each rule below exists because breaking it caused a real bug or a live-check failure.

1. **Code computes, the model explains.** The model sees the Assessment only through the `get_assessment` tool
   (`assessmentForModel`), never the raw record. Text copied from the record goes out only as `recordText`, capped at
   200 characters.
2. **Ids:** `F#` findings, `E#` evidence, `M#` missing items, `R#` red flags. `withIds` assigns them, and the same
   Assessment always gets the same ids. Every clinical sentence cites a known id. `M#` and `R#` never move the 3D
   view.
3. **Check, then send.** The guard checks the whole reply before any of it reaches the client. Never loosen a guard
   rule to make a reply pass. Fix the prompt, or add a rule with a passing and a blocked test sentence.
   `fallbackText` must always pass the guard (`tests/unit/diagnosis/chat-contract.test.ts`, all 94 cases plus random
   records).
4. **`tool_choice: auto` on every call.** `claude-sonnet-5-5` and `claude-opus-5-5` reject a forced tool choice
   (HTTP 400). If the first response doesn't call `get_assessment`, return the fallback (log reason `no_tool`).
5. **One list of scope topics.** `SCOPE_TOPICS` in `prompt.ts` feeds prompt rule 6 and the guard's "what I can help
   with" exception. Add a topic there, never in two places.
6. **Privacy.** Never log or echo the record, question, reply, Assessment or `ANTHROPIC_API_KEY`. The one log line
   holds only outcome, HTTP status, ms, token counts, model and guard reasons. Error messages are fixed strings.
7. **Paid calls only on request.** Live checks and `npm run eval:assistant` cost money. Run them only when the task
   asks, with `EVAL_MODELS`, `EVAL_CASES` and `EVAL_RUNS` kept small. The script never reads `.env.local`.
8. **Stay in the chat area.** Don't edit `src/domain/diagnosis/`; tell @HyorinmaruK instead. Shared files
   (`InspectorColumn.tsx`, `package.json`) get the smallest possible change, and the team is told.
9. **Verification.** Unit tests go in `tests/unit/assistant/`. UI changes also run `npm run build && npm run test:e2e`.
   If e2e rewrote `docs/visual-review/` screenshots without a visual change, restore them.
