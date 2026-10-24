---
inclusion: fileMatch
fileMatchPattern: ["src/domain/diagnosis/**", "tests/unit/diagnosis/**", "tests/assistant/cases/**"]
---
# Diagnosis engine — invariants

Spec: #[[file:.kiro/specs/diagnosis-engine/design.md]]
Contract: #[[file:src/domain/diagnosis/types.ts]]

1. `assess(record)` is pure and deterministic. It calls `normalizeRecord()` and reads only normalized values.
2. **Every threshold has a source.** A new rule needs:
   - an `R-DX-*` id in `rules.ts`;
   - a DOI in `sources.ts`;
   - a row in the design rules table;
   - a status row in `docs/research/diagnosis-engine.md` (A / S / M, see the manual steering `#clinical-sources`).
   Never change a threshold just to make a test pass.
3. **Basis words:**
   - `rule-defined` = a sourced threshold applied to a measurement;
   - `supported` = reported by a clinician, or several findings pointing the same way;
   - `possible` = needs data the record doesn't have.

   Brain output is differential-only and always `possible`.
4. **Free text is never interpreted or copied** (notes, diagnoses, conclusions, descriptions). Symptom names, rhythm
   and Doppler measurement names are matched only against closed keyword lists.
5. **No digits in labels or red flags** unless the same value is an `Evidence.value`. The property test
   "numbers written in labels and red flags are backed by evidence" enforces this.
6. Missing or unit-less values go to `missing[]` with a reason, deduplicated by field. If a sex-specific threshold is
   ambiguous and the sex is unknown, ask for the sex and don't grade.
7. **Tests for every change:**
   - a boundary unit test on both sides of the threshold;
   - a case in `tests/assistant/cases/` when behaviour changes;
   - `tests/unit/diagnosis/properties.test.ts` must still pass (seeded random records, replay with `PBT_SEED=<n>`).
