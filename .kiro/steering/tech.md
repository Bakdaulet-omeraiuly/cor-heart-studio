---
inclusion: always
---
# Tech and workflow

Repository rules live in `AGENTS.md` (Kiro and Claude Code both read it). This file only adds what agents get wrong
most often.

- **Stack:**
  - Next.js 16 (App Router, Turbopack). Read `node_modules/next/dist/docs/` before touching routes; the APIs differ
    from older versions.
  - React 19, React Three Fiber, Zod 4, Zustand, Vitest 5, Playwright.
- **Before every push:**
  - `git pull --rebase`, then `npm run typecheck && npm run lint && npm test`.
  - UI changes also need `npm run build && npm run test:e2e`.
  - A push to `main` deploys to production on Vercel.
- **Domain code is pure:** no React, no clock, no randomness, no network in `src/domain/**`.
- **Unknown stays unknown:** use `null` and normalization statuses; never fill in a default.
- **Reuse, don't copy:**
  - units and plausibility: `normalizeRecord()`;
  - CAD-RADS: `cadRads()`;
  - QTc: `qtcBazett()` / `qtcFridericia()`;
  - AS grades: `gradeByVelocity()` / `gradeByArea()`;
  - LV mass: `lvMassAse()`.
- **Field registry:** `src/domain/schema/fields.ts` is the single source of truth for scalar observations. After
  changing it, regenerate `docs/medical-data-dictionary.md` with `npx tsx scripts/generate-data-dictionary.ts`.
