// CSV <-> record mapping for the scalar subset. One patient-study per row; units live in column names.
// Lists use "; " separators (escape a literal semicolon as "\;"). Valve findings flatten to
// <valve>_<condition> columns holding the severity. Nested data (labs, waveforms, imaging) needs JSON.
import Papa from "papaparse";
import { FIELDS, FIELD_BY_CSV } from "../schema/fields";
import { VALVE_IDS, type PatientRecordInput } from "../schema/record";
import type { Issue } from "../types";

export const CSV_ID_COLUMNS = ["patient_id", "study_id", "display_name", "synthetic", "study_date", "source", "observed_at"] as const;
export const CSV_TEXT_COLUMNS = ["diagnoses", "symptoms", "clinician_notes", "ecg_rhythm", "wall_motion"] as const;
const VALVE_CONDITIONS = ["stenosis", "regurgitation", "prolapse"] as const;
export const CSV_VALVE_COLUMNS = VALVE_IDS.flatMap((v) => VALVE_CONDITIONS.map((c) => `${v}_${c}`));
export const CSV_COLUMNS: string[] = [
  ...CSV_ID_COLUMNS,
  ...FIELDS.filter((f) => f.csvColumn).map((f) => f.csvColumn!),
  ...CSV_VALVE_COLUMNS,
  ...CSV_TEXT_COLUMNS,
];

export function splitList(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === ";") { cur += ";"; i++; continue; }
    if (s[i] === ";") { out.push(cur.trim()); cur = ""; continue; }
    cur += s[i];
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}
const joinList = (items: string[]) => items.map((x) => x.replace(/;/g, "\\;")).join("; ");

export interface CsvRow {
  rowNumber: number; // 1-based data row (header excluded)
  record: PatientRecordInput | null;
  issues: Issue[];
  raw: Record<string, string>;
}

export function parseCsv(text: string): { rows: CsvRow[]; fileIssues: Issue[] } {
  const fileIssues: Issue[] = [];
  const clean = text.replace(/^﻿/, "");
  const res = Papa.parse<Record<string, string>>(clean, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase() });
  for (const e of res.errors) {
    fileIssues.push({ severity: "error", code: `csv.${e.code}`, path: e.row !== undefined ? `row ${e.row + 1}` : "file", message: e.message,
      suggestion: e.code === "MissingQuotes" ? "Wrap fields containing commas, quotes or line breaks in double quotes (\"\"), doubling inner quotes." : undefined });
  }
  const headers = res.meta.fields ?? [];
  const known = new Set(CSV_COLUMNS);
  const unknown = headers.filter((h) => !known.has(h));
  if (unknown.length) fileIssues.push({ severity: "warning", code: "csv.unknown_columns", path: "header", message: `Unrecognized column(s): ${unknown.join(", ")}. They are ignored.`, suggestion: "Download the CSV template for the supported column names (units are part of the name)." });
  if (!headers.includes("patient_id") || !headers.includes("study_id")) {
    fileIssues.push({ severity: "error", code: "csv.missing_id_columns", path: "header", message: "Header must contain patient_id and study_id columns.", suggestion: "Start from the CSV template." });
  }
  const rowErrorRows = new Set(res.errors.map((e) => e.row));
  const rows: CsvRow[] = res.data.map((r, i) => {
    const issues: Issue[] = [];
    if (rowErrorRows.has(i)) issues.push({ severity: "error", code: "csv.row_malformed", path: `row ${i + 1}`, message: "Row could not be parsed reliably (see file-level errors)." });
    const get = (k: string) => (r[k] ?? "").trim();
    const rec: Record<string, unknown> = {};
    const defaultSource = get("source") || undefined;
    const observedAt = get("observed_at") || undefined;
    if (get("patient_id")) rec.patientId = get("patient_id");
    if (get("study_id")) rec.studyId = get("study_id");
    if (get("display_name")) rec.displayName = get("display_name");
    if (get("synthetic")) rec.synthetic = /^(true|yes|1)$/i.test(get("synthetic"));
    if (get("study_date")) rec.studyDate = get("study_date");
    for (const [col, def] of FIELD_BY_CSV) {
      const v = get(col);
      if (!v) continue;
      const num = Number(v.replace(",", "."));
      if (!Number.isFinite(num) || !/^[-+]?\d*[.,]?\d+(e[-+]?\d+)?$/i.test(v)) {
        if (/^(null|na|n\/a|unknown)$/i.test(v)) {
          setPath(rec, def.path, { value: null, unit: def.canonicalUnit, source: defaultSource, observedAt });
        } else {
          issues.push({ severity: "error", code: "csv.not_a_number", path: col, message: `"${v}" in ${col} is not a number.`, suggestion: `Enter a plain number in ${def.canonicalUnit} (the unit is fixed by the column name).` });
        }
        continue;
      }
      setPath(rec, def.path, { value: num, unit: def.canonicalUnit, source: defaultSource, observedAt });
    }
    const diagnoses = get("diagnoses");
    if (diagnoses) rec.diagnoses = splitList(diagnoses).map((d) => { const [text, source] = d.split("|").map((x) => x.trim()); return source ? { text, source } : { text, source: defaultSource }; });
    const symptoms = get("symptoms");
    if (symptoms) rec.symptoms = splitList(symptoms);
    if (get("clinician_notes")) rec.clinicianNotes = get("clinician_notes");
    if (get("ecg_rhythm")) rec.ecg = { ...(rec.ecg as object), rhythm: get("ecg_rhythm") };
    const valveFindings: unknown[] = [];
    for (const v of VALVE_IDS) for (const c of VALVE_CONDITIONS) {
      const s = get(`${v}_${c}`);
      if (!s) continue;
      if (c === "prolapse") { if (/^(true|yes|1|present)$/i.test(s)) valveFindings.push({ valve: v, condition: c, source: defaultSource }); continue; }
      valveFindings.push({ valve: v, condition: c, severity: s, source: defaultSource });
    }
    if (valveFindings.length) rec.valveFindings = valveFindings;
    const wm = get("wall_motion");
    if (wm) {
      const items = splitList(wm).map((x) => {
        const [seg, motion] = x.split(":").map((y) => y.trim());
        return { segment: Number(seg), motion, source: defaultSource };
      });
      rec.echo = { ...(rec.echo as object), regionalWallMotion: items };
    }
    return { rowNumber: i + 1, record: issues.some((x) => x.severity === "error") ? null : (rec as PatientRecordInput), issues, raw: r };
  });
  return { rows, fileIssues };
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let o = obj;
  for (const p of parts.slice(0, -1)) o = (o[p] ??= {}) as Record<string, unknown>;
  o[parts[parts.length - 1]] = value;
}
function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** Neutralize spreadsheet formula injection for text cells (numbers stay numeric). */
export function safeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  const s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s)) return `'${s}`;
  return s;
}

