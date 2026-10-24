// Writes the generated scalar-field table into docs/medical-data-dictionary.md (between markers).
//   npx tsx scripts/generate-data-dictionary.ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FIELDS } from "@/domain/schema/fields";
import { CSV_VALVE_COLUMNS } from "@/domain/import/csv";

const p = resolve(import.meta.dirname, "../docs/medical-data-dictionary.md");
const rows = FIELDS.map((f) => `| \`${f.path}\` | ${f.label} | ${f.canonicalUnit} | ${Object.keys(f.units).map((u) => `\`${u}\``).join(", ")} | ${f.impossible.exclusiveMin ? ">" : "≥"} ${f.impossible.min ?? "—"} … ≤ ${f.impossible.max ?? "—"} | \`${f.csvColumn ?? "—"}\` | ${f.rendering.replace("_", " ")} | ${f.description} |`);
const table = ["| JSON path | Field | Canonical unit | Accepted units (case-insensitive) | Impossible-input guard | CSV column | Rendering | Notes |", "|---|---|---|---|---|---|---|---|", ...rows].join("\n");
const valves = CSV_VALVE_COLUMNS.map((c) => `\`${c}\``).join(", ");
const doc = readFileSync(p, "utf8");
const out = doc
  .replace(/<!-- FIELDS:BEGIN -->[\s\S]*<!-- FIELDS:END -->/, `<!-- FIELDS:BEGIN -->\n${table}\n<!-- FIELDS:END -->`)
  .replace(/<!-- VALVES:BEGIN -->[\s\S]*<!-- VALVES:END -->/, `<!-- VALVES:BEGIN -->\n${valves}\n<!-- VALVES:END -->`);
writeFileSync(p, out);
console.log("data dictionary table updated");
