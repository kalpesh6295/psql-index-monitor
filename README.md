# Index Doctor

A PostgreSQL index dashboard with an agent that verifies index recommendations
before making them. Point it at a database, see the full picture of index
health, and get a remediation plan where every item carries tool-verified
evidence, exact DDL, and a rollback.

![Index Doctor](docs/screenshots/doctor-tab.png)

Built for the micro1 Agentic Workflows Hackathon: the dashboard and its
heuristic rules predate the competition and serve as the measured baseline; the
agent, eval harness, and Doctor UI were built during it. The full story,
results (14/14 correct decisions vs the heuristics' 10/14), changelog, and
reproduction guide are in **[HACKATHON.md](HACKATHON.md)**. Every submission
deliverable is mapped in **[SUBMISSION.md](SUBMISSION.md)**.

## Quick start

```bash
npm install
npm run dev
# open http://localhost:4201
```

The app starts disconnected. Point it at a database by setting `DATABASE_URL`
in `.env` (see `.env.example`) and restarting; every tab then shows that
database. The connection is configured server-side only — there is no
connect-from-the-browser, so credentials never pass through the client, and
the API binds to localhost. A read-only role is enough for the dashboard. To
run the agent, also add `ANTHROPIC_API_KEY`.

## Getting a database to point it at

Three options, in order of effort:

**Option A — your own database.** Set `DATABASE_URL` in `.env` to any
PostgreSQL database and restart. A read-only role is enough for the dashboard;
the agent is more useful when `pg_stat_statements`, `hypopg`, and
`pgstattuple` are installed, but it detects what's missing and adapts.

**Option B — the Docker sandbox (recommended for judging).** A database with
14 known, planted problems, built in one command (Docker required, ~3–5 min):

```bash
npm run sandbox:setup
```

Then set in `.env` and restart:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5499/indexdoctor
```

This runs the container with the right extensions, loads the seed data,
plants the damage, and drives the query workload automatically.

**Option C — no Docker: load the included data into your own Postgres.** The
same seed data ships in this repository at
[eval/sandbox/seed/](eval/sandbox/seed/). Load it into a fresh database in
order, then run the workload so the statistics views have something to show:

```bash
createdb indexdoctor
psql -d indexdoctor -f eval/sandbox/seed/01_schema.sql   # schema + indexes (~7.5M rows total after step 2)
psql -d indexdoctor -f eval/sandbox/seed/02_data.sql     # data, takes 1-2 min
psql -d indexdoctor -f eval/sandbox/seed/03_damage.sql   # planted problems + stats reset
SANDBOX_DATABASE_URL=postgres://localhost:5432/indexdoctor npm run workload
```

Then set `DATABASE_URL` in `.env` to the same URL and restart. Notes:
`01_schema.sql` tries to create the `pg_stat_statements`, `hypopg`, and
`pgstattuple` extensions — if any aren't installed on your server, psql
prints an error and continues, and the dashboard still works fully (the agent
just loses some verification tools and says so). Likewise the
`pg_stat_statements_reset()` call in `03_damage.sql` is safe to see fail.
Only Option B guarantees all extensions, so eval scores are only comparable
against the Docker sandbox.

## The Doctor

The agent works in three phases against whatever database is connected:

1. **Triage** the same statistics snapshot the dashboard renders, plus
   pg_stat_statements when available.
2. **Verify** each candidate in its own conversation with read-only tools:
   HypoPG hypothetical-index tests (does the planner actually use it?),
   EXPLAIN, exact bloat via pgstatindex, and your application's query catalog
   (`QUERY_CATALOG_DIR`) so an index used only by a monthly job is not called
   "unused". Missing instruments are detected and the agent gets conservative
   instead of confident.
3. **Plan**: recommendations with severity, evidence, production-safe DDL and
   rollback, plus a list of things it examined and deliberately left alone.
   Every card's "evidence trail" expands into the raw tool calls behind it.

Safety, enforced in code rather than promised: every connection sets
`default_transaction_read_only=on` at the session level, all statements carry
timeouts, the agent never executes DDL, and artifacts from any non-sandbox
database are routed to a gitignored folder so private schemas stay out of the
repository.

## Dashboard tabs

| Tab | What it shows |
| --- | --- |
| Doctor | The target database, the agent run, and the verified plan |
| Action Items | The classic threshold heuristics (drop/reindex/add/vacuum) |
| Overview | Sizes, cache hit ratio, usage distribution |
| All Indexes / Unused / Most Used | Every index with size, scans, definition |
| Table Sizes / Bloat / Duplicates | Table health, estimated btree bloat, duplicate indexes |
| Seq vs Idx / Missing Indexes | Scan patterns and likely missing indexes |
| Write Overhead / Index:Table Ratio | Write amplification and over-indexing signals |

All metrics come from PostgreSQL's built-in statistics views and are cumulative
since the last `pg_stat_reset()`. The bloat figures on the Bloat tab are
estimates; the agent measures exactly when pgstattuple is installed.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | none | The database to analyze (server-side only, by design) |
| `ANTHROPIC_API_KEY` | none | Required for agent runs |
| `AGENT_MODEL` | `claude-opus-5` | Model for the agent |
| `QUERY_CATALOG_DIR` | none | Directory of your app's .sql queries, used as drop-safety evidence |
| `SANDBOX_DATABASE_URL` | none | CLI target for `npm run agent` / `npm run baseline` (no default by design) |
| `PORT` / `API_PORT` | 4201 / 4200 | Dev server ports |

SSL is enabled automatically for non-localhost connections.

## Eval harness

Everything used to measure the agent against the baseline lives in
[eval/](eval/) and is self-contained (see [eval/README.md](eval/README.md)):
a Dockerized sandbox with planted ground truth, the heuristics as a scoreable
CLI, the scorer, and a human-approved apply-to-clone harness for latency
comparisons. One command reproduces the sandbox and baseline score:

```bash
npm run reproduce
```

CI runs the same reproduction on every push.
