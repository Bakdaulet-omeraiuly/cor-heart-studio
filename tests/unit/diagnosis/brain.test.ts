import { describe, expect, it } from "vitest";
import { hippocampalPattern, ventricularPattern } from "@/domain/diagnosis/brain";
import { normalizeRecord } from "@/domain/normalization/normalize";
import { alt, missingFields, o, obsRec } from "./helpers";

const brain = (obs: Record<string, unknown>) => obsRec(obs);

describe("brain atrophy rates vs cohorts (Barnes 2009, de Leon 1989)", () => {
  it("hippocampal loss: 2.30 ageing, 2.31 and 3.91 between, 3.92 Alzheimer-type", () => {
    expect([2.3, 2.31, 3.91, 3.92].map(hippocampalPattern)).toEqual(["ageing", "between", "between", "alzheimer"]);
  });
  it("ventricular expansion: 2 ageing, 2.1 and 8.9 between, 9 Alzheimer-type", () => {
    expect([2, 2.1, 8.9, 9].map(ventricularPattern)).toEqual(["ageing", "between", "between", "alzheimer"]);
  });

  it("is differential-only and possible; both alternatives when between ranges", () => {
    const a = brain({ hippocampalVolumeChangePerYear: o(-3, "%/year") });
    expect(a.findings).toEqual([]);
    expect(alt(a, "brain-atrophy-alzheimer-pattern")).toMatchObject({ basis: "possible", organ: "brain", target: "hippocampus" });
    expect(alt(a, "brain-atrophy-ageing-pattern")?.basis).toBe("possible");
  });

  it("one alternative when the rate is inside one cohort range", () => {
    const ad = brain({ hippocampalVolumeChangePerYear: o(-4.8, "%/year") });
    expect(alt(ad, "brain-atrophy-alzheimer-pattern")).toBeDefined();
    expect(alt(ad, "brain-atrophy-ageing-pattern")).toBeUndefined();
    const age = brain({ hippocampalVolumeChangePerYear: o(-1.2, "%/y") });
    expect(alt(age, "brain-atrophy-ageing-pattern")).toBeDefined();
    expect(alt(age, "brain-atrophy-alzheimer-pattern")).toBeUndefined();
  });

  it("always asks for cognitive assessment and biomarkers, never for LVEF on a brain-only record", () => {
    const m = missingFields(brain({ hippocampalVolumeChangePerYear: o(-4.8, "%/year") }));
    expect(m).toContain("clinical.cognitiveAssessment");
    expect(m).toContain("labs.amyloidTauBiomarkers");
    expect(m).not.toContain("observations.lvEjectionFraction");
  });

  it("a rate without a unit is not used", () => {
    const a = brain({ hippocampalVolumeChangePerYear: -4.8 });
    expect(a.differential).toEqual([]);
    expect(missingFields(a)).toContain("observations.hippocampalVolumeChangePerYear");
  });

  it("the rates are registry fields: recognised by normalize, impossible values excluded", () => {
    const n = normalizeRecord({ patientId: "T-1", studyId: "S-1", observations: { hippocampalVolumeChangePerYear: o(-4.8, "%/year"), ventricularVolumeChangePerYear: o(250, "%/year") } });
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    expect(n.patient.issues.map((i) => i.code)).not.toContain("observation.unsupported");
    expect(n.patient.observations["observations.hippocampalVolumeChangePerYear"]).toMatchObject({ value: -4.8, unit: "%/year", status: "ok", category: "brain_imaging" });
    expect(n.patient.observations["observations.ventricularVolumeChangePerYear"].status).toBe("impossible");
    expect(missingFields(brain({ ventricularVolumeChangePerYear: o(250, "%/year") }))).toContain("observations.ventricularVolumeChangePerYear");
  });

  it("ventricles give the target when there is no hippocampal rate", () => {
    expect(alt(brain({ ventricularVolumeChangePerYear: o(10, "%/year") }), "brain-atrophy-alzheimer-pattern")?.target).toBe("ventricles");
  });
});
