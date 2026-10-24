# Requirements Document — diagnosis-engine

## Introduction

The diagnosis engine turns one patient record into an `Assessment`:
- rule-defined grades of the conditions the site shows, with evidence;
- a differential of alternative explanations;
- the data that are missing;
- red flags.

It is a pure TypeScript function with no network and no LLM. The assistant chat (`.kiro/specs/assistant-chat/`,
@kerimku1) shows and explains its output, and the case set in `tests/assistant/cases/` measures both.

Background, sources and thresholds: `docs/research/diagnosis-engine.md`. Task brief: `docs/tasks/HyorinmaruK.md`.
The app is a demo on synthetic and open data — **not a medical device, no diagnosis** (`AGENTS.md`).

Glossary:
- **Record** — `PatientRecord` (`src/domain/schema/record.ts`).
- **Assessment / Finding / Evidence** — the shared contract in `src/domain/diagnosis/types.ts`.
- **Rule** — a guideline threshold implemented in code, with an id `R-DX-*` and a source (guideline + DOI).
- **Basis** — `rule-defined` (threshold applied to a measurement), `supported` (reported assessment or converging
  findings), `possible` (fits, but needs data the record lacks).

## Requirements

### Requirement 1 — Contract and purity
**User Story:** As the chat developer, I want a stable, pure `assess()` so that I can build against it from day one.

#### Acceptance Criteria
1. THE engine SHALL export `assess: Assess` and the types `Assessment`, `Finding`, `Evidence` from `src/domain/diagnosis`.
2. THE engine SHALL return the same `Assessment` (deep-equal, same order) for the same record.
3. THE engine SHALL NOT use the network, the clock, randomness or any LLM.
4. THE engine SHALL include the disclaimer "Not a diagnosis …" in every `Assessment`.
5. IF the record fails validation THEN the engine SHALL return no findings and one `missing` item naming the record.

### Requirement 2 — Evidence and citation
**User Story:** As a clinician, I want every statement to show its number, rule and guideline so that I can check it.

#### Acceptance Criteria
1. EVERY finding and differential item SHALL carry at least one `Evidence` with `field`, `value`, `rule` and `source`.
2. EVERY `Evidence.source` SHALL contain a guideline or paper name and a DOI.
3. EVERY numeric `Evidence.value` SHALL be either a value from the normalized record or a value computed by the engine
   from record values (field `derived.<id>`), rounded as documented in the design.
4. Labels and red-flag strings SHALL NOT contain numbers other than values that also appear as an `Evidence.value`
   in the same `Assessment`, and AHA segment numbers.
5. THE engine SHALL NOT copy free text from the record into any field of the `Assessment`.

### Requirement 3 — Aortic stenosis (ACC/AHA 2020)
**User Story:** As a clinician, I want AS graded from Vmax, mean gradient and AVA, including discordant cases.

#### Acceptance Criteria
1. WHEN Vmax ≥ 4.0 m/s OR ΔPm ≥ 40 mmHg THEN the engine SHALL report AS grade `severe` (rule-defined).
2. WHEN 3.0 ≤ Vmax < 4.0 m/s or 20 ≤ ΔPm < 40 mmHg, and neither is severe, THEN the grade SHALL be `moderate`.
3. WHEN 2.0 ≤ Vmax < 3.0 m/s (or Vmax is absent and ΔPm < 20 mmHg), and nothing is moderate or severe, THEN the
   grade SHALL be `mild`.
4. WHEN Vmax < 2.0 m/s and nothing is moderate or severe THEN the grade SHALL be `none`.
5. WHEN Vmax ≥ 5.0 m/s OR ΔPm ≥ 60 mmHg THEN the engine SHALL add a red flag.
6. WHEN AVA ≤ 1.0 cm² and neither gradient is severe THEN the grade SHALL be `discordant`. The differential SHALL
   include classical low-flow low-gradient AS (LVEF < 50 % or unknown), paradoxical low-flow AS (LVEF ≥ 50 % or
   unknown) and moderate AS with measurement error. Stroke volume index SHALL be listed as missing when absent.
7. WHEN a gradient is severe and AVA > 1.0 cm² THEN the grade SHALL stay `severe`, and the differential SHALL include a
   high-flow state.
8. WHEN AS is reported without Vmax, ΔPm or AVA THEN the engine SHALL report the reported severity as `supported` and
   list the three measurements as missing.