/** Records -> CSV (scalar subset, canonical units). Values must already be in canonical units. */
export function recordsToCsv(records: PatientRecordInput[]): string {
  const rows = records.map((r) => {
    const row: Record<string, unknown> = {
      patient_id: r.patientId, study_id: r.studyId, display_name: r.displayName, synthetic: r.synthetic === undefined ? "" : String(r.synthetic),
      study_date: r.studyDate, clinician_notes: r.clinicianNotes, ecg_rhythm: r.ecg?.rhythm,
    };
    const sources = new Set<string>();
    for (const f of FIELDS) {
      if (!f.csvColumn) continue;
      const o = getPath(r, f.path) as { value: number | null; unit?: string; source?: string } | number | undefined;
      if (o === undefined) continue;
      const val = typeof o === "number" ? o : o.value;
      row[f.csvColumn] = val === null ? "null" : val;
      if (typeof o === "object" && o.source) sources.add(o.source);
    }
    if (sources.size === 1) row.source = [...sources][0];
    if (r.diagnoses?.length) row.diagnoses = joinList(r.diagnoses.map((d) => (typeof d === "string" ? d : d.source ? `${d.text} | ${d.source}` : d.text)));
    if (r.symptoms?.length) row.symptoms = joinList(r.symptoms.map((s) => (typeof s === "string" ? s : s.symptom)));
    for (const v of r.valveFindings ?? []) {
      const valve = String(v.valve);
      const key = `${valve.endsWith("_valve") ? valve : `${valve}_valve`}_${v.condition}`;
      row[key] = v.condition === "prolapse" ? "true" : v.severity ?? "unspecified";
    }
    if (r.echo?.regionalWallMotion?.length) row.wall_motion = joinList(r.echo.regionalWallMotion.map((w) => `${w.segment}:${w.motion}`));
    const out: Record<string, string> = {};
    for (const c of CSV_COLUMNS) out[c] = safeCell(row[c]);
    return out;
  });
  return Papa.unparse({ fields: CSV_COLUMNS, data: rows.map((r) => CSV_COLUMNS.map((c) => r[c])) }, { quotes: false, newline: "\r\n" });
}
