# Agent Scheduling + Persistence

## Conversation persistence
- Agent chat UI now persists per-agent conversation locally in browser storage.
- Storage key format: `agent-chat:v1:<SOUL_MINT>`.
- A clear-chat button is available in the agent chat top bar.

## Health checks
- New endpoint: `GET /api/agent/<SOUL_MINT>/health`
- Returns machine status plus runtime `/health` probe via `fly-force-instance-id`.

## Cron scheduler
- Run one cycle:
  - `node scripts/agent-scheduler.mjs --agent <SOUL_MINT>`
- Install recurring cron:
  - `node scripts/agent-cron.mjs install --agent <SOUL_MINT> --interval 10`
- List active jobs:
  - `node scripts/agent-cron.mjs list`
- Remove one agent:
  - `node scripts/agent-cron.mjs remove --agent <SOUL_MINT>`
- Remove all agentshaus jobs:
  - `node scripts/agent-cron.mjs remove`

## Fly machine scheduler (runtime-native)
- New runtime deployments now include an on-machine scheduler (no local cron required).
- Runtime env controls:
  - `RUNTIME_SCHEDULER_ENABLED` (`true`/`false`)
  - `RUNTIME_SCHEDULER_INTERVAL_MINUTES` (default `10`)
  - `RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS` (default `20`)
  - `RUNTIME_SCHEDULER_MODE` (currently `alpha-maintenance`)
  - `RUNTIME_AUTO_RECLAIM` (`true`/`false`)
- Scheduler status is visible through:
  - `GET /api/agent/<SOUL_MINT>/health` (runtime health payload)
  - Runtime settings card (Automation + Interval rows)

## Files / context injection
- Per-agent context folder:
  - `~/.agentshaus/files/<SOUL_MINT>/`
- Add `.txt`/`.md` (or other text) files there.
- Scheduler includes up to 5 files per run (clipped per file for safety).

## Logs
- JSONL run logs:
  - `~/.agentshaus/logs/<SOUL_MINT>.<JOB_NAME>.jsonl`
- Cron stdout/stderr:
  - `~/.agentshaus/logs/<SOUL_MINT>.<JOB_NAME>.cron.log`
