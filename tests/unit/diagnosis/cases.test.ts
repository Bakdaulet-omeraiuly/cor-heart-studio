// Runs every case in tests/assistant/cases/ through assess() (format: tests/assistant/cases/README.md).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assess, type Assessment } from "@/domain/diagnosis";
import { normalizeRecord } from "@/domain/normalization/normalize";
import { PatientRecordSchema } from "@/domain/schema/record";

const DIR = resolve(__dirname, "../../assistant/cases");
const BEHAVIORS = ["answer", "state-missing", "refer-urgent", "decline-out-of-scope", "decline-patient-diagnosis"];

interface Case {
  id: string; title: string; category: string; source: string; question?: string; record: unknown; reviewedByClinician: boolean;
  expected: {
    ruleDefined: { condition: string; grade: string | null }[];
    findings?: { condition: string; basis: string; grade?: string }[];
    differential?: { condition: string; basis?: string }[];
    absentDifferential?: string[];
    missing?: string[];
    absentMissing?: string[];
    redFlags: number;
    behavior: string;
  };
}

const cases: Case[] = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(resolve(DIR, f), "utf8")));

/** Every number the record contains (raw and normalized), plus the unit conversions the engine applies to valve/Doppler values. */
function recordNumbers(raw: unknown): number[] {
  const n = normalizeRecord(raw);
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number") out.push(v, v / 100, v / 10, Math.round(v * 7.50062 * 10) / 10);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(raw);
  if (n.ok) walk({ o: n.patient.observations, d: n.patient.derived });
  return out;
}

function checkProvenance(a: Assessment, raw: unknown) {
  const nums = recordNumbers(raw);
  for (const f of [...a.findings, ...a.differential]) {
    for (const e of f.evidence) {
      if (typeof e.value !== "number" || e.field.startsWith("derived.")) continue;
      expect(nums.some((x) => Math.abs(x - (e.value as number)) < 1e-9), `${e.field}=${e.value} is not a record value`).toBe(true);
    }
  }
}

describe("case set (tests/assistant/cases)", () => {
  it("has at least 60 well-formed cases with unique ids", () => {
    expect(cases.length).toBeGreaterThanOrEqual(60);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(c.source.length, c.id).toBeGreaterThan(5);
      expect(BEHAVIORS, c.id).toContain(c.expected.behavior);
    }
  });

  for (const c of cases) {
    it(`${c.id} — ${c.title}`, () => {
      const a = assess(PatientRecordSchema.parse(c.record));
      const e = c.expected;
      // 100 % agreement on rule-defined grades: same set of (condition, grade), nothing extra, nothing missing
      const got = a.findings.filter((f) => f.basis === "rule-defined").map((f) => `${f.condition}:${f.grade ?? null}`).sort();
      expect(got, "rule-defined findings").toEqual(e.ruleDefined.map((r) => `${r.condition}:${r.grade}`).sort());
      for (const f of e.findings ?? []) {
        const hit = a.findings.find((x) => x.condition === f.condition);
        expect(hit, `finding ${f.condition}`).toBeDefined();
        expect(hit!.basis, f.condition).toBe(f.basis);
        if (f.grade !== undefined) expect(hit!.grade, f.condition).toBe(f.grade);
      }
      for (const d of e.differential ?? []) {
        const hit = a.differential.find((x) => x.condition === d.condition);
        expect(hit, `differential ${d.condition}`).toBeDefined();
        if (d.basis) expect(hit!.basis, d.condition).toBe(d.basis);
      }
      for (const d of e.absentDifferential ?? []) expect(a.differential.map((x) => x.condition), `absent ${d}`).not.toContain(d);
      const missing = a.missing.map((m) => m.field);
      for (const m of e.missing ?? []) expect(missing, `missing ${m}`).toContain(m);
      for (const m of e.absentMissing ?? []) expect(missing, `not missing ${m}`).not.toContain(m);
      expect(a.redFlags.length, "red flags").toBe(e.redFlags);
      // every clinical statement cites a rule and a DOI; no invented numbers; disclaimer present
      for (const f of [...a.findings, ...a.differential]) for (const ev of f.evidence) expect(ev.source).toMatch(/doi:10\./);
      checkProvenance(a, c.record);
      expect(a.disclaimer).toMatch(/not a diagnosis/i);
    });
  }
});
