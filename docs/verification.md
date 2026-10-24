# Verification (2026-10-24)

Environment: Apple M2, macOS 15.6.1, Node 24.16.0, Google Chrome 155 (ANGLE Metal), Next.js 16.4.2.

| Check | Command | Result |
|---|---|---|
| Clean install | `npm ci` | lockfile committed (not re-run from scratch in a clean clone) |
| Type check | `npm run typecheck` | pass |
| Lint | `npx eslint .` | pass (0 errors, 0 warnings) |
| Unit/integration | `npm test` | **47/47 pass** (normalization, mapping determinism & rules, CSV/JSON import, duplicates, formula injection, rendered LV volume, segment continuity, cycle) |
| Production build | `npm run build` | pass, `/` prerendered static |
| End-to-end | `npm run test:e2e` | **10/10 pass**: render loop running, import→select→render→explanation, rejected/duplicate decisions, patient switching, structure isolate/restore, cutaway/overlay/playback/keyboard, 2- and 4-way comparison, manual entry, light theme, WebGL-disabled fallback |
| Performance | `node tests/perf/measure.mjs` | first usable frame **1.6 s**; single view **55 fps** (target 60 — not met); four-way compare **60 fps**; JS heap 75 MB; assets served gzip |

Deployment: https://cor-heart-studio.vercel.app (Vercel, production). Smoke test 2026-10-24: `/`, models,
samples and schema return 200 (Brotli); `node tests/perf/measure.mjs https://cor-heart-studio.vercel.app` →
first usable 2.1 s, 55 fps single view, 60 fps four-way compare. The full e2e suite was run locally, not
against the deployment.

Asset sizes: low 6.2 MB (3.4 MB gzip), high 13.9 MB (7.5 MB gzip).

## Measured rendered volumes (TS deformation on the real LV cavity mesh)

| Input | Rendered ED | Rendered ES |
|---|---|---|
| none (baseline) | 104.2 mL | 46.9 mL (default, labelled unknown) |
| EDV 170 | 170.0 mL | — |
| EDV 150 / ESV 90 | 150.0 mL | 90.0 mL (EF 40.0%) |
| EF 25% | 104.2 mL | 78.2 mL |

## Not verified

- GPU shader output vs the TypeScript reference (only visually consistent).
- Mobile devices, Safari, Firefox; real low-end hardware.
- Long-session memory growth when switching patients repeatedly (not measured).
- Screen-reader walkthrough (only labelled controls, keyboard and focus were checked).
- Clinical correctness of anything: out of scope.
