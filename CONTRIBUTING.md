# Contributing

## Setup (once)
```bash
git clone https://github.com/Bakdaulet-omeraiuly/cor-heart-studio.git
cd cor-heart-studio
npm ci
npm run dev        # http://localhost:3000
```
Needs Node 24 and Google Chrome (for the e2e tests).

## Every task
```bash
git pull --rebase
# … work (by hand, with Claude Code or Kiro) …
npm run typecheck && npm run lint && npm test
git add -A && git commit -m "what changed"
git pull --rebase && git push       # straight to main is fine; a branch/PR is optional
```
No approval needed. A push to `main` deploys to production automatically — if it breaks, `git revert <sha>` and push.

## AI agents
Claude Code reads `CLAUDE.md`, Kiro reads `AGENTS.md` — both point to the same rules in `AGENTS.md`.
Change the rules there, in a PR, so everyone's agent follows the same ones.
