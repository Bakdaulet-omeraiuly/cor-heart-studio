"use client";
// 95 % intervals from the Monte Carlo (src/domain/treatments/uncertainty.ts), one line on screen and the method behind the ⓘ.
// Two questions are kept apart: how sure we are of the cohort-average effect, and how far one patient may differ.
import { useMemo } from "react";
import { InfoTip } from "@/components/ui/primitives";
import type { BrainTarget } from "@/domain/outlook/evidence";
import type { LvhInputs } from "@/domain/outlook/project";
import { DRAWS, isBand, simulateAsReplacement, simulateBrain, simulateLvh, type Interval } from "@/domain/treatments/uncertainty";

const METHOD = (
  <span className="block max-w-[17rem] space-y-1.5">
    <span className="block text-ink">{DRAWS.toLocaleString("en-US")} draws, fixed seed, 95 % interval.</span>
    <span className="block"><b className="font-medium text-ink">Average effect:</b> how sure we are of the cohort-average effect, drawn from the study&apos;s published confidence interval (SE = width / 3.92).</span>
    <span className="block"><b className="font-medium text-ink">Between patients:</b> how far one patient may differ, drawn from the SD between patients where the study reported it. It is much wider, and it is not a prediction for the patient in front of you.</span>
    <span className="block">A value with no reported spread is held at its published value: nothing is drawn from a number nobody measured.</span>
  </span>
);

const range = (i: Interval, digits = 1) => `${i.lo.toFixed(digits)}–${i.hi.toFixed(digits)}`;

function Line({ label, children, testId }: { label: string; children: React.ReactNode; testId: string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-[10px] leading-snug text-faint" data-testid={testId}>
      <span className="font-medium text-muted">{label}</span>
      {children}
      <InfoTip label="How the uncertainty is drawn" side="bottom" anchor="container">{METHOD}</InfoTip>
    </p>
  );
}

export function LvhUncertainty({ inp, active, years }: { inp: LvhInputs; active: string[]; years: number }) {
  // the input object is rebuilt on every render; its four numbers decide the draws
  const { ivsMm, pwMm, lvidMm, bsaM2 } = inp;
  const bands = useMemo(() => {
    if (years <= 0) return null;
    const i = { ivsMm, pwMm, lvidMm, bsaM2 };
    return { average: simulateLvh(i, active, years, "average"), patients: simulateLvh(i, active, years, "patients") };
  }, [ivsMm, pwMm, lvidMm, bsaM2, active, years]);
  if (!bands || (!isBand(bands.average) && !isBand(bands.patients))) return null;
  return (
    <Line label={`LVMI at +${years} y, 95 %:`} testId="uncertainty-lvh">
      {isBand(bands.average) && <span className="num" data-testid="uncertainty-lvh-average">average effect {range(bands.average)} g/m²</span>}
      {isBand(bands.average) && isBand(bands.patients) && <span aria-hidden>·</span>}
      {isBand(bands.patients) && <span className="num" data-testid="uncertainty-lvh-patients">between patients {range(bands.patients, 0)} g/m²</span>}
    </Line>
  );
}

export function AsUncertainty({ active, years }: { active: string[]; years: number }) {
  const band = useMemo(() => (years > 0 ? simulateAsReplacement(active, years, "patients") : null), [active, years]);
  if (!isBand(band)) return null;
  return (
    <Line label="Valve area after replacement, 95 %:" testId="uncertainty-as">
      <span className="num" data-testid="uncertainty-as-patients">between patients {range(band, 2)} cm²</span>
    </Line>
  );
}

const NAME: Record<BrainTarget, string> = { hippocampus: "Hippocampi", ventricles: "Ventricles", cortex: "Cortex" };

/** % change from today, with the interval ends. */
const pct = (i: Interval, v0: number) => `${(100 * (i.lo / v0 - 1)).toFixed(1)} to ${(100 * (i.hi / v0 - 1)).toFixed(1)} %`;

export function BrainUncertainty({ baseline, active, years }: { baseline: Record<BrainTarget, number>; active: string[]; years: number }) {
  const bands = useMemo(
    () => (years > 0 ? { average: simulateBrain(baseline, active, years, "average"), patients: simulateBrain(baseline, active, years, "patients") } : null),
    [baseline, active, years],
  );
  if (!bands) return null;
  const rows = (Object.keys(NAME) as BrainTarget[]).filter((t) => isBand(bands.average[t]) || isBand(bands.patients[t]));
  if (!rows.length) return null;
  return (
    <div className="space-y-0.5" data-testid="uncertainty-brain">
      <Line label={`Change at +${years} y, 95 % interval`} testId="uncertainty-brain-title"><span /></Line>
      <dl className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-0.5 text-[10px] leading-snug">
        <dt className="text-faint" /><dd className="text-faint">average</dd><dd className="text-faint">between patients</dd>
        {rows.map((t) => (
          <div key={t} className="contents">
            <dt className="text-muted">{NAME[t]}</dt>
            <dd className="num text-muted">{isBand(bands.average[t]) ? pct(bands.average[t], baseline[t]) : "—"}</dd>
            <dd className="num text-muted">{isBand(bands.patients[t]) ? pct(bands.patients[t], baseline[t]) : "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

