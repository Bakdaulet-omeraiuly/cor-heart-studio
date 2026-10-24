# Medical data dictionary

Every category from the master specification is represented in the runtime schema
(`src/domain/schema/record.ts`, published as `public/schema/patient-records.schema.json`) and shown in
the inspector. **Availability is optional**: no field is required except `patientId` and `studyId`.
Only supported, traceable observations may change geometry; everything else is displayed.

Conventions

- Unknown = field absent or `"value": null`. Zero is never substituted for unknown.
- Each observation keeps `value`, `unit`, `source`, `observedAt`, `method`, and optional `phase`,
  `location`, `axis`, `indexed`, `note`. The original value and unit are preserved next to the normalized one.
- Units are converted to one canonical unit per field. A missing or unsupported unit keeps the value but
  marks it **not usable for rendering** (with a warning and a suggested unit).
- "Impossible-input guard" bounds reject physically impossible entries (e.g. a negative heart rate).
  They are **not** clinical reference ranges; unusual but possible values are accepted and rendered.
- No clinical classification is performed. No thresholds are configured (see
  `docs/data-to-visual-mapping.md`, *Clinical thresholds*).
- Different dates/methods are never merged into one simultaneous state; mismatches raise notices.

## Scalar observations (generated from `src/domain/schema/fields.ts`)

