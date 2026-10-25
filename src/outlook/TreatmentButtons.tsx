"use client";
// Treatment buttons for one condition. A button is a toggle; its evidence sits behind the ⓘ (one line on screen).
import { ExternalLink } from "lucide-react";
import { Button, InfoTip } from "@/components/ui/primitives";
import { entriesFor, sourceById } from "@/domain/treatments/load";
import type { ConditionId, EvidenceEntry } from "@/domain/treatments/types";
import { useOutlook } from "./outlookStore";

const STUDY_LABEL = { rct: "randomised trial", "meta-analysis": "meta-analysis", "placebo-arm": "placebo arm", "prospective-cohort": "prospective cohort", observational: "observational", guideline: "guideline" } as const;

function EntryDetails({ entry }: { entry: EvidenceEntry }) {
  return (
    <span className="block max-w-[17rem] space-y-1.5">
      <span className="block text-ink">{entry.why}</span>
      {!entry.effect && <span className="block text-warn">No measured effect on the 3D model.</span>}
      <span className="block">{entry.caveat}</span>
      <span className="block space-y-0.5">
        {entry.sources.map((id) => {
          const s = sourceById(id);
          return (
            <a key={id} href={`https://doi.org/${s.doi}`} target="_blank" rel="noreferrer" className="flex items-start gap-1 text-ink hover:text-accent">
              <span>{s.cite} · {STUDY_LABEL[s.studyType]}, n = {s.n}</span>
              <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            </a>
          );
        })}
      </span>
    </span>
  );
}

export function TreatmentButtons({ condition }: { condition: ConditionId }) {
  const active = useOutlook((s) => s.active);
  const toggle = useOutlook((s) => s.toggle);
  const entries = entriesFor(condition, "treatment");
  if (!entries.length) return null;
  return (
    <div className="relative flex flex-wrap gap-1.5" role="group" aria-label="Treatment options" data-testid="treatment-buttons">
      {entries.map((e) => (
        <span key={e.id} className="inline-flex items-center gap-0.5">
          <Button size="sm" pressed={active.includes(e.id)} aria-pressed={active.includes(e.id)} data-testid={`treatment-${e.id}`} onClick={() => toggle(e.id)}>
            {e.label}
          </Button>
          <InfoTip label={`Evidence for ${e.label}`} side="bottom" anchor="container"><EntryDetails entry={e} /></InfoTip>
        </span>
      ))}
    </div>
  );
}
