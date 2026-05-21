# psql-index-monitor

PostgreSQL index performance dashboard. Connects to any PostgreSQL database and gives you a full picture of index health with actionable recommendations.

## Quick Start

```bash
git clone git@github.com:Berg-Group/psql-index-monitor.git
cd psql-index-monitor
npm install

# Copy and configure env
cp .env.example .env
# Edit .env — set DATABASE_URL to your PostgreSQL connection string

npm run dev
# Frontend: http://localhost:4201
# API:      http://localhost:4200
```

## Configuration

| Variable       | Default | Description                              |
| -------------- | ------- | ---------------------------------------- |
| `DATABASE_URL` | —       | PostgreSQL connection string **(required)** |
| `PORT`         | `4201`  | Vite dev server port                     |
| `API_PORT`     | `4200`  | Express API port                         |

SSL is auto-enabled for non-localhost connections (e.g. RDS).

A read-only database user is sufficient — all queries are SELECT-only against `pg_stat_*` views.

## Dashboard Tabs

| Tab                | What it shows                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| **Action Items**   | Prioritized recommendations (critical/warning/info) computed from all metrics. Default landing.  |
| **Overview**       | Total indexes, tables, sizes, cache hit ratio, top tables chart, usage distribution pie          |
| **All Indexes**    | Every index with size, scans, tuples, type (PK/Unique/Index), definition                        |
| **Unused**         | Indexes with zero scans (excluding PK/unique) — candidates for removal                          |
| **Most Used**      | Top 50 indexes by scan count                                                                    |
| **Table Sizes**    | All tables with data/index/total size, row counts, dead rows %, vacuum timestamps               |
| **Bloat**          | Estimated B-tree index bloat — color-coded with reindex recommendations                         |
| **Duplicates**     | Indexes covering identical columns — safe candidates for removal                                |
| **Seq vs Idx**     | Sequential vs index scan ratio per table                                                        |
| **Missing Indexes**| Tables with high seq scans + many rows — likely need new indexes                                |
| **Write Overhead** | Tables ranked by write cost (writes x index count), HOT update %, insert/update/delete breakdown|
| **Index:Table Ratio** | Tables where index size exceeds data size — sign of over-indexing                            |

## Action Items Logic

The Action Items tab computes recommendations by analyzing data from all other tabs:

- **Drop Index** — unused indexes > 10 MB, duplicate indexes
- **Reindex** — bloat > 30% (warning) or > 50% on large indexes (critical)
- **Add Index** — tables with high seq scans, many rows, few index scans
- **Vacuum** — tables with > 20% dead rows
- **Review** — index:table ratio > 2x, tables with 10+ indexes under heavy writes, low HOT update %

## Tech Stack

- **Backend**: Express + pg (raw SQL against `pg_stat_*` views)
- **Frontend**: React 19 + Vite + Recharts
- **Scope**: Only `public` schema indexes and tables

## Notes

- All metrics come from PostgreSQL's built-in statistics views (`pg_stat_user_indexes`, `pg_stat_user_tables`, `pg_statio_user_indexes`, etc.)
- Stats are cumulative since the last `pg_stat_reset()` — keep this in mind when interpreting scan counts
- The bloat estimation uses a heuristic based on `pg_stats` — it's an approximation, not exact
