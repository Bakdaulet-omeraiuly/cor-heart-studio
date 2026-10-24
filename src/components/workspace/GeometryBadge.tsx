"use client";
import { Box } from "lucide-react";
import type { HeartAssetSpec } from "@/scene/asset-adapters/registry";

/** Where the 3D shape comes from — always visible next to the heart (provenance is part of the picture). */
export function GeometryBadge({ spec }: { spec: HeartAssetSpec }) {
  const m = spec.manifest;
  return (
    <div className="pointer-events-auto max-w-[360px] rounded-xl border border-line bg-panel/90 px-2.5 py-1.5 text-[11px] shadow-[var(--shadow)] backdrop-blur" data-testid="geometry-badge">
      <p className="flex items-center gap-1.5 font-medium text-ink">
        <Box className="h-3.5 w-3.5 shrink-0" />
        Tier {spec.tier} · Geometry: {spec.geometrySource}
      </p>
      {spec.tier === "B" ? (
        <p className="mt-0.5 text-muted">
          Motion and valves are illustrative (single-phase scan). Data: {m.attribution}, {m.license}.
        </p>
      ) : (
        <p className="mt-0.5 text-muted">Shape is an illustration; only reported dimensions are data-driven.</p>
      )}
    </div>
  );
}
