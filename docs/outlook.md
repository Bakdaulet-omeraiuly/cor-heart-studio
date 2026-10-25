# Outlook: published rates of change applied to today's anatomy

The **Outlook** button in the app bar opens and closes this screen in either module. It answers one question for a
clinician: *if this anatomy changed at the published average rate for a condition, what would it look like after N
years?* It is a scenario view built from cohort averages. It is **not** a forecast for an individual, and it is not a
diagnosis or a treatment recommendation. The screen says this next to the numbers.

Code: `src/domain/outlook/` (evidence table, pure projection, heart record copy), `src/outlook/` (UI, store),
`src/brain/BrainOutlook.tsx` (brain panel and the targets the 3D deformation acts on). Tests:
`tests/unit/outlook.test.ts`, `tests/e2e/outlook.spec.ts`.

## Model

* Brain volumes compound a signed annual rate: `V(t) = V0 · (1 + r/100)^t`.
* Aortic stenosis changes linearly, because Otto 1997 reports changes per year: `AVA(t) = AVA0 + ΔA·t`,
  `Vmax(t) = Vmax0 + ΔV·t`. The area never falls below 0.3 cm².
* **Pace** chooses which end of each source's reported spread to use. The spread means different things in different
  sources, and the panel names it for every rate:
  * 95% CI of the cohort mean (Barnes 2009)
  * ±1 SD between patients (Sluimer 2008, Otto 1997)
  * no spread reported (de Leon 1989, Fjell 2009), in which case all three paces are equal

  For aortic stenosis the slower end is clamped at no progression, because mean − 1 SD would mean the valve
  opens up, which does not happen without intervention.

## Evidence (every number copied from the cited abstract)

