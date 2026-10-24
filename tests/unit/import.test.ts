import { describe, expect, it } from "vitest";
import { parseCsv, recordsToCsv, safeCell } from "@/domain/import/csv";
import { buildImportPreview } from "@/domain/import/preview";
import { normalizeRecord } from "@/domain/normalization/normalize";
import { readText, samplePatients } from "./helpers";

const none = new Set<string>();

describe("CSV parsing", () => {
  it("handles quoted commas, embedded newlines, quotes, Unicode and a UTF-8 BOM", () => {
    const csv = "﻿patient_id,study_id,heart_rate_bpm,clinician_notes,symptoms\r\n" +
      'P-1,S-1,70,"Notes, with comma\nand a second line, ""quoted"" — Жүрек ❤",Breathlessness; Chest pain\\; at rest\r\n';
    const { rows, fileIssues } = parseCsv(csv);
    expect(fileIssues.filter((i) => i.severity === "error")).toEqual([]);
    const rec = rows[0].record!;
    expect(rec.clinicianNotes).toBe('Notes, with comma\nand a second line, "quoted" — Жүрек ❤');
    expect(rec.symptoms).toEqual(["Breathlessness", "Chest pain; at rest"]);
    expect((rec.observations as Record<string, { value: number; unit: string }>).heartRate).toMatchObject({ value: 70, unit: "bpm" });
  });

  it("flattens valve findings deterministically", () => {
    const { rows } = parseCsv("patient_id,study_id,aortic_valve_stenosis,mitral_valve_prolapse\nP,S,severe,yes\n");
    expect(rows[0].record!.valveFindings).toEqual([
      { valve: "mitral_valve", condition: "prolapse", source: undefined },
      { valve: "aortic_valve", condition: "stenosis", severity: "severe", source: undefined },
    ]);
  });

  it("rejects non-numeric values in unit-bearing columns with a suggestion", () => {
    const { rows } = parseCsv("patient_id,study_id,lv_edd_mm\nP,S,5.6cm\n");
    expect(rows[0].record).toBeNull();
    expect(rows[0].issues[0].suggestion).toMatch(/mm/);
  });

  it("JSON and CSV sample datasets normalize to the same shared observations", () => {
    const json = samplePatients();
    const csv = parseCsv(recordsToCsv(json as never));
    expect(csv.rows).toHaveLength(json.length);
    json.forEach((raw, i) => {
      const a = normalizeRecord(raw), b = normalizeRecord(csv.rows[i].record);
      if (!a.ok || !b.ok) throw new Error("normalization failed");
      for (const [path, o] of Object.entries(a.patient.observations)) {
        expect(b.patient.observations[path]?.value, `${a.patient.patientId} ${path}`).toBe(o.value);
      }
      expect(b.patient.valveFindings.map((v) => [v.valve, v.condition, v.severity])).toEqual(a.patient.valveFindings.map((v) => [v.valve, v.condition, v.severity]));
      expect(b.patient.wallMotion).toEqual(a.patient.wallMotion.map((w) => ({ ...w, source: b.patient.wallMotion.find((x) => x.segment === w.segment)?.source })));
    });
  });

  it("the downloadable CSV sample matches the JSON sample", () => {
    const fromFile = parseCsv(readText("public/samples/synthetic-patients.csv"));
    expect(fromFile.fileIssues.filter((i) => i.severity === "error")).toEqual([]);
    expect(fromFile.rows.map((r) => r.record?.patientId)).toEqual(samplePatients().map((p) => p.patientId));
  });
});

describe("export safety", () => {
  it("neutralizes formula injection but keeps numbers numeric", () => {
    expect(safeCell("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(safeCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(safeCell("+cmd")).toBe("'+cmd");
    expect(safeCell(-16.5)).toBe("-16.5");
    expect(safeCell("-16.5")).toBe("-16.5");
  });
});

describe("import preview", () => {
  it("previews the bundled JSON sample as all valid", () => {
    const p = buildImportPreview("synthetic-patients.json", readText("public/samples/synthetic-patients.json"), none);
    expect(p.fileIssues.filter((i) => i.severity === "error")).toEqual([]);
    expect(p.counts.rejected).toBe(0);
    expect(p.rows).toHaveLength(8);
  });

  it("flags malformed CSV", () => {
    const p = buildImportPreview("malformed.csv", readText("public/samples/invalid/malformed.csv"), none);
    expect(p.fileIssues.some((i) => i.severity === "error")).toBe(true);
  });

  it("rejects rows with missing identifiers but keeps valid rows importable", () => {
    const p = buildImportPreview("missing-identifiers.json", readText("public/samples/invalid/missing-identifiers.json"), none);
    expect(p.rows.map((r) => r.status)).toEqual(["rejected", "rejected", "valid"]);
  });

  it("reports unit mismatches per field", () => {
    const p = buildImportPreview("unit-mismatch.json", readText("public/samples/invalid/unit-mismatch.json"), none);
    const codes = p.rows[0].issues.map((i) => `${i.code}:${i.path}`);
    expect(codes).toEqual(expect.arrayContaining(["unit.unknown:observations.heartRate", "unit.unknown:observations.lvEndDiastolicDiameter", "unit.missing:observations.lvEndSystolicDiameter"]));
    expect(p.rows[0].patient!.observations["observations.ivsThickness"].value).toBe(11);
  });

  it("flags contradictory volumes and impossible values", () => {
    const p = buildImportPreview("contradictory-volumes.json", readText("public/samples/invalid/contradictory-volumes.json"), none);
    expect(p.rows[0].status).toBe("warning");
    expect(p.rows[0].issues.map((i) => i.code)).toEqual(expect.arrayContaining(["volumes.contradiction", "value.impossible"]));
  });

  it("detects duplicates in the file and against the session", () => {
    const text = readText("public/samples/invalid/duplicates.csv");
    const p = buildImportPreview("duplicates.csv", text, new Set(["DUP-041::STUDY-041"]));
    expect(p.rows.map((r) => r.status)).toEqual(["valid", "duplicate_in_file", "duplicate_existing"]);
  });

  it("enforces size, type and schema-version limits", () => {
    expect(buildImportPreview("x.txt", "hello", none).fileIssues[0].code).toBe("file.type");
    expect(buildImportPreview("x.json", "{}", none, 11 * 1024 * 1024).fileIssues[0].code).toBe("file.too_large");
    expect(buildImportPreview("x.json", '{"schemaVersion":"2.0.0","patients":[]}', none).fileIssues[0].code).toBe("json.schema_version");
  });
});
