# Design Document — diagnosis-engine

## Overview

```
PatientRecord ──► normalizeRecord()  (reused: units, plausibility, derived EF / BSA)
                       │
                       ▼
                  Ctx (read-only helpers + collectors: findings, differential, missing, redFlags, facts)
                       │
   phase 1:  valves → lv → chambers → coronary → ecg → brain     (grade findings, record facts)
   phase 2:  differential(ctx)                                   (cross-condition alternatives)
                       │
                       ▼
                  Assessment  (fixed order, deduplicated missing[])
```

Pure functions only. No React, no network, no clock, no randomness. The modules import existing domain code and do
not copy it:
- `normalizeRecord` — `normalization/normalize.ts`;
- `cadRads`, `stenosisCategory`, `VESSEL_LABEL` — `coronary.ts`;
- `qtcBazett`, `qtcFridericia` — `ecg.ts`;
- `gradeByVelocity`, `gradeByArea`, `worse`, `lvMassAse` — `outlook/project.ts`;
- `LVMI_UPPER_NORMAL`, `SOURCES` — `outlook/evidence.ts`;
- `AHA_SEGMENT_NAMES` — `mapping/mapPatientToVisual.ts`.

## File layout (all owned by @HyorinmaruK)

| Path | Contents |
|---|---|
| `src/domain/diagnosis/types.ts` | the agreed contract (unchanged) + conventions in comments |
| `src/domain/diagnosis/index.ts` | `assess`, `DISCLAIMER`, types |
| `src/domain/diagnosis/assess.ts` | orchestration, fixed module order |
| `src/domain/diagnosis/sources.ts` | `SRC` — guideline + DOI strings used in `Evidence.source` |
| `src/domain/diagnosis/rules.ts` | `RULES` — id → title, source, thresholds (the table below, in code) |
| `src/domain/diagnosis/context.ts` | `Ctx`: value readers with units, sex, BSA, symptom keywords, collectors |
| `src/domain/diagnosis/valves.ts` | AS, regurgitation, prolapse |
| `src/domain/diagnosis/lv.ts` | EF, dilatation, mass/geometry, wall thickness, wall motion |
| `src/domain/diagnosis/chambers.ts` | LA, RA, RV |
| `src/domain/diagnosis/coronary.ts` | CAD-RADS |
| `src/domain/diagnosis/ecg.ts` | QTc, PR, QRS, rate, rhythm |
| `src/domain/diagnosis/brain.ts` | hippocampal / ventricular rate vs cohorts |
| `src/domain/diagnosis/differential.ts` | phase-2 alternatives |
| `tests/unit/diagnosis/*.test.ts` | boundary unit tests per module, contract, injection, case runner |
| `tests/assistant/cases/*.json` | ≥ 60 cases + `README.md` (format) |

## Ctx (context.ts)

```ts
interface Ctx {
  p: NormalizedPatient;
  sex: "male" | "female" | null;          // demographics.biologicalSex: m/male/man, f/female/woman (closed list)
  bsa: { value: number; field: "derived.bsaMosteller" } | null;
  num(path): Num | null;                  // normalized observation with status "ok"; else records missing (unit / explicit null)
  valve(valve, condition): NormalizedValveFinding | undefined;
  valveNum(valve, key): Num | null;       // Vmax (m/s; cm/s ÷ 100), ΔPm (mmHg; kPa × 7.50062), AVA (cm²; mm² ÷ 100)
  doppler(valve, kind): Num | null;       // VC / RVol / RF / EROA by closed keyword match on doppler[].measurement
  symptoms: Set<"syncope" | "angina" | "dyspnoea" | "heart_failure" | "palpitations">;
  finding(f), alt(f), missing(field, why), redFlag(text);
  facts: Facts;                           // grades other modules need (asGrade, lvef, cadRads, territories, …)
}
```

Rounding of engine-computed values (stored in `Evidence.value` and used for the comparison, so what is shown is what
was graded): LVMI 1 decimal; RWT 2 decimals; LAVI 1 decimal; QTc integer ms; derived EF 1 decimal (normalize);
BSA 2 decimals (normalize).

