// COR-Fit fidelity report types (written by pipeline/cor_pipeline/fidelity.py; see docs/cor-fit.md).

export interface FidelityOverall {
  /** % of surface points (both directions) within one voxel of the other surface. */
  nsdPercent: number;
  meanMm: number;
  hd95MmWorst: number;
  toleranceMm: number;
  structures: number;
}

export interface FidelityRow {
  nsdPercent: number | null;
  meanMm?: number;
  hd95Mm?: number;
  maxMm?: number;
  points?: number;
  volumeErrorPercent?: number;
}

export const fmtPct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}%`);
export const fmtMm = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)} mm`);
