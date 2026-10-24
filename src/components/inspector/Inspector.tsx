"use client";
import { CAD_RADS_TEXT, VESSEL_LABEL, stenosisCategory } from "@/domain/coronary";
import type { CameraPreset } from "@/state/store";

/** Camera preset that shows each vessel's course on the template (right-dominant pattern). */
const LESION_VIEW: Record<"LM" | "LAD" | "LAD_DISTAL" | "LCx" | "RCA" | "PDA", CameraPreset> = {
  LM: "superior", LAD: "superior", LAD_DISTAL: "left_lateral", LCx: "left_lateral", RCA: "anterior", PDA: "inferior",
};
import { Fragment, useMemo } from "react";
import { AlertTriangle, Ban, Crosshair, Download, Info, X } from "lucide-react";
import { FIELDS, type FieldCategory } from "@/domain/schema/fields";
import { STRUCTURE_LABEL, type StructureId, type VisualChange } from "@/domain/mapping/types";
import { AHA_SEGMENT_NAMES } from "@/domain/mapping/mapPatientToVisual";
import { interpretationSummary } from "@/domain/provenance/summary";
import { EVIDENCE_LABEL, type EvidenceClass, type Issue, type NormalizedObservation } from "@/domain/types";
import { patientTitle, type PatientEntry } from "@/lib/patients";
import { useApp, type InspectorTab } from "@/state/store";
import { EvidenceBadge, IconButton, Pill, SectionTitle, cx, download } from "../ui/primitives";
import { getHeartAssetSpec } from "@/scene/asset-adapters/registry";
import { EcgWaveform } from "./EcgWaveform";

const CATEGORY_LABEL: Record<FieldCategory, string> = {
  vitals: "Vital signs", demographics: "Patient information", ecg: "ECG", echo_dimensions: "Echo — chamber dimensions", echo_function: "Echo — function", hemodynamics: "Hemodynamics",
  brain_imaging: "Brain MRI — volume change",
};
const TABS: { id: InspectorTab; label: string }[] = [
  { id: "observations", label: "Observations" },
  { id: "changes", label: "Visual changes" },
  { id: "evidence", label: "Evidence" },
  { id: "warnings", label: "Warnings" },
];

const fmt = (v: unknown) => (typeof v === "number" ? (Math.round(v * 100) / 100).toString() : v === null || v === undefined ? "—" : String(v));

