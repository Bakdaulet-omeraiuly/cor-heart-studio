"use client";
// Patient / subject context, shown once in the app bar (not repeated per viewport).
import { patientTitle } from "@/lib/patients";
import { getHeartAssetSpec } from "@/scene/asset-adapters/registry";
import { useApp } from "@/state/store";
import { BRAIN_SUBJECTS } from "@/brain/useBrainData";

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-faint">{label}</span>
      <span className={`truncate text-[12px] text-ink ${mono ? "num" : ""}`}>{value}</span>
    </span>
  );
}

function TierPill({ tier, title }: { tier: "A" | "B"; title: string }) {
  return (
    <span title={title} className={`shrink-0 rounded border px-1.5 py-px text-[10px] font-medium uppercase tracking-wider ${tier === "B" ? "border-ok/50 text-ok" : "border-line-strong text-muted"}`}>
      Tier {tier}
    </span>
  );
}

export function ContextBar() {
  const organ = useApp((s) => s.module);
  const entry = useApp((s) => (s.selectedKey ? s.entries[s.selectedKey] : null));

  if (organ === "brain") {
    return (
      <div className="flex min-w-0 items-center gap-4" data-testid="context-bar">
        <span className="truncate text-[13px] font-medium">Healthy volunteer · {BRAIN_SUBJECTS[0].id}</span>
        <Field label="Modality" value="MRI T1" />
        <Field label="Source" value="Mindboggle-101" />
        <TierPill tier="B" title="Shape built from this subject's MRI segmentation" />
      </div>
    );
  }
  if (!entry) return <span className="text-[12px] text-faint" data-testid="context-bar">No patient selected</span>;
  const p = entry.patient;
  const spec = getHeartAssetSpec(entry.assetId);
  const demo = p.record.demographics;
  const age = demo?.age?.value != null ? `${demo.age.value} ${demo.age.unit === "years" ? "y" : demo.age.unit}` : null;
  return (
    <div className="flex min-w-0 items-center gap-4" data-testid="context-bar">
      <span className="truncate text-[13px] font-medium">{patientTitle(p)}</span>
      <span className="hidden min-w-0 items-center gap-4 xl:flex">
        <Field label="ID" value={p.patientId} mono />
        <Field label="Study" value={`${p.studyId}${p.studyDate ? ` · ${p.studyDate}` : ""}`} mono />
      </span>
      {(age || demo?.biologicalSex) && <span className="hidden lg:flex"><Field label="Age/Sex" value={[age, demo?.biologicalSex].filter(Boolean).join(" · ")} /></span>}
      <span className="hidden md:flex"><Field label="Geometry" value={spec.tier === "B" ? "CT segmentation" : "Template"} /></span>
      <TierPill tier={spec.tier} title={spec.geometrySource} />
      {p.synthetic && <span className="shrink-0 text-[10px] uppercase tracking-wider text-info">Synthetic</span>}
    </div>
  );
}
