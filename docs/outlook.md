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
* There is no untreated arm. No verified per-year rate of progression in untreated hypertension was found.

## Next candidates (not built)

* Age-matched normative centiles (Brain Charts for the Human Lifespan, Bethlehem 2022) in place of fixed rates.
