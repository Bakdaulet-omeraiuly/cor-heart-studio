"use client";
// Heart outlook: today vs +N years for the selected record, side by side. Two scenarios:
// aortic stenosis progression (Otto 1997) and hypertensive LVH on treatment (LIFE, Devereux 2004).
// Both hearts are ordinary records run through the mapping engine, so they follow the same rules as imported data.
import dynamic from "next/dynamic";
import { useMemo, type ReactNode } from "react";
import { Focus, ScanEye } from "lucide-react";
import { AS_EVENT_FREE_2Y, AS_PROGRESSION, LVH_CLASS_EFFECT, LVH_FOLLOW_UP_YEARS, LVH_TREATMENT, LVMI_UPPER_NORMAL, type LvhArm } from "@/domain/outlook/evidence";
import { readAsBaseline, readLvhBaseline, withProjectedAorticStenosis, withProjectedWalls } from "@/domain/outlook/heart";
import { projectAorticStenosis, projectLvh, type AsGrade, type AsProjection, type LvhProjection } from "@/domain/outlook/project";
import type { NormalizedPatient } from "@/domain/types";
import { entryFromNormalized, patientTitle, type PatientEntry } from "@/lib/patients";
import { useApp } from "@/state/store";
import { getHeartAssetSpec } from "@/scene/asset-adapters/registry";
import { useLowAssets } from "@/scene/useHeartAssets";
import { Button, PanelHeader, Segmented } from "@/components/ui/primitives";
import { useWebgl } from "@/components/workspace/HeartViewport";
import { useOutlook, type HeartScenario } from "./outlookStore";
import { HorizonControls, OutlookCaveat, SourceList, fmtSigned } from "./shared";

const CompareCanvas = dynamic(() => import("@/scene/CompareCanvas"), { ssr: false });

const yearsLabel = (years: number, pace: string) => (years ? `+${years} year${years > 1 ? "s" : ""} · ${pace === "mean" ? "average" : pace} pace` : "Today (move the slider)");
const sourceHint = (recorded: number | null, typed: number | undefined | null) => (typed != null ? "entered" : recorded != null ? "from record" : "example value");

export function HeartOutlook() {
  const entry = useApp((s) => (s.selectedKey ? s.entries[s.selectedKey] : null));
  const scenario = useOutlook((s) => s.heartScenario);
  if (!entry) return <p className="p-6 text-[13px] text-muted">Select a record in the patient panel to open its outlook.</p>;
  return scenario === "as" ? <AorticStenosisOutlook entry={entry} /> : <LvhOutlook entry={entry} />;
}

function ScenarioPicker() {
  const scenario = useOutlook((s) => s.heartScenario);
  const set = useOutlook((s) => s.set);
  return (
    <Segmented<HeartScenario> label="Heart scenario" size="md" value={scenario} onChange={(v) => set({ heartScenario: v })}
      options={[{ value: "as", label: "Aortic stenosis" }, { value: "lvh", label: "LVH on treatment" }]} />
  );
}

/** Two records (today, projected) through the mapping engine; fixed key suffixes so the 3D views update in place. */
function useOutlookEntries(entry: PatientEntry, today: NormalizedPatient, later: NormalizedPatient): PatientEntry[] {
  return useMemo(() => [entryFromNormalized(today, entry.origin, entry.addedAt), entryFromNormalized(later, entry.origin, entry.addedAt)], [entry, today, later]);
}

function OutlookLayout({ entry, entries, toolbar, cards, children }: { entry: PatientEntry; entries: PatientEntry[]; toolbar: ReactNode; cards: [ReactNode, ReactNode]; children: ReactNode }) {
  const assets = useLowAssets(entries.map((e) => getHeartAssetSpec(e.assetId)));
  const webgl = useWebgl();
  const xray = useApp((s) => s.xray);
  const setApp = useApp((s) => s.set);
  const ready = entries.every((e) => assets.assets[getHeartAssetSpec(e.assetId).id]);
  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_330px]" data-testid="heart-outlook">
      <section className="flex min-h-[480px] flex-col lg:min-h-0" aria-label="Today and projected heart">
        <PanelHeader title={`Outlook · ${patientTitle(entry.patient)}`} aside={<>
          {toolbar}
          <Button size="sm" pressed={xray} onClick={() => setApp({ xray: !xray })}><ScanEye className="h-3.5 w-3.5" /> X-ray</Button>
        </>} />
        <div className="relative min-h-0 flex-1 bg-[#050608]">
          {!webgl ? <p className="p-6 text-[13px] text-muted">WebGL 2 is not available: the numbers on the right are the full projection.</p>
            : assets.error ? <p className="p-6 text-[13px] text-muted" role="alert">The anatomical asset failed to load: {assets.error}</p>
            : ready ? <CompareCanvas entries={entries} assets={assets.assets} syncCamera sharedScale /> : <p className="p-6 text-[13px] text-muted" role="status">Loading…</p>}
        </div>
        <div className="grid shrink-0 grid-cols-2 divide-x divide-line border-t border-line bg-panel">{cards}</div>
      </section>
      <aside className="min-h-0 overflow-y-auto border-line bg-panel p-3 scroll-thin lg:border-l" aria-label="Outlook settings and evidence">
        <ScenarioPicker />
        <div className="mt-3">{children}</div>
      </aside>
    </div>
  );
}

