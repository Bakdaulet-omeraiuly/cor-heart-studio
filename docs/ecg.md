# ECG strip and heartbeat timing

The heart view shows a **lead-II-like ECG schematic** under the metrics. It is synthesized from the record's intervals
and locked to the 3D heart's cycle. It is not a recording. Supplied waveform samples are still plotted as they are,
in the inspector.

| What | How | Source |
|---|---|---|
| Rate | Heart rate from the record sets RR = 60/HR | record |
| Systole length | LVET = 413 − 1.7·HR ms (already used by `cycle.ts`) | Weissler 1968, [doi](https://doi.org/10.1161/01.cir.37.2.149) |
| Electromechanical coupling | QRS onset is placed one pre-ejection period (PEP = 131 − 0.4·HR ms) before aortic valve opening; QS2 = 546 − 2.1·HR ms is shown for comparison with QT | Weissler 1968 (men) |
| PR, QRS, QT | From the record (`ecg.prInterval`, `ecg.qrsDuration`, `ecg.qtInterval`); QT can also come from a reported QTc by inverting its stated correction | record |
| Missing intervals | Shown as **default**: PR 160 ms and QRS 90 ms (typical adult values); QT = Framingham mean for this RR, 0.379 − 0.154(1 − RR) s | Sagie 1992, [doi](https://doi.org/10.1016/0002-9149(92)90562-d) |
| QTc | Bazett QT/√RR, Fridericia QT/∛RR, Framingham QT + 0.154(1 − RR) | Bazett 1920; Fridericia 1920; Sagie 1992 |
| Morphology | Sum of Gaussian P, Q, R, S, T events, the form of the McSharry 2003 dynamical ECG model; amplitudes and widths are illustrative | McSharry 2003, [doi](https://doi.org/10.1109/TBME.2003.808805) |

Each interval carries a badge: **reported**, **derived** (from the reported QTc) or **default**. The grid is ECG paper:
40 ms / 0.1 mV minor squares and 200 ms / 0.5 mV major squares. The trace sweeps with the same clock as the 3D heart,
including pause and the phase scrubber.

Not modelled: axis, ST/T morphology, conduction abnormalities, arrhythmia and heart-rate variability. A rhythm or
ST statement in the record is shown as text only.