## Rules table

Sources (full citations in `sources.ts` and `docs/research/diagnosis-engine.md`):
- ACC20 — ACC/AHA 2020 VHD, doi:10.1161/CIR.0000000000000923.
- ASE15 — Lang 2015, doi:10.1016/j.echo.2014.10.003.
- EACVI17 — Baumgartner 2017, doi:10.1016/j.echo.2016.12.001.
- ESC21 — doi:10.1093/eurheartj/ehab368.
- AHA22 — doi:10.1161/CIR.0000000000001063.
- UDHF21 — Bozkurt 2021, doi:10.1016/j.cardfail.2021.01.022.
- AHA17SEG — Cerqueira 2002, doi:10.1161/hc0402.102975.
- RUDSKI10 — doi:10.1016/j.echo.2010.05.010.
- CADRADS2 — doi:10.1016/j.jcmg.2022.07.002.
- AHA09QT — Rautaharju 2009, doi:10.1016/j.jacc.2008.12.014.
- AHA09IVCD — Surawicz 2009, doi:10.1016/j.jacc.2008.12.013.
- DREW10 — doi:10.1161/CIRCULATIONAHA.109.192704.
- BRADY18 — Kusumoto 2018, doi:10.1016/j.jacc.2018.10.044.
- SVT15 — Page 2015, doi:10.1016/j.jacc.2015.08.856.
- ESH23 — doi:10.1097/HJH.0000000000003480.
- ESC23CM — doi:10.1093/eurheartj/ehad194.
- BARNES09 — doi:10.1016/j.neurobiolaging.2008.01.010.
- DELEON89 — doi:10.2214/ajr.152.6.1257.
- NIAAA18 — doi:10.1016/j.jalz.2018.02.018.

