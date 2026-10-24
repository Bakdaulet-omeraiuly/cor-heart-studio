# Architecture

```
src/
  domain/            pure TypeScript, no React/WebGL
    schema/          Zod runtime schema (record.ts), field registry (fields.ts)
    normalization/   one adapter: raw → validated + canonical units + derived values + issues
    import/          CSV parse/export (Papa Parse), import preview (duplicates, limits, statuses)
    mapping/         mapPatientToVisual (pure), cycle timing template, types
    references/      asset-baseline reference profile + asset capabilities
    provenance/      deterministic interpretation summary (never diagnoses)
  scene/             browser-only, loaded via next/dynamic ssr:false
    asset-adapters/  GLB loader + manifest + nearest-vertex attribute sampler
    animation/       deform.ts (TS reference of the shader), per-view clocks
    materials/       tissue material (onBeforeCompile), GLSL deformation mirror
    geometry/        valve generator, camera presets, cut planes
    layers/          ValveRig, FlowRig (imperative, updated in useFrame)
    annotations/     DOM label overlay projected from 3D anchors
    performance/     device tier, WebGL probe
    HeartCanvas / CompareCanvas / HeartModel / CameraRig / SceneEnvironment
  components/        workspace shell, library, inspector, import, editor, comparison, UI primitives
  state/store.ts     Zustand session store (memory only)
scripts/heart-asset/ offline procedural asset builder (Node)
```

## Data flow

raw JSON/CSV/form → `normalizeRecord` → `NormalizedPatient` (original kept) →
`mapPatientToVisual(patient, ASSET_BASELINE_PROFILE, PROCEDURAL_ASSET_CAPABILITIES)` → `PatientVisualState`
→ per frame: `sampleCycle(phase)` + `frameParams` → shader uniforms. Clinical values and display geometry
live in separate types; the renderer never classifies.

## Rules kept

- No React state updates per frame: clocks and uniforms are mutable objects read in `useFrame`;
  the phase indicator is throttled (~12 Hz).
- Geometry is shared between views; materials/uniforms are per patient. Comparison uses one WebGL
  context (drei `View`) with a 2–4 view cap.
- Patient data stays in memory: no URLs, no localStorage, no analytics, no console logging. A dev-only
  `window.__cor` store handle exists for debugging and is stripped from production builds.
- Resources are disposed on unmount (materials, valve/flow geometry, BVH).
- Failure states: asset load error → 2D fallback; no WebGL → 2D fallback; context loss → restore or 2D.

## Extension points (not implemented)

- Tier B: a validated patient mesh adapter implementing the same attribute contract (`heartAsset.ts`).
- Tier C: DICOM → segmentation → mesh pipeline producing a Tier-B asset.
- Tier D: measured/computed flow replacing `FlowRig`.
- Clinical thresholds: `ReferenceProfile.classificationThresholds` (currently `null`).
- Optional LLM extraction of free-text reports into the schema (must stay optional and reviewable).
