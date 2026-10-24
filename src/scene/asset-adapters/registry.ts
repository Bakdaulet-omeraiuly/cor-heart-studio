// Heart assets the app can render, keyed by assetId. Tier A = a template adapted to echo numbers: the
// CT-derived healthy heart (Rodero 2021, default) or the procedural heart; Tier B = the patient's own shape
// built from an open CT segmentation by pipeline/ (see docs/plan-tier-b-ct.md).
// A patient record selects a Tier B asset with imaging.assets[] { kind: "mesh", reference: <assetId> }.
import type { AssetCapabilities, ReferenceProfile } from "@/domain/mapping/types";
import type { NormalizedPatient } from "@/domain/types";
import { ASSET_BASELINE_PROFILE, capabilitiesFromManifest, profileFromManifest } from "@/domain/references/asset-baseline";
import proceduralManifest from "./procedural-heart-v1.manifest.json";
import ctS0270 from "./ct/s0270.manifest.json";
import ctS0338 from "./ct/s0338.manifest.json";
import roderoTemplate from "./template/rodero-01.manifest.json";
import type { HeartManifest } from "./manifest";

export interface HeartAssetSpec {
  id: string;
  tier: "A" | "B";
  manifest: HeartManifest;
  /** Heart centre in asset space (the scene puts it at the origin). */
  center: [number, number, number];
  profile: ReferenceProfile;
  capabilities: AssetCapabilities;
  /** One line for the viewport badge and inspector. */
  geometrySource: string;
}

export const PROCEDURAL_ASSET_ID = "cor-procedural-heart";
export const RODERO_TEMPLATE_ID = "cor-template-rodero-01";
/** Templates a record without its own mesh can be drawn on (choice in the scene toolbar). */
export const TEMPLATE_IDS = [RODERO_TEMPLATE_ID, PROCEDURAL_ASSET_ID] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

let defaultTemplate: TemplateId = RODERO_TEMPLATE_ID;
export const getDefaultTemplate = () => defaultTemplate;
/** Session choice; existing entries must be rebuilt by the caller (store.setTemplate). */
export function setDefaultTemplate(id: TemplateId) { defaultTemplate = id; }

function spec(manifest: HeartManifest, tier: "A" | "B", center: [number, number, number], geometrySource: string, description: string): HeartAssetSpec {
  return {
    id: manifest.assetId,
    tier,
    manifest,
    center,
    profile: profileFromManifest(manifest, `asset-baseline:${manifest.assetId}`, description),
    capabilities: capabilitiesFromManifest(manifest),
    geometrySource,
  };
}

const ct = (m: HeartManifest) => spec(m, "B", (m.center ?? [0, 0, 0]) as [number, number, number],
  `${m.provenance?.geometry ?? "CT segmentation"}${m.provenance?.reviewedByClinician ? "" : " — not reviewed by a clinician"}`,
  `Rest pose of ${m.assetId}, measured from its CT segmentation (cardiac phase unknown). Defaults are illustrative placeholders.`);

export const HEART_ASSETS: Record<string, HeartAssetSpec> = Object.fromEntries([
  // the procedural manifest predates the `center` field: its centre is fixed here
  { ...spec(proceduralManifest, "A", [0.8625, 1.7825, -0.6325], "Procedural template adapted to reported measurements", ""), profile: ASSET_BASELINE_PROFILE },
  spec(roderoTemplate as HeartManifest, "A", [0, 0, 0],
    "CT-derived healthy template (Rodero 2021 case 01, CC BY 4.0) adapted to reported measurements",
    "Rest pose of a healthy adult heart from CT (end-diastole), Rodero et al. 2021. Defaults are illustrative placeholders."),
  ct(ctS0270),
  ct(ctS0338),
].map((s) => [s.id, s]));

export function getHeartAssetSpec(id: string | undefined): HeartAssetSpec {
  return HEART_ASSETS[id ?? defaultTemplate] ?? HEART_ASSETS[defaultTemplate];
}

/** The Tier B asset a record points to (first bundled mesh reference), else the session's template. */
export function specForPatient(patient: NormalizedPatient): HeartAssetSpec {
  const ref = patient.record.imaging?.assets?.find((a) => a.kind === "mesh" && HEART_ASSETS[a.reference]);
  return getHeartAssetSpec(ref?.reference);
}