| Rule id | Input fields | Thresholds / logic | Output | Source | Visual rule nearby |
|---|---|---|---|---|---|
| R-DX-AS-01 | `valveFindings[aortic_valve]` peakVelocity, meanGradient, valveArea; `doppler[aortic_valve]` peak velocity / mean gradient | Vmax: <2 none, 2–2.99 mild, 3–3.99 moderate, ≥4 severe. ΔPm: <20 mild*, 20–39 moderate, ≥40 severe. Grade = worse. (*only when Vmax is absent) | finding `aortic-stenosis` | ACC20 | R-VALVE-STEN-01 |
| R-DX-AS-02 | + AVA, LVEF, SV, BSA | AVA ≤ 1.0 and no severe gradient → `discordant` + D2/D3/measurement-error alternatives; severe gradient and AVA > 1.0 → high-flow alternative | finding grade + differential | ACC20, EACVI17 | |
| R-DX-AS-03 | Vmax, ΔPm | Vmax ≥ 5.0 or ΔPm ≥ 60 → red flag | redFlags | ACC20 | |
| R-DX-AS-04 | `valveFindings[aortic_valve].severity` | reported severity without numbers → `supported`; reported ≠ rule grade → differential | finding / differential | ACC20 | R-VALVE-STEN-01 |
| R-DX-MR-01 | `doppler[mitral_valve]` VC, RVol, RF, EROA | severe: VC ≥ 0.7 cm, RVol ≥ 60 mL, RF ≥ 50 %, EROA ≥ 0.40 cm²; else non-severe; mixed → discordant | finding `mitral-regurgitation` | ACC20 | R-VALVE-REGURG-01 |
| R-DX-AR-01 | `doppler[aortic_valve]` VC, RVol, RF, EROA | mild VC < 0.3, RVol < 30, RF < 30, EROA < 0.10; moderate VC 0.3–0.6, RVol 30–59, RF 30–49, EROA 0.10–0.29; severe VC > 0.6, RVol ≥ 60, RF ≥ 50, EROA ≥ 0.30; mixed → discordant | finding `aortic-regurgitation` | ACC20 | R-VALVE-REGURG-01 |
| R-DX-REG-01 | `valveFindings[*]` regurgitation severity | reported → `supported` (none/trace not reported as disease) | finding `<valve>-regurgitation` | ACC20 | R-VALVE-REGURG-01 |
| R-DX-MVP-01 | `valveFindings[*]` prolapse | reported → `supported` | finding `<valve>-prolapse` | ACC20 | R-VALVE-PROLAPSE-01 |
| R-DX-LVEF-01 | `observations.lvEjectionFraction` or `derived.lvEfFromVolumes` | ≤ 40 reduced; > 40 and < 50 mildly reduced; ≥ 50 preserved | finding `lv-ef-category` | ESC21, AHA22 | R-LV-EF-01/02 |
| R-DX-LVEF-02 | same + sex | abnormal < 52 (M) / < 54 (F); mildly ≥ 41, moderately 30–40, severely < 30; sex unknown and grades differ → missing sex | finding `lv-systolic-dysfunction` | ASE15 | R-LV-EF-01/02 |
| R-DX-LVEF-03 | reported vs derived EF | \|Δ\| > 5 points → differential "EF measurements disagree" | differential | ASE15 | R-LV-EF-02 |
| R-DX-LVDIL-01 | `observations.lvEndDiastolicDiameter` + sex | > 58.4 mm (M) / > 52.2 mm (F) | finding `lv-dilatation` | ASE15 | R-LV-DIM-01 |
| R-DX-LVDIL-02 | `observations.lvEndDiastolicVolume` + BSA + sex | LVEDVi > 74 (M) / > 61 (F) mL/m² | finding `lv-dilatation` | ASE15 | R-LV-VOL-01 |
| R-DX-LVH-01 | IVSd, PWd, LVEDD, BSA, sex | LVMI = `lvMassAse()` / BSA; LVH > 115 (M) / > 95 (F) g/m²; RWT = 2·PWd/LVEDD > 0.42 → concentric. Geometry: concentric LVH / eccentric LVH / concentric remodelling | findings `lv-hypertrophy`, `lv-concentric-remodelling` | ASE15 | R-LV-WALL-01 |
| R-DX-WALL-01 | IVSd, PWd (no BSA) | > 10 mm (M) / > 9 mm (F) → `supported` | finding `lv-increased-wall-thickness` | ASE15 | R-LV-WALL-01 |
| R-DX-WMA-01 | `echo.regionalWallMotion[]` | non-normal segments grouped by territory: LAD 1, 2, 7, 8, 13, 14, 17; RCA 3, 4, 9, 10, 15; LCx 5, 6, 11, 12, 16 | finding `regional-wall-motion-abnormality` per territory, target `lv#<first segment>` | AHA17SEG | R-LV-WMA-01 |
| R-DX-LA-01 | `observations.laVolume` + BSA | LAVI < 35 normal; 35–41 mild; 42–48 moderate; > 48 severe | finding `la-enlargement` | ASE15 | R-LA-VOL-01 |
| R-DX-RV-01 | `observations.rvBasalDiameter` | > 41 mm | finding `rv-dilatation` | ASE15 | R-RV-DIM-01 |
| R-DX-RV-02 | `observations.tapse`, `observations.rvEjectionFraction` | TAPSE < 17 mm; RVEF < 45 % | finding `rv-systolic-dysfunction` | ASE15 | R-RV-EF-01 |
| R-DX-RA-01 | `observations.raMinorDimension` | > 44 mm (2010 limit, superseded by ASE 2025 RA area / RAVI) | finding `ra-enlargement`, `supported` | RUDSKI10 | R-RA-DIM-01 |
| R-DX-CAD-01 | `coronaryFindings[]` | `cadRads()` categories 0–5, 4B | finding `coronary-stenosis`, target `coronary_vessels#<vessel>:<segment>` | CADRADS2 | R-CORO-STEN-01 |
| R-DX-CAD-02 | category | 4B or 5 → red flag; 3 or 4A without functional test → missing | redFlags / missing | CADRADS2 | |
| R-DX-QTC-01 | `ecg.qtc` (+method) or `ecg.qtInterval` + `ecg.heartRate` / `observations.heartRate`, sex | prolonged ≥ 450 (M) / ≥ 460 (F); short ≤ 390; Bazett vs Fridericia disagree → formula-dependent | finding `qtc` | AHA09QT | — (ecg.ts) |
| R-DX-QTC-02 | reported QTc, Fridericia QTc | > 500 ms → red flag | redFlags | DREW10 | |
| R-DX-PR-01 | `ecg.prInterval` | > 200 ms | finding `first-degree-av-block` | BRADY18 | |
| R-DX-QRS-01 | `ecg.qrsDuration` | ≥ 120 ms | finding `wide-qrs` | AHA09IVCD | |
| R-DX-HR-01 | `ecg.heartRate` else `observations.heartRate` | < 50 bradycardia; > 100 tachycardia | finding `bradycardia` / `tachycardia` | BRADY18, SVT15 | R-HR-01 |
| R-DX-RHY-01 | `ecg.rhythm`, `ecg.arrhythmias[]` | closed keywords: atrial fibrillation / AF / AFib, atrial flutter | finding `atrial-fibrillation` / `atrial-flutter`, `supported` | AHA09QT (ECG statement series) | |
| R-DX-BRAIN-01 | `observations.hippocampalVolumeChangePerYear` (%/y) | loss ≥ 3.92 → AD-type; ≤ 2.30 → ageing; between → both | differential only | BARNES09, NIAAA18 | — (Outlook) |
| R-DX-BRAIN-02 | `observations.ventricularVolumeChangePerYear` (%/y) | ≥ 9 → AD-type; ≤ 2 → ageing; between → both | differential only | DELEON89, NIAAA18 | — (Outlook) |
| R-DX-DIFF-* | facts from phase 1 | see `differential.ts` and requirements 4.5 and 10.1–10.6 | differential | per item | |

