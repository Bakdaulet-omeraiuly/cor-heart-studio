"use client";
import { Box } from "lucide-react";
import type { HeartAssetSpec } from "@/scene/asset-adapters/registry";
import { InfoTip } from "../ui/primitives";

/** Where the 3D shape comes from — always visible next to the heart (provenance is part of the picture).
 * One short line on screen; the full source, COR-Fit numbers and caveats sit behind ⓘ. */
export function GeometryBadge({ spec }: { spec: HeartAssetSpec }) {
  const m = spec.manifest;
  const fit = m.fidelity ? (m.fidelity.lods.high ?? m.fidelity.lods.low) : undefined;
  const short = spec.tier === "B" ? "Shape from this patient's CT" : "CT template · illustration";
  return (
    <div className="pointer-events-auto flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-1 text-[11px] leading-snug text-white/90" data-testid="geometry-badge">
      <Box className="h-3.5 w-3.5 shrink-0 opacity-80" />
      <span className="font-medium">{short}</span>
      {fit && <span className="num text-white/70">· fit {fit.overall.nsdPercent}%</span>}
      <InfoTip label="Shape source and accuracy">
        <span className="block font-medium text-ink">Tier {spec.tier} · Geometry: {spec.geometrySource}</span>
        {fit && (
          <span className="mt-1 block" data-testid="corfit-line">
            COR-Fit: {fit.overall.nsdPercent}% of the surface within {fit.toleranceMm} mm of the CT labels (mean {fit.overall.meanMm} mm)
          </span>
        )}
        <span className="mt-1 block text-faint">
          {spec.tier === "B"
            ? `Motion and valves are illustrative (single-phase scan). Data: ${m.attribution}, ${m.license}.`
            : "Shape is an illustration; only reported dimensions are data-driven."}
        </span>
      </InfoTip>
    </div>
  );
}
