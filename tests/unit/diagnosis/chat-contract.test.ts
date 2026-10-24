// Engine ↔ chat contract: every Assessment the engine can produce must survive the assistant's own pipeline.
// The fallback text (shown whenever a model reply is rejected) must always pass the number/citation guard, for all
// 94 cases and for random records. Uses @kerimku1's modules read-only (src/app/api/assistant/*).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assess } from "@/domain/diagnosis";
import { normalizeRecord } from "@/domain/normalization/normalize";
import { PatientRecordSchema } from "@/domain/schema/record";
import { withIds } from "@/app/api/assistant/ids";
import { fallbackText } from "@/app/api/assistant/fallback";
import { guard } from "@/app/api/assistant/guard";

const DIR = resolve(__dirname, "../../assistant/cases");
const cases = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()
  .map((f) => JSON.parse(readFileSync(resolve(DIR, f), "utf8")) as { id: string; record: unknown });

function check(raw: unknown) {
  const record = PatientRecordSchema.parse(raw);
  const n = normalizeRecord(record);
  if (!n.ok) throw new Error("record does not normalize");
  const ided = withIds(assess(record));
  const text = fallbackText(ided);
  return { verdict: guard(text, ided, n.patient), text };
}

describe("engine output passes the assistant guard (fallback text)", () => {
  for (const c of cases) {
    it(c.id, () => {
      const { verdict, text } = check(c.record);
      expect(verdict, text).toEqual({ ok: true });
    });
  }
});
