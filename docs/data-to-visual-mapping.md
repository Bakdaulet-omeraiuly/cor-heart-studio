# Data-to-visual mapping (mapping v1.0.0)

The mapping is one pure function, `mapPatientToVisual(patient, reference, capabilities)` in
`src/domain/mapping/mapPatientToVisual.ts`. It has no React, WebGL, clock or randomness: the same
normalized record, reference profile and asset capabilities always produce byte-identical output
(tested). Its output (`PatientVisualState`) contains structure parameters, animation parameters,
segment arrays, valve states, highlights, a list of **visual changes with provenance**, warnings,
unsupported findings, unknowns and version identifiers (`mappingVersion`, `assetId/assetVersion`,
`referenceProfileId`, `inputHash`).

## Provenance carried by every visual change

Each `VisualChange` records: target structure (and AHA segments), changed property, a plain-language
summary, source field paths with original and normalized values/units, rule ID and version, evidence
class, whether the result is quantitative / qualitative / illustrative, the formula, any display
clamping, unresolved conflicts, and limitations. The inspector's **Visual changes** tab shows them;
clicking a change selects the structure in 3D, and selecting a structure lists the changes that drive it.

Evidence classes: reported measurement ●, reported assessment ◆, derived ▲, illustrative inference ◌,
default/unknown ?. Symbols accompany colours everywhere.

## Reference profile = asset baseline, not normal ranges

`asset-baseline-v1` (`src/domain/references/asset-baseline.ts`) uses values **measured from the
procedural asset at rest** (written by the asset builder into the manifest):

| Baseline | Value | How measured |
|---|---|---|
| LV end-diastolic cavity volume | 104.2 mL | Closed LV-cavity mesh volume (divergence theorem) |
| LV epicardial volume | 224.5 mL | Closed LV epicardial mesh, cut at the valve plane |
| LVEDD | 45.7 mm | Septal–lateral cavity chord at 30% of cavity length |
| IVSd / LVPWd | 9.5 / 9.5 mm | Wall chords at the same level |
| LA volume | 25.8 mL | LA cavity mesh volume (appendage excluded) |
| RV basal diameter | 26.3 mm | Widest septum-to-free-wall chord at the base (±0.6 rad of the septal direction) |
| RA minor dimension | 34.5 mm | RA ellipsoid inner minor axis |

Defaults for absent data are illustrative placeholders, labelled default/unknown in the UI:
heart rate 70 bpm, LV EF-equivalent 55%, RV EF-equivalent 50%.

## Rules

| Rule | Input(s) | Visual response | Nature | Formula / notes |
|---|---|---|---|---|
| R-HR-01 | `observations.heartRate` (else `ecg.heartRate`, labelled) | Real-time cycle frequency | quantitative | RR = 60 / HR. Playback slow-motion is a separate multiplier and never changes the displayed HR. |
| R-LV-DIM-01 | LVEDD | LV endocardial short-axis scale | quantitative | `radial = LVEDD / 45.7 mm`. Epicardium follows so wall thickness is kept: `epi = (R·radial + T)/(R + T)` with the asset's mean cavity radius R and wall T. |
| R-LV-VOL-01 | LVEDV + LVEDD | LV long-axis scale | quantitative | `long = (EDV / 104.2) / radial²` — volume and diameter are combined, never interchanged. |
| R-LV-VOL-02 | LVEDV only | Uniform LV cavity scale | quantitative (shape illustrative) | `linear = ∛(EDV / 104.2)` — a volume ratio is not applied per axis. |
| R-LV-EF-01 | LVEF | LV volume excursion ED→ES | quantitative | `ESV/EDV = 1 − EF/100`. Longitudinal share `L = 0.27·EF/100` (illustrative split); endocardial radial factor `√((ESV/EDV)/(1−L))`. |
| R-LV-EF-02 | LVEDV + LVESV | Animate between the two volume targets | derived | `EF = 100 × (EDV − ESV)/EDV`; a reported EF differing by > 5 points is shown as a conflict (rendering follows the volumes). |
| — (built in) | — | Epicardium moves less than endocardium | illustrative | Myocardial volume conservation: epicardial ES volume = epicardial ED volume − stroke volume. Systolic wall thickening emerges from this. |
| — (built in) | EF | LV torsion | illustrative | Base/apex counter-rotation, 12° at EF 55%, scaled by `(1 − ESV/EDV)/0.45`. |
| R-LV-WALL-01 | IVSd → segments 2, 3, 8, 9, 14; LVPWd → 5, 11; `echo.wallThickness[]` regions or segments | Regional wall thickness | quantitative (named segments) + illustrative taper | `Δ = measured − 9.5 mm`, applied 35% outward / 65% inward. Adjacent segments taper to ½Δ (labelled interpolated). The heart is never enlarged as a substitute. |
| R-LV-WMA-01 | `echo.regionalWallMotion[]` (AHA 17) | Local inward motion of the named segment | qualitative | normal 1, hypokinetic 0.45, akinetic 0, dyskinetic −0.35, aneurysmal −0.55 (illustrative convention). Smoothly interpolated across segment borders (no tearing). |
| R-RV-DIM-01 | RV basal diameter | RV free wall moves away from the septum | quantitative | `scale = RVD / 26.3 mm`, applied beyond the septal reference radius. |
| R-RV-EF-01 | RVEF | RV excursion | quantitative | as LV, longitudinal share 0.3. |
| R-LA-VOL-01 | LA volume | LA uniform scale | quantitative (shape illustrative) | `∛(LAV / 25.8 mL)`. |
| R-RA-DIM-01 | RA minor dimension | RA uniform scale | quantitative (shape illustrative) | `RA / 34.5 mm`. |
| R-VALVE-STEN-01 | valve + stenosis + severity | Restricted maximum opening of the named valve | qualitative | trace .95, mild .75, mild–moderate .65, moderate .52, moderate–severe .42, severe .30, unspecified .60 of the illustrative full opening. A reported area is displayed, not converted. |
| R-VALVE-REGURG-01 | valve + regurgitation | Labelled amber reverse-flow particles during that valve's closed phase + small coaptation gap | illustrative | Jet length/gap by category only. Not measured flow, velocity or CFD. |
| R-VALVE-PROLAPSE-01 | valve + prolapse | Leaflets billow beyond the annulus when closed | illustrative | Affected scallop not represented. |
| R-TISSUE-01 | CT/MRI fibrosis/scar or tissue characterization with an AHA segment | Hatched overlay on that segment | qualitative | Geometry unchanged; extent within the segment not represented. |

