// Import pipeline: file -> parsed records -> normalized rows with status, duplicates and errors.
// Nothing is committed here; the UI decides what to import after showing the preview.
import { normalizeRecord } from "../normalization/normalize";
import { EnvelopeSchema, SUPPORTED_SCHEMA_MAJOR } from "../schema/record";
import { recordKey, type Issue, type NormalizedPatient } from "../types";
import { parseCsv } from "./csv";

export const IMPORT_LIMITS = { maxBytes: 10 * 1024 * 1024, maxRecords: 500 };

export type RowStatus = "valid" | "warning" | "rejected" | "duplicate_in_file" | "duplicate_existing";

export interface PreviewRow {
  index: number; // 1-based position in the file
  label: string; // "Row 3" or "Record 2"
  status: RowStatus;
  key?: string;
  patientId?: string;
  studyId?: string;
  issues: Issue[];
  patient?: NormalizedPatient;
}

export interface ImportPreview {
  fileName: string;
  format: "json" | "csv" | "unknown";
  bytes: number;
  fileIssues: Issue[];
  rows: PreviewRow[];
  counts: Record<RowStatus, number>;
}

export function detectFormat(fileName: string, text: string): "json" | "csv" | "unknown" {
  const n = fileName.toLowerCase();
  if (n.endsWith(".json")) return "json";
  if (n.endsWith(".csv")) return "csv";
  const t = text.replace(/^﻿/, "").trimStart();
  if (t.startsWith("{") || t.startsWith("[")) return "json";
  if (/^[a-z_]+,/.test(t)) return "csv";
  return "unknown";
}

function parseJson(text: string): { records: unknown[]; fileIssues: Issue[] } {
  const fileIssues: Issue[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    return { records: [], fileIssues: [{ severity: "error", code: "json.syntax", path: "file", message: `Invalid JSON: ${(e as Error).message}`, suggestion: "Validate the file with a JSON linter or start from the JSON template." }] };
  }
  // Supported forms: versioned envelope (canonical), a bare array of records, or one record (convenience).
  if (Array.isArray(data)) {
    fileIssues.push({ severity: "info", code: "json.convenience_array", path: "file", message: "Bare array accepted as a convenience form; the versioned envelope { schemaVersion, patients } is recommended." });
    return { records: data, fileIssues };
  }
  if (data && typeof data === "object" && "patients" in data) {
    const env = EnvelopeSchema.safeParse(data);
    if (!env.success) return { records: [], fileIssues: [{ severity: "error", code: "json.envelope", path: "file", message: "Envelope must contain schemaVersion (string) and patients (array)." }] };
    const major = Number(env.data.schemaVersion.split(".")[0]);
    if (major !== SUPPORTED_SCHEMA_MAJOR) {
      return { records: [], fileIssues: [{ severity: "error", code: "json.schema_version", path: "schemaVersion", message: `Schema version ${env.data.schemaVersion} is not supported (expected ${SUPPORTED_SCHEMA_MAJOR}.x).` }] };
    }
    return { records: env.data.patients, fileIssues };
  }
  if (data && typeof data === "object" && "patientId" in data) {
    fileIssues.push({ severity: "info", code: "json.convenience_single", path: "file", message: "Single record accepted as a convenience form." });
    return { records: [data], fileIssues };
  }
  return { records: [], fileIssues: [{ severity: "error", code: "json.shape", path: "file", message: "Unrecognized JSON shape. Expected { \"schemaVersion\": \"1.0.0\", \"patients\": [ ... ] }." }] };
}

export function buildImportPreview(fileName: string, text: string, existingKeys: ReadonlySet<string>, bytes = new Blob([text]).size): ImportPreview {
  const format = detectFormat(fileName, text);
  const fileIssues: Issue[] = [];
  const rows: PreviewRow[] = [];
  const empty = { valid: 0, warning: 0, rejected: 0, duplicate_in_file: 0, duplicate_existing: 0 };
  if (bytes > IMPORT_LIMITS.maxBytes) {
    fileIssues.push({ severity: "error", code: "file.too_large", path: "file", message: `File is ${(bytes / 1e6).toFixed(1)} MB; the limit is ${IMPORT_LIMITS.maxBytes / 1e6} MB.`, suggestion: "Split the file into smaller batches." });
    return { fileName, format, bytes, fileIssues, rows, counts: empty };
  }
  if (format === "unknown") {
    fileIssues.push({ severity: "error", code: "file.type", path: "file", message: "Unsupported file type. Use .json or .csv.", suggestion: "Download a template from the import dialog." });
    return { fileName, format, bytes, fileIssues, rows, counts: empty };
  }

  let inputs: { label: string; record: unknown; preIssues: Issue[] }[] = [];
  if (format === "json") {
    const r = parseJson(text);
    fileIssues.push(...r.fileIssues);
    inputs = r.records.map((rec, i) => ({ label: `Record ${i + 1}`, record: rec, preIssues: [] }));
  } else {
    const r = parseCsv(text);
    fileIssues.push(...r.fileIssues);
    inputs = r.rows.map((row) => ({ label: `Row ${row.rowNumber}`, record: row.record, preIssues: row.issues }));
  }
  if (inputs.length > IMPORT_LIMITS.maxRecords) {
    fileIssues.push({ severity: "error", code: "file.too_many_records", path: "file", message: `${inputs.length} records exceed the batch limit of ${IMPORT_LIMITS.maxRecords}.`, suggestion: "Split the batch." });
    return { fileName, format, bytes, fileIssues, rows, counts: empty };
  }
  if (inputs.length === 0 && !fileIssues.some((i) => i.severity === "error")) {
    fileIssues.push({ severity: "warning", code: "file.empty", path: "file", message: "The file contains no records." });
  }

  const seen = new Set<string>();
  inputs.forEach((inp, i) => {
    const issues = [...inp.preIssues];
    if (inp.record === null) {
      rows.push({ index: i + 1, label: inp.label, status: "rejected", issues });
      return;
    }
    const n = normalizeRecord(inp.record);
    if (!n.ok) {
      rows.push({ index: i + 1, label: inp.label, status: "rejected", patientId: n.patientId, studyId: n.studyId, issues: [...issues, ...n.issues] });
      return;
    }
    const p = n.patient;
    const key = recordKey(p.patientId, p.studyId);
    issues.push(...p.issues);
    let status: RowStatus = issues.some((x) => x.severity === "error" || x.severity === "warning") ? "warning" : "valid";
    if (seen.has(key)) {
      status = "duplicate_in_file";
      issues.unshift({ severity: "warning", code: "duplicate.in_file", path: "patientId/studyId", message: `(${p.patientId}, ${p.studyId}) appears earlier in this file.`, suggestion: "Give each examination its own studyId, or remove the repeated row." });
    } else if (existingKeys.has(key)) {
      status = "duplicate_existing";
      issues.unshift({ severity: "warning", code: "duplicate.existing", path: "patientId/studyId", message: `(${p.patientId}, ${p.studyId}) already exists in this session. Choose replace or skip.` });
    }
    seen.add(key);
    rows.push({ index: i + 1, label: inp.label, status, key, patientId: p.patientId, studyId: p.studyId, issues, patient: p });
  });
  const counts = { ...empty };
  for (const r of rows) counts[r.status]++;
  return { fileName, format, bytes, fileIssues, rows, counts };
}
