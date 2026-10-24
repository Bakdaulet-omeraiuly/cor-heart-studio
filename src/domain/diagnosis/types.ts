// Shared contract between the diagnosis engine (@HyorinmaruK) and the assistant chat (@kerimku1).
// Agreed in docs/tasks/HyorinmaruK.md and docs/tasks/kerimku1.md. Tell the other person before changing anything here.
//
// Conventions (comments only, the types are exactly as agreed):
// - Evidence.field is a dotted record path ("observations.lvEjectionFraction", "valveFindings[aortic_valve stenosis].peakVelocity",
//   "doppler[mitral_valve].EROA", "coronaryFindings[LAD proximal].stenosisPercent", "echo.regionalWallMotion[7]") or
//   "derived.<id>" for a value the engine computed from record values (derived.lvMassIndex, derived.qtcBazett, …).
//   Numeric values are in canonical units (Vmax m/s, gradients mmHg, areas cm², lengths mm, VC cm).
// - Evidence.value never holds free text copied from the record; strings are engine-defined enums ("severe", "akinetic").
// - Finding.target is a heart StructureId ("aortic_valve", "lv", "coronary_vessels", …) or a brain target
//   ("hippocampus", "ventricles", "cortex"), optionally followed by "#<detail>": "lv#7" (AHA segment 7),
//   "coronary_vessels#LAD:proximal". Split on "#" to get the structure id.
import type { PatientRecord } from "@/domain/schema/record";

export interface Evidence {
  field: string;            // жазбадағы өріс, мысалы "valves.aortic.peakVelocity"
  value: number | string;
  unit?: string;
  rule: string;             // "R-VALVE-STEN-01" немесе жаңа ереже id
  source: string;           // гайдлайн + DOI
}

export interface Finding {
  condition: string;        // "aortic-stenosis"
  label: string;            // "Aortic stenosis, severe"
  grade?: string;           // "severe"
  basis: "rule-defined" | "supported" | "possible";
  evidence: Evidence[];
  organ: "heart" | "brain";
  target?: string;          // 3D нысан id (клапан, коронар сегменті, ми аймағы)
}

export interface Assessment {
  findings: Finding[];      // ережемен анықталғандар
  differential: Finding[];  // ықтимал балама түсіндірмелер
  missing: { field: string; why: string }[];
  redFlags: string[];
  disclaimer: string;
}

export type Assess = (record: PatientRecord) => Assessment;   // таза функция, желісіз, детерминистік
