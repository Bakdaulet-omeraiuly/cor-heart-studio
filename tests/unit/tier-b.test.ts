// Tier B: CT-derived heart assets selected by a record's imaging.assets mesh reference.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mapPatientToVisual } from "@/domain/mapping/mapPatientToVisual";
import { entryFromRaw, type PatientEntry } from "@/lib/patients";
import { deformPoint, frameParams, restParams } from "@/scene/animation/deform";
import { HEART_ASSETS, PROCEDURAL_ASSET_ID, RODERO_TEMPLATE_ID, getDefaultTemplate, getHeartAssetSpec, setDefaultTemplate, specForPatient } from "@/scene/asset-adapters/registry";
import { meshVolume } from "../../scripts/heart-asset/surface-nets";
import { ROOT, minimal, norm, obs, readText, samplePatients } from "./helpers";

const openCt = () => JSON.parse(readText("public/samples/open-ct-patients.json")).patients as Record<string, unknown>[];
const ctSpecs = Object.values(HEART_ASSETS).filter((s) => s.tier === "B");
const entry = (raw: unknown) => {
  const e = entryFromRaw(raw, "sample", 0);
  if ("error" in e) throw new Error(e.error);
  return e as PatientEntry;
};

describe("asset registry", () => {
  it("bundles the procedural heart and at least one CT heart whose files ship", () => {
    expect(HEART_ASSETS[PROCEDURAL_ASSET_ID].tier).toBe("A");
    expect(ctSpecs.length).toBeGreaterThan(0);
    for (const s of ctSpecs) for (const f of Object.values(s.manifest.files)) {
      expect(existsSync(resolve(ROOT, "public", f.url.replace(/^\//, ""))), f.url).toBe(true);
    }
  });

  it("CT assets declare what the segmentation lacks", () => {
    for (const s of ctSpecs) {
      // coronaries and great veins are not in the segmentation: an atlas-grade asset may draw them, labelled as such
      for (const id of ["coronary_vessels", "vena_cava", "pulmonary_veins"] as const) {
        if (s.capabilities.structures.includes(id)) expect(String(s.manifest.structureToMesh[id]?.note)).toMatch(/atlas.*not imaged/);
      }
      expect(s.capabilities.structures).toContain("lv");
      expect(s.manifest.provenance?.reviewedByClinician).toBe(false);
      expect(s.manifest.license).toBe("CC BY 4.0");
    }
  });

  it("unknown ids fall back to the procedural heart", () => {
    expect(getDefaultTemplate()).toBe(RODERO_TEMPLATE_ID);
    expect(getHeartAssetSpec("nope").id).toBe(RODERO_TEMPLATE_ID);
    expect(getHeartAssetSpec(undefined).id).toBe(RODERO_TEMPLATE_ID);
    expect(HEART_ASSETS[RODERO_TEMPLATE_ID].tier).toBe("A");
  });
});

describe("record -> asset", () => {
  it("open CT samples normalize and select their CT heart", () => {
    const records = openCt();
    expect(records.length).toBe(ctSpecs.length);
    for (const r of records) {
      const e = entry(r);
      expect(getHeartAssetSpec(e.assetId).tier).toBe("B");
      expect(e.visual.assetId).toBe(e.assetId);
      expect(e.patient.issues.filter((i) => i.severity === "error")).toEqual([]);
    }
  });

  it("synthetic samples and unreferenced meshes use the session template (CT anatomy by default)", () => {
    for (const r of samplePatients()) expect(entry(r).assetId).toBe(RODERO_TEMPLATE_ID);
    const p = norm(minimal({ imaging: { assets: [{ kind: "mesh", reference: "somebody-elses-mesh" }] } }));
    expect(specForPatient(p).id).toBe(RODERO_TEMPLATE_ID);
    setDefaultTemplate(PROCEDURAL_ASSET_ID);
    try {
      expect(specForPatient(p).id).toBe(PROCEDURAL_ASSET_ID);
      for (const r of openCt()) expect(getHeartAssetSpec(entry(r).assetId).tier).toBe("B"); // own CT meshes kept
    } finally { setDefaultTemplate(RODERO_TEMPLATE_ID); }
  });

  it("a CT heart without echo numbers is shown at its own measured size (no rescaling)", () => {
    for (const r of openCt()) {
      const v = entry(r).visual;
      expect(v.lv.edRadial).toBeCloseTo(1, 6);
      expect(v.lv.edLong).toBeCloseTo(1, 6);
      expect(v.la.edScale).toBeCloseTo(1, 6);
    }
  });
});

describe("deformation on CT LV cavities", () => {
  for (const spec of [...ctSpecs, HEART_ASSETS[RODERO_TEMPLATE_ID]]) {
    const caseId = spec.id.replace("cor-ct-", "").replace("cor-template-", "");
    const fixture = JSON.parse(readText(`tests/fixtures/ct/${caseId}-lv-cavity-proxy.json`)) as { positions: number[]; indices: number[] };
    const P0 = new Float32Array(fixture.positions);
    const I = new Uint32Array(fixture.indices);
    const volumeAt = (raw: unknown, ventricular: number) => {
      const vs = mapPatientToVisual(norm(raw), spec.profile, spec.capabilities);
      const P = frameParams(vs, { ventricular, atrial: 0 }, restParams(spec.manifest));
      const out = new Float32Array(P0.length);
      const v: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < P0.length; i += 3) {
        deformPoint(P, P0[i], P0[i + 1], P0[i + 2], [1, 0, 0, 0], 1, 0, v);
        out[i] = v[0]; out[i + 1] = v[1]; out[i + 2] = v[2];
      }
      return meshVolume(out, I);
    };

    it(`${caseId}: rest volume equals the segmentation's LV cavity volume (within 3%)`, () => {
      const vol = volumeAt(minimal(), 0);
      expect(Math.abs(vol - spec.manifest.baseline.lvEndDiastolicVolumeMl) / spec.manifest.baseline.lvEndDiastolicVolumeMl).toBeLessThan(0.03);
    });

    it(`${caseId}: the LV handles work on the CT frame — rendered EF matches the input (within 3 points)`, () => {
      const raw = minimal({ observations: { lvEjectionFraction: obs(40, "%") } });
      const ed = volumeAt(raw, 0), es = volumeAt(raw, 1);
      expect(Math.abs((100 * (ed - es)) / ed - 40)).toBeLessThan(3);
    });
  }
});

describe("COR-Fit fidelity of the published CT hearts", () => {
  it("every Tier B model carries a report that passes the publication gate", () => {
    for (const s of ctSpecs) {
      const f = s.manifest.fidelity;
      expect(f, s.id).toBeDefined();
      for (const lod of Object.values(f!.lods)) {
        expect(lod!.overall.nsdPercent).toBeGreaterThanOrEqual(95);
        expect(lod!.overall.meanMm).toBeLessThan(lod!.toleranceMm);
        // surfaces that are not from imaging are reported as such, not scored
        expect(lod!.structures.find((r) => r.key === "other_walls")?.nsdPercent).toBeNull();
      }
      expect(Math.abs(f!.volume.errorPercent)).toBeLessThanOrEqual(5);
    }
  });
});