## Ordering and determinism

- Modules run in the fixed order above. Findings keep insertion order.
- Valves are visited in `VALVE_IDS` order. Segments are visited in ascending order. Coronary lesions keep record order.
- `missing` is deduplicated by `field` (the first reason wins).

## Error handling

- `normalizeRecord` failure → `{ findings: [], differential: [], missing: [{ field: "record", why }], redFlags: [] }`.
- Unusable values (statuses `unit_missing`, `unit_unknown`, `impossible`, `contradiction`, `null`) are never graded.
  Missing and unknown units are listed in `missing`.

## Testing strategy

- `tests/unit/diagnosis/<module>.test.ts` — boundary values on both sides of every threshold, sex-unknown paths,
  missing units, discordance.
- `tests/unit/diagnosis/assess.test.ts` — contract, determinism, disclaimer, injection invariance (all free-text
  fields filled with instructions → deep-equal Assessment), "no free text copied" (no record string appears in the output).
- `tests/unit/diagnosis/properties.test.ts` — property-based tests. A seeded PRNG generates schema-valid random records
  covering every module. Correctness properties:
  - **P1** determinism;
  - **P2** citation and no duplicate missing items;
  - **P3** no invented numbers;
  - **P4** label and red-flag digits backed by evidence;
  - **P5** injection invariance;
  - **P6** brain output differential-only;
  - **P7** AS grade monotone in Vmax;
  - **P8** unit invariance;
  - **P9** EF category monotone;
  - **P10** CAD-RADS monotone;
  - **P11–P12** sex-unknown safety (QTc, ASE EF).

  A failure prints the seed and the full counterexample record.
- `tests/unit/diagnosis/cases.test.ts` — loads `tests/assistant/cases/*.json`, checks:
  - expected findings (condition + grade + basis);
  - required differential conditions;
  - required missing fields;
  - red-flag count;
  - that every numeric evidence value is in the record or is a `derived.*` field.
