# Coronary arteries and stenosis

## Where the vessels come from

The default anatomy (Rodero 2021 healthy CT heart) has no coronaries in its source mesh. `pipeline/cor_pipeline/coronary.py`
routes a **right-dominant** pattern over its epicardium:

* **Grooves.** A groove is where two chamber "outer" distance fields are equal on the true outside surface. The
  atrioventricular groove is where the ventricles meet the atria; the interventricular groove is where the LV meets
  the RV. Vertices next to a blood pool are excluded, because in this mesh the RV cavity lies directly on the septal
  LV epicardium.
* **Ostia.** The ostia sit about 1 cm above the aortic annulus: the left one in the left (posterior) sinus, the right
  one in the right (anterior) sinus. The direction comes from the aortic lumen.
* **Paths.** Each vessel is the cheapest path over the surface graph, where the cost is the groove mismatch in mm.
  * The left system runs from the left ostium to the apex. Its first 10 mm is the left main (a typical length,
    assumption); the rest is the LAD.
  * The LCx leaves at the end of the left main and runs round the left AV groove to the lateral wall.
  * The RCA runs from the right ostium through the acute margin to the crux.
  * The PDA runs from the crux about two thirds of the way to the apex.
* **Calibres** are from Dodge et al. 1992, [doi:10.1161/01.cir.86.1.232](https://doi.org/10.1161/01.cir.86.1.232):
  LM 4.5, proximal LAD 3.7 → distal 1.9, proximal RCA 3.9 and proximal LCx 3.4 mm. Distal RCA, LCx and PDA calibres
  are tapered assumptions and are marked as such in the manifest.
* **Epicardial fat** is drawn within 3–9 mm of the vessel centrelines. The arteries ride on it: their centre is
  about one diameter above the muscle.

This is a template pattern, not anyone's coronary anatomy. The manifest, the inspector and every change record say so.

## Stenosis (record → drawing)

Records may carry `coronaryFindings: [{ vessel, segment?, stenosisPercent, plaque?, source? }]`:

* `vessel`: LM, LAD, LCx, RCA or PDA. Common names are accepted.
* `segment`: proximal, mid or distal. These are drawn at the thirds of the modelled vessel.
* `stenosisPercent`: diameter stenosis, 0–100.
* `plaque`: noncalcified, partially_calcified or calcified.

**CAD-RADS 2.0** (Cury et al. 2022, [doi:10.1016/j.jcmg.2022.07.002](https://doi.org/10.1016/j.jcmg.2022.07.002)) is
graded per patient from the most severe stenosis:

| Category | Stenosis |
|---|---|
| 0 | 0 % |
| 1 | 1–24 % |
| 2 | 25–49 % |
| 3 | 50–69 % |
| 4A | 70–99 % |
| 4B | left main ≥ 50 %, or ≥ 70 % in the LAD, LCx and RCA territories (the PDA counts as RCA here) |
| 5 | 100 % |

The renderer narrows the tube toward its centreline by the reported diameter fraction over an illustrative 10 mm
cosine profile, using the `_CORO` vertex attribute (vessel id, position along the vessel, lumen radius). Plaque is
tinted yellow when non-calcified and chalk-white when calcified. The procedural heart has no lumen handles: there a
stenosis is listed as unsupported, and the CAD-RADS grade is still shown, because it describes the record, not the
drawing.
