// Prints the treatment evidence as a markdown table for docs/outlook.md.
//   npx tsx scripts/evidence-table.ts
import { EVIDENCE } from "@/domain/treatments/load";

const rows = EVIDENCE.entries.map((e) => {
  const effect = e.effect ? `${e.effect.likely} (best ${e.effect.best}, worst ${e.effect.worst}) ${e.effect.quantity === "lvmi_gm2" ? "g/m² LVMI" : "% hippocampus"} over ${e.effect.evidenceYears} y` : "no effect on the model";
  const src = e.sources.map((id) => { const s = EVIDENCE.sources[id]; return `[${s.cite}](https://doi.org/${s.doi}) (${s.studyType}, n=${s.n})`; }).join("; ");
  return `| \`${e.id}\` | ${e.kind} | ${e.label} | ${effect} | ${src} |`;
});
console.log(["| Id | Kind | Label | Change | Sources |", "|---|---|---|---|---|", ...rows].join("\n"));
