// Writes public/samples/comprehensive-example.json — one fictional record using every optional namespace.
// The ECG samples are a synthetic demonstration signal (sum of Gaussians), clearly labelled as such.
import { writeFileSync } from "node:fs";
const fs = 250, seconds = 2.4, hr = 70, rr = 60 / hr;
const g = (t, mu, s, a) => a * Math.exp(-((t - mu) ** 2) / (2 * s * s));
const lead = [];
for (let i = 0; i < fs * seconds; i++) {
  const t = (i / fs) % rr;
  const v = g(t, 0.16, 0.025, 0.12) - g(t, 0.235, 0.008, 0.1) + g(t, 0.25, 0.01, 1.1) - g(t, 0.27, 0.009, 0.25) + g(t, 0.5, 0.045, 0.3);
  lead.push(i === 300 ? null : Math.round(v * 1000) / 1000);
}
const rec = {
  schemaVersion: "1.0.0",
  patients: [{
    patientId: "SYN-008", studyId: "STUDY-008-A", displayName: "Synthetic 08 · Comprehensive record (all namespaces)", synthetic: true, studyDate: "2026-04-01",
    diagnoses: [{ text: "Hypertensive heart disease", source: "synthetic clinician assessment", kind: "primary" }, { text: "Type 2 diabetes mellitus", source: "synthetic history", kind: "secondary" }],
    demographics: { age: { value: 61, unit: "years", referenceDate: "2026-04-01" }, biologicalSex: "female", heightCm: { value: 164, unit: "cm" }, weightKg: { value: 78, unit: "kg" } },
    history: { medical: ["Hypertension (12 years)", "Type 2 diabetes"], familyCardiac: ["Father: myocardial infarction at 58"] },
    medications: [{ name: "Amlodipine", dose: "5 mg", frequency: "daily" }, { name: "Metformin", dose: "1 g", frequency: "twice daily" }],
    symptomDetails: [{ symptom: "Shortness of breath", present: true, onset: "2025-11", duration: "5 months", description: "On climbing two flights of stairs" }, { symptom: "Syncope", present: false }],
    symptoms: ["Shortness of breath"],
    observations: {
      heartRate: { value: 70, unit: "bpm", source: "synthetic measurement", observedAt: "2026-04-01T09:10:00Z" },
      systolicBP: { value: 148, unit: "mmHg", source: "synthetic measurement", observedAt: "2026-04-01T09:10:00Z", location: "left arm, seated" },
      diastolicBP: { value: 88, unit: "mmHg", source: "synthetic measurement", observedAt: "2026-04-01T09:10:00Z", location: "left arm, seated" },
      spo2: { value: 97, unit: "%", source: "synthetic measurement" },
      respiratoryRate: { value: 16, unit: "breaths/min", source: "synthetic measurement" },
      bodyTemperature: { value: 36.8, unit: "°C", source: "synthetic measurement" },
      lvEndDiastolicDiameter: { value: 50, unit: "mm", source: "synthetic echo report", phase: "end_diastole", method: "2D linear" },
      lvEndSystolicDiameter: { value: 33, unit: "mm", source: "synthetic echo report", phase: "end_systole", method: "2D linear" },
      lvEndDiastolicVolume: { value: 120, unit: "mL", source: "synthetic echo report", method: "biplane Simpson" },
      lvEndSystolicVolume: { value: 52, unit: "mL", source: "synthetic echo report", method: "biplane Simpson" },
      lvEjectionFraction: { value: 57, unit: "%", source: "synthetic echo report", method: "biplane Simpson" },
      laVolume: { value: 58, unit: "mL", source: "synthetic echo report" },
      rvBasalDiameter: { value: 31, unit: "mm", source: "synthetic echo report", method: "apical 4-chamber, RV-focused" },
      raMinorDimension: { value: 38, unit: "mm", source: "synthetic echo report" },
      ivsThickness: { value: 12, unit: "mm", source: "synthetic echo report", phase: "end_diastole" },
      lvPosteriorWallThickness: { value: 11, unit: "mm", source: "synthetic echo report", phase: "end_diastole" },
      tapse: { value: 21, unit: "mm", source: "synthetic echo report" },
      strokeVolume: { value: 68, unit: "mL", source: "synthetic echo report" },
      cardiacOutput: { value: 4.8, unit: "L/min", source: "synthetic echo report" },
      globalLongitudinalStrain: { value: -16.5, unit: "%", source: "synthetic echo report", method: "speckle tracking" },
      pasp: { value: 34, unit: "mmHg", source: "synthetic echo report", method: "TR jet + RA pressure estimate" }
    },
    ecg: {
      rhythm: "Sinus rhythm", heartRate: { value: 71, unit: "bpm" }, prInterval: { value: 168, unit: "ms" }, qrsDuration: { value: 96, unit: "ms" },
      qtInterval: { value: 392, unit: "ms" }, qtc: { value: 426, unit: "ms" }, qtcCorrectionMethod: "Bazett",
      stChanges: [{ leads: ["V5", "V6"], description: "0.5 mm horizontal ST depression (synthetic)" }], tWaveAbnormalities: [{ leads: ["I", "aVL"], description: "Flattened T waves" }],
      arrhythmias: [], source: "synthetic 12-lead ECG", observedAt: "2026-04-01T09:20:00Z",
      waveforms: [
        { leads: ["II"], samplingFrequencyHz: fs, amplitudeUnit: "mV", calibration: "10 mm/mV", startTime: "2026-04-01T09:20:00Z", samples: [lead], format: "inline-json" },
        { leads: ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"], samplingFrequencyHz: 500, amplitudeUnit: "mV", attachmentRef: "synthetic-ecg-0001", format: "DICOM-ECG" }
      ]
    },
    echo: {
      regionalWallMotion: [{ segment: 4, motion: "hypokinetic", source: "synthetic echo report" }],
      diastolicFunction: { grade: "I", description: "Impaired relaxation pattern (synthetic)" },
      rvFunction: { metric: "TAPSE", value: 21, unit: "mm", assessment: "Preserved (as reported)" }
    },
    valveFindings: [{ valve: "aortic_valve", condition: "calcification", severity: "mild", source: "synthetic echo report" }, { valve: "mitral_valve", condition: "regurgitation", severity: "mild", source: "synthetic echo report" }],
    doppler: [
      { measurement: "E/A ratio", value: 0.8, unit: "ratio", valve: "mitral_valve", sampleLocation: "mitral leaflet tips", phase: "diastole", method: "pulsed-wave Doppler" },
      { measurement: "E/e' average", value: 11, unit: "ratio", sampleLocation: "mitral annulus (septal + lateral)", method: "tissue Doppler" },
      { measurement: "TR peak velocity", value: 2.6, unit: "m/s", valve: "tricuspid_valve", referenceDirection: "toward the right atrium", phase: "systole", method: "continuous-wave Doppler", jet: { direction: "central", description: "Thin central jet" } }
    ],
    labs: [
      { analyte: "NT-proBNP", value: 410, unit: "pg/mL", assay: "synthetic immunoassay", collectedAt: "2026-03-30" },
      { analyte: "Troponin T (hs)", value: 9, unit: "ng/L", referenceInterval: { high: 14, unit: "ng/L", source: "synthetic lab sheet" }, collectedAt: "2026-03-30" },
      { analyte: "Hemoglobin", value: 13.1, unit: "g/dL", collectedAt: "2026-03-30" },
      { analyte: "Potassium", value: 4.4, unit: "mmol/L", collectedAt: "2026-03-30" },
      { analyte: "Sodium", value: 139, unit: "mmol/L", collectedAt: "2026-03-30" },
      { analyte: "Calcium", value: 2.35, unit: "mmol/L", collectedAt: "2026-03-30" },
      { analyte: "Creatinine", value: 82, unit: "µmol/L", collectedAt: "2026-03-30" },
      { analyte: "eGFR", value: 74, unit: "mL/min/1.73m²", assay: "CKD-EPI 2021", collectedAt: "2026-03-30" },
      { analyte: "LDL cholesterol", value: 2.9, unit: "mmol/L", collectedAt: "2026-03-30" },
      { analyte: "Glucose (fasting)", value: 7.2, unit: "mmol/L", collectedAt: "2026-03-30" },
      { analyte: "HbA1c", value: 7.1, unit: "%", collectedAt: "2026-03-30" },
      { analyte: "HbA1c", value: 6.8, unit: "%", collectedAt: "2025-10-12", note: "earlier result" }
    ],
    imaging: {
      findings: [
        { modality: "CT", category: "coronary_anatomy", finding: "Right-dominant coronary circulation; mild non-obstructive plaque in proximal LAD", location: "proximal LAD", source: "synthetic CCTA report" },
        { modality: "MRI", category: "tissue_characterization", finding: "Patchy mid-wall enhancement", segment: 9, source: "synthetic MRI report" }
      ],
      assets: [{ kind: "dicom_series", reference: "synthetic-series-001", format: "DICOM", deidentified: true }]
    },
    additionalInvestigations: [
      { type: "holter", summary: "24 h Holter: sinus rhythm, rare isolated ventricular ectopics (synthetic)", date: "2026-02-10" },
      { type: "exercise_stress_test", summary: "Bruce protocol, 8 min, no ischaemic changes (synthetic)", date: "2026-02-20" },
      { type: "catheterization", summary: "Right heart catheterization (synthetic)", date: "2026-03-01",
        pressures: [{ location: "pulmonary artery", value: 28, unit: "mmHg", phase: "systolic", method: "fluid-filled catheter" }, { location: "pulmonary capillary wedge", value: 14, unit: "mmHg", phase: "mean", method: "fluid-filled catheter" }] }
    ],
    clinicalConclusion: {
      primaryDiagnoses: ["Hypertensive heart disease"], secondaryDiagnoses: ["Type 2 diabetes mellitus"], severity: "mild (as reported)",
      structuralFindings: ["Mild concentric LV wall thickening"], functionalFindings: ["Preserved LVEF", "Grade I diastolic dysfunction"],
      interpretation: "Synthetic clinician interpretation for demonstration only.", recommendedFollowUp: "Synthetic: repeat echo in 12 months.", author: "Synthetic clinician", date: "2026-04-01"
    },
    clinicianNotes: "Fictional comprehensive record exercising every optional namespace. The ECG samples are a synthetic demonstration signal."
  }]
};
writeFileSync(new URL("../public/samples/comprehensive-example.json", import.meta.url), JSON.stringify(rec, null, 2));
console.log("ok");
