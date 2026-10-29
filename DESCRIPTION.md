# Index Doctor — submission description

Postgres monitoring tools are good at detecting index smells and bad at
prescribing fixes. My own dashboard was telling me to drop an "unused" index
that a monthly billing job depends on, and to add an index to a table where no
index would ever help. That is the problem here: threshold heuristics produce
advice nobody can act on safely. Checking each item by hand takes a senior
engineer 30 to 60 minutes, and skipping the check causes incidents.

Index Doctor is the agentic layer I built on top of that dashboard during this
hackathon. You point it at a PostgreSQL database and the agent works in three
phases. First it triages the same stats snapshot the dashboard renders. Then a
skeptical verifier takes each candidate and has to prove it, correct it, or
throw it out using read-only tools: HypoPG to test whether the planner would
actually use a proposed index, EXPLAIN, exact bloat measurement with
pgstatindex, pg_stat_statements, and the application's query catalog. What
survives becomes a plan where every item carries its evidence, exact
production-safe DDL, and a rollback. Each recommendation card in the UI can be
expanded to show the raw tool calls behind it. The agent never executes
anything; DDL only runs through a separate human-approved harness, and only
against a clone of the eval sandbox.

I scored it against a fair baseline: the dashboard's own heuristic rules, run
as a CLI on the same 14 planted ground-truth cases in a reproducible Docker
sandbox (including 2 trap cases and 3 healthy tables).

| Metric | Heuristics | Index Doctor |
|---|---|---|
| Correct decisions | 10/14 | **14/14** |
| Traps passed (harmful advice avoided) | 0/2 | **2/2** |
| Recall / Precision | 7/9 / 82% | **9/9 / 100%** |
| Recommendations with runnable DDL | 0/11 | **10/10** |
| Workload after applying the plan to a clone (unmodified: 36.9s) | 50.6s — 37% slower than doing nothing | **21.4s — 42% faster** |
| Cost per run (measured) | free | $5.28 |

The heuristics fell for both traps; applied as-is, their plan makes the
workload slower than ignoring them, because the blind drops send the billing
job from under a millisecond to 27. The agent refused both traps and could
show why, and its top find — a composite index invisible to seq-scan counters
— takes the most expensive query from 25ms to 0.25ms.

One number I want to be honest about: the first scored run was 13/14. The
agent flagged a healthy unique index at 70% leaf density as bloated — the
instrument was right, the interpretation baseline was missing. I added density
calibration to the verifier and the final run is 14/14; both runs are in the
repo, the first one archived.

Some engineering details I care about: the agent detects which instruments
exist on the target database and degrades to conservative, lower-confidence
verdicts when they are missing (this came from pointing it at a real dev
database and watching it crash). Every connection is forced read-only at the
session level by a single shared pool factory. Cost is bounded by design, at
most 16 verification conversations per run no matter how big the database is.
Results from any non-sandbox database are routed to a gitignored folder
automatically, because I leaked my own schema into the repo twice before
making that structural. The whole repo passes strict TypeScript, and CI
rebuilds the sandbox and re-scores the baseline on every push.

To be clear about scope: the React dashboard and its heuristic rules existed
before the competition and serve as the baseline. The agent, the eval sandbox
with ground truth, the scorer, the apply harness, the Doctor UI, and the docs
were all built during it.

Reproduce with `npm install && npm run reproduce` (Docker required), then add
an Anthropic API key for the agent run. HACKATHON.md has the full changelog
with all 8 iterations including the failed ones, plus the reproduction guide
and the hot take. SUBMISSION.md maps every deliverable to its file.