const H3 = ({ children }: { children: ReactNode }) => <h3 className="mb-1.5 mt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">{children}</h3>;

// ---------------------------------------------------------------- aortic stenosis

/** Typed in when the record has no usable aortic stenosis numbers (a moderate valve). */
const DEFAULT_AVA = 1.3;
const DEFAULT_VMAX = 3.2;

const GRADE_TONE: Record<AsGrade, string> = { none: "text-muted", mild: "text-ink", moderate: "text-warn", severe: "text-error" };

function AorticStenosisOutlook({ entry }: { entry: PatientEntry }) {
  const { years, pace, avaOverride, vmaxOverride, set } = useOutlook();
  const setApp = useApp((s) => s.set);
  const requestCamera = useApp((s) => s.requestCamera);
  const recorded = useMemo(() => readAsBaseline(entry.patient), [entry]);
  const ava0 = avaOverride ?? recorded.ava ?? DEFAULT_AVA;
  const vmax0 = vmaxOverride ?? recorded.vmax ?? DEFAULT_VMAX;
  const now = useMemo(() => projectAorticStenosis(ava0, vmax0, 0, "mean"), [ava0, vmax0]);
  const later = useMemo(() => projectAorticStenosis(ava0, vmax0, years, pace), [ava0, vmax0, years, pace]);
  const today = useMemo(() => withProjectedAorticStenosis(entry.patient, now, "::outlook-today"), [entry, now]);
  const projected = useMemo(() => withProjectedAorticStenosis(entry.patient, later, "::outlook-later"), [entry, later]);
  const entries = useOutlookEntries(entry, today, projected);

  // the aortic valve is open only during ejection: freeze both hearts at mid-ejection so the opening can be compared
  const showValve = () => {
    const ph = entries[0]?.visual.timing.phases;
    setApp({ xray: true, ...(ph ? { playing: false, scrubPhase: (ph.ivcEnd + ph.ejectionEnd) / 2 } : {}) });
    requestCamera("aortic_closeup");
  };

  return (
    <OutlookLayout entry={entry} entries={entries}
      toolbar={<Button size="sm" title="Close-up of the aortic valve, frozen at peak ejection with the outer wall see-through" onClick={showValve}><Focus className="h-3.5 w-3.5" /> Aortic valve</Button>}
      cards={[<AsCard key="t" title="Today" p={now} />, <AsCard key="l" title={yearsLabel(years, pace)} p={later} />]}>
      <p className="text-[11px] text-faint">Average haemodynamic progression in adults with asymptomatic aortic stenosis.</p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <NumberField label="Valve area today" unit="cm²" value={ava0} step={0.05} min={0.3} max={4} hint={sourceHint(recorded.ava, avaOverride)}
          onChange={(v) => set({ avaOverride: v })} />
        <NumberField label="Peak velocity today" unit="m/s" value={vmax0} step={0.1} min={1} max={7} hint={sourceHint(recorded.vmax, vmaxOverride)}
          onChange={(v) => set({ vmaxOverride: v })} />
      </div>
      {(avaOverride != null || vmaxOverride != null) && (
        <button className="mt-1 text-[11px] text-muted underline hover:text-ink" onClick={() => set({ avaOverride: null, vmaxOverride: null })}>Use the record&apos;s values</button>
      )}

      <div className="mt-4"><HorizonControls paceHint="Average = Otto 1997 mean change per year; slower/faster = mean ∓ 1 SD between patients (slower end clamped at no progression)." /></div>

      <dl className="mt-4 grid grid-cols-[1fr_auto] gap-y-1 text-[11px]">
        <dt className="text-faint">Valve area</dt><dd className="num">{AS_PROGRESSION.areaCm2PerYear.mean} ± {AS_PROGRESSION.areaCm2PerYear.sd} cm²/y</dd>
        <dt className="text-faint">Peak velocity</dt><dd className="num">+{AS_PROGRESSION.velocityMsPerYear.mean} ± {AS_PROGRESSION.velocityMsPerYear.sd} m/s/y</dd>
        <dt className="text-faint">Mean gradient</dt><dd className="num">+{AS_PROGRESSION.meanGradientMmHgPerYear.mean} ± {AS_PROGRESSION.meanGradientMmHgPerYear.sd} mmHg/y</dd>
      </dl>

      <H3>Alive without valve replacement 2 years later</H3>
      <table className="w-full text-[11px]">
        <tbody className="divide-y divide-line">
          {AS_EVENT_FREE_2Y.map((b) => (
            <tr key={b.label} className={b === later.eventFree2y ? "bg-panel-3" : ""}>
              <td className="py-1 pl-1 text-muted">Jet velocity {b.label}</td>
              <td className="num py-1 pr-1 text-right text-ink">{b.percent} ± {b.pm} %</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-faint">Otto 1997, by jet velocity at entry; the highlighted row matches the projected velocity.</p>

      <div className="mt-4">
        <OutlookCaveat>
          Cohort averages applied to this record&apos;s numbers. Individual progression varies widely (the SD is larger than the mean for valve area),
          and calcification, age and symptoms change it. Not a forecast for this patient and not a treatment recommendation.
        </OutlookCaveat>
      </div>

      <H3>How the 3D model changes</H3>
      <p className="text-[11px] leading-snug text-muted">The discs under the hearts are the valve area to scale (dashed ring: a normal {NORMAL_AVA_CM2} cm² valve). The grade (worse of area and velocity, ACC/AHA 2020 thresholds) becomes an aortic stenosis finding on a copy of the record. The ordinary mapping rule then narrows the leaflet opening: an illustrative opening per grade, not an orifice area. Everything else in the record is unchanged.</p>

      <H3>Sources</H3>
      <SourceList ids={["otto1997", "acc2020"]} />
    </OutlookLayout>
  );
}

/** Normal adult aortic valve area drawn as the reference ring (normal is about 3–4 cm²). */
const NORMAL_AVA_CM2 = 3.5;

/** Orifice drawn to scale: disc area ∝ valve area, against a normal-valve ring. */
function OrificeGauge({ ava }: { ava: number }) {
  const R = 22; // px radius of the normal ring
  const r = R * Math.sqrt(Math.min(ava, NORMAL_AVA_CM2) / NORMAL_AVA_CM2);
  return (
    <svg viewBox="0 0 50 50" className="h-12 w-12 shrink-0" role="img" aria-label={`Valve area ${ava.toFixed(2)} cm² drawn to scale against a normal ${NORMAL_AVA_CM2} cm² valve`}>
      <circle cx="25" cy="25" r={R} fill="none" stroke="var(--border-strong)" strokeDasharray="2 2" />
      <circle cx="25" cy="25" r={r} fill="var(--accent)" fillOpacity="0.85" />
    </svg>
  );
}

function AsCard({ title, p }: { title: string; p: AsProjection }) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-3 py-2" data-testid="outlook-state">
      <OrificeGauge ava={p.ava} />
      <div className="min-w-0">
        <p className="truncate text-[11px] text-faint">{title}</p>
        <p className={`text-[17px] font-medium capitalize leading-tight ${GRADE_TONE[p.grade]}`}>{p.grade === "none" ? "No stenosis grade" : `${p.grade} stenosis`}</p>
        <p className="num text-[11px] text-muted">
          AVA {p.ava.toFixed(2)} cm² · V<sub>max</sub> {p.vmax.toFixed(1)} m/s
          {p.years > 0 && <span className="text-faint"> (range {p.avaRange[0].toFixed(2)}–{p.avaRange[1].toFixed(2)} cm²)</span>}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- hypertensive LVH on treatment

/** Example values when the record lacks them (a concentric LVH and an average adult body surface area). */
const LVH_DEFAULTS = { ivsMm: 14, pwMm: 13, lvidMm: 46, bsaM2: 1.9 };

function LvhOutlook({ entry }: { entry: PatientEntry }) {
  const { years, pace, lvhArm, lvhOverrides, set } = useOutlook();
  const recorded = useMemo(() => readLvhBaseline(entry.patient), [entry]);
  const inp = {
    ivsMm: lvhOverrides.ivsMm ?? recorded.ivsMm ?? LVH_DEFAULTS.ivsMm,
    pwMm: lvhOverrides.pwMm ?? recorded.pwMm ?? LVH_DEFAULTS.pwMm,
    lvidMm: lvhOverrides.lvidMm ?? recorded.lvidMm ?? LVH_DEFAULTS.lvidMm,
    bsaM2: lvhOverrides.bsaM2 ?? recorded.bsaM2 ?? LVH_DEFAULTS.bsaM2,
  };
  const key = `${inp.ivsMm}|${inp.pwMm}|${inp.lvidMm}|${inp.bsaM2}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the four input values
  const now = useMemo(() => projectLvh(inp, lvhArm, 0, "mean"), [key, lvhArm]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the four input values
  const later = useMemo(() => projectLvh(inp, lvhArm, years, pace), [key, lvhArm, years, pace]);
  const today = useMemo(() => withProjectedWalls(entry.patient, now.ivsMm, now.pwMm, "::outlook-today", "today"), [entry, now]);
  const projected = useMemo(() => withProjectedWalls(entry.patient, later.ivsMm, later.pwMm, "::outlook-later", years ? `+${years} y (projected)` : "today"), [entry, later, years]);
  const entries = useOutlookEntries(entry, today, projected);
  const arm = LVH_TREATMENT[lvhArm];
  const field = (k: keyof typeof LVH_DEFAULTS) => sourceHint(recorded[k], lvhOverrides[k]);

  return (
    <OutlookLayout entry={entry} entries={entries}
      toolbar={null}
      cards={[<LvhCard key="t" title="Today" p={now} lvidMm={inp.lvidMm} />, <LvhCard key="l" title={yearsLabel(years, pace)} p={later} lvidMm={inp.lvidMm} />]}>
      <p className="text-[11px] text-faint">LV mass regression on antihypertensive treatment in hypertension with ECG LVH.</p>

      <div className="mt-3">
        <Segmented<LvhArm> label="Treatment" value={lvhArm} onChange={(v) => set({ lvhArm: v })}
          options={(Object.keys(LVH_TREATMENT) as LvhArm[]).map((a) => ({ value: a, label: LVH_TREATMENT[a].label }))} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <NumberField label="IVSd today" unit="mm" value={inp.ivsMm} step={0.5} min={5} max={35} hint={field("ivsMm")} onChange={(v) => set({ lvhOverrides: { ...lvhOverrides, ivsMm: v } })} />
        <NumberField label="LVPWd today" unit="mm" value={inp.pwMm} step={0.5} min={5} max={35} hint={field("pwMm")} onChange={(v) => set({ lvhOverrides: { ...lvhOverrides, pwMm: v } })} />
        <NumberField label="LVIDd today" unit="mm" value={inp.lvidMm} step={1} min={25} max={85} hint={field("lvidMm")} onChange={(v) => set({ lvhOverrides: { ...lvhOverrides, lvidMm: v } })} />
        <NumberField label="Body surface area" unit="m²" value={inp.bsaM2} step={0.05} min={1} max={3} hint={field("bsaM2")} onChange={(v) => set({ lvhOverrides: { ...lvhOverrides, bsaM2: v } })} />
      </div>
      {Object.keys(lvhOverrides).length > 0 && (
        <button className="mt-1 text-[11px] text-muted underline hover:text-ink" onClick={() => set({ lvhOverrides: {} })}>Use the record&apos;s values</button>
      )}

      <div className="mt-4"><HorizonControls paceHint="Average = LIFE mean LVMI change; slower/faster = mean ∓ 1 SD between patients (slower end clamped at no regression)." /></div>

      <dl className="mt-4 grid grid-cols-[1fr_auto] gap-y-1 text-[11px]">
        <dt className="text-faint">{arm.label} (LIFE)</dt><dd className="num">{arm.lvmiChange} ± {arm.sd} g/m²</dd>
        <dt className="text-faint">Reached at</dt><dd className="num">{LVH_FOLLOW_UP_YEARS} years</dd>
        <dt className="text-faint">Now applied</dt><dd className="num">{Math.round(later.fractionOfFollowUp * 100)} % of it</dd>
      </dl>
      <p className="mt-1 text-[10px] leading-snug text-faint">LIFE reports baseline and the last study; the years between are a linear interpolation (assumption), and the change is held after {LVH_FOLLOW_UP_YEARS} years because there are no trial data beyond.</p>

      <H3>LV mass index change by drug class</H3>
      <table className="w-full text-[11px]">
        <tbody className="divide-y divide-line">
          {LVH_CLASS_EFFECT.map((c) => (
            <tr key={c.label}><td className="py-1 text-muted">{c.label}</td><td className="num py-1 text-right text-ink">{c.percent} % <span className="text-faint">({c.ci[0]} to {c.ci[1]})</span></td></tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-faint">Klingbeil 2003 meta-analysis, adjusted for duration and blood-pressure change; context only, not projected (no time base).</p>

      <div className="mt-4">
        <OutlookCaveat>
          Trial averages applied to this record&apos;s walls. The SD is about as large as the mean: some patients regress much more, some not at all.
          Blood-pressure control, adherence and other drugs change it. Not a forecast for this patient and not a treatment recommendation.
        </OutlookCaveat>
      </div>

      <H3>How the 3D model changes</H3>
      <p className="text-[11px] leading-snug text-muted">
        LV mass comes from the record&apos;s linear dimensions (ASE cube formula with the Devereux 1986 correction). The LIFE change in mass index × body
        surface area gives the projected mass. The septal and posterior walls are thinned by one common factor with the cavity diameter held (LIFE
        attributes the regression mainly to reduced concentricity). The ordinary wall-thickness rule then draws them. The rings under the hearts are
        the mid-ventricular short axis to scale (septum left, posterior wall right). Upper normal LVMI
        (ASE/EACVI 2015): {LVMI_UPPER_NORMAL.men} g/m² men, {LVMI_UPPER_NORMAL.women} g/m² women.
      </p>

      <H3>Sources</H3>
      <SourceList ids={["devereux2004", "gerdts2009", "klingbeil2003", "devereux1986", "lang2015"]} />
    </OutlookLayout>
  );
}

/** Mid-ventricular short axis drawn to scale (1 mm = 1 unit): septum on the left, posterior wall on the right, cavity held. */
function ShortAxisGauge({ ivsMm, pwMm, lvidMm }: { ivsMm: number; pwMm: number; lvidMm: number }) {
  const outer = (ivsMm + lvidMm + pwMm) / 2;
  const cx = 40, cy = 40;
  // outer circle centred so the septal side is ivs thick and the posterior side pw thick
  const ox = cx + (pwMm - ivsMm) / 2;
  return (
    <svg viewBox="0 0 80 80" className="h-14 w-14 shrink-0" role="img" aria-label={`Short axis to scale: septum ${ivsMm.toFixed(1)} mm, posterior wall ${pwMm.toFixed(1)} mm, cavity ${lvidMm} mm`}>
      <circle cx={ox} cy={cy} r={outer} fill="var(--accent)" fillOpacity="0.85" />
      <circle cx={cx} cy={cy} r={lvidMm / 2} fill="var(--panel)" />
    </svg>
  );
}

function LvhCard({ title, p, lvidMm }: { title: string; p: LvhProjection; lvidMm: number }) {
  const over = p.lvmiGm2 > LVMI_UPPER_NORMAL.men ? "above both sex limits" : p.lvmiGm2 > LVMI_UPPER_NORMAL.women ? "above the women's limit" : "within normal limits";
  return (
    <div className="flex min-w-0 items-center gap-3 px-3 py-2" data-testid="outlook-state">
      <ShortAxisGauge ivsMm={p.ivsMm} pwMm={p.pwMm} lvidMm={lvidMm} />
      <div className="min-w-0">
      <p className="truncate text-[11px] text-faint">{title}</p>
      <p className="num text-[17px] font-medium leading-tight text-ink">LVMI {p.lvmiGm2.toFixed(0)} g/m²
        {p.years > 0 && <span className="text-[12px] font-normal text-muted"> ({fmtSigned(p.lvmiChange, 1)}; range {fmtSigned(p.lvmiRange[0], 0)} to {fmtSigned(p.lvmiRange[1], 0)})</span>}
      </p>
      <p className="num text-[11px] text-muted">IVSd {p.ivsMm.toFixed(1)} · LVPWd {p.pwMm.toFixed(1)} mm · LVM {p.lvmG.toFixed(0)} g · <span className="text-faint">{over}</span></p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- shared

function NumberField({ label, unit, value, step, min, max, hint, onChange }: { label: string; unit: string; value: number; step: number; min: number; max: number; hint: string; onChange: (v: number) => void }) {
  return (
    <label className="block text-[11px]">
      <span className="text-muted">{label}</span>
      <span className="mt-0.5 flex items-center gap-1 rounded-md border border-line bg-panel-2 px-2">
        <input type="number" value={value} step={step} min={min} max={max} aria-label={label}
          onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= min && v <= max) onChange(v); }}
          className="num h-7 w-full bg-transparent text-[13px] outline-none" />
        <span className="text-faint">{unit}</span>
      </span>
      <span className="text-[10px] text-faint">{hint}</span>
    </label>
  );
}

