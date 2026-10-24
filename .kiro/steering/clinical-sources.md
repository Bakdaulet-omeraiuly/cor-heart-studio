---
inclusion: manual
---
# Adding or checking a clinical threshold

Use this when a task touches a guideline number (`#clinical-sources`).

1. Find the **primary source** (guideline or paper) and its DOI. Copy the number from the abstract or the table, never
   from memory.
2. Record its status in `docs/research/diagnosis-engine.md` §2 and §7:
   - **A** = the publisher's or society's own page or abstract;
   - **S** = a secondary page quoting the guideline table;
   - **M** = from memory or not yet confirmed, to re-check against the full text.
3. **Superseded guidelines:** if a newer guideline replaced the source, say so. If the record can't supply the
   newer measure, downgrade the finding from `rule-defined` to `supported` (example: the RA minor axis, ASE 2010 → 2025).
4. **Boundaries:** write the inequality exactly as the guideline does (≥ vs >). Add unit tests on both sides
   (e.g. 3.99 / 4.00) and one case in `tests/assistant/cases/` with the source in its `source` field.