Display-only inputs (blood pressure, SpO₂, temperature, respiratory rate, labs, ECG intervals and
rhythm text, Doppler, symptoms, notes, conclusions, diagnoses) are shown with provenance and **never**
change geometry. GLS is shown next to a qualitative cue and is never expanded into a strain field.

### Missing data

Missing observations leave the baseline geometry in place and add an *unknown* item (shown in the
Evidence tab and as a badge in the library). Missing never means normal. Diagnosis-only records do not
receive invented dimensions; there are no diagnosis presets in this release.

### Conflicts and context

- ESV ≥ EDV: both volumes are excluded (error) and the conflict is shown.
- A phase that contradicts the field (e.g. LVEDD with `phase: "end-systole"`) or an indexed value
  excludes that value from geometry.
- Different observation dates for EF and volumes raise a notice; they are not merged silently.
- Missing/unknown units keep the value but exclude it from rendering, with a suggested unit.

## Visual safety bounds

Bounds protect the mesh only and never rewrite clinical values. When a bound applies, a
`display.clamped` warning is raised and the change shows a *Display* note.

| Quantity | Bound |
|---|---|
| LV short-axis scale | 0.70 – 1.60 |
| LV long-axis scale | 0.80 – 1.35 |
| RV scale | 0.70 – 1.80 |
| Atrial scale | 0.75 – 1.90 |
| Regional wall change | −6 mm … +16 mm |
| Animatable heart rate | 20 – 250 bpm |
| ESV/EDV ratio | ≥ 0.05 |

## Rendered-volume verification

`tests/unit/deform-volume.test.ts` applies the TypeScript reference of the vertex-shader deformation to
the asset's real LV cavity mesh and checks:

- baseline volume equals the manifest value;
- end-diastolic volume reaches a supplied EDV within 3% (measured: 170 → 170.0 mL);
- the ED→ES excursion reproduces the supplied EF within 3 points (measured: 150/90 mL → EF 40.0%);
- lower EF ⇒ larger rendered ESV.

The GLSL copy (`src/scene/materials/deformGlsl.ts`) mirrors that function line by line; a GPU-side
numerical comparison is **not** automated (see `docs/verification.md`). Segmental motion abnormalities
deliberately modulate local motion, so with a wall-motion finding the rendered ESV no longer equals the
EF target exactly; the change card says so.

## Cardiac cycle template

`src/domain/mapping/cycle.ts`: phase 0 = end-diastole. Isovolumic contraction 50 ms; ejection from the
Weissler et al. (1968) LVET regression `LVET ≈ 0.413 − 0.0017·HR s`; isovolumic relaxation 70 ms;
rapid filling up to 160 ms; atrial contraction ≤ 120 ms; diastasis takes the remainder. Valves: semilunar
open only in ejection, AV valves only after isovolumic relaxation (partially drifting closed in diastasis,
reopening with atrial contraction) — never both on the same side (tested). This template only places
events in time; its shape is illustrative. It is drawn as a volume curve, **not** an ECG.

## Clinical thresholds

None are implemented. Automatic labels such as "dilated", "reduced EF" or "severe" are not generated
from numbers, because no current primary guideline thresholds with population, method and applicability
have been sourced and reviewed for this project. Supplied severities are displayed as supplied.

## Flow depiction

Flow particles (off by default) follow fixed anatomical paths (venae cavae → RA → RV → PA;
pulmonary veins → LA → LV → aorta), are neutral white (no oxygenation coding), move at constant speed,
and wait at closed valves; they never move backward. Reverse-flow cues exist only for a supplied
regurgitation finding. Tier D (measured or computed flow) is not implemented.
