import { z } from "zod";

const Source = z.object({
  id: z.string().min(1),
  cite: z.string().min(1),
  title: z.string().min(1),
  journal: z.string().min(1),
  doi: z.string().min(1),
  studyType: z.enum(["rct", "meta-analysis", "placebo-arm", "prospective-cohort", "observational", "guideline"]),
  n: z.number().int().positive(),
  durationMonths: z.number().positive().optional(),
  population: z.string().min(1),
});

const Effect = z.object({
  quantity: z.enum(["lvmi_gm2", "hippocampus_pct", "ventricles_ml", "cortex_slowing_pct"]),
  likely: z.number(),
  best: z.number(),
  worst: z.number(),
  evidenceYears: z.number().positive(),
});

const Entry = z.object({
  id: z.string().min(1),
  condition: z.enum(["lvh", "as", "ad"]),
  kind: z.enum(["natural", "treatment"]),
  label: z.string().min(1),
  group: z.string().min(1).optional(),
  why: z.string().min(1),
  caveat: z.string().min(1),
  sources: z.array(z.string()).min(1),
  effect: Effect.optional(),
});

const RANDOMISED = new Set(["rct", "meta-analysis"]);

/**
 * Rules the evidence file must keep:
 * - every entry cites sources that exist;
 * - a treatment effect that moves a model comes only from randomised trials or meta-analyses.
 */
export const EvidenceFileSchema = z
  .object({ sources: z.record(z.string(), Source), entries: z.array(Entry) })
  .superRefine((file, ctx) => {
    file.entries.forEach((e, i) => {
      for (const id of e.sources) {
        const s = file.sources[id];
        if (!s) {
          ctx.addIssue({ code: "custom", path: ["entries", i, "sources"], message: `unknown source ${id}` });
        } else if (e.kind === "treatment" && e.effect && !RANDOMISED.has(s.studyType)) {
          ctx.addIssue({ code: "custom", path: ["entries", i, "sources"], message: `${id} is ${s.studyType}: a treatment effect needs rct or meta-analysis` });
        }
      }
    });
  });
