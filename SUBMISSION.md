# Submission map

Where each required deliverable lives, so nothing needs hunting.

| Deliverable | Location |
|---|---|
| Problem, user, bottleneck | [HACKATHON.md](HACKATHON.md) — first three sections |
| Pre-existing vs. added for the competition | [HACKATHON.md](HACKATHON.md) — comparison table |
| Solution code | [agent/](agent/) (the Index Doctor), [server/doctor.ts](server/doctor.ts) + Doctor tab ([client/src/components/Doctor.tsx](client/src/components/Doctor.tsx)), [shared/](shared/) |
| Agent instructions (prompts) | [agent/run.ts](agent/run.ts) — `TRIAGE_SYSTEM`, `VERIFY_SYSTEM`, report-writer system prompt |
| Baseline | [eval/baseline/run.ts](eval/baseline/run.ts) — verbatim port of the dashboard heuristics |
| Improvement changelog | [HACKATHON.md](HACKATHON.md) — "Improvement changelog" (every iteration evidence-linked) |
| Evaluation: cases, scorer, rules | [eval/sandbox/ground-truth.json](eval/sandbox/ground-truth.json), [eval/score.ts](eval/score.ts) (+ [eval/score-lib.ts](eval/score-lib.ts)) |
| Results & evidence | [eval/results/](eval/results/) — plans, scores inputs, latency measurements; archive of the first scored run in [eval/results/archive/](eval/results/archive/) |
| Agent trajectories | [eval/trajectories/](eval/trajectories/) (JSONL per run: triage, one file per verification, report) — also rendered in-product: each recommendation card's **evidence trail** in the Doctor tab |
| Reproduction guide | [HACKATHON.md](HACKATHON.md) — "Reproduction guide"; quick start: `npm install && npm run reproduce` |
| Solution video | (link provided with the submission) |
| Main failure mode & hot take | [HACKATHON.md](HACKATHON.md) — final section |