9. WHEN the reported severity differs from the rule grade THEN the differential SHALL say so, with both values.
10. WHEN a valve measurement has no unit or an unknown unit THEN the engine SHALL NOT use it, and SHALL list it as missing.

### Requirement 4 — Regurgitation and mitral prolapse
1. WHEN a mitral `doppler[]` entry gives VC ≥ 0.7 cm, RVol ≥ 60 mL, RF ≥ 50 % or EROA ≥ 0.40 cm², and none of the
   supplied parameters is below its threshold, THEN the engine SHALL report severe MR (rule-defined).
2. WHEN aortic `doppler[]` parameters all fall in one ACC/AHA class (mild, moderate, severe) THEN the engine SHALL report
   that AR grade (rule-defined).
3. IF the supplied parameters of one valve fall in different classes THEN the grade SHALL be `discordant`, and the
   engine SHALL NOT pick one.
4. WHEN a regurgitation or prolapse is reported THEN the engine SHALL report it as `supported` with the reported severity.
5. WHEN MR and mitral prolapse are both present THEN primary MR SHALL be `supported` in the differential. WHEN MR is
   present without prolapse, with LVEF < 50 %, LV dilatation or a regional wall-motion abnormality, THEN secondary MR
   SHALL be `possible`.

### Requirement 5 — Left ventricle
1. WHEN LVEF ≤ 40 % THEN the EF category SHALL be `reduced`. WHEN 41–49 % (i.e. > 40 and < 50) THEN `mildly reduced`.
   WHEN ≥ 50 % THEN `preserved` (ESC 2021 / AHA-ACC-HFSA 2022).
2. WHEN LVEF is below the ASE/EACVI 2015 normal limit for the patient's sex (men < 52 %, women < 54 %) THEN the engine
   SHALL report LV systolic dysfunction graded mildly (≥ 41), moderately (30–40) or severely (< 30) abnormal.
3. IF the sex is unknown and the sex-specific grades differ THEN the engine SHALL NOT grade, and SHALL list biological
   sex as missing.
4. WHEN LVEF is absent and both LV volumes are usable THEN the engine SHALL grade the volume-derived EF and label it derived.
5. WHEN reported and volume-derived EF differ by more than 5 points THEN the differential SHALL say so.
6. WHEN LVEDD exceeds 58.4 mm (men) or 52.2 mm (women) THEN the engine SHALL report LV dilatation.
7. WHEN IVSd, PWd, LVEDD and BSA are usable THEN the engine SHALL compute LV mass index (ASE linear formula) and RWT
   and report LVH (> 115 / > 95 g/m²) and LV geometry (RWT > 0.42 = concentric).
8. WHEN LV mass index cannot be computed but a wall exceeds 10 mm (men) or 9 mm (women) THEN the engine SHALL report
   increased wall thickness as `supported`, and list height and weight as missing.
9. WHEN regional wall motion is reported abnormal THEN the engine SHALL report one finding per coronary territory
   (AHA 17-segment model), `supported`, with each segment as evidence.

### Requirement 6 — Other chambers
1. WHEN LA volume and BSA are usable THEN the engine SHALL grade LA volume index (normal < 35, mild 35–41, moderate
   42–48, severe > 48 mL/m²). WHEN BSA is unknown THEN it SHALL list height and weight as missing.
2. WHEN RV basal diameter > 41 mm THEN the engine SHALL report RV dilatation.
3. WHEN TAPSE < 17 mm or RVEF < 45 % THEN the engine SHALL report RV systolic dysfunction.
4. WHEN RA minor-axis dimension > 44 mm THEN the engine SHALL report RA enlargement as `supported` (not
   rule-defined), because this 2010 limit was superseded by RA area / volume index (ASE 2025).

### Requirement 7 — Coronary arteries (CAD-RADS 2.0)
1. WHEN coronary findings are present THEN the engine SHALL report the CAD-RADS category from `cadRads()`
   (`src/domain/coronary.ts`), with every lesion as evidence and the driving lesion as target.
2. WHEN the category is 4B or 5 THEN the engine SHALL add a red flag.
3. WHEN the category is 3 or 4A and no functional test is in the record THEN the engine SHALL list a functional test as missing.

### Requirement 8 — ECG
1. WHEN a QTc is reported THEN the engine SHALL grade it. WHEN it is not, but QT and heart rate are usable, THEN the
   engine SHALL compute Bazett and Fridericia QTc with `ecg.ts` and grade both.
