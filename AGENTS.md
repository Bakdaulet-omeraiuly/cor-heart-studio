<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# COR Studio — rules for every contributor and agent (Claude Code, Kiro, …)

Next.js 16 + React Three Fiber app: Heart and Brain modules rendered from open, labelled segmentation data.
Visualization demo with synthetic/open data — **not a medical device, no diagnosis**.

## Workflow
- Each contributor works and pushes on their own — straight to `main` or via a branch/PR, their choice. No approval needed.
- Stay in your own area (see `docs/tasks/`) so you don't overwrite each other; `git pull --rebase` before every push.
- Before every push: `npm run typecheck && npm run lint && npm test`. UI changes also: `npm run build && npm run test:e2e`.
  A push to `main` deploys to production automatically — if it breaks the site, `git revert` and push.

## Data and honesty
- `data/` and `pipeline/` (CT/MRI sources, Python pipeline) are not in git and never go to Vercel (`.vercelignore`).
  The app runs without them; published models live in `public/`.
- Never commit real patient data, DICOM, `.env*` or keys.
- Every visual must keep an honest provenance label: CT-derived vs echo vs illustrative. Accuracy numbers mean
  fidelity to the segmentation (see `docs/cor-fit.md`), never clinical accuracy. Outlook screens are cohort averages
  from cited papers (`docs/outlook.md`), never an individual forecast.
- Check licences before adding any dataset or model (current sources are CC BY 4.0 / CC BY-SA).

## Where things are
- `src/` app code, `src/imaging/` shared slice code, `tests/` Vitest + Playwright, `docs/` design and science notes.
- UI rules: `docs/design-system.md` (one line on screen, details behind ⓘ).
