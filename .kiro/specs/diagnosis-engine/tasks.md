# Implementation Plan

Before every push: `git pull --rebase`, then `npm run typecheck && npm run lint && npm test`. A push to `main` deploys to
production. The engine is not imported by the UI yet, so these tasks cannot change what the site renders.

- [x] 1. Interface (H3)
  - `src/domain/diagnosis/types.ts` exactly as agreed, plus `index.ts` and a stub `assess()` returning `findings: []` and the disclaimer.
  - Contract test `tests/unit/diagnosis/assess.test.ts`.
  - _Requirements: 1.1, 1.4_

- [x] 2. Core: sources, rules table, context
  - [x] 2.1 `sources.ts` (guideline + DOI strings) and `rules.ts` (`RULES` id → title, source).
  - [x] 2.2 `context.ts`: normalize via `normalizeRecord`; readers `num`, `valveNum`, `doppler`; sex, BSA, symptom keywords;
        collectors with deduplicated `missing`.
  - [x] 2.3 `assess.ts` orchestration, record-invalid path.
  - _Requirements: 1.2, 1.3, 1.5, 2.1–2.5, 10.8_

- [x] 3. Valves
  - [x] 3.1 AS grading, discordance, very-severe red flag, reported-vs-rule comparison (R-DX-AS-01…04).
  - [x] 3.2 MR / AR quantitative grading, reported regurgitation, prolapse (R-DX-MR-01, R-DX-AR-01, R-DX-REG-01, R-DX-MVP-01).
  - [x] 3.3 Unit tests: Vmax 1.99/2.00, 2.99/3.00, 3.99/4.00, 4.99/5.00; ΔPm 19/20, 39/40, 59/60; AVA 1.00/1.01; cm/s and kPa
        conversion; missing unit; MR VC 0.69/0.70, EROA 0.39/0.40; AR VC 0.29/0.30, 0.60/0.61; discordant parameters.
  - _Requirements: 3, 4_

- [x] 4. Left ventricle
  - [x] 4.1 EF category and ASE grade, sex-unknown path, derived EF, reported vs derived EF (R-DX-LVEF-01…03).
  - [x] 4.2 Dilatation (LVEDD, LVEDVi), LV mass index and geometry, wall thickness fallback (R-DX-LVDIL-*, R-DX-LVH-01, R-DX-WALL-01).
  - [x] 4.3 Wall motion by territory (R-DX-WMA-01).
  - [x] 4.4 Unit tests: EF 40/41, 49/50, 51/52, 53/54, 29/30; LVEDD 52.2/52.3, 58.4/58.5; LVMI 115/115.1 and 95/95.1; RWT 0.42/0.43;
        IVS 10/11 (M), 9/10 (F).
  - _Requirements: 5_

- [x] 5. Other chambers
  - [x] 5.1 LAVI, RV basal diameter, TAPSE, RVEF, RA minor axis (R-DX-LA-01, R-DX-RV-01/02, R-DX-RA-01).
  - [x] 5.2 Unit tests: LAVI 34.9/35, 41.9/42, 48/48.1; RVD 41/42; TAPSE 16/17; RVEF 44/45; RA 44/45; no BSA → missing.
  - _Requirements: 6_

- [x] 6. Coronary arteries
  - [x] 6.1 CAD-RADS via `cadRads()`, lesion evidence, target, red flag, functional-test missing (R-DX-CAD-01/02).
  - [x] 6.2 Unit tests: 49/50, 69/70, 99/100; LM 49/50 → 4B; three-vessel 4B.
  - _Requirements: 7_

- [x] 7. ECG
  - [x] 7.1 QTc reported / Bazett + Fridericia, sex paths, formula-dependent, red flag; PR, QRS, rate, rhythm.
  - [x] 7.2 Unit tests: QTc 449/450 (M), 459/460 (F), 390/391, 500/501; PR 200/201; QRS 119/120; HR 49/50, 100/101.
  - _Requirements: 8_

- [x] 8. Brain
  - [x] 8.1 Hippocampal and ventricular rates vs cohort ranges, differential-only output, missing biomarkers.
  - [x] 8.2 Unit tests: hippocampal loss 2.30/2.31, 3.91/3.92; ventricles 2/2.1, 8.9/9.
  - _Requirements: 9_

- [x] 9. Differential and red flags across conditions
  - [x] 9.1 `differential.ts`: HF, ischaemic, valvular, DCM, LVH causes, MR mechanism, LA, RV, QTc causes; symptomatic severe AS red flag.
  - [x] 9.2 Unit tests for each alternative's trigger and its absence.
  - _Requirements: 4.5, 10_

- [x] 10. Injection and free-text invariance
  - [x] 10.1 Test: every free-text field filled with instructions → Assessment deep-equal to the clean record; no record string in output.
  - _Requirements: 2.5, 11_

- [x] 11. Case set (H5)
  - [x] 11.1 `tests/assistant/cases/README.md` (format) and ≥ 60 cases: synthetic samples, guideline examples, boundaries,
        incomplete records, out-of-scope / patient-facing questions, injection.
  - [x] 11.2 `tests/unit/diagnosis/cases.test.ts` runner, 100 % rule-defined grade agreement.
  - _Requirements: 12_

- [x] 12. Property-based tests
  - [x] 12.1 `tests/unit/diagnosis/properties.test.ts`: 13 properties over seeded random schema-valid records (default
        1000 records each; replay a counterexample with `PBT_SEED=<seed>`, change volume with `PBT_RUNS=<n>`).
        Properties:
        - determinism;
        - DOI on every evidence item; no duplicate missing items;
        - no invented numbers;
        - digits in labels and red flags backed by evidence;
        - injection invariance;
        - brain output differential-only;
        - AS grade monotone in Vmax;
        - unit invariance (m/s vs cm/s, mm vs cm);
        - EF category monotone;
        - CAD-RADS monotone when a lesion is added;
        - sex-unknown safety for QTc and the ASE EF grade.
  - [x] 12.2 Fix found by PBT: the D2/D3 stage names in low-gradient AS labels put digits on screen that no Evidence
        backed (Requirement 2.4). The stage now lives in `derived.accAhaStage` evidence.
  - _Requirements: 1.2, 2.1–2.5, 3.1–3.6, 5.1–5.3, 7.1, 8.2–8.3, 9.3, 11.1_

- [x] 13. Engine ↔ chat contract
  - [x] 13.1 `tests/unit/diagnosis/chat-contract.test.ts` runs every case through `assess` → `withIds` → `fallbackText`
        → `guard` (the assistant's own modules) and requires the guard to pass. A matching property in `properties.test.ts`
        does the same on random records.
  - [x] 13.2 The first run failed on 12 of 94 cases: the guard rejected the CAD-RADS category digit ("4A"), signed rates
        ("-4.8 %/year") and the `cm²/m²` unit. Fixed in `src/app/api/assistant/guard.ts` (agreed change to a shared file,
        see the commit message); the assistant's own guard, fallback, ids and prompt tests still pass.
  - _Requirements: 2.3, 2.4_