export function Inspector() {
  const s = useApp();
  const entry = s.selectedKey ? s.entries[s.selectedKey] : null;
  if (!entry) return <aside aria-label="Inspector" className="p-4 text-[13px] text-muted">Select a patient to inspect observations and visual mappings.</aside>;
  const warnCount = entry.patient.issues.filter((i) => i.severity !== "info").length + entry.visual.issues.length + entry.visual.unsupported.length;
  return (
    <aside aria-label="Inspector" className="flex h-full min-h-0 flex-col">
      <Header entry={entry} />
      <div role="tablist" aria-label="Inspector sections" className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line px-3">
        {TABS.map((t) => (
          <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={s.inspectorTab === t.id} aria-controls={`panel-${t.id}`}
            onClick={() => s.set({ inspectorTab: t.id })}
            className={cx("-mb-px whitespace-nowrap border-b-2 px-2 py-2 text-[12px] font-medium transition-colors", s.inspectorTab === t.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}>
            {t.label}{t.id === "changes" && <span className="num ml-1 text-faint">{entry.visual.changes.length}</span>}
            {t.id === "warnings" && warnCount > 0 && <span className="num ml-1 text-warn">{warnCount}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${s.inspectorTab}`} aria-labelledby={`tab-${s.inspectorTab}`} className="min-h-0 flex-1 overflow-y-auto p-3 scroll-thin">
        {s.selectedStructure && <StructurePanel entry={entry} id={s.selectedStructure} segment={s.selectedSegment} />}
        {s.inspectorTab === "observations" && <Observations entry={entry} />}
        {s.inspectorTab === "changes" && <Changes entry={entry} />}
        {s.inspectorTab === "evidence" && <Evidence entry={entry} />}
        {s.inspectorTab === "warnings" && <Warnings entry={entry} />}
      </div>
    </aside>
  );
}

function Header({ entry }: { entry: PatientEntry }) {
  const p = entry.patient;
  const summary = useMemo(() => interpretationSummary(p, entry.visual), [p, entry.visual]);
  return (
    <div className="border-b border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold">{patientTitle(p)}</h2>
          <p className="num truncate text-[11px] text-faint" title={`patientId ${p.patientId} · studyId ${p.studyId}`}>{p.patientId} · {p.studyId}{p.studyDate ? ` · ${p.studyDate}` : ""}</p>
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton label="Download normalized JSON" onClick={() => download(`${p.patientId}_${p.studyId}.normalized.json`, JSON.stringify({ original: p.original, normalized: { observations: p.observations, derived: p.derived, valveFindings: p.valveFindings, coronaryFindings: p.coronaryFindings, wallMotion: p.wallMotion, wallThickness: p.wallThickness, issues: p.issues }, visual: entry.visual }, null, 2))}>
            <Download className="h-4 w-4" />
          </IconButton>
          <IconButton label="Close inspector" onClick={() => useApp.getState().set({ inspectorOpen: false })}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
      {p.synthetic && <p className="mt-1 text-[11px] text-info">Synthetic demonstration record.</p>}
      <details className="mt-2 text-[12px] text-muted">
        <summary className="cursor-pointer select-none font-medium text-ink">Interpretation summary <span className="font-normal text-faint">(describes data, does not diagnose)</span></summary>
        <ul className="mt-1.5 list-disc space-y-1 pl-4">{summary.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </details>
    </div>
  );
}

function StructurePanel({ entry, id, segment }: { entry: PatientEntry; id: StructureId; segment: number | null }) {
  const set = useApp((s) => s.selectStructure);
  const st = entry.visual.structureStatus[id];
  const changes = entry.visual.changes.filter((c) => c.target === id && (!segment || !c.segments || c.segments.includes(segment)));
  const unknown = entry.visual.unknowns.filter((u) => u.structure === id);
  return (
    <section aria-label={`Selected structure ${STRUCTURE_LABEL[id]}`} className="mb-3 rounded-xl border border-accent/50 bg-accent/5 p-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><Crosshair className="h-3.5 w-3.5 text-accent" />{STRUCTURE_LABEL[id]}{segment ? ` · segment ${segment} (${AHA_SEGMENT_NAMES[segment - 1]})` : ""}</h3>
        <IconButton label="Clear selection" className="h-6 w-6" onClick={() => set(null)}><X className="h-3.5 w-3.5" /></IconButton>
      </div>
      <p className="mt-1 text-[12px] text-muted">Status: <b className="text-ink">{st.status.replace(/_/g, " ")}</b></p>
      {changes.length > 0 ? (
        <ul className="mt-2 space-y-1.5">{changes.map((c) => <li key={c.id} className="text-[12px]"><b>{c.property}:</b> {c.summary} <span className="text-faint">← {c.sources.map((x) => x.path).join(", ")}</span></li>)}</ul>
      ) : <p className="mt-1 text-[12px] text-muted">No supplied input changes this structure.</p>}
      {unknown.map((u, i) => <p key={i} className="mt-1 text-[12px] text-faint">? {u.message}</p>)}
    </section>
  );
}

function ObsRow({ o }: { o: NormalizedObservation }) {
  const usable = o.status === "ok";
  const converted = usable && o.original.unit && o.original.unit !== o.unit;
  return (
    <tr className="border-b border-line/60 align-top last:border-0">
      <th scope="row" className="py-1.5 pr-2 text-left text-[12px] font-normal text-muted">{o.label}</th>
      <td className="py-1.5 text-right">
        {o.value === null && o.status === "null" ? <span className="text-faint">unknown</span> : (
          <span className={cx("num text-[13px]", !usable && "text-warn line-through decoration-1")}>{fmt(usable ? o.value : o.original.value)} <span className="text-[11px] text-faint">{usable ? o.unit : o.original.unit ?? "no unit"}</span></span>
        )}
        {converted && <div className="num text-[10px] text-faint">from {fmt(o.original.value)} {o.original.unit}</div>}
        {!usable && o.status !== "null" && <div className="text-[10px] text-warn">{o.statusMessage}</div>}
        {(o.source || o.method || o.phase || o.observedAt) && (
          <div className="text-[10px] text-faint">{[o.source, o.method, o.phase, o.observedAt, o.location].filter(Boolean).join(" · ")}</div>
        )}
      </td>
      <td className="py-1.5 pl-2 text-right"><span className={cx("text-[10px]", o.rendering === "display_only" ? "text-faint" : "text-info")} title={o.rendering === "display_only" ? "Displayed only — does not change geometry" : "May drive the visualization"}>{o.rendering === "display_only" ? "display" : o.rendering === "drives_timing" ? "timing" : "geometry"}</span></td>
    </tr>
  );
}

function Observations({ entry }: { entry: PatientEntry }) {
  const p = entry.patient;
  const r = p.record;
  const requestCamera = useApp((st) => st.requestCamera);
  const byCat = new Map<FieldCategory, NormalizedObservation[]>();
  for (const f of FIELDS) {
    const o = p.observations[f.path];
    if (!o) continue;
    byCat.set(f.category, [...(byCat.get(f.category) ?? []), o]);
  }
  return (
    <div>
      {r.diagnoses?.length ? (
        <>
          <SectionTitle>Diagnoses (as supplied)</SectionTitle>
          <ul className="space-y-1 text-[13px]">{r.diagnoses.map((d, i) => <li key={i} className="flex items-start justify-between gap-2"><span>{d.text}</span><EvidenceBadge evidence="reported_assessment" compact /></li>)}</ul>
          {r.diagnoses.some((d) => d.source) && <p className="mt-1 text-[11px] text-faint">Source: {[...new Set(r.diagnoses.map((d) => d.source).filter(Boolean))].join("; ")}</p>}
        </>
      ) : null}
      {[...byCat.entries()].map(([cat, obs]) => (
        <section key={cat}>
          <SectionTitle>{CATEGORY_LABEL[cat]}</SectionTitle>
          <table className="w-full"><tbody>{obs.map((o) => <ObsRow key={o.path} o={o} />)}</tbody></table>
        </section>
      ))}
      {p.derived.length > 0 && (
        <section>
          <SectionTitle>Derived</SectionTitle>
          <ul className="space-y-1.5">{p.derived.map((d) => (
            <li key={d.id} className="text-[12px]"><span className="flex justify-between gap-2"><span className="text-muted">{d.label}</span><span className="num text-[13px]">{d.value} <span className="text-faint">{d.unit}</span></span></span>
              <span className="flex items-center justify-between text-[10px] text-faint"><code>{d.formula}</code><EvidenceBadge evidence="derived" compact /></span>{d.note && <span className="text-[10px] text-warn">{d.note}</span>}</li>
          ))}</ul>
        </section>
      )}
      {p.valveFindings.length > 0 && (
        <section>
          <SectionTitle>Valve findings</SectionTitle>
          <ul className="space-y-1.5">{p.valveFindings.map((v, i) => (
            <li key={i} className="text-[12px]">
              <div className="flex justify-between gap-2"><span>{STRUCTURE_LABEL[v.valve]} — {v.condition}{v.severity ? ` (${v.severity.replace(/_/g, " ")})` : ""}</span><EvidenceBadge evidence="reported_assessment" compact /></div>
              {v.measurements.map((m) => <div key={m.label} className="num text-[11px] text-muted">{m.label}: {fmt(m.value)} {m.unit ?? <span className="text-warn">no unit</span>}</div>)}
              {(v.source || v.note) && <div className="text-[10px] text-faint">{[v.source, v.note].filter(Boolean).join(" · ")}</div>}
            </li>))}</ul>
        </section>
      )}
      {p.coronaryFindings.length > 0 && (
        <section data-testid="coronary-findings">
          <SectionTitle aside={entry.visual.coronary.cadRads && (
            <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[11px] font-medium text-warn" title={`CAD-RADS 2.0 (Cury et al. 2022): ${CAD_RADS_TEXT[entry.visual.coronary.cadRads]}. Most severe: ${entry.visual.coronary.driver}`}>
              CAD-RADS {entry.visual.coronary.cadRads}
            </span>
          )}>Coronary arteries</SectionTitle>
          <ul className="space-y-1.5">{p.coronaryFindings.map((c, i) => (
            <li key={i} className="text-[12px]">
              <div className="flex justify-between gap-2">
                <span>{VESSEL_LABEL[c.vessel]}{c.segment ? ` · ${c.segment}` : ""}</span>
                <span className="flex items-center gap-2">
                  <span className="num">{c.stenosisPercent}% <span className="text-faint">· {stenosisCategory(c.stenosisPercent)}</span></span>
                  {entry.visual.coronary.lesions.some((l) => l.vessel === c.vessel) && (
                    <button className="rounded border border-line px-1 text-[10px] text-muted hover:text-ink" title="Turn the 3D view toward this lesion" onClick={() => requestCamera(LESION_VIEW[c.vessel === "LAD" && c.segment !== "proximal" ? "LAD_DISTAL" : c.vessel])}>View</button>
                  )}
                </span>
              </div>
              <div className="flex justify-between text-[10px] text-faint"><span>{c.plaque ? c.plaque.replace(/_/g, " ") + " plaque" : "plaque type not reported"}{c.source ? ` · ${c.source}` : ""}</span><EvidenceBadge evidence="reported_measurement" compact /></div>
            </li>))}</ul>
          {entry.visual.coronary.cadRads && <p className="mt-1 text-[10px] text-faint">{CAD_RADS_TEXT[entry.visual.coronary.cadRads]} — CAD-RADS 2.0, most severe diameter stenosis per patient.</p>}
        </section>
      )}
      {(p.wallMotion.length > 0 || p.wallThickness.length > 0) && (
        <section>
          <SectionTitle>Regional findings (AHA 17-segment)</SectionTitle>
          <ul className="grid grid-cols-1 gap-1 text-[12px]">
            {p.wallMotion.filter((w) => w.motion !== "normal").map((w) => <li key={`m${w.segment}`} className="flex justify-between"><span>Segment {w.segment} · {AHA_SEGMENT_NAMES[w.segment - 1]}</span><span className="text-warn">{w.motion}</span></li>)}
            {p.wallMotion.length > 0 && p.wallMotion.every((w) => w.motion === "normal") && <li className="text-muted">All {p.wallMotion.length} reported segments: normal motion.</li>}
            {p.wallThickness.map((t, i) => <li key={`t${i}`} className="flex justify-between"><span>Wall thickness · {String(t.region)}</span><span className="num">{fmt(t.valueMm)} mm</span></li>)}
          </ul>
        </section>
      )}
      {r.ecg && (
        <section>
          <SectionTitle>ECG (text and supplied signals)</SectionTitle>
          {r.ecg.rhythm && <p className="text-[12px]">Rhythm: {r.ecg.rhythm}</p>}
          {r.ecg.stChanges?.map((st, i) => <p key={i} className="text-[12px] text-muted">ST: {st.description}{st.leads ? ` (${st.leads.join(", ")})` : ""}</p>)}
          {r.ecg.tWaveAbnormalities?.map((t, i) => <p key={i} className="text-[12px] text-muted">T wave: {t.description}{t.leads ? ` (${t.leads.join(", ")})` : ""}</p>)}
          {r.ecg.waveforms?.map((w, i) => <EcgWaveform key={i} waveform={w} />)}
          {!r.ecg.waveforms?.length && <p className="mt-1 text-[11px] text-faint">No waveform supplied — none is drawn. The cycle diagram in the player is a timing template, not an ECG.</p>}
        </section>
      )}
      <ContextLists entry={entry} />
    </div>
  );
}

function ContextLists({ entry }: { entry: PatientEntry }) {
  const r = entry.patient.record;
  const list = (title: string, items: (string | undefined)[] | undefined) => items && items.filter(Boolean).length > 0 && (
    <section><SectionTitle>{title}</SectionTitle><ul className="list-disc space-y-0.5 pl-4 text-[12px]">{items.filter(Boolean).map((x, i) => <li key={i}>{x}</li>)}</ul></section>
  );
  const ageStr = r.demographics?.age?.value != null ? `${r.demographics.age.value} ${r.demographics.age.unit}` : undefined;
  return (
    <>
      {r.demographics && list("Patient information", [ageStr && `Age: ${ageStr}`, r.demographics.biologicalSex && `Biological sex: ${r.demographics.biologicalSex}`])}
      {list("Symptoms", [...(r.symptoms ?? []), ...(r.symptomDetails ?? [])].map((x) => x.symptom + (x.present === false ? " (absent)" : "") + (x.onset ? ` · onset ${x.onset}` : "") + (x.duration ? ` · ${x.duration}` : "") + (x.description ? ` — ${x.description}` : "")))}
      {list("Medical history", r.history?.medical)}
      {list("Family cardiac history", r.history?.familyCardiac)}
      {list("Medications", r.medications?.map((m) => [m.name, m.dose, m.frequency].filter(Boolean).join(" ")))}
      {r.labs?.length ? (
        <section>
          <SectionTitle aside={<span className="text-[10px] text-faint">never deform the heart</span>}>Laboratory</SectionTitle>
          <table className="w-full text-[12px]"><tbody>{r.labs.map((l, i) => (
            <tr key={i} className="border-b border-line/60 last:border-0"><th scope="row" className="py-1 text-left font-normal text-muted">{l.analyte}</th><td className="num py-1 text-right">{fmt(l.value)} <span className="text-faint">{l.unit ?? "no unit"}</span></td><td className="py-1 pl-2 text-right text-[10px] text-faint">{l.collectedAt}</td></tr>
          ))}</tbody></table>
        </section>
      ) : null}
      {list("Doppler", r.doppler?.map((d) => `${d.measurement}: ${fmt(d.value)} ${d.unit ?? ""}${d.sampleLocation ? ` @ ${d.sampleLocation}` : ""}${d.referenceDirection ? ` (${d.referenceDirection})` : ""}`))}
      {list("CT / MRI findings", r.imaging?.findings?.map((f) => `${f.modality}: ${f.finding}${f.value != null ? ` — ${f.value}${f.unit ? ` ${f.unit}` : ""}` : ""}${f.segment ? ` (segment ${f.segment})` : f.location ? ` (${f.location})` : ""}`))}
      {list("Imaging attachments (reference only — not reconstructed)", r.imaging?.assets?.map((a) => `${a.kind}: ${a.reference}${a.format ? ` · ${a.format}` : ""}`))}
      {list("Additional investigations", r.additionalInvestigations?.map((x) => `${x.type.replace(/_/g, " ")}: ${x.summary}`))}
      {r.clinicalConclusion && list("Clinical conclusion (attributed, as supplied)", [r.clinicalConclusion.interpretation, r.clinicalConclusion.recommendedFollowUp && `Follow-up (as supplied): ${r.clinicalConclusion.recommendedFollowUp}`, r.clinicalConclusion.author && `— ${r.clinicalConclusion.author}`])}
      {r.clinicianNotes && <section><SectionTitle>Clinician notes</SectionTitle><p className="whitespace-pre-wrap text-[12px] text-muted">{r.clinicianNotes}</p></section>}
    </>
  );
}

function ChangeCard({ c }: { c: VisualChange }) {
  const s = useApp();
  const focused = s.focusChangeId === c.id;
  return (
    <li className={cx("rounded-xl border p-2.5", focused ? "border-accent" : "border-line")}>
      <button className="w-full text-left" onClick={() => { s.selectStructure(c.target, c.segments?.length === 1 ? c.segments[0] : null); s.set({ focusChangeId: c.id, inspectorTab: "changes" }); }}>
        <div className="flex items-start justify-between gap-2">
          <span className="text-[12px] font-semibold">{STRUCTURE_LABEL[c.target]} · {c.property}</span>
          <EvidenceBadge evidence={c.evidence} compact />
        </div>
        <p className="mt-1 text-[12px]">{c.summary}</p>
      </button>
      <dl className="mt-1.5 grid grid-cols-[70px_1fr] gap-x-2 gap-y-0.5 text-[11px]">
        <dt className="text-faint">Inputs</dt>
        <dd className="num">{c.sources.map((x) => `${x.path} = ${fmt(x.originalValue)}${x.originalUnit ? ` ${x.originalUnit}` : ""}${x.normalizedUnit && x.normalizedUnit !== x.originalUnit ? ` → ${fmt(x.normalizedValue)} ${x.normalizedUnit}` : ""}`).join("; ")}</dd>
        <dt className="text-faint">Rule</dt><dd className="num">{c.ruleId} v{c.ruleVersion}</dd>
        <dt className="text-faint">Result</dt><dd>{c.nature}</dd>
        {c.formula && <><dt className="text-faint">Formula</dt><dd className="num">{c.formula}</dd></>}
        {c.displayAdjustment && <><dt className="text-warn">Display</dt><dd className="text-warn">{c.displayAdjustment}</dd></>}
        {c.conflicts.map((x, i) => <Fragment key={i}><dt className="text-warn">Conflict</dt><dd className="text-warn">{x}</dd></Fragment>)}
        {c.limitations.length > 0 && <><dt className="text-faint">Limits</dt><dd className="text-muted">{c.limitations.join(" ")}</dd></>}
      </dl>
    </li>
  );
}

function Changes({ entry }: { entry: PatientEntry }) {
  const v = entry.visual;
  return (
    <div>
      {v.changes.length === 0 && <p className="text-[13px] text-muted">No supplied observation changes the rendered anatomy. Timing and shape are defaults (see Evidence).</p>}
      <ul className="space-y-2">{v.changes.map((c) => <ChangeCard key={c.id} c={c} />)}</ul>
    </div>
  );
}

function Evidence({ entry }: { entry: PatientEntry }) {
  const v = entry.visual;
  const spec = getHeartAssetSpec(entry.assetId);
  const classes: EvidenceClass[] = ["reported_measurement", "reported_assessment", "derived", "illustrative_inference", "default_unknown"];
  return (
    <div className="text-[12px]">
      <SectionTitle>Evidence classes</SectionTitle>
      <ul className="space-y-1">
        {classes.map((c) => <li key={c} className="flex items-center gap-2"><EvidenceBadge evidence={c} /><span className="text-muted">{({
          reported_measurement: "Number supplied in the record; not independently verified.",
          reported_assessment: "Diagnosis or qualitative finding as supplied.",
          derived: "Deterministic calculation from supplied values (formula shown).",
          illustrative_inference: "Chosen shape or motion not directly measured.",
          default_unknown: "Baseline used because data is absent — unknown, not normal.",
        } as Record<EvidenceClass, string>)[c]}</span></li>)}
      </ul>
      <SectionTitle>Shown as unknown / default</SectionTitle>
      {v.unknowns.length ? <ul className="space-y-1">{v.unknowns.map((u, i) => <li key={i} className="flex gap-2"><EvidenceBadge evidence="default_unknown" compact /><span>{u.message}</span></li>)}</ul> : <p className="text-muted">Nothing.</p>}
      <SectionTitle>Always illustrative</SectionTitle>
      <ul className="list-disc space-y-1 pl-4 text-muted">
        {spec.tier === "B"
          ? <li>Walls other than the LV (fixed thickness), papillary muscles, coronary ostia and the cardiac phase of the scan. The chamber and great-artery shapes come from the CT segmentation.</li>
          : <li>The full 3D shape is a template ({spec.geometrySource}): only measured dimensions are data-driven; everything else comes from the template, not from this patient.</li>}
        <li>Contraction waveform, torsion and the longitudinal/radial split of shortening.</li>
        <li>Valve opening fractions for qualitative severities; leaflet shapes.</li>
        <li>Flow particles and reverse-flow cues (not measured flow, velocity, pressure or oxygenation).</li>
        <li>{spec.manifest.structureToMesh?.coronary_vessels && "absent" in spec.manifest.structureToMesh.coronary_vessels
          ? "Surface tissue texture. No coronary vessels, venae cavae or pulmonary veins (not in the source data)."
          : "Surface tissue texture, fat distribution and coronary course (one common pattern)."}</li>
      </ul>
      <SectionTitle>Provenance tier & versions</SectionTitle>
      <dl className="grid grid-cols-[120px_1fr] gap-y-0.5 text-[11px]">
        <dt className="text-faint">Tier</dt><dd>{spec.tier === "B" ? `B — ${spec.geometrySource}` : `A — template, not this patient's imaging (${spec.geometrySource})`}</dd>
        {spec.manifest.license && spec.id !== "cor-procedural-heart" && <><dt className="text-faint">Data</dt><dd>{spec.manifest.attribution} · {spec.manifest.license}</dd></>}
        <dt className="text-faint">Mapping</dt><dd className="num">v{v.mappingVersion}</dd>
        <dt className="text-faint">Asset</dt><dd className="num">{v.assetId} v{v.assetVersion}</dd>
        <dt className="text-faint">Reference</dt><dd className="num">{v.referenceProfileId}</dd>
        <dt className="text-faint">Input hash</dt><dd className="num">{v.inputHash}</dd>
        <dt className="text-faint">Classification</dt><dd>None — no sourced clinical thresholds configured</dd>
      </dl>
      <p className="mt-3 text-[11px] text-faint">{EVIDENCE_LABEL.reported_measurement} values are as supplied. This tool is a visualization demo, not a medical device.</p>
    </div>
  );
}

function IssueItem({ i }: { i: Issue }) {
  const Icon = i.severity === "error" ? Ban : i.severity === "warning" ? AlertTriangle : Info;
  return (
    <li className="flex gap-2 text-[12px]">
      <Icon className={cx("mt-0.5 h-3.5 w-3.5 shrink-0", i.severity === "error" ? "text-error" : i.severity === "warning" ? "text-warn" : "text-info")} aria-label={i.severity} />
      <span><span className="num text-[10px] text-faint">{i.path}</span> {i.message}{i.suggestion && <span className="block text-[11px] text-muted">→ {i.suggestion}</span>}</span>
    </li>
  );
}

function Warnings({ entry }: { entry: PatientEntry }) {
  const p = entry.patient, v = entry.visual;
  const ignored = Object.values(p.observations).filter((o) => o.status !== "ok" && o.status !== "null");
  return (
    <div>
      <SectionTitle>Validation & mapping warnings</SectionTitle>
      {[...p.issues.filter((i) => i.severity !== "info"), ...v.issues].length ? <ul className="space-y-1.5">{[...p.issues.filter((i) => i.severity !== "info"), ...v.issues].map((i, k) => <IssueItem key={k} i={i} />)}</ul> : <p className="text-[12px] text-muted">None.</p>}
      <SectionTitle>Unsupported findings (displayed, not rendered)</SectionTitle>
      {v.unsupported.length ? <ul className="space-y-1 text-[12px]">{v.unsupported.map((u, i) => <li key={i}><b>{u.label}</b> — <span className="text-muted">{u.reason}</span></li>)}</ul> : <p className="text-[12px] text-muted">None.</p>}
      <SectionTitle>Ignored observations (kept, not used)</SectionTitle>
      {ignored.length ? <ul className="space-y-1 text-[12px]">{ignored.map((o) => <li key={o.path}><b>{o.label}</b> = {fmt(o.original.value)} {o.original.unit ?? ""} — <span className="text-warn">{o.statusMessage}</span></li>)}</ul> : <p className="text-[12px] text-muted">None.</p>}
      <SectionTitle>Notes</SectionTitle>
      <ul className="space-y-1.5">{p.issues.filter((i) => i.severity === "info").map((i, k) => <IssueItem key={k} i={i} />)}</ul>
      <p className="mt-3 text-[11px] text-faint">Display-only inputs (blood pressure, labs, ECG intervals, symptoms, notes) are shown in Observations and never change the anatomy.</p>
      <Pill tone="neutral">Mapping v{v.mappingVersion}</Pill>
    </div>
  );
}