<!-- FIELDS:BEGIN -->
| JSON path | Field | Canonical unit | Accepted units (case-insensitive) | Impossible-input guard | CSV column | Rendering | Notes |
|---|---|---|---|---|---|---|---|
| `observations.heartRate` | Heart rate | bpm | `bpm`, `beats/min`, `/min`, `min-1` | > 0 … ≤ 400 | `heart_rate_bpm` | drives timing | Resting heart rate. Sets the real-time cardiac cycle frequency. |
| `observations.systolicBP` | Systolic blood pressure | mmHg | `mmhg`, `kpa` | > 0 … ≤ 400 | `systolic_bp_mmhg` | display only | Displayed only. Blood pressure does not change geometry. |
| `observations.diastolicBP` | Diastolic blood pressure | mmHg | `mmhg`, `kpa` | ≥ 0 … ≤ 300 | `diastolic_bp_mmhg` | display only | Displayed only. |
| `observations.spo2` | Oxygen saturation | % | `%`, `percent` | ≥ 0 … ≤ 100 | `spo2_percent` | display only | Displayed only. Never changes blood or tissue colour. |
| `observations.respiratoryRate` | Respiratory rate | breaths/min | `breaths/min`, `/min`, `min-1`, `bpm` | ≥ 0 … ≤ 200 | `respiratory_rate_per_min` | display only | Displayed only. |
| `observations.bodyTemperature` | Body temperature | °C | `°c`, `c`, `celsius`, `°f`, `f` | ≥ 10 … ≤ 50 | `body_temperature_c` | display only | Displayed only. |
| `demographics.heightCm` | Height | cm | `cm`, `m`, `in` | ≥ 20 … ≤ 280 | `height_cm` | display only | Context; used only for derived body surface area. |
| `demographics.weightKg` | Weight | kg | `kg`, `lb`, `g` | ≥ 0.2 … ≤ 700 | `weight_kg` | display only | Context; used only for derived body surface area. |
| `ecg.heartRate` | ECG heart rate | bpm | `bpm`, `/min` | > 0 … ≤ 400 | `ecg_heart_rate_bpm` | display only | Acquisition-specific rate. Used for timing only if no vital-sign heart rate exists (labelled). |
| `ecg.prInterval` | PR interval | ms | `ms`, `s` | ≥ 0 … ≤ 1000 | `ecg_pr_ms` | display only | Displayed only. |
| `ecg.qrsDuration` | QRS duration | ms | `ms`, `s` | ≥ 0 … ≤ 600 | `ecg_qrs_ms` | display only | Displayed only; does not create an activation map. |
| `ecg.qtInterval` | QT interval | ms | `ms`, `s` | ≥ 0 … ≤ 1500 | `ecg_qt_ms` | display only | Displayed only. |
| `ecg.qtc` | QTc | ms | `ms`, `s` | ≥ 0 … ≤ 1500 | `ecg_qtc_ms` | display only | Displayed with its correction method when supplied (e.g. Bazett, Fridericia). |
| `observations.lvEndDiastolicDiameter` | LV end-diastolic diameter | mm | `mm`, `cm` | > 0 … ≤ 150 | `lv_edd_mm` | drives geometry | Scales the LV cavity in the short-axis plane relative to the asset baseline. |
| `observations.lvEndSystolicDiameter` | LV end-systolic diameter | mm | `mm`, `cm` | > 0 … ≤ 150 | `lv_esd_mm` | display only | Displayed; used for a consistency check against LVEDD. |
| `observations.lvEndDiastolicVolume` | LV end-diastolic volume | mL | `ml`, `cm3`, `cm^3`, `l` | > 0 … ≤ 1500 | `lv_edv_ml` | drives geometry | Targets the rendered LV cavity volume at end-diastole. |
| `observations.lvEndSystolicVolume` | LV end-systolic volume | mL | `ml`, `cm3`, `cm^3`, `l` | ≥ 0 … ≤ 1500 | `lv_esv_ml` | drives geometry | Targets the rendered LV cavity volume at end-systole. |
| `observations.laVolume` | Left atrial volume | mL | `ml`, `cm3`, `cm^3`, `l` | > 0 … ≤ 1000 | `la_volume_ml` | drives geometry | Scales the LA (cube-root of the volume ratio, shape illustrative). |
| `observations.rvBasalDiameter` | RV basal diameter | mm | `mm`, `cm` | > 0 … ≤ 150 | `rv_basal_diameter_mm` | drives geometry | Scales the RV in the short-axis direction. |
| `observations.raMinorDimension` | RA minor-axis dimension | mm | `mm`, `cm` | > 0 … ≤ 150 | `ra_minor_mm` | drives geometry | Scales the RA (shape illustrative). |
| `observations.ivsThickness` | Interventricular septum thickness (diastole) | mm | `mm`, `cm` | > 0 … ≤ 80 | `ivs_d_mm` | drives geometry | Thickens or thins the septal LV segments only. |
| `observations.lvPosteriorWallThickness` | LV posterior wall thickness (diastole) | mm | `mm`, `cm` | > 0 … ≤ 80 | `lvpw_d_mm` | drives geometry | Thickens or thins the inferolateral (posterior) LV segments only. |
| `observations.lvEjectionFraction` | LV ejection fraction | % | `%`, `percent` | ≥ 0 … ≤ 100 | `lv_ef_percent` | drives geometry | Sets the LV cavity volume excursion between end-diastole and end-systole. |
| `observations.rvEjectionFraction` | RV ejection fraction | % | `%`, `percent` | ≥ 0 … ≤ 100 | `rv_ef_percent` | drives geometry | Sets the RV volume excursion. |
| `observations.tapse` | TAPSE | mm | `mm`, `cm` | ≥ 0 … ≤ 80 | `tapse_mm` | display only | Displayed; RV function context. |
| `observations.strokeVolume` | Stroke volume | mL | `ml`, `cm3`, `cm^3`, `l` | ≥ 0 … ≤ 1000 | `stroke_volume_ml` | display only | Displayed. |
| `observations.cardiacOutput` | Cardiac output | L/min | `l/min`, `ml/min` | ≥ 0 … ≤ 60 | `cardiac_output_l_min` | display only | Displayed. |
| `observations.globalLongitudinalStrain` | Global longitudinal strain | % | `%`, `percent` | ≥ -60 … ≤ 60 | `gls_percent` | display only | Displayed next to a labelled qualitative cue; never expanded into a strain field. |
| `observations.pasp` | Pulmonary artery systolic pressure (estimated) | mmHg | `mmhg` | ≥ 0 … ≤ 250 | `pasp_mmhg` | display only | Displayed with method and location. |
| `observations.hippocampalVolumeChangePerYear` | Hippocampal volume change per year | %/year | `%/year`, `%/y`, `%/yr`, `%/a`, `%peryear`, `percent/year` | ≥ -100 … ≤ 200 | `—` | display only | Annualised change between two MRI scans (negative = atrophy). Compared with cohort ranges by the diagnosis engine; never an individual forecast. |
| `observations.ventricularVolumeChangePerYear` | Ventricular volume change per year | %/year | `%/year`, `%/y`, `%/yr`, `%/a`, `%peryear`, `percent/year` | ≥ -100 … ≤ 200 | `—` | display only | Annualised lateral-ventricle volume change between two scans (positive = expansion). Compared with cohort means by the diagnosis engine. |
<!-- FIELDS:END -->

`drives timing` = sets cycle frequency. `drives geometry` = may change the rendered anatomy through a
documented rule. `display only` = shown with provenance, never changes the anatomy.

## Categories and rendering boundary

