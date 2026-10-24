# COR Studio design system

Goal: read like professional imaging software (OHIF, 3D Slicer, cvi42, HeartFlow), not a consumer app.

## Principles (from radiology UI practice)

1. **Images first, minimal chrome.** Docked toolbars and panels; nothing floats over the image except
   DICOM-style corner text. (Minimal-GUI reading stations read faster.)
2. **Neutral grey surfaces, colour only for meaning.** Hue is reserved for data (structures, evidence
   classes), plane identity (axial red / coronal green / sagittal blue) and the one accent for the
   active control (OHIF "neutral" presets work the same way).
3. **Dark by default, with real contrast.** Reading rooms are dim; but readers spend over half their time
   on text, so every text token meets WCAG AA (≥ 4.5:1) on every surface.
4. **Patient context once, globally.** Name / ID / study / modality / provenance tier live in the app
   bar, not repeated per viewport.
5. **Dense, aligned numbers.** Tabular mono digits, units in muted text, right-aligned columns.
6. **Provenance is part of the picture.** Every view says where its data comes from (badge or corner text).
7. **One line on screen, the rest behind ⓘ.** Each view shows its primary values and a one-line source
   ("CT template · illustration · fit 89.1%"); methods, formulas, label codes, citations and per-metric
   sources sit in `InfoTip` (hover or keyboard focus, kept in the DOM). Detail is moved, never deleted.

## Tokens (dark; light theme mirrors them)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#08090b` | app background, behind viewports |
| `--panel` / `-2` / `-3` | `#0e1013` / `#14171b` / `#1b1f24` | panels, rows/inputs, hover/selected |
| `--border` / `-strong` | `#22262c` / `#30353d` | dividers / control outlines |
| `--text` | `#e8eaed` | primary text (≥ 13.7:1) |
| `--muted` | `#a2aab5` | secondary text (≥ 7:1) |
| `--faint` | `#848e9a` | tertiary text, units (≥ 4.98:1) |
| `--accent` | coral `#e8836b` | brand + the active control only |
| viewport | `#000` / `#050608` | image and 3D backgrounds |

## Type

Geist (UI) and Geist Mono (numbers). Sizes: 11 px micro labels (uppercase, `tracking-wider`), 12 px
body/data, 13 px controls, 15 px titles. Numbers always `.num` (tabular).

## Layout

- App bar 44 px: brand · module tabs (Heart | Brain) · patient context · session/theme.
- Workspaces are columns of docked panels. Each panel: 36 px header (micro label + controls on the right),
  body, optional footer.
- Viewports: toolbar docked in the panel header, playback docked as the panel footer, corner text for
  provenance; legend collapsed by default.
- MPR evidence column on the right (brain MRI, heart CT) with colour-coded plane headers and crosshairs.

## Phase 2 (implemented)

- Metric strip under each 3D view: brain totals; heart key numbers with their source on every cell
  (Tier B: CT segmentation volumes, LV mass derived ×1.05 g/mL; Tier A: reported values, unknown shown as "—").
- Inspector collapses from the app bar to widen the 3D view.
- Brain: choosing a structure in the list turns the camera to it (from its hemisphere's side) and makes
  the cortex see-through for deep structures.

## Annotations

- Structure labels are thin annotations (dot, 1 px leader, haloed text), never badges.
- Off by default: only the hovered and the selected structure are named. All labels: Layers ›
  Structure labels, or key **L**. Selected label uses the accent colour.
