# Anatomy review

**Review status: self-review by the implementing agent only. No cardiologist, anatomist or medical
illustrator has reviewed this asset. Nothing here is clinically validated.**

## References used for proportions and topology

General anatomy knowledge consistent with standard references (e.g. *Gray's Anatomy*, 42nd ed.;
Netter, *Atlas of Human Anatomy*; AHA 17-segment model — Cerqueira et al., *Circulation* 2002;
Weissler et al. 1968 for LVET vs heart rate). No reference image was traced and no dimensions were
copied from a specific person. Proportions were set by eye and checked against the asset's measured
baseline (LVEDD 45.7 mm, IVSd 9.5 mm, LV EDV 104 mL, RV basal 26 mm, LA 26 mL).

## Detail checklist

| Item | Present | Notes |
|---|---|---|
| Asymmetric silhouette, base/apex, LV/RV surfaces | yes | RV occupies ~⅔ of the anterior surface; LV forms the left border and apex |
| Atrial appendages | yes | Lobulated LAA tucked by the pulmonary trunk; broad RAA over the aortic root |
| Grooves (AV sulcus, anterior/posterior IV) | yes | Derived from the surface field, filled with lobulated fat |
| Great vessels with wall thickness, open cut ends | yes | Aortic arch + 3 branches, sinuses of Valsalva, PA bifurcation, SVC/IVC, 4 pulmonary veins |
| Coronary arteries / veins | yes | LM, LAD, LCx, RCA, PDA, D1, D2, OM, AM, conus; GCV, coronary sinus, MCV, anterior cardiac vein; right-dominant pattern only |
| Epicardial fat in appropriate regions | yes | AV sulcus and IV grooves only |
| Real interior chambers, septa, wall thickness in section | yes | Closed solid mesh, section shading on cut faces |
| Trabeculae / pectinate muscles | approximated | Procedural ridges, not individual trabeculae |
| Papillary muscles + moderator band | yes | 2 LV papillary muscles, RV anterior papillary, moderator band |
| Valve annuli, leaflets with thickness | yes | Saddle mitral annulus, crown-shaped semilunar annuli, 2/3/3/3 leaflets, 0.45 mm-scale shells |
| Chordae on AV valves only | yes | Attached to deformed free edges and papillary tips each frame |
| Fossa ovalis, conduction system, pericardium, valve nodules/lunules | no | Not modelled |

## Realism acceptance rubric (evidence in `docs/visual-review/`)

| Review item | Status | Evidence / reason |
|---|---|---|
| Silhouette | **pass** | `anterior.png`, `posterior.png`, `left-lateral.png`, `right-lateral.png`, `superior.png` — recognisable from every side; no disconnected primitives |
| Vessel integration | **pass** | Smoothly blended roots, visible wall thickness at cut ends (`superior.png`, cutaways) |
| Tissue realism | **needs revision** | Restrained and seam-free, but procedural colour/relief only (no baked maps); surface reads slightly smooth/illustrative rather than photographic |
| Interior | **pass** | `cutaway-four-chamber-*.png`: four chambers, septum, papillary muscles, chordae, wall thickness |
| Valve close-up | **needs revision (improved)** | Leaflets are now Bézier membranes with bellies, scalloped mitral edges, a coaptation zone, tapering thickness and grid-derived normals (`valve-mitral-open.png`, `valve-aortic-closed.png`); severe aortic stenosis shows a small triangular orifice (`valve-aortic-stenosis-closeup.png`). Still visibly CG at close range: no nodules/lunules, uniform material, and at the four-chamber cut edge part of a mitral leaflet can appear outside the sectioned wall |
| Dynamic coherence | **pass (visual inspection only)** | No tearing or detached vessels observed across the cycle; weights are continuous by construction. Not checked automatically for self-intersection |
| Measurement response | **pass** | Volume tests (exact EDV/ESV targets); SYN-02/03/07 visibly change only relevant structures |
| Annotation | **pass** | Labels follow live 3D anchors, hide when occluded or clipped |
| Overlay clarity | **pass** | Hatch patterns + legend, both themes (`e2e-clinical-overlay-syn07.png`, `abnormality-wall-thickening-syn03.png`, `e2e-light-theme.png`) |
| Runtime presentation | **pass** | 55 fps single view / 60 fps four-way compare on Apple M2 (see verification) |

## Known defects

1. Valve leaflets read as illustration rather than tissue in close-up; the mitral regurgitation cue is small at the default framing.
2. Fixed: choosing the short-axis cut now frames the cut face from the base (`cutaway-short-axis.png`).
3. One acute-marginal/anterior-cardiac branch on the RV runs as a near-straight line (`right-lateral.png`).
4. No baked normal/roughness textures; micro-detail is procedural.
5. Coronary course fixed to one right-dominant pattern; no variants.
6. A coronary ostium tube end is visible inside the aortic root in the aortic close-up.
