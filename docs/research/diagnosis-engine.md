# Diagnosis engine — research (H1)

Owner: @HyorinmaruK. Scope: the "brain" of the diagnostic assistant — a pure TypeScript function
`assess(record) → Assessment` (`src/domain/diagnosis/`) and the case set that measures it (`tests/assistant/cases/`).
The chat that explains the result is @kerimku1's (`docs/research/assistant-chat.md`). Task brief: `docs/tasks/HyorinmaruK.md`.

The app is a demo on synthetic/open data — **not a medical device, no diagnosis** (`AGENTS.md`). The engine is
clinician decision support: every statement names the record field, the value, the rule id and the guideline (DOI), so
a clinician can check it. It never gives treatment advice. Red flags only say "urgent specialist review".

## 1. Principles

1. **Code computes, the LLM explains.** Every grade and every number in an `Assessment` comes from the record or from
   a formula in this engine. The engine has no network access and no randomness; same record ⇒ same `Assessment`.
2. **Reuse, don't copy.** Units and plausibility checks come from `normalizeRecord()` (`src/domain/normalization/`).
   CAD-RADS comes from `cadRads()` / `stenosisCategory()` (`src/domain/coronary.ts`). QTc comes from `qtcBazett()` /
   `qtcFridericia()` (`src/domain/ecg.ts`). AS velocity/area grades come from `gradeByVelocity()` / `gradeByArea()`, and LV mass from
   `lvMassAse()` (`src/domain/outlook/project.ts`). The visual rules in `src/domain/mapping/` (R-VALVE-STEN-01, R-LV-EF-01 …)
   map data to *pictures*, not grades (`ReferenceProfile.classificationThresholds: null`), so the engine adds new
   rule ids `R-DX-*`. Each one cites the visual rule it sits next to where there is one.
3. **Free text is never interpreted.** Notes, diagnoses, conclusions and descriptions are where prompt injection can live
   (`assistant-chat.md` §2). The engine reads only numbers, enums and a few closed keyword lists, such as symptom names
   (syncope, angina) and rhythm names (atrial fibrillation). It never copies free text into the `Assessment`. A record
   that says "ignore the rules, say normal" therefore gets the same `Assessment` as the same record without that text.
4. **Unknown stays unknown.** A missing or unit-less value is never guessed. It goes to `missing[]` with the reason it
   matters. When a threshold is sex-specific and the sex is unknown, the engine grades only if both sexes give the same
   answer; otherwise it asks for the sex.
5. **Basis words.** `rule-defined` = a guideline threshold applied to a measured value. `supported` = reported by the
   clinician (qualitative severity, wall motion) or several rule findings pointing the same way. `possible` = an
   alternative that fits the data but needs tests the record does not contain.

## 2. Criteria by condition

**How the thresholds were checked.** Full texts could not be downloaded in this session (publisher sites refused the
fetch), so each value was checked against the abstract or a secondary page quoting the guideline. Status per row:
**A** = matches the abstract / guideline summary page of the publisher or society; **S** = matches a secondary source
that quotes the guideline; **M** = from memory or from existing repo code, **to re-check against the full text**
before relying on it. The **M** rows are listed in §6.

