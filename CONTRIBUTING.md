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
git checkout main && git pull
git checkout -b my-feature
# … work (by hand, with Claude Code or Kiro) …
npm run typecheck && npm run lint && npm test
git push -u origin my-feature
gh pr create        # or open the PR on github.com
```
Merge only after review. Don't push to `main`.

## AI agents
Claude Code reads `CLAUDE.md`, Kiro reads `AGENTS.md` — both point to the same rules in `AGENTS.md`.
Change the rules there, in a PR, so everyone's agent follows the same ones.
