"use client";
import { Box } from "lucide-react";
import type { HeartAssetSpec } from "@/scene/asset-adapters/registry";

/** Where the 3D shape comes from — always visible next to the heart (provenance is part of the picture). */
export function GeometryBadge({ spec }: { spec: HeartAssetSpec }) {
  const m = spec.manifest;
  return (
    <div className="pointer-events-auto rounded-md bg-black/55 px-2 py-1 text-[11px] leading-snug text-white/90" data-testid="geometry-badge">
      <p className="flex items-center gap-1.5 font-medium">
        <Box className="h-3.5 w-3.5 shrink-0 opacity-80" />
        Tier {spec.tier} · Geometry: {spec.geometrySource}
      </p>
      {spec.tier === "B" ? (
        <p className="mt-0.5 text-white/65">
          Motion and valves are illustrative (single-phase scan). Data: {m.attribution}, {m.license}.
        </p>
      ) : (
        <p className="mt-0.5 text-white/65">Shape is an illustration; only reported dimensions are data-driven.</p>
      )}
    </div>
  );
}
