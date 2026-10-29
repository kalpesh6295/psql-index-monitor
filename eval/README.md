# Eval harness

Everything in this directory exists to **measure** Index Doctor against a
reproducible fixture — none of it is required to run the product. The app
(`client/`, `server/`, `agent/`, `shared/`) works against any PostgreSQL
database: point DATABASE_URL at a database and run the agent from the Doctor tab.

- `sandbox/` — Dockerized Postgres 16 fixture: synthetic schema (~7.5M rows),
  planted ground-truth cases (`sandbox/ground-truth.json`), the synthetic
  application's query catalog (`sandbox/queries/*.sql` — used as the workload,
  the latency measurement set, and the agent's app-query catalog *when
  targeting the sandbox*), and the deterministic workload driver.
- `baseline/` — the dashboard's Action Items heuristics as a CLI, so they can
  be scored on identical terms with the agent.
- `score.ts` / `score-lib.ts` — scores any plan against the ground truth.
- `apply.ts` — executes a plan against a **clone** of the sandbox after human
  approval, then measures workload latency. Hard-refuses non-sandbox targets.
- `results/` — shareable artifacts. `local-private/` (gitignored) — artifacts
  from any non-sandbox database, kept out of the repository by construction.

Quick start: `npm run reproduce` from the repo root (Docker required).