| Category | Where in the record | Supported content | Rendering boundary (as implemented) |
|---|---|---|---|
| Patient information | `patientId`, `studyId`, `demographics`, `history`, `medications` | Age with unit + reference date, biological sex, height, weight, medical & family cardiac history, medications | Context only. Height/weight only feed the derived BSA. No anatomy from demographics or medication. |
| Symptoms | `symptoms`, `symptomDetails[]` | Symptom, present/absent, onset, duration, description, source | Displayed as supplied; never creates lesions. |
| Vital signs | `observations.*` | HR, SBP/DBP, SpO₂, respiratory rate, temperature | HR → cycle frequency. All others display only (no colour change from SpO₂). |
| ECG / EKG | `ecg` | Rhythm, acquisition HR, PR, QRS, QT, QTc + correction method, ST changes, T-wave abnormalities, arrhythmias, source, time | Displayed. No activation map, no tracing invented. ECG HR used for timing only when no vital-sign HR exists (labelled). |
| ECG waveform | `ecg.waveforms[]` | Leads, sampling frequency, amplitude unit, calibration, timestamps, inline samples (null = missing), attachment reference/format | Inline numeric samples are plotted exactly (gaps shown). Attachments (e.g. DICOM-ECG) are listed as unsupported formats, never synthesized. |
| Echo chamber dimensions | `observations.*` | LVEDD, LVESD, LVEDV, LVESV, LA volume, RV basal diameter, RA minor dimension, IVSd, LVPWd | Phase, method, axis and indexed status retained. Indexed values and contradicting phases are not used for geometry. |
| Echo function | `observations.*`, `echo.*` | LVEF, RVEF, TAPSE, SV, CO, GLS, regional wall motion (AHA-17), diastolic function, RV function | EF / RVEF drive excursion; wall motion drives segmental motion; GLS shown with a qualitative cue only; the rest displayed. |
| Valves | `valveFindings[]` | Valve (aliases MV/AV/TV/PV accepted), condition (stenosis, regurgitation, prolapse, calcification, prosthetic, other), severity, valve area, peak/mean gradients, peak velocity | Attached to the named valve. Severity → illustrative opening/jet; measured area/gradients displayed, never converted into geometry. |
| Doppler | `doppler[]` | Measurement, value, unit, valve, sample location, reference direction, phase, method, jet description | Displayed. A local measurement never defines a 3D velocity field. |
| Laboratory | `labs[]` | Analyte, value, unit, assay, reference interval (as supplied), collection time; repeated results allowed | Displayed with analyte-specific units. Never deforms the heart. |
| Cardiac CT / MRI findings | `imaging.findings[]` | Modality, category (chamber geometry, myocardial thickness, ventricular volume, coronary anatomy, tissue characterization, fibrosis/scar, congenital, other), finding, location or AHA segment | Fibrosis/scar and tissue characterization with an AHA segment → hatched segment overlay (geometry unchanged). Others displayed as text. |
| Imaging assets | `imaging.assets[]` | DICOM series, segmentation masks, meshes (reference, format, de-identified flag, units, orientation, labels, license) | Listed with an "unsupported — not reconstructed" notice (Tier C not implemented). Never fetched. |
| Additional investigations | `additionalInvestigations[]` | Holter, exercise stress test, CCTA, coronary angiography, catheterization (pressures with location/phase/method/time) | Displayed as structured summaries. |
| Diagnosis & conclusion | `diagnoses[]`, `clinicalConclusion` | Primary/secondary diagnoses with source, severity as supplied, structural/functional findings, interpretation, recommended follow-up, author | Displayed with attribution. Never generates recommendations; diagnoses never create geometry (no diagnosis presets). |

## CSV encoding (scalar subset)

- One patient-study per row. Required columns: `patient_id`, `study_id`.
- Optional row-level columns: `display_name`, `synthetic` (true/false), `study_date`, `source` (applied to
  every value in the row), `observed_at`.
- Value columns carry the canonical unit in their name (table above). Write `null`/`NA`/`unknown` for an
  explicitly unknown value. A non-numeric value (e.g. `5.6cm`) rejects the row with a suggestion.
- Valve findings flatten deterministically to `<valve>_<condition>` columns holding the severity
  (`prolapse` columns hold `true`):
  <!-- VALVES:BEGIN -->
`mitral_valve_stenosis`, `mitral_valve_regurgitation`, `mitral_valve_prolapse`, `aortic_valve_stenosis`, `aortic_valve_regurgitation`, `aortic_valve_prolapse`, `tricuspid_valve_stenosis`, `tricuspid_valve_regurgitation`, `tricuspid_valve_prolapse`, `pulmonary_valve_stenosis`, `pulmonary_valve_regurgitation`, `pulmonary_valve_prolapse`
<!-- VALVES:END -->
- Lists: `diagnoses` (items `text | source`), `symptoms`, `wall_motion` (items `segment:motion`), separated
  by `; `. Escape a literal semicolon as `\;`. Text cells follow RFC 4180 quoting (commas, quotes, line
  breaks, Unicode and a UTF-8 BOM are supported).
- Not representable in CSV (use JSON): labs, ECG waveforms and ST/T detail, Doppler, imaging, additional
  investigations, conclusions, histories, medications, wall-thickness arrays.
- Exports neutralize spreadsheet formula injection (text cells starting with `= + - @` get a leading `'`;
  numbers stay numeric).

## Examples

- Minimal canonical example (spec §8): `public/samples/template.json` (CSV twin: `template.csv`).
- Seven valid synthetic cases: `public/samples/synthetic-patients.json` / `.csv` (tested to normalize to
  the same observations).
- Every namespace in one record: `public/samples/comprehensive-example.json`.
- Invalid fixtures: `public/samples/invalid/` (malformed CSV, missing identifiers, unit mismatch,
  contradictory volumes + impossible value, duplicates).
