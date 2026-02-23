# Repository Agent Instructions

## Push + Deploy Default

- For this repository, when a user asks to "push" changes, do both actions in the same run:
  1. Push the current branch to GitHub remote `origin` (`https://github.com/kiran-nebula/agentshaus.git`).
  2. Deploy to Vercel production for project `agents` in team `nebula-labs`.
- Run Vercel deploy from repository root (`/Users/kiran/agentshaus`) so the linked project root settings are respected.
- Do not switch to another Vercel project unless the user explicitly asks.
