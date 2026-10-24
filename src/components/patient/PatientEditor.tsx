"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, Ban } from "lucide-react";
import { FIELDS, FIELD_BY_PATH } from "@/domain/schema/fields";
import { SEVERITIES, VALVE_IDS, WALL_MOTION } from "@/domain/schema/record";
import { normalizeRecord } from "@/domain/normalization/normalize";
import { AHA_SEGMENT_NAMES } from "@/domain/mapping/mapPatientToVisual";
import { STRUCTURE_LABEL } from "@/domain/mapping/types";
import { entryFromNormalized } from "@/lib/patients";
import { useApp } from "@/state/store";
import { Modal } from "../ui/Modal";
import { Button, Segmented, SectionTitle, cx } from "../ui/primitives";

type Rec = Record<string, unknown>;
const FORM_FIELDS = [
  "observations.heartRate", "observations.systolicBP", "observations.diastolicBP", "observations.spo2",
  "observations.lvEndDiastolicDiameter", "observations.lvEndDiastolicVolume", "observations.lvEndSystolicVolume", "observations.lvEjectionFraction",
  "observations.ivsThickness", "observations.lvPosteriorWallThickness", "observations.laVolume", "observations.rvBasalDiameter",
  "observations.raMinorDimension", "observations.rvEjectionFraction",
];

const get = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Rec)[k] : undefined), o);
function setIn(o: Rec, path: string, v: unknown): Rec {
  const [k, ...rest] = path.split(".");
  const copy = { ...o };
  if (!rest.length) { if (v === undefined) delete copy[k]; else copy[k] = v; return copy; }
  copy[k] = setIn((o[k] as Rec) ?? {}, rest.join("."), v);
  return copy;
}

const input = "h-8 w-full rounded-lg border border-line bg-panel-2 px-2 text-[13px]";

