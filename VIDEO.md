# Solution video — 5-minute script (shot by shot)

Order: the idea → the baseline → the feature, start-to-finish → the comparison
→ changelog / biggest change / removed experiment. This covers everything the
brief requires. SHOW = what is on screen; SAY = read it (or paraphrase).

## Before you press record — checklist

1. Sandbox container up (`docker ps` shows indexdoctor-db healthy). If the
   stats look stale, do NOT re-seed now — the submitted artifacts were scored
   against this window.
2. `.env` has `DATABASE_URL=postgres://postgres:postgres@localhost:5499/indexdoctor`,
   then `npm run dev`, open http://localhost:4201. The Doctor tab must show
   "Verified Remediation Plan (10) — Generated 30/08/2026 … verified for $5.28".
3. Latency numbers are measured and final (36.9s → 21.4s agent, 50.6s
   baseline; `eval/results/measure-*.json`) — re-running the apply steps is
   not needed for the video, only the 2-second shot of the approval prompt
   (you can show it and answer N).
4. Open in your editor, large font: `eval/sandbox/ground-truth.json`,
   `HACKATHON.md` (changelog table), `eval/trajectories/2026-08-30T12-52-10-391Z/`.
5. ⚠️ The "Run Index Doctor agent" button starts a REAL run that will
   overwrite `eval/results/agent.json` and add a new trajectory — which would
   desync the video from the submitted 14/14 artifacts (ground rule 09). To
   film the live log safely: click it, record ~15 seconds of the log, then
   Ctrl+C the dev server before the run finishes, delete the new partial
   directory under `eval/trajectories/`, and restart `npm run dev`. The
   completed 14/14 plan is untouched (results are only written at the end).
   Splice the log clip in at section 3.

## 1 · 0:00–0:40 — The idea

- SHOW: the Doctor tab, top of page (logo, patient strip).
- SAY: "This is Index Doctor. Every Postgres database accumulates index debt —
  unused indexes taxing every write, bloated ones wasting cache, missing ones
  hiding inside slow queries. Monitoring tools are good at *detecting* those
  smells and bad at *prescribing* safely: their advice, executed as-is, causes
  incidents. Index Doctor is an agent that verifies every recommendation with
  database instruments before it's allowed to make it — so the plan you get is
  safe to hand to a DBA."

## 2 · 0:40–1:30 — The baseline

- SHOW: the Action Items tab against the sandbox.
- SAY: "The baseline is the dashboard I already had: classic threshold
  heuristics — the same rules most monitoring tools ship. They look
  reasonable. Two of these are landmines." Point at each:
  - "Drop unused index idx_invoices_unpaid_due, reclaim 31 MB — that index
    backs the monthly dunning job. Zero scans this month, incident on the 1st."
  - "page_views likely needs an index, check slow query logs — no columns, no
    DDL, and in fact no index helps that table at all."
- SAY: "These exact rules, ported verbatim to a scoreable CLI, are the
  baseline the agent has to beat."

## 3 · 1:30–2:00 — The eval, in one breath

- SHOW: `eval/sandbox/ground-truth.json`, scrolling slowly.
- SAY: "To measure it: a reproducible Postgres 16 sandbox, about 7.5 million
  rows, a deterministic workload, and 14 planted cases with known answers —
  9 real issues, 2 traps where the obvious fix is harmful, and 3 healthy
  controls where the right answer is 'do nothing'. Both tools are scored by
  the same script. Primary metric: correct decisions out of 14."

## 4 · 2:00–3:30 — The feature, start to finish

- SHOW: Doctor tab. Point at the patient strip.
- SAY: "The target database is configured server-side — credentials never
  touch the browser, access is read-only, the agent never executes DDL."
- SHOW: click **Run Index Doctor agent**; ~15s of the live log (triage
  candidates appearing). Cut to the completed run (see checklist item 5).
- SAY: "Triage reads the same statistics snapshot the dashboard renders, plus
  pg_stat_statements. Then every candidate gets its own verification
  conversation with instruments: HypoPG hypothetical indexes, EXPLAIN, exact
  bloat, and the application's query catalog. About seven minutes, $5.28."
- SHOW: scroll the **Verified Remediation Plan (10)**. Stop on the first
  critical card, `events (user_id, created_at DESC)`.
- SAY: "Every card is evidence, not opinion. This index is invisible to
  seq-scan counters — the planner was serving the most expensive query in the
  database through the *wrong* index. pg_stat_statements found it, HypoPG
  proved the planner would use the fix — a ~3,800x cost reduction — and it
  even tested and rejected a covering variant that bought nothing."
- SHOW: scroll to **Examined and Deliberately Left Alone**.
- SAY: "This section is the point. The invoices index the heuristics wanted
  to drop — KEEP: the agent found dunning_job.sql in the app's query catalog.
  page_views — NO ACTION: HypoPG proved no btree changes the plan. And a 66%
  leaf density reading was cleared as normal fill, not bloat — instruments
  come with calibration."
- SHOW: on the invoices card, expand **"evidence trail · how this was verified"**.
- SAY: "And every verdict expands into the raw tool calls behind it — the
  agent's trajectory, rendered as a product feature."

## 5 · 3:30–4:10 — The comparison

- SHOW: the **Scoreboard — Agent vs. Heuristics** section.
- SAY: "Same snapshot, same scorer: 14 out of 14 correct decisions against
  the heuristics' 10. Both traps passed versus both failed. 100% precision
  versus 82. And every one of the agent's recommendations ships executable
  DDL with a rollback — the heuristics ship zero."
- SAY: "And it's not just decisions on paper. Applied to a clone behind a
  human approval gate, the agent's plan cuts the measured workload from 36.9
  to 21.4 seconds — the events query alone goes from 25 milliseconds to a
  quarter of one. The baseline's plan, applied the same way, makes the
  workload 37% *slower* than doing nothing: its blind drops send the dunning
  job from under a millisecond to 27." SHOW the `npm run apply:agent`
  approval prompt for ~2 seconds while saying "human approval gate".

## 6 · 4:10–5:00 — Changelog, biggest change, removed experiment

- SHOW: HACKATHON.md improvement-changelog table.
- SAY: "Every iteration is evidence-linked. The first scored run was 13 out
  of 14 — the one miss flagged a healthy unique index at 70% leaf density as
  bloated. The instrument was right; the interpretation baseline was missing.
  We added that calibration to the verifier and the final run is 14 for 14 —
  that run is archived, both are in the repo."
- SAY: "The biggest quality jump didn't come from prompting. It came from
  replacing tools that estimate with tools that measure — HypoPG answers
  'would the planner use this index' as a fact."
- SAY: "The experiment we removed: our first sandbox sized planted issues
  with naive bytes-per-row math. Postgres 13's btree deduplication compressed
  them two-x below the estimates — the planted bloat was invisible to our own
  dashboard's estimator. We threw that sizing away, and the lesson became the
  design: agents inherit the epistemics of their tools. Give an agent an
  estimator and you get confident guesses with citations. Give it instruments
  and you get verification."

## Recording notes

- Pre-run everything; never wait on camera. Terminal and editor font large.
- The video's numbers must match the submitted artifacts (ground rule 09):
  plan generated 30/08/2026, $5.28, 14/14 — trajectory
  `eval/trajectories/2026-08-30T12-52-10-391Z/`.
- Privacy toggle stays OFF — everything on screen is synthetic sandbox data.
