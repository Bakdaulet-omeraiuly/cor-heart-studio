"use client";
// Heart outlook: aortic stenosis progression (Otto 1997) for the selected record, today vs +N years side by side.
// Both hearts are ordinary records run through the mapping engine, so the valve follows the same rules as imported data.
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { Focus, ScanEye } from "lucide-react";
import { AS_EVENT_FREE_2Y, AS_PROGRESSION } from "@/domain/outlook/evidence";
import { readAsBaseline, withProjectedAorticStenosis } from "@/domain/outlook/heart";
import { projectAorticStenosis, type AsGrade, type AsProjection } from "@/domain/outlook/project";
import { entryFromNormalized, patientTitle } from "@/lib/patients";
import { useApp } from "@/state/store";
import { getHeartAssetSpec } from "@/scene/asset-adapters/registry";
import { useLowAssets } from "@/scene/useHeartAssets";
import { Button, PanelHeader } from "@/components/ui/primitives";
import { useWebgl } from "@/components/workspace/HeartViewport";
import { useOutlook } from "./outlookStore";
import { HorizonControls, OutlookCaveat, SourceList } from "./shared";

const CompareCanvas = dynamic(() => import("@/scene/CompareCanvas"), { ssr: false });

/** Typed in when the record has no usable aortic stenosis numbers (a moderate valve). */
const DEFAULT_AVA = 1.3;
const DEFAULT_VMAX = 3.2;

const GRADE_TONE: Record<AsGrade, string> = { none: "text-muted", mild: "text-ink", moderate: "text-warn", severe: "text-error" };

export function HeartOutlook() {
  const entry = useApp((s) => (s.selectedKey ? s.entries[s.selectedKey] : null));
  const { years, pace, avaOverride, vmaxOverride, set } = useOutlook();
  const recorded = useMemo(() => (entry ? readAsBaseline(entry.patient) : { ava: null, vmax: null }), [entry]);
  const ava0 = avaOverride ?? recorded.ava ?? DEFAULT_AVA;
  const vmax0 = vmaxOverride ?? recorded.vmax ?? DEFAULT_VMAX;
  const now = useMemo(() => projectAorticStenosis(ava0, vmax0, 0, "mean"), [ava0, vmax0]);
  const later = useMemo(() => projectAorticStenosis(ava0, vmax0, years, pace), [ava0, vmax0, years, pace]);
  const entries = useMemo(() => {
    if (!entry) return [];
    // fixed key suffixes: the 3D views update in place while the slider moves
    return [entryFromNormalized(withProjectedAorticStenosis(entry.patient, now, "::outlook-today"), entry.origin, entry.addedAt),
      entryFromNormalized(withProjectedAorticStenosis(entry.patient, later, "::outlook-later"), entry.origin, entry.addedAt)];
  }, [entry, now, later]);
  const assets = useLowAssets(entries.map((e) => getHeartAssetSpec(e.assetId)));
  const webgl = useWebgl();
  const xray = useApp((s) => s.xray);
  const setApp = useApp((s) => s.set);
  const requestCamera = useApp((s) => s.requestCamera);

  // the aortic valve is open only during ejection: freeze both hearts at mid-ejection so the opening can be compared
  const showValve = () => {
    const ph = entries[0]?.visual.timing.phases;
    setApp({ xray: true, ...(ph ? { playing: false, scrubPhase: (ph.ivcEnd + ph.ejectionEnd) / 2 } : {}) });
    requestCamera("aortic_closeup");
  };

  if (!entry) return <p className="p-6 text-[13px] text-muted">Select a record in the patient panel to open its outlook.</p>;
  const ready = entries.every((e) => assets.assets[getHeartAssetSpec(e.assetId).id]);
  const source = (v: number | null, o: number | null) => (o != null ? "entered" : v != null ? "from record" : "example value");

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]" data-testid="heart-outlook">
      <section className="flex min-h-[480px] flex-col lg:min-h-0" aria-label="Today and projected heart">
        <PanelHeader title={`Outlook · ${patientTitle(entry.patient)}`} aside={<>
          <Button size="sm" title="Close-up of the aortic valve, frozen at peak ejection with the outer wall see-through" onClick={showValve}><Focus className="h-3.5 w-3.5" /> Aortic valve</Button>
          <Button size="sm" pressed={xray} onClick={() => setApp({ xray: !xray })}><ScanEye className="h-3.5 w-3.5" /> X-ray</Button>
        </>} />
        <div className="relative min-h-0 flex-1 bg-[#050608]">
          {!webgl ? <p className="p-6 text-[13px] text-muted">WebGL 2 is not available: the numbers on the right are the full projection.</p>
            : assets.error ? <p className="p-6 text-[13px] text-muted" role="alert">The anatomical asset failed to load: {assets.error}</p>
            : ready ? <CompareCanvas entries={entries} assets={assets.assets} syncCamera sharedScale /> : <p className="p-6 text-[13px] text-muted" role="status">Loading…</p>}
        </div>
        <div className="grid shrink-0 grid-cols-2 divide-x divide-line border-t border-line bg-panel">
          <StateCard title="Today" p={now} />
          <StateCard title={years ? `+${years} year${years > 1 ? "s" : ""} · ${pace === "mean" ? "average" : pace} pace` : "Today (move the slider)"} p={later} />
        </div>
      </section>

      <aside className="min-h-0 overflow-y-auto border-line bg-panel p-3 scroll-thin lg:border-l" aria-label="Outlook settings and evidence">
        <h2 className="text-[13px] font-medium">Aortic stenosis progression</h2>
        <p className="mt-0.5 text-[11px] text-faint">Average haemodynamic progression in adults with asymptomatic aortic stenosis.</p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <NumberField label="Valve area today" unit="cm²" value={ava0} step={0.05} min={0.3} max={4} hint={source(recorded.ava, avaOverride)}
            onChange={(v) => set({ avaOverride: v })} />
          <NumberField label="Peak velocity today" unit="m/s" value={vmax0} step={0.1} min={1} max={7} hint={source(recorded.vmax, vmaxOverride)}
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

        <h3 className="mb-1 mt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Alive without valve replacement 2 years later</h3>
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

        <h3 className="mb-1.5 mt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">How the 3D model changes</h3>
        <p className="text-[11px] leading-snug text-muted">The discs under the hearts are the valve area to scale (dashed ring: a normal {NORMAL_AVA_CM2} cm² valve). The grade (worse of area and velocity, ACC/AHA 2020 thresholds) becomes an aortic stenosis finding on a copy of the record. The ordinary mapping rule then narrows the leaflet opening: an illustrative opening per grade, not an orifice area. Everything else in the record is unchanged.</p>

        <h3 className="mb-1.5 mt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Sources</h3>
        <SourceList ids={["otto1997", "acc2020"]} />
      </aside>
    </div>
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

function StateCard({ title, p }: { title: string; p: AsProjection }) {
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
