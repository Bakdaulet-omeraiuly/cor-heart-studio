---
inclusion: always
---
# Product: COR Heart Studio

- **What it is:** a 3D heart and brain viewer driven by a patient record. Each visual change traces back to the record
  value, the rule and the evidence class behind it.
- **Diagnostic assistant:** a rules engine (`assess()`) grades the conditions the site shows by guideline and produces
  findings, a differential, missing data and red flags. A Claude chat explains that result to a clinician.
- **Boundary:** a demo on synthetic and open data. It is **not a medical device and gives no diagnosis**. The assistant
  supports clinicians: it never addresses patients, never gives treatment or dosing advice, and red flags only say
  "urgent specialist review".
- **Core rule:** code computes every number and grade, and the LLM only explains. Every clinical statement carries a
  rule id and a guideline DOI.

## Ownership (do not edit someone else's area without telling them)

| Owner | Area |
|---|---|
| @HyorinmaruK | `src/domain/diagnosis/**`, `tests/unit/diagnosis/**`, `tests/assistant/cases/**`, `docs/research/diagnosis-engine.md`, `.kiro/specs/diagnosis-engine/` |
| @kerimku1 | `src/app/api/assistant/**`, chat UI components, `scripts/eval-assistant.ts`, `docs/research/assistant-chat.md`, `.kiro/specs/assistant-chat/` |
| @Bakdaulet-omeraiuly | everything else (3D scene, pipeline, import, mapping, outlook) |

The contract between the engine and the chat is `src/domain/diagnosis/types.ts`. Tell the other side before changing it.
