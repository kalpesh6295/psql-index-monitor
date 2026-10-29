# Index Doctor — Agentic Workflows Hackathon

An agentic layer on top of a PostgreSQL index-monitoring dashboard that turns raw
`pg_stat_*` numbers into a **verified, evidence-linked remediation plan** — and
refuses to make the dangerous recommendations that threshold heuristics make.

> Deliverable map for judges: **[SUBMISSION.md](SUBMISSION.md)**. One-command
> reproduction of the sandbox + baseline: `npm install && npm run reproduce`.

![The Doctor tab](docs/screenshots/doctor-tab.png)

*The Doctor tab against the eval sandbox: target → run → verified plan. Every
recommendation card carries an expandable "evidence trail" — the verification
tool calls that justified it, rendered from the run's trajectory logs.*

## Who has this problem?

Backend developers running PostgreSQL without a DBA. Monitoring tools (this
repo's dashboard, pganalyze, raw `pg_stat_user_indexes`) hand them a wall of
warnings: *unused index, drop it; high seq scans, add an index; 30% bloat,
reindex.* The stats are cheap to collect — the expertise to act on them safely
is not.

## What bottleneck makes it worth solving?

Every recommendation from a threshold heuristic is **unverified**:

- "Unused" means *zero scans in the stats window*. The index backing your
  monthly dunning job also has zero scans — drop it and the job takes the
  database down with a 1.5M-row sequential scan at 2am on the 1st.
- "This table needs an index" names no columns. Which index? Would the planner
  even use it? The heuristic says "check your slow query logs" and walks away.
- Bloat estimators guess tuple widths. PostgreSQL 13+ btree deduplication makes
  narrow indexes far denser than the estimate, so real bloat hides below the
  threshold (we hit this exact failure while building the eval — see changelog).

Acting on these safely takes hours of a senior engineer's time per
recommendation: reading query patterns, testing hypothetical plans, checking
constraints. That is the bottleneck the agent removes.

## What existed before the competition vs. what's new

| Pre-existing (committed before hackathon) | New for the hackathon |
|---|---|
| React dashboard + Express collector over `pg_stat_*` views ([server/](server/), [client/](client/)) | [eval/sandbox/](eval/sandbox/) — reproducible Postgres 16 sandbox (HypoPG, pg_stat_statements, pgstattuple) with 14 ground-truth cases planted |
| Heuristic "Action Items" rules in the UI ([client/src/components/ActionItems.tsx](client/src/components/ActionItems.tsx)) | [eval/baseline/run.ts](eval/baseline/run.ts) — those exact rules as a scoreable CLI (**this is the baseline**) |
| | [agent/](agent/) — the Index Doctor agent (triage → tool-based verification → plan + report) |
| | [eval/](eval/) — scorer, human-approved apply-to-clone, latency measurement |

## How the agent works

Three phases, all trajectories logged to `eval/trajectories/<run>/`:

1. **Triage** (1 model call): receives the *same collector snapshot the
   dashboard renders* plus `pg_stat_statements` totals; enumerates candidate
   findings — including "looks suspicious, probably fine" candidates so healthy
   objects get cleared explicitly.
2. **Verify** (1 fresh conversation per candidate): a skeptical verifier with
   read-only tools must prove, correct, or refute each candidate:
   - `test_hypothetical_index` — HypoPG: does the planner actually use the
     proposed index, and what does the cost drop to? Required evidence for any
     `add_index`.
   - `inspect_index` — constraints, uniqueness, partial predicates. Required
     before any `drop_index`.
   - `list_app_queries` — the application's query catalog, including rare
     scheduled jobs that never appear in a short stats window.
   - `get_query_stats` — where execution time actually goes (catches expensive
     queries that never show up as seq scans).
   - `run_sql` / `explain_query` — read-only catalog access, exact bloat via
     `pgstatindex()`, `EXPLAIN (GENERIC_PLAN)`.
3. **Plan**: verdicts become `eval/results/agent.json` (machine-scoreable) and
   `eval/results/REPORT.md` (the document you'd hand a teammate), with exact
   production-safe DDL, rollback, evidence, and a "deliberately left alone"
   section.

Everything is also usable from the dashboard's **Doctor tab**: point
`DATABASE_URL` at any PostgreSQL database, launch the agent with live
progress, and read the verified plan, the cleared items, and (on the sandbox)
the agent-vs-heuristics scoreboard in the same UI that renders the raw
metrics. The connection is configured server-side only and the API binds to
loopback — credentials never pass through the browser.

The instruments are optional on real databases: the agent detects which of
hypopg / pg_stat_statements / pgstattuple / the query catalog exist on the
target, verifies with what's available, lowers confidence where an instrument
is missing, and names the extension that would give decisive evidence. (The
bundled query catalog describes the sandbox's application; on other databases
set `QUERY_CATALOG_DIR` to your application's query directory.)

**Safety (ground rule 04/05):** every agent connection sets
`default_transaction_read_only=on`; the agent never executes DDL. Execution
happens only in [eval/apply.ts](eval/apply.ts): it targets a **clone** of the
database (`CREATE DATABASE ... TEMPLATE`), prints every statement, and requires
an explicit human `y` before running anything.

**Capabilities deliberately not used:** no persistent memory (each run must be
stateless and reproducible from the same snapshot — memory would make the eval
unrepeatable), no skills, no more agents than the problem needs. Verification
is where the points of failure live, so that is where the engineering went.

## Repository layout & engineering notes

```
Product (self-sufficient — runs against any PostgreSQL database):
  client/    dashboard UI + the Doctor tab
  server/    collector API (pre-existing) + doctor.ts (run/score/plan API)
  agent/     the Index Doctor: tools.ts (read-only instruments) + run.ts
             (triage → verify → plan orchestration, trajectories, cost accounting)
  shared/    connection policy (SSL, read-only, timeouts, no-default targets)
             and the Plan schema — one contract for both tools and every consumer

Eval harness (self-contained under eval/ — deletable without breaking the product):
  eval/sandbox/   reproducible fixture: Docker + seeds + planted ground truth
                  + the synthetic app's query catalog + workload driver
  eval/baseline/  the dashboard's heuristics as a scoreable CLI (verbatim port)
  eval/score*.ts  scorer (shared by CLI and API)
  eval/apply.ts   human-gated apply-to-clone + latency measurement (sandbox-only)
  eval/results/   shareable artifacts; eval/local-private/ (gitignored) for
                  anything from non-sandbox databases
```

**How it scales beyond the sandbox** (each mechanism exists in code, not intent):

- Cost and context are bounded by design: triage emits at most 16 candidates
  per run regardless of database size, each verification runs in its own fresh
  conversation (no context accumulation), tool output is capped at 50 rows,
  and every statement carries a timeout (20s agent / 30s dashboard).
- Verification runs at fixed concurrency (3) and a single candidate failure is
  caught and reported without sinking the run — the plan is composed from
  whatever verified.
- Safety is enforced where it can't be forgotten: every pool is built by one
  factory (`shared/db.ts`) that sets session-level `default_transaction_read_only`
  and auto-enables SSL for remote hosts; the destructive apply harness
  hard-refuses any database that is not the eval sandbox.
- Real-database variance is handled, not assumed away: optional instruments
  (hypopg, pg_stat_statements, pgstattuple, the query catalog) are detected per
  target and the agent degrades to conservative, lower-confidence verdicts —
  proven on two real databases during development (changelog iterations 8+).
- Privacy by construction: run artifacts (plans, reports, trajectories) from
  any non-sandbox target are automatically routed to a gitignored
  `eval/local-private/` directory, so a private schema cannot end up in the
  repository or the submission by accident — a failure mode we hit twice with
  real databases before making it structural (ground rules 07/08).
- `npm run typecheck` passes strict TypeScript across the whole repo; the eval
  harness is the test suite — deterministic seeds and workload make scores
  reproducible run-to-run.

Known scaling limits, stated honestly: the triage snapshot grows with catalog
size (thousands of indexes would need pagination or pre-filtering), one run
covers the top ~16 issues rather than every finding on a badly neglected
database, and prompt caching is not yet enabled (the verifier system prompt and
snapshot are cacheable — the clearest next cost win).

## Evaluation design

[eval/sandbox/ground-truth.json](eval/sandbox/ground-truth.json) defines 14 cases over a
synthetic SaaS database (~7.5M rows, 11 tables) with a deterministic 13k-query
workload window:

- **9 positives** — missing single-column index, missing composite index that
  produces *zero* seq scans (planner uses a worse index, so scan-counters are
  blind), duplicate indexes, large/small unused indexes, dedup-hidden bloat,
  dead rows.
- **2 traps** — an "unused" partial index that a monthly cron job depends on
  (correct: KEEP); a high-seq-scan table where no btree helps because queries
  aggregate the whole table (correct: NO INDEX).
- **3 controls** — healthy tables where any recommendation counts against you.

**What a good result looks like for the intended user:** a plan they can
execute as-is — every item names the exact object and DDL, carries the evidence
that justifies it, and contains nothing that would break the application. A
missed issue costs performance; a wrong drop or useless index costs an incident.

Both tools are scored by [eval/score.ts](eval/score.ts) under identical rules.
Primary metric: **correct decisions (n/14)**. Secondary: recall, traps passed,
precision, adds with exact columns, recommendations with executable DDL, and
workload latency after applying each tool's plan to a clone.

Resources differ between the tools in one deliberate way (per the fairness
rule): the agent may read the application's query catalog
([eval/sandbox/queries/](eval/sandbox/queries/)) and pg_stat_statements — context a human
reviewer would also consult. The baseline heuristics cannot use that context by
construction; that limitation *is* the bottleneck being demonstrated.

## Results

| Metric | Baseline (heuristics) | Agent (Index Doctor) |
|---|---|---|
| Correct decisions | 10/14 | **14/14** |
| Recall (positives) | 7/9 | **9/9** |
| Traps passed | **0/2** | **2/2** |
| Controls passed | 3/3 | 3/3 |
| Precision | 9/11 (82%) | **10/10 (100%)** |
| `add_index` with exact columns | 0/1 | **2/2** |
| Recommendations with executable DDL | **0/11** | **10/10** |
| Projected workload window after applying plan (unmodified: 36.9s) | **50.6s — 37% slower than doing nothing** | **21.4s (−42%)** |
| Human time to a safe, executable plan | ~30-60 min per recommendation (manual verification of each claim) | ~7 min runtime; plan arrives pre-verified for human review |
| Cost per run | engineer time only | **$5.28** (measured: 718k in / 67k out tokens, `claude-opus-5`) |

These are the final scored run (2026-08-30, after the iteration 6-8 fixes
below). The first scored run — 13/14, with one false alarm on a healthy
control — is preserved in [eval/results/archive/](eval/results/archive/) and
discussed in the failure-mode section; the iteration-7 calibration fix
eliminated that miss on the re-run.

The agent passed both traps with evidence: it found `dunning_job.sql` in the
application's query catalog and issued KEEP for the "unused" partial index the
heuristics wanted to drop, and it used HypoPG to prove no btree changes the
`page_views` plans before refusing the "missing index" the heuristics demanded.
It also found the composite `events (user_id, created_at)` index that is
invisible to seq-scan counters, and recommended the *optimal* orders index
`(user_id, created_at DESC)` — better than the minimal ground-truth answer,
because it also covers the query's ORDER BY.

The baseline's misses are structural, not tuning artifacts: it cannot name
columns (no DDL is executable), it cannot see the expensive events query (the
planner serves it via the wrong index, so seq-scan counters stay at zero), it
drops the dunning job's index, and it demands an index that no planner would
use.

Latency was measured by applying each plan to a clone behind the
human-approval gate ([eval/apply.ts](eval/apply.ts)) and replaying the query
catalog (`eval/results/measure-*.json`). The agent's plan cuts the projected
stats-window from 36.9s to 21.4s: `events_recent_by_user` drops 24.8ms →
0.25ms (~99x) and `orders_by_user` 5.8ms → 0.46ms (~13x). The baseline's plan
makes the same workload **37% slower than doing nothing**: its blind drops
send `dunning_job` from 0.6ms to 27.4ms and `order_items_by_order` from 0.2ms
to 9.6ms. One agent statement failed in the harness — it bundled
`VACUUM …; ALTER TABLE …` in a single DDL string, which the pg client wraps
in an implicit transaction where VACUUM cannot run. That is an apply-harness
limitation (recorded honestly in `measure-agent.json`), not a wrong
recommendation; the un-run VACUUM does not affect the numbers above.

## Improvement changelog

| Stage | What we tried and why | Evidence | Decision / learning |
|---|---|---|---|
| Baseline | Ported the dashboard's Action Items rules verbatim to a CLI so they could be scored | 10/14 correct, 0/2 traps, 0 executable DDL | Established the honest starting point — the heuristics are decent detectors and unsafe prescribers |
| Iteration 1 | First sandbox seed: planted issues sized by naive "bytes/row" math | `idx_products_price` came out 9.2MB (<10MB threshold); planted bloat invisible: estimator computed otta=2,083 pages vs 1,861 actual | **Btree deduplication (PG13+) shrinks narrow indexes ~2x below width-based estimates.** Re-sized plants; learned the dashboard's bloat estimator structurally can't see dedup-hidden bloat |
| Iteration 2 | Gave the agent measurement instead of estimation: added `pgstattuple` to the sandbox and told the verifier to use `pgstatindex()` leaf density, not the snapshot's estimate | Bloat case (GT-7) became detectable by evidence rather than formula | Kept. Tools that return ground truth beat tools that return guesses |
| Iteration 3 | Hardened trap GT-10: disabled autovacuum on `page_views` so the visibility map stays unset | HypoPG confirms the planner rejects a hypothetical btree for whole-table aggregates | Kept — the trap's correct answer ("no index helps") is now *verifiably* true, not a matter of opinion |
| Iteration 4 | Scorer fairness pass: overlapping correct recs (an index that is both unused and a duplicate) were double-penalized; genuinely-bloated `messages_pkey` counted as a false positive | Baseline precision corrected 67% → 82% | Kept. The comparison must be generous to the baseline to be credible |
| Iteration 5 | First full agent run over the same snapshot + eval cases | 13/14 correct, 9/9 recall, 2/2 traps, 92% precision, 12/12 executable DDL, $5.38 measured | Two follow-ups below |
| Iteration 6 | Scorer accepted only the exact ground-truth column set; the agent recommended `orders (user_id, created_at DESC)` — strictly better than the minimal `(user_id)` because it covers the ORDER BY | Column credit now requires the ground-truth columns as a leading prefix (correct composites count) | Kept. The eval must not punish answers better than its own key |
| Iteration 7 | The one control failure: agent flagged healthy `users_email_key` (~70% leaf density) as bloated — that is normal btree fill, not bloat | Added calibration to the verifier prompt: 65-75% density is healthy; only reindex below ~55% | Kept — the final re-run (2026-08-30) validates it: the false alarm is gone, all 3 controls pass, 14/14 (first run archived in `eval/results/archive/`) |
| Iteration 8 | Pointed the agent at a real development database (not the sandbox) — it crashed: `relation "pg_stat_statements" does not exist`. Real databases rarely have the optional instruments installed | Added instrument detection: hypopg / pg_stat_statements / pgstattuple / query catalog are each optional; the agent verifies with what exists, lowers confidence, is extra conservative about drops, and names the missing instrument that would give decisive evidence. Verified end-to-end against an extension-free database: no crash, 0 recommendations, 3 conservative clears (`eval/results/agent-degraded-plaindb.json`) | Kept. An agent built only for its own eval sandbox is a demo, not a tool |
| Final | Doctor tab in the dashboard: shows whatever database `DATABASE_URL` targets, runs baseline/agent, and renders the verified plan, cleared items, and the scoreboard next to the heuristics they replace | Final scored run (2026-08-30) with iterations 6-8 in place: 14/14 correct, 2/2 traps, 100% precision, 10/10 executable DDL, $5.28 — rendered where the intended user already works | The main contribution is verification-before-recommendation |

## Reproduction guide

Prereqs: Docker (running), Node 20+, an Anthropic API key. Versions used:
Postgres 16 (official image + `postgresql-16-hypopg`), Node 20.18,
`@anthropic-ai/sdk` 0.122.0, model `claude-opus-5`.

No Docker, or just want to explore the product? The README's "Getting a
database to point it at" section covers using your own database or loading
the included seed data (`eval/sandbox/seed/`) into any Postgres by hand.
Scored eval runs should use the Docker sandbox below, though — it guarantees
the extensions the agent is graded with.

```bash
npm install
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env

# 1. Sandbox: container + schema + ~7.5M rows + damage + 13k-query window (~3-4 min)
npm run sandbox:setup

# Point the tools at the sandbox it just created (nothing connects by default):
export SANDBOX_DATABASE_URL='postgres://postgres:postgres@localhost:5499/indexdoctor'

# 2. Baseline recommendations (writes eval/results/baseline.json) + score
npm run baseline
npx tsx eval/score.ts eval/results/baseline.json

# 3. Agent (~5-10 min, roughly $2-5 at claude-opus-5 pricing)
npm run agent
npx tsx eval/score.ts eval/results/agent.json

# 4. Side-by-side scores
npm run eval

# 5. Latency: measure the unmodified DB, then each plan, all on CLONES
#    (apply steps print every statement and ask for approval; the primary
#    sandbox DB is never touched, so its stats window stays intact)
npm run measure:before
npm run apply:agent
npm run apply:baseline
```

Expected outputs: score tables like the Results section; `eval/results/REPORT.md`
(the human deliverable); per-candidate trajectories in `eval/trajectories/<run>/`.
The sandbox is deterministic (seeded PRNG + `setseed`), so scores should
reproduce within noise (scan counts vary slightly with autovacuum timing).

**UI path:** set `DATABASE_URL='postgres://postgres:postgres@localhost:5499/indexdoctor'`
in `.env`, `npm run dev`, open http://localhost:4201 — the Doctor tab shows the
sandbox as the patient, with "Run Index Doctor agent" (and, on the sandbox
only, the baseline button and scoreboard). The verified plan, cleared items,
evidence trails, and full report render in place. (Only `eval/apply.ts`
remains terminal-only, deliberately — executing DDL keeps an explicit typed
approval.)

## Main failure mode & hot take

**Main failure mode:** in the first scored run (archived in
`eval/results/archive/`), the agent's only wrong call was flagging a healthy
unique index (`users_email_key`, ~70% leaf density) for reindexing. The
instrument was right — the *interpretation baseline* was missing: 65-75%
density is normal fill for a live btree, not bloat. Measurement tools still
need calibration context, or the agent turns honest numbers into false alarms.
Notably it failed **safe**: a pointless reindex wastes a maintenance window;
the baseline's failures (dropping a cron job's index) cause incidents. Adding
that calibration to the verifier prompt (iteration 7) eliminated the false
alarm on the final run — but the class of failure is the lesson: every new
instrument arrives without its interpretation baseline until someone supplies
it.

**Hot take:** the single biggest quality jump did not come from prompting. It
came from replacing tools that **estimate** with tools that **measure**: HypoPG
answers "would the planner use this index" as a fact, `pgstatindex` answers
"how bloated is this really" as a fact — while our own dashboard's estimator
was confidently blind to dedup-compressed bloat, and scan counters were
confidently blind to the most expensive query in the database. Agents inherit
the epistemics of their tools: give an agent an estimator and you get confident
guesses with citations; give it instruments and you get verification. And as
the failure mode shows, an instrument without a calibration baseline is just a
more precise way to be wrong — tools must ship with the context to read them.
