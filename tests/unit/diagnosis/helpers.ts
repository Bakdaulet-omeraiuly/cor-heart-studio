import { assess, type Assessment, type Finding } from "@/domain/diagnosis";
import { PatientRecordSchema, type PatientRecordInput } from "@/domain/schema/record";

export type Rec = Partial<PatientRecordInput> & Record<string, unknown>;

/** Run the engine on a minimal record plus `extra` (validated through the real schema). */
export const run = (extra: Rec = {}): Assessment => assess(PatientRecordSchema.parse({ patientId: "T-1", studyId: "S-1", ...extra }));
export const o = (value: number | null, unit?: string) => (unit === undefined ? { value } : { value, unit });
export const find = (a: Assessment, condition: string): Finding | undefined => a.findings.find((f) => f.condition === condition);
export const alt = (a: Assessment, condition: string): Finding | undefined => a.differential.find((f) => f.condition === condition);
export const missingFields = (a: Assessment) => a.missing.map((m) => m.field);
export const male = { demographics: { biologicalSex: "male" } };
export const female = { demographics: { biologicalSex: "female" } };
/** Height/weight giving a Mosteller BSA of exactly 2.00 m² (√(180 × 80 / 3600) = 2). */
export const bsa2 = (sex: "male" | "female" = "male") => ({ demographics: { biologicalSex: sex, heightCm: o(180, "cm"), weightKg: o(80, "kg") } });
export const obsRec = (observations: Record<string, unknown>, extra: Rec = {}) => run({ observations, ...extra } as Rec);