| Target | Typical ageing | Alzheimer's disease | Source |
|---|---|---|---|
| Hippocampi | −1.41 %/y (95% CI −0.52 to −2.30) | −4.66 %/y (−3.92 to −5.40) | Barnes 2009, meta-analysis, 595 AD / 212 controls, [doi](https://doi.org/10.1016/j.neurobiolaging.2008.01.010) |
| Ventricles (lateral + third) | ≈ +2 %/y | ≈ +9 %/y | de Leon 1989, CT, 50 AD / 45 controls, [doi](https://doi.org/10.2214/ajr.152.6.1257) |
| Cortex | ≈ −0.5 %/y (temporal/prefrontal) | −1.9 ± 0.9 %/y (whole brain) | Fjell 2009, [doi](https://doi.org/10.1523/JNEUROSCI.3252-09.2009); Sluimer 2008, [doi](https://doi.org/10.1212/01.wnl.0000311446.61861.e3) |

| Aortic stenosis | Per year (mean ± SD) | Source |
|---|---|---|
| Valve area | −0.12 ± 0.19 cm² | Otto 1997, 123 adults, [doi](https://doi.org/10.1161/01.cir.95.9.2262) |
| Peak velocity | +0.32 ± 0.34 m/s | 〃 |
| Mean gradient | +7 ± 7 mmHg (shown, not projected) | 〃 |
| Alive without AVR at 2 years | < 3 m/s: 84 ± 16 %; 3–4 m/s: 66 ± 13 %; > 4 m/s: 21 ± 18 % | 〃 |
| Grade | severe: Vmax ≥ 4 m/s or AVA ≤ 1.0 cm²; moderate: 3–3.9 m/s or 1.0–1.5 cm²; mild: 2–2.9 m/s or > 1.5 cm² | ACC/AHA 2020, [doi](https://doi.org/10.1161/CIR.0000000000000923) |

## Known approximations (shown in the UI)

* **Brain anatomy vs cohorts.** The brain is one healthy adult volunteer (Mindboggle MMRR-21-5). The rates come from
  older cohorts (about 60–90 years old; AD mean about 70).
* **Cortex.** Fjell's rate is for temporal and prefrontal cortex, and Sluimer's is for the whole brain. Both are applied
  here to the whole cortex.
* **3D brain deformation.** Hippocampi and ventricles are scaled about their own centroid by the cube root of the volume
  ratio, so their shape is kept. The cortex moves inward along its normals by `2.5 mm × (1 − ratio)`, which assumes the
  volume loss is all thinning. The MRI slices are hidden while the outlook is open, because they show today's scan.
* **Ventricle rate.** It was measured on CT in 1989. A modern MRI rate would replace it once one is verified from a
  primary source.
* **3D heart.** The heart shows the projected grade through the existing stenosis rule
  (`R-VALVE-STEN-01`, an illustrative leaflet opening per grade). The quantitative picture is the orifice disc drawn to
  scale under each heart: disc area ∝ AVA, against a 3.5 cm² normal ring. The *Aortic valve* button freezes both hearts
  at mid-ejection with the outer wall see-through.
* **Individual variation.** For valve area the between-patient SD is larger than the mean. The range shown is the
  cohort spread, not a prediction interval for a person.

## Hypertensive LVH on treatment (heart)

| Quantity | Value | Source |
|---|---|---|
| LVMI change, losartan-based | −21.7 ± 21.8 g/m² (baseline → last study) | LIFE echo substudy, Devereux 2004, RCT 457 / 459, [doi](https://doi.org/10.1161/01.CIR.0000141573.44737.5A) |
| LVMI change, atenolol-based | −17.7 ± 19.6 g/m² | 〃 |
| Time base | 4.8 years of treatment | Gerdts 2009 (same substudy), [doi](https://doi.org/10.1080/08037050903047202) |
| LV mass | `0.8 · 1.04 · [(IVSd + LVIDd + PWd)³ − LVIDd³] + 0.6` g (cm) | Devereux 1986, [doi](https://doi.org/10.1016/0002-9149(86)90771-x) |
| Upper normal LVMI | 115 g/m² men, 95 g/m² women | ASE/EACVI 2015, [doi](https://doi.org/10.1016/j.echo.2014.10.003) |
| Class effects (context only) | ARB −13, CCB −11, ACEi −10, diuretic −8, β-blocker −6 % | Klingbeil 2003, [doi](https://doi.org/10.1016/s0002-9343(03)00158-x) |

* The projected mass is `LVM0 + ΔLVMI · BSA · min(1, t / 4.8)`. Between today and 4.8 years the change is
  **interpolated linearly**. This is an assumption: the abstract reports baseline and the last study only. After 4.8
  years the change is held, because the trial has no data beyond that point.
* The walls come from inverting the mass formula. IVSd and LVPWd are scaled by one common factor with LVIDd held,
  because LIFE attributes the regression mainly to reduced concentricity. No wall is thinned below 6 mm.
* The slow pace (mean + 1 SD) is clamped at no regression. The fast pace is mean − 1 SD.
* BSA comes from the record's height and weight (Mosteller). When the record has neither, an example value of 1.9 m²
  is used, and the field is labelled as an example.
* Under each heart the mid-ventricular short axis is drawn to scale (septum on the left, posterior wall on the right).
  The 3D short-axis cutaway is not offered here because clipping does not apply in the side-by-side views (an existing
  limitation of `CompareCanvas`).
* The natural course (no button on) now comes from the placebo arm of Simpson 2009; see "Treatment buttons" below for what that does and does not show.

## Treatment buttons (Now | In N years)

Buttons turn a treatment on or off; the right-hand 3D organ is recomputed from the buttons that are on, and with every button off
it shows the natural course. Code: `src/domain/treatments/` (evidence, selection, projection, chat proposals), `src/outlook/TreatmentButtons.tsx`,
the Assistant panel (`src/components/assistant/`, one chat: with the Outlook open it asks `/api/treatments/explain` and `/api/treatments` and shows the proposals as buttons), `src/app/api/treatments/`. Design: `docs/superpowers/specs/2026-10-24-treatment-scenarios-design.md`.

**Evidence rule.** A treatment effect that moves a model comes only from a randomised trial or a meta-analysis of trials
(`rct`, `meta-analysis`); a unit test fails otherwise. The natural course may come from a placebo arm or a prospective cohort and is
labelled. Observational findings are never used to move a model. Every entry carries its DOI, study type, n, duration and a caveat.

**Combination rules.**
* Buttons in the same group (for example `bp-regimen`) are never summed: switching one on switches the others off. That is an assumption
  made because no trial reports the sum of two blood-pressure regimens.
* Across groups, hippocampal effects multiply as volume factors; only one such effect has evidence today.
* A study's change is applied in proportion to elapsed time up to its follow-up and then **held**: nothing is extrapolated. The screen says so when a
  projection is past the evidence.
* Range: average = `likely`, slower = `best`, faster = `worst`. Where the unfavourable end of a treatment (or the favourable end of the natural
  course) would pass "no change", it is held at no change, as in the sections above.

**What the evidence does not support (shown honestly in the app).**
* Aortic stenosis: statins did not slow progression in three randomised trials (SALTIRE, ASTRONOMER, SEAS), so the statin button is listed with no effect
  on the valve. No verified randomised numbers for valve replacement were read, so there is no valve-replacement button in this version.
* Aerobic exercise and the hippocampus is contested: one trial in healthy older adults found about +3.5 points against controls, two later trials in
  people with memory problems found no volumetric difference. The likely value is therefore no effect; the favourable end is Erickson 2011.
  None of the trials included people with Alzheimer's dementia.
* Anti-amyloid antibodies are listed without a volumetric effect: the pooled randomised evidence (Alves 2023, Neurology) shows larger ventricles on ARIA-inducing antibodies, relative to each trial's placebo, with no per-year rate to drive the model.
* Aerobic exercise: two meta-analyses of randomised trials (Firth 2018, Balbim 2023) find no significant pooled effect on total hippocampal volume, so likely and worst stay at no effect; Erickson 2011 stays as the favourable end.
* LVH natural course: one small placebo arm (12 patients, normal office blood pressure, 1 year).

**Adding evidence.** Edit `src/domain/treatments/evidence.json` (sources and entries); the schema and `tests/unit/treatments/evidence*.test.ts`
reject missing DOIs, empty caveats and non-randomised effects. Regenerate the table below with `npx tsx scripts/evidence-table.ts`.

| Id | Kind | Label | Change | Sources |
|---|---|---|---|---|
| `lvh-natural` | natural | Natural course | 1.97 (best 0, worst 8.65) g/m² LVMI over 1 y | [Simpson 2009](https://doi.org/10.1136/hrt.2009.177238) (rct, n=35) |
| `lvh-bp-control` | treatment | Lower blood pressure | -4.68 (best -11.99, worst 0) g/m² LVMI over 1 y | [Simpson 2009](https://doi.org/10.1136/hrt.2009.177238) (rct, n=35) |
| `lvh-losartan` | treatment | Losartan-based regimen | -21.7 (best -43.5, worst 0) g/m² LVMI over 4.8 y | [LIFE · Devereux 2004](https://doi.org/10.1161/01.CIR.0000141573.44737.5A) (rct, n=916); [Gerdts 2009](https://doi.org/10.1080/08037050903047202) (rct, n=883) |
| `lvh-atenolol` | treatment | Atenolol-based regimen | -17.7 (best -37.3, worst 0) g/m² LVMI over 4.8 y | [LIFE · Devereux 2004](https://doi.org/10.1161/01.CIR.0000141573.44737.5A) (rct, n=916); [Gerdts 2009](https://doi.org/10.1080/08037050903047202) (rct, n=883) |
| `as-natural` | natural | Natural course | no effect on the model | [Otto 1997](https://doi.org/10.1161/01.cir.95.9.2262) (prospective-cohort, n=123) |
| `as-statin` | treatment | Statin | no effect on the model | [ASTRONOMER · Chan 2010](https://doi.org/10.1161/CIRCULATIONAHA.109.900027) (rct, n=269); [SALTIRE · Cowell 2005](https://doi.org/10.1056/NEJMoa043876) (rct, n=155); [SEAS · Rossebø 2008](https://doi.org/10.1056/NEJMoa0804602) (rct, n=1873) |
| `ad-natural` | natural | Natural course | no effect on the model | [Barnes 2009](https://doi.org/10.1016/j.neurobiolaging.2008.01.010) (meta-analysis, n=807); [de Leon 1989](https://doi.org/10.2214/ajr.152.6.1257) (prospective-cohort, n=95); [Fjell 2009](https://doi.org/10.1523/JNEUROSCI.3252-09.2009) (prospective-cohort, n=142); [Sluimer 2008](https://doi.org/10.1212/01.wnl.0000311446.61861.e3) (prospective-cohort, n=65) |
| `ad-exercise` | treatment | Aerobic exercise | 0 (best 3.46, worst 0) % hippocampus over 1 y | [Firth 2018](https://doi.org/10.1016/j.neuroimage.2017.11.007) (meta-analysis, n=737); [Balbim 2023](https://doi.org/10.1007/s11357-023-00971-7) (meta-analysis, n=554); [Erickson 2011](https://doi.org/10.1073/pnas.1015950108) (rct, n=120); [ten Brinke 2014](https://doi.org/10.1136/bjsports-2013-093184) (rct, n=86); [EXERT · Baker 2025](https://doi.org/10.1002/alz.14586) (rct, n=296) |
| `ad-antiamyloid` | treatment | Anti-amyloid antibody | +2.1 (best 1.5, worst 2.8) mL ventricles over 1.5 y; the length is an assumption from the 18-month lecanemab trial | [Alves 2023](https://doi.org/10.1212/WNL.0000000000207156) (meta-analysis, n=8062); [Swanson 2021](https://doi.org/10.1186/s13195-021-00813-8) (rct, n=854) |
| `ad-bvitamins` | treatment | B vitamins (folate, B6, B12) | 29.6 (best 53, worst 0) % of the natural cortex loss avoided over 2 y; whole-brain measure applied to the cortex | [VITACOG · Smith 2010](https://doi.org/10.1371/journal.pone.0012244) (rct, n=168); [Jernerén 2015](https://doi.org/10.3945/ajcn.114.103283) (rct, n=168) |

## Next candidates (not built)

* Age-matched normative centiles (Brain Charts for the Human Lifespan, Bethlehem 2022) in place of fixed rates.