export function PatientEditor({ editKey }: { editKey: string | null }) {
  const s = useApp();
  const existing = editKey ? s.entries[editKey] : null;
  const [rec, setRec] = useState<Rec>(() => (existing ? structuredClone(existing.patient.original as Rec) : { patientId: "", studyId: "", synthetic: true, observations: {} }));
  const [mode, setMode] = useState<"form" | "json">("form");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const close = () => s.set({ dialog: null });

  const result = useMemo(() => normalizeRecord(rec), [rec]);
  const issues = result.ok ? result.patient.issues.filter((i) => i.severity !== "info") : result.issues;
  const keyChanged = existing && result.ok && result.patient.key !== existing.key;
  const collides = result.ok && result.patient.key !== editKey && !!s.entries[result.patient.key];

  const switchMode = (m: "form" | "json") => {
    if (m === "json") { setJsonText(JSON.stringify(rec, null, 2)); setJsonError(null); }
    else {
      try { setRec(JSON.parse(jsonText)); setJsonError(null); } catch (e) { setJsonError((e as Error).message); return; }
    }
    setMode(m);
  };

  const save = () => {
    let r = rec;
    if (mode === "json") { try { r = JSON.parse(jsonText); } catch (e) { setJsonError((e as Error).message); return; } }
    const n = normalizeRecord(r);
    if (!n.ok) { setRec(r); return; }
    const entry = entryFromNormalized(n.patient, existing?.origin ?? "manual", existing?.addedAt ?? Date.now());
    s.upsertEntries([entry]);
    s.select(entry.key);
    close();
  };

  const obs = (path: string) => get(rec, path) as { value: number | null; unit?: string; source?: string } | undefined;
  const setObs = (path: string, patch: { value?: string; unit?: string }) => {
    const def = FIELD_BY_PATH.get(path)!;
    const cur = obs(path);
    const valueStr = patch.value ?? (cur?.value === null ? "" : String(cur?.value ?? ""));
    if (valueStr.trim() === "" && patch.value !== undefined) { setRec(setIn(rec, path, undefined)); return; }
    const value = Number(valueStr);
    setRec(setIn(rec, path, { ...(cur ?? { source: "manual entry" }), value: Number.isFinite(value) ? value : null, unit: patch.unit ?? cur?.unit ?? def.canonicalUnit }));
  };
  const valves = (get(rec, "valveFindings") as Rec[] | undefined) ?? [];
  const valveVal = (v: string, c: string) => valves.find((f) => f.valve === v && f.condition === c);
  const setValve = (v: string, c: string, severity: string | boolean) => {
    const others = valves.filter((f) => !(f.valve === v && f.condition === c));
    const next = severity === "" || severity === false ? others : [...others, { valve: v, condition: c, ...(c === "prolapse" ? {} : { severity }), source: "manual entry" }];
    setRec(setIn(rec, "valveFindings", next.length ? next : undefined));
  };
  const wm = (get(rec, "echo.regionalWallMotion") as { segment: number; motion: string }[] | undefined) ?? [];
  const setWm = (seg: number, motion: string) => {
    const next = wm.filter((w) => w.segment !== seg);
    if (motion) next.push({ segment: seg, motion });
    next.sort((a, b) => a.segment - b.segment);
    setRec(setIn(rec, "echo.regionalWallMotion", next.length ? next : undefined));
  };
  const diagnoses = ((get(rec, "diagnoses") as (string | { text: string; source?: string })[] | undefined) ?? []).map((d) => (typeof d === "string" ? d : d.source ? `${d.text} | ${d.source}` : d.text)).join("\n");

  return (
    <Modal title={existing ? `Edit ${existing.patient.patientId} · ${existing.patient.studyId}` : "New patient record"} onClose={close} wide footer={
      <>
        <span className="mr-auto text-[12px] text-muted">{result.ok ? (issues.length ? `${issues.length} warning(s) — record can still be saved` : "Valid record") : "Fix the errors to save"}</span>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!result.ok && mode === "form"} onClick={save} data-testid="save-record">{collides ? "Replace existing record" : "Save record"}</Button>
      </>
    }>
      <div className="mb-3 flex items-center justify-between">
        <Segmented<"form" | "json"> label="Editor mode" value={mode} onChange={switchMode} options={[{ value: "form", label: "Form" }, { value: "json", label: "Full JSON (all namespaces)" }]} />
        <p className="text-[11px] text-faint">Unknown values: leave empty (never 0). Data stays in this tab.</p>
      </div>
      {mode === "json" ? (
        <div>
          <textarea aria-label="Record JSON" value={jsonText} onChange={(e) => setJsonText(e.target.value)} spellCheck={false} className="num h-[52dvh] w-full rounded-lg border border-line bg-panel-2 p-2 text-[12px]" />
          {jsonError && <p className="mt-1 text-[12px] text-error">JSON syntax error: {jsonError}</p>}
        </div>
      ) : (
        <div className="grid gap-x-6 md:grid-cols-2">
          <section>
            <SectionTitle>Identity</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[12px] text-muted">patientId *<input className={input} value={String(rec.patientId ?? "")} onChange={(e) => setRec({ ...rec, patientId: e.target.value })} /></label>
              <label className="text-[12px] text-muted">studyId *<input className={input} value={String(rec.studyId ?? "")} onChange={(e) => setRec({ ...rec, studyId: e.target.value })} /></label>
              <label className="text-[12px] text-muted">Display name<input className={input} value={String(rec.displayName ?? "")} onChange={(e) => setRec(setIn(rec, "displayName", e.target.value || undefined))} /></label>
              <label className="text-[12px] text-muted">Study date<input type="date" className={input} value={String(rec.studyDate ?? "")} onChange={(e) => setRec(setIn(rec, "studyDate", e.target.value || undefined))} /></label>
            </div>
            <label className="mt-2 flex items-center gap-2 text-[12px]"><input type="checkbox" checked={rec.synthetic === true} onChange={(e) => setRec({ ...rec, synthetic: e.target.checked })} /> Synthetic / fictional record</label>
            {keyChanged && <p className="mt-1 text-[11px] text-warn">Changing patientId/studyId saves a separate record; the original stays in the session.</p>}
            {collides && <p className="mt-1 text-[11px] text-warn">A record with this (patientId, studyId) already exists and will be replaced.</p>}
            <SectionTitle>Diagnoses</SectionTitle>
            <textarea aria-label="Diagnoses, one per line, optional source after |" className="h-16 w-full rounded-lg border border-line bg-panel-2 p-2 text-[13px]" placeholder="Dilated cardiomyopathy | clinician assessment" defaultValue={diagnoses}
              onBlur={(e) => setRec(setIn(rec, "diagnoses", e.target.value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [text, source] = l.split("|").map((x) => x.trim()); return source ? { text, source } : { text }; })))} />
            <SectionTitle>Measurements</SectionTitle>
            <div className="space-y-1.5">
              {FORM_FIELDS.map((path) => {
                const def = FIELDS.find((f) => f.path === path)!;
                const o = obs(path);
                const issue = issues.find((i) => i.path === path);
                return (
                  <div key={path} className="grid grid-cols-[1fr_88px_84px] items-center gap-1.5">
                    <label htmlFor={`f-${path}`} className="text-[12px] text-muted" title={def.description}>{def.label} <span className="text-faint">({def.short})</span></label>
                    <input id={`f-${path}`} inputMode="decimal" className={cx(input, "num text-right", issue && "border-warn")} value={o?.value ?? ""} placeholder="unknown"
                      onChange={(e) => setObs(path, { value: e.target.value })} />
                    <select aria-label={`${def.label} unit`} className={input} value={o?.unit ?? def.canonicalUnit} onChange={(e) => setObs(path, { unit: e.target.value })}>
                      {[...new Set([def.canonicalUnit, ...Object.keys(def.units)])].map((u) => <option key={u} value={u}>{u}</option>)}
                      {o?.unit && !Object.keys(def.units).includes(o.unit.toLowerCase()) && o.unit !== def.canonicalUnit && <option value={o.unit}>{o.unit} (unsupported)</option>}
                    </select>
                  </div>
                );
              })}
            </div>
          </section>
          <section>
            <SectionTitle>Valve findings</SectionTitle>
            <table className="w-full text-[12px]">
              <thead className="text-[11px] text-faint"><tr><th className="text-left font-normal">Valve</th><th className="font-normal">Stenosis</th><th className="font-normal">Regurgitation</th><th className="font-normal">Prolapse</th></tr></thead>
              <tbody>{VALVE_IDS.map((v) => (
                <tr key={v}>
                  <td className="py-1 pr-2">{STRUCTURE_LABEL[v]}</td>
                  {(["stenosis", "regurgitation"] as const).map((c) => (
                    <td key={c} className="px-1"><select aria-label={`${STRUCTURE_LABEL[v]} ${c}`} className={input} value={String(valveVal(v, c)?.severity ?? (valveVal(v, c) ? "unspecified" : ""))} onChange={(e) => setValve(v, c, e.target.value)}>
                      <option value="">not reported</option>{SEVERITIES.filter((x) => x !== "none").map((x) => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}
                    </select></td>
                  ))}
                  <td className="text-center"><input type="checkbox" aria-label={`${STRUCTURE_LABEL[v]} prolapse`} checked={!!valveVal(v, "prolapse")} onChange={(e) => setValve(v, "prolapse", e.target.checked)} /></td>
                </tr>
              ))}</tbody>
            </table>
            <SectionTitle>Regional wall motion (AHA 17-segment)</SectionTitle>
            <div className="grid grid-cols-2 gap-1">
              {AHA_SEGMENT_NAMES.map((name, i) => (
                <label key={i} className="flex items-center justify-between gap-1 text-[11px] text-muted"><span className="truncate" title={name}>{i + 1}. {name}</span>
                  <select className="h-7 w-28 rounded-md border border-line bg-panel-2 px-1 text-[12px] text-ink" value={wm.find((w) => w.segment === i + 1)?.motion ?? ""} onChange={(e) => setWm(i + 1, e.target.value)}>
                    <option value="">not reported</option>{WALL_MOTION.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select></label>
              ))}
            </div>
            <SectionTitle>Symptoms & notes</SectionTitle>
            <input aria-label="Symptoms separated by semicolons" className={input} placeholder="Breathlessness; palpitations" defaultValue={((get(rec, "symptoms") as (string | { symptom: string })[] | undefined) ?? []).map((x) => (typeof x === "string" ? x : x.symptom)).join("; ")}
              onBlur={(e) => setRec(setIn(rec, "symptoms", e.target.value.split(";").map((x) => x.trim()).filter(Boolean)))} />
            <textarea aria-label="Clinician notes" className="mt-2 h-20 w-full rounded-lg border border-line bg-panel-2 p-2 text-[13px]" placeholder="Clinician notes (displayed only)" value={String(rec.clinicianNotes ?? "")} onChange={(e) => setRec(setIn(rec, "clinicianNotes", e.target.value || undefined))} />
            <p className="mt-1 text-[11px] text-faint">Labs, ECG, Doppler, imaging and other namespaces: use “Full JSON”.</p>
          </section>
        </div>
      )}
      {issues.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg border border-line bg-panel-2 p-2 text-[12px]" aria-live="polite">
          {issues.map((i, k) => <li key={k} className="flex gap-1.5">{i.severity === "error" ? <Ban className="mt-0.5 h-3.5 w-3.5 text-error" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-warn" />}<span><span className="num text-faint">{i.path}</span> {i.message}{i.suggestion && <span className="block text-muted">→ {i.suggestion}</span>}</span></li>)}
        </ul>
      )}
    </Modal>
  );
}