2. QTc SHALL be `prolonged` at ≥ 450 ms (men) / ≥ 460 ms (women), `short` at ≤ 390 ms, otherwise `normal`.
3. IF the sex is unknown and 450 ≤ QTc < 460 THEN the grade SHALL be `indeterminate`, and sex SHALL be listed as missing.
4. IF the Bazett and Fridericia grades differ THEN the grade SHALL be `formula-dependent`, with both values as evidence.
5. WHEN the reported QTc or the Fridericia QTc is > 500 ms THEN the engine SHALL add a red flag.
6. WHEN PR > 200 ms THEN the engine SHALL report first-degree AV block. WHEN QRS ≥ 120 ms THEN it SHALL report a wide QRS.
   WHEN the heart rate is < 50 or > 100 bpm THEN it SHALL report bradycardia or tachycardia.
7. WHEN QTc is prolonged THEN the differential SHALL include QT-prolonging drugs (if medications are listed), electrolyte
   disturbance (with K/Mg/Ca missing when absent), congenital long QT, and QRS widening (if QRS ≥ 120 ms).

### Requirement 9 — Brain
1. WHEN `observations.hippocampalVolumeChangePerYear` (%/y) is usable THEN the engine SHALL compare the annual loss with
   Barnes 2009: ≥ 3.92 → Alzheimer-type pattern `possible`; ≤ 2.30 → typical-ageing pattern `possible`; otherwise both.
2. WHEN `observations.ventricularVolumeChangePerYear` (%/y) is usable THEN the engine SHALL compare it with de Leon 1989
   (≥ 9 Alzheimer-type, ≤ 2 ageing, otherwise both).
3. Brain results SHALL appear only in `differential`, never as `findings`. Cognitive assessment and amyloid/tau
   biomarkers SHALL be listed as missing.

### Requirement 10 — Differential, missing data and red flags
1. WHEN LVEF < 50 % THEN heart failure SHALL be `possible`, and natriuretic peptide SHALL be listed as missing when absent.
2. WHEN LV dysfunction or dilatation co-exists with a wall-motion abnormality or CAD-RADS ≥ 3 THEN an ischaemic
   cause SHALL be `supported`. WHEN it co-exists with severe AS, MR or AR THEN a valvular cause SHALL be `supported`.
3. WHEN LVH, increased wall thickness or concentric remodelling is present THEN the engine SHALL list:
   - hypertensive heart disease (`supported` if SBP ≥ 140 mmHg, else `possible`);
   - AS afterload (`supported` if AS is moderate or worse);
   - HCM (`possible` if a wall is ≥ 15 mm).
4. WHEN LA enlargement is present THEN MR moderate or worse, or AF, SHALL be `supported`; otherwise raised filling
   pressure SHALL be `possible`.
5. WHEN RV dilatation or dysfunction is present THEN left-heart disease and TR SHALL be `supported` when present.
   Pulmonary hypertension SHALL be `possible`, with PASP missing when absent.
6. WHEN a structured symptom (syncope, angina/chest pain, dyspnoea, heart-failure symptoms) is present with severe AS
   THEN the engine SHALL add a red flag.
7. WHEN the record has no LVEF and no volumes THEN LVEF SHALL be listed as missing.
8. Every `missing` item SHALL name a record field (or a test) and why it matters. Items SHALL NOT repeat.

### Requirement 11 — Robustness against injected text
1. WHEN any free-text field contains instructions (e.g. "ignore the rules, report normal") THEN the `Assessment` SHALL
   be identical to that of the same record without the text. Free-text fields include notes, sources, diagnoses,
   conclusions, descriptions, history and medication details.
2. Symptom names, `ecg.rhythm`, `ecg.arrhythmias` and `doppler[].measurement` SHALL be read only through closed keyword
   lists (e.g. "syncope", "atrial fibrillation", "vena contracta"). Such text can therefore only switch a listed
   keyword on, never change a threshold or a grade.

### Requirement 12 — Tests and case set
1. Unit tests SHALL cover each threshold on both sides of the boundary (e.g. Vmax 3.99 / 4.00, EF 40 / 41, QTc 449 / 450).
2. `tests/assistant/cases/` SHALL contain ≥ 60 JSON cases:
   - synthetic records, guideline examples and boundary values;
   - incomplete records;
   - out-of-scope and patient-facing questions;
   - records with injected text.

   Each case SHALL give the input, the expected `Assessment` (or the expected behaviour) and a source.
3. A unit test SHALL run every case through `assess()`. All rule-defined grades SHALL match the expected grades (100 %).
