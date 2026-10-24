// Regenerates derived data files: CSV twin of the JSON samples, import templates, published JSON Schema.
//   npx tsx scripts/generate-data-files.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { recordsToCsv } from "@/domain/import/csv";
import { patientJsonSchema, SCHEMA_VERSION } from "@/domain/schema/record";

const root = resolve(import.meta.dirname, "..");
const samples = JSON.parse(readFileSync(resolve(root, "public/samples/synthetic-patients.json"), "utf8"));
writeFileSync(resolve(root, "public/samples/synthetic-patients.csv"), recordsToCsv(samples.patients) + "\r\n");

const template = {
  schemaVersion: SCHEMA_VERSION,
  patients: [{
    patientId: "SYN-002", studyId: "STUDY-002-A", displayName: "Synthetic patient 02", synthetic: true,
    diagnoses: [{ text: "Dilated cardiomyopathy", source: "synthetic clinician assessment" }],
    observations: {
      heartRate: { value: 92, unit: "bpm", source: "synthetic measurement" },
      systolicBP: { value: 110, unit: "mmHg", source: "synthetic measurement" },
      diastolicBP: { value: 72, unit: "mmHg", source: "synthetic measurement" },
      lvEjectionFraction: { value: 32, unit: "%", source: "synthetic echo report" },
      lvEndDiastolicVolume: { value: 180, unit: "mL", source: "synthetic echo report" },
      lvEndSystolicVolume: { value: 122.4, unit: "mL", source: "synthetic echo report" },
      lvEndDiastolicDiameter: { value: 65, unit: "mm", source: "synthetic echo report", phase: "end_diastole", method: "reported linear dimension" },
    },
    valveFindings: [{ valve: "mitral_valve", condition: "regurgitation", severity: "moderate", source: "synthetic clinician assessment" }],
    symptoms: ["Exertional breathlessness"],
    clinicianNotes: "Fictional demonstration record. No imaging is supplied.",
  }],
};
writeFileSync(resolve(root, "public/samples/template.json"), JSON.stringify(template, null, 2) + "\n");
writeFileSync(resolve(root, "public/samples/template.csv"), recordsToCsv(template.patients as never) + "\r\n");

mkdirSync(resolve(root, "public/schema"), { recursive: true });
writeFileSync(resolve(root, "public/schema/patient-records.schema.json"), JSON.stringify({ $id: "https://cor-heart-studio.local/schema/patient-records.schema.json", title: "COR Heart Studio patient records", ...patientJsonSchema() }, null, 2) + "\n");
console.log("data files written");