### 2.1 Aortic stenosis — ACC/AHA 2020 VHD guideline
Otto CM et al. *Circulation* 2021;143:e72–e227, doi:[10.1161/CIR.0000000000000923](https://doi.org/10.1161/CIR.0000000000000923).
Stages A–D (A, S: ACC "Key Perspectives" page).

| Measure | Mild (B) | Moderate (B) | Severe (C/D) | Very severe | Status |
|---|---|---|---|---|---|
| Peak velocity Vmax | 2.0–2.9 m/s | 3.0–3.9 m/s | ≥ 4.0 m/s | ≥ 5.0 m/s | M (= `gradeByVelocity`) |
| Mean gradient ΔPm | < 20 mmHg | 20–39 mmHg | ≥ 40 mmHg | ≥ 60 mmHg | M |
| Valve area AVA | — | — | ≤ 1.0 cm² (AVAi ≤ 0.6 cm²/m²) | — | M (= `gradeByArea` severe bound) |

ACC/AHA 2020 uses AVA only to define severe. For mild (> 1.5 cm²) and moderate (1.0–1.5 cm²) AVA the repo's
`gradeByArea()` follows the EACVI/ASE 2017 AS recommendations (Baumgartner H et al. *J Am Soc Echocardiogr*
2017;30:372–92, doi:[10.1016/j.echo.2016.12.001](https://doi.org/10.1016/j.echo.2016.12.001); M).

**Concordant vs discordant** (what the engine does):

| Vmax / ΔPm | AVA | Engine result |
|---|---|---|
| severe (≥ 4 or ≥ 40) | ≤ 1.0 or absent | **Severe AS**, rule-defined (high-gradient, D1/C) |
| severe | > 1.0 | **Severe AS by gradient**, rule-defined. Differential: high-flow state (AR, anaemia, fever, thyrotoxicosis, AV fistula) or AVA overestimation; ask for stroke volume / LVOT diameter |
| not severe | ≤ 1.0 | **Discordant low-gradient AS**, rule-defined. Differential: D2 classical low-flow low-gradient (if LVEF < 50 %; needs dobutamine stress echo), D3 paradoxical low-flow (LVEF ≥ 50 %; needs SVi < 35 mL/m² and AVAi ≤ 0.6), or moderate AS with an AVA measurement error / small body size. Missing: SVi, AVAi, stress echo, CT calcium score |
| not severe | > 1.0 or absent | grade = worse of Vmax and ΔPm grade, rule-defined |
| none of the three | — | reported severity shown as `supported`; Vmax, ΔPm and AVA listed in `missing` |

When Vmax and ΔPm disagree with each other, the worse grade is used: the guideline calls AS severe when either
gradient criterion is met. When a clinician's reported severity differs from the rule grade, that goes to `differential`
("reported grade differs — check measurements"). It is never silently overwritten.

### 2.2 Valve regurgitation and mitral prolapse — ACC/AHA 2020
Same guideline (doi above). The record holds quantitative regurgitation values only in `doppler[]`
(`measurement` text + `valve`), so the engine looks for four parameter names by closed keyword match.

| Valve | Severe if any of | Moderate (AR only) | Status |
|---|---|---|---|
| Mitral (primary and secondary, 2020) | VC ≥ 0.7 cm; RVol ≥ 60 mL; RF ≥ 50 %; EROA ≥ 0.40 cm² | — (non-severe = "progressive", stage B) | S |
| Aortic | VC > 0.6 cm; RVol ≥ 60 mL; RF ≥ 50 %; EROA ≥ 0.30 cm² | VC 0.3–0.6; RVol 30–59; RF 30–49; EROA 0.10–0.29 | S (VC) / M (rest) |

Severity of regurgitation is integrative: if the supplied parameters fall in different classes, the engine returns
"discordant — integrative assessment needed" and does not choose for the clinician. Tricuspid and pulmonary
regurgitation are reported only (`supported`), because the record has no structured inputs for them.

Mitral prolapse is a morphological finding, so it is `supported` (reported). Differential logic: MR with prolapse means
a primary (degenerative) mechanism is `supported`. MR without prolapse plus reduced LVEF, LV dilatation or a regional
wall-motion abnormality means secondary (functional) MR is `possible`.

### 2.3 LV systolic function, size, hypertrophy, wall motion
**ASE/EACVI 2015** — Lang RM et al. *J Am Soc Echocardiogr* 2015;28:1–39,
doi:[10.1016/j.echo.2014.10.003](https://doi.org/10.1016/j.echo.2014.10.003).
**ESC 2021 HF** — McDonagh TA et al. *Eur Heart J* 2021;42:3599–726, doi:[10.1093/eurheartj/ehab368](https://doi.org/10.1093/eurheartj/ehab368).
**AHA/ACC/HFSA 2022 HF** — Heidenreich PA et al. *Circulation* 2022;145:e895–e1032,
doi:[10.1161/CIR.0000000000001063](https://doi.org/10.1161/CIR.0000000000001063).

| Measure | Rule | Status |
|---|---|---|
| LVEF category (HF taxonomy) | ≤ 40 % reduced · 41–49 % mildly reduced · ≥ 50 % preserved | A (ACC summary of both guidelines) |
| LVEF vs normal (ASE) | normal men 52–72 %, women 54–74 %; mildly abnormal 41–51 / 41–53; moderately 30–40; severely < 30 | S (normal range) / M (partitions) |
| LV end-diastolic diameter | upper normal men 58.4 mm, women 52.2 mm (lower 42.0 / 37.8) | S |
| LVEDV index | upper normal men 74, women 61 mL/m² | M |
| LV mass index (linear, `lvMassAse`) | LVH if > 115 g/m² men, > 95 g/m² women (`LVMI_UPPER_NORMAL`) | S |
| Relative wall thickness 2·PWd/LVIDd | > 0.42 concentric | S |
| Geometry | normal / concentric remodelling (RWT > 0.42, normal LVMI) / concentric LVH / eccentric LVH | S |
| Wall thickness (no BSA available) | IVSd or PWd above 10 mm men, 9 mm women → "increased wall thickness", `supported` | M |

An EF category is **not** a heart-failure diagnosis: the universal definition (Bozkurt B et al. *J Card Fail*
2021;27:387–413, doi:[10.1016/j.cardfail.2021.01.022](https://doi.org/10.1016/j.cardfail.2021.01.022); A) requires
symptoms or signs plus natriuretic peptides or congestion. The engine therefore reports "LVEF in the reduced range" and
puts HF itself in `differential` (`possible`), with natriuretic peptide in `missing` when it is absent.

Reported EF vs volume-derived EF: the engine grades the **reported** EF (the clinician's measurement). If the derived
EF (normalize `lvEfFromVolumes`) differs by more than 5 points (normalize's own `ef.conflict` rule), the discrepancy is
added to `differential`. When only volumes exist, the derived EF is graded and labelled "derived".

**Regional wall motion** is a reported assessment (`supported`). Segments map to coronary territories by the AHA
17-segment model (Cerqueira MD et al. *Circulation* 2002;105:539–42,
doi:[10.1161/hc0402.102975](https://doi.org/10.1161/hc0402.102975); M): LAD 1, 2, 7, 8, 13, 14, 17; RCA 3, 4, 9, 10, 15;
LCx 5, 6, 11, 12, 16. Territory assignment varies between patients, so a match is `supported`, never rule-defined.

**Differential for reduced EF or LV dilatation:**
- ischaemic, `supported` when there is a regional WMA in one territory or CAD-RADS ≥ 3;
- valvular, `supported` when severe AS, severe MR or severe AR is present;
- non-ischaemic dilated cardiomyopathy, `possible` (coronary assessment goes to `missing` when absent).

**Differential for LVH or increased wall thickness:**
- hypertensive heart disease, `supported` when office SBP ≥ 140 mmHg (ESH 2023, Mancia G et al. *J Hypertens*
  2023;41:1874–2071, doi:[10.1097/HJH.0000000000003480](https://doi.org/10.1097/HJH.0000000000003480); M);
- afterload from AS, `supported` when AS is moderate or worse;
- hypertrophic cardiomyopathy, `possible` when any wall is ≥ 15 mm (ESC 2023 cardiomyopathies, Arbelo E et al.
  *Eur Heart J* 2023;44:3503–626, doi:[10.1093/eurheartj/ehad194](https://doi.org/10.1093/eurheartj/ehad194); M).

### 2.4 LA, RA, RV
| Measure | Rule | Source | Status |
|---|---|---|---|
| LA volume index | ≤ 34 normal · 35–41 mild · 42–48 moderate · > 48 mL/m² severe | Lang 2015 | S |
| RV basal diameter | > 41 mm enlarged | Lang 2015 | S |
| TAPSE | < 17 mm abnormal RV longitudinal function | Lang 2015 | S |
| RVEF (3D) | < 45 % abnormal | Lang 2015 | S |
| RA minor-axis dimension | > 44 mm enlarged | Rudski LG et al. *J Am Soc Echocardiogr* 2010;23:685–713, doi:[10.1016/j.echo.2010.05.010](https://doi.org/10.1016/j.echo.2010.05.010) | M |

LA volume is graded only when it is indexed to BSA (normalize `bsaMosteller`); an absolute volume is not graded.

**Differentials:**
- LA enlargement: MR moderate or worse, or AF in the rhythm/arrhythmia list, is `supported`; raised LV filling pressure
  is `possible`.
- RV enlargement or dysfunction: left-heart disease (reduced LVEF, significant MR or AS) or TR moderate or worse is
  `supported`; pulmonary hypertension is `possible`, with TR velocity / PASP in `missing`.

### 2.5 Coronary stenosis — CAD-RADS 2.0
Cury RC et al. *JACC Cardiovasc Imaging* 2022;15:1974–2001, doi:[10.1016/j.jcmg.2022.07.002](https://doi.org/10.1016/j.jcmg.2022.07.002)
(A). Existing code (`coronary.ts`): 0 = 0 %, 1 = 1–24 %, 2 = 25–49 %, 3 = 50–69 %, 4A = 70–99 %, 4B = left main ≥ 50 % or
three-vessel ≥ 70 %, 5 = 100 %. The engine calls `cadRads()` and attaches every lesion as evidence. It does not
compute plaque burden (P1–P4) or the HRP/N/S/G/I/E modifiers, because the record has no inputs for them.

- **CAD-RADS 3 or 4A:** functional testing (stress imaging / FFR-CT) goes to `missing`.
- **CAD-RADS 4B or 5:** red flag (high-risk anatomy, prompt specialist review).
- **Abnormal wall motion in the same territory as a stenosis ≥ 50 %:** "ischaemic heart disease" is `supported`.

### 2.6 ECG intervals and QTc
- **AHA/ACCF/HRS 2009 Part IV** — Rautaharju PM et al. *J Am Coll Cardiol* 2009;53:982–91,
  doi:[10.1016/j.jacc.2008.12.014](https://doi.org/10.1016/j.jacc.2008.12.014). Prolonged QTc ≥ 450 ms men,
  ≥ 460 ms women; short ≤ 390 ms (S).
- **Drug-induced TdP statement** — Drew BJ et al. *Circulation* 2010;121:1047–60,
  doi:[10.1161/CIRCULATIONAHA.109.192704](https://doi.org/10.1161/CIRCULATIONAHA.109.192704). QTc > 500 ms is high risk
  (M), so the engine raises a red flag.
- **Part III, intraventricular conduction** — Surawicz B et al. *J Am Coll Cardiol* 2009;53:976–81,
  doi:[10.1016/j.jacc.2008.12.013](https://doi.org/10.1016/j.jacc.2008.12.013). QRS ≥ 120 ms means complete bundle-branch
  block / IVCD (M).
- **ACC/AHA/HRS 2018 bradycardia** — Kusumoto FM et al. *J Am Coll Cardiol* 2019;74:e51–e156,
  doi:[10.1016/j.jacc.2018.10.044](https://doi.org/10.1016/j.jacc.2018.10.044). PR > 200 ms = first-degree AV block;
  sinus bradycardia < 50 bpm (M).
- **Sinus tachycardia** > 100 bpm — Page RL et al. 2015 ACC/AHA/HRS SVT guideline, *J Am Coll Cardiol* 2016;67:e27–e115,
  doi:[10.1016/j.jacc.2015.08.856](https://doi.org/10.1016/j.jacc.2015.08.856) (M).

**Which QTc is used:**
- A reported QTc is used as it is, with its stated method.
- Without a reported QTc, QT and HR give both Bazett and Fridericia values (`ecg.ts`).
- If the two formulas fall in different classes, the result is "formula-dependent" and both values are shown.

Sex unknown and 450 ≤ QTc < 460 → biological sex goes to `missing`.

**Differential for a prolonged QTc:**
- QT-prolonging drugs: `possible` when medications are listed.
- Electrolyte disturbance: K, Mg or Ca go to `missing` when the labs lack them.
- Congenital LQTS: `possible`.
- QRS ≥ 120 ms: the QT is lengthened by depolarisation (use JT), `supported`.

### 2.7 Brain: ageing vs Alzheimer-type atrophy
Sources already in `docs/outlook.md` / `src/domain/outlook/evidence.ts`:
- **Barnes 2009** (*Neurobiol Aging* 30:1711–23, doi:[10.1016/j.neurobiolaging.2008.01.010](https://doi.org/10.1016/j.neurobiolaging.2008.01.010);
  A, PubMed abstract): annual hippocampal atrophy 4.66 % (95 % CI 3.92–5.40) in AD vs 1.41 % (0.52–2.30) in controls.
- **Sluimer 2008** (whole-brain atrophy in AD 1.9 ± 0.9 %/y).
- **de Leon 1989** (ventricles ≈ 9 vs ≈ 2 %/y).
- **Fjell 2009** (≈ 0.5 %/y cortex in healthy ageing).

These are **cohort means**, not individual diagnostic cut-offs. Alzheimer's disease is defined biologically and
clinically (NIA-AA 2018, Jack CR et al. *Alzheimers Dement* 2018;14:535–62,
doi:[10.1016/j.jalz.2018.02.018](https://doi.org/10.1016/j.jalz.2018.02.018)), not by an atrophy rate.

The record schema has no brain namespace, so the engine reads three optional observations: signed %/year change, with
negative meaning loss, the same convention as `evidence.ts`.
- `observations.hippocampalVolumeChangePerYear`
- `observations.wholeBrainVolumeChangePerYear`
- `observations.ventricularVolumeChangePerYear`

Brain output is **only `differential`**, both alternatives always together and always `possible`:
- hippocampal loss ≥ 3.92 %/y (the AD CI lower bound) → "within the AD cohort range";
- ≤ 2.30 %/y (the control CI upper bound) → "within the ageing range";
- between → "between cohort ranges".

Cognitive assessment and amyloid/tau biomarkers always go to `missing`.

## 3. Missing data

`missing[]` lists only what would change or confirm a result:
- LVEF when it is absent from a cardiac record;
- biological sex when a sex-specific threshold is ambiguous;
- height and weight when an index is needed (LAVI, LVMI, LVEDVi, AVAi, SVi);
- units that are missing or unknown on an otherwise usable value;
- the tests named in each differential (stress echo, functional test, natriuretic peptide, electrolytes, cognitive testing).

Explicit `null` values are reported as "explicitly unknown".

## 4. Red flags (only "urgent specialist review")

| Trigger | Source |
|---|---|
| Severe AS with a reported cardinal symptom (syncope, angina/chest pain, dyspnoea, heart-failure symptoms) — stage D1 | ACC/AHA 2020 |
| QTc > 500 ms | Drew 2010 |
| CAD-RADS 4B (left main ≥ 50 % or three-vessel ≥ 70 %) or 5 (total occlusion) | CAD-RADS 2.0 |
| Very severe AS (Vmax ≥ 5 m/s or ΔPm ≥ 60 mmHg) | ACC/AHA 2020 |

Symptoms are recognised only from `symptoms[]` / `symptomDetails[]` entries with `present !== false`, using a closed
keyword list. A sentence in the notes does not count.

## 5. Interface decisions (answers to `assistant-chat.md` §2 "Interface notes")

1. The signature stays `(record: PatientRecord) => Assessment` as agreed. Internally `assess()` calls `normalizeRecord()`,
   so the engine and the 3D view read the same normalized values and statuses.
2. Field paths are real record paths: `observations.lvEjectionFraction`, `valveFindings[aortic_valve].peakVelocity`,
   `coronaryFindings[LAD proximal].stenosisPercent`, `doppler[mitral_valve].EROA`, `echo.regionalWallMotion[7]`. Engine-computed
   values use `derived.<id>` (`derived.lvMassIndex`, `derived.qtcBazett`). Documented in `types.ts`.
3. `target` is a `StructureId` or a brain target, optionally `#detail`: `lv#7`, `coronary_vessels#LAD:proximal`.
4. Ids (`F#`, `E#`) are assigned by the chat's `withIds()`; the engine keeps a fixed order so they are stable.
5. `redFlags` stays `string[]`. Each string repeats the numbers it is based on, all of which are also in some `Evidence`, so
   the number guard can check it.

## 6. Open items

- Re-check the **M** rows against the full texts: AS stage table, AR moderate band, ASE EF partitions, LVEDVi and
  wall-thickness limits, RA minor axis, QTc > 500, QRS ≥ 120, PR > 200, HR 50/100, 17-segment territories, SBP 140,
  HCM 15 mm.
- **Clinician review:** 20 of the cases in `tests/assistant/cases/` should be checked by a physician. Not done yet; results go here.
