-- Index Doctor sandbox schema
-- A synthetic SaaS backend. Several index problems are deliberately planted;
-- see sandbox/ground-truth.json for the authoritative list.

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS hypopg;
CREATE EXTENSION IF NOT EXISTS pgstattuple;

-- ---------------------------------------------------------------------------
-- users: HEALTHY CONTROL. Properly indexed, all indexes used by the workload.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  country text NOT NULL,
  plan text NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);
CREATE INDEX idx_users_country ON users (country);

-- ---------------------------------------------------------------------------
-- orders: PLANTED [GT-1] missing index. The workload constantly filters by
-- user_id but there is no index on it -> heavy sequential scans.
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL,
  status text NOT NULL,
  total_cents int NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX idx_orders_created_at ON orders (created_at);

-- ---------------------------------------------------------------------------
-- order_items: PLANTED [GT-3] duplicate indexes — two identical btrees on
-- (order_id). One of them is pure waste.
-- ---------------------------------------------------------------------------
CREATE TABLE order_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id bigint NOT NULL,
  product_id bigint NOT NULL,
  qty int NOT NULL
);
CREATE INDEX idx_order_items_order_id ON order_items (order_id);
CREATE INDEX idx_order_items_order ON order_items (order_id);

-- ---------------------------------------------------------------------------
-- products: PLANTED [GT-4] large unused index (price) and [GT-14] small unused
-- index (category) — no query in the catalog touches either column.
-- ---------------------------------------------------------------------------
CREATE TABLE products (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  price_cents int NOT NULL
);
CREATE UNIQUE INDEX products_sku_key ON products (sku);
CREATE INDEX idx_products_category ON products (category);
CREATE INDEX idx_products_price ON products (price_cents);

-- ---------------------------------------------------------------------------
-- events: PLANTED [GT-2] missing composite index (user_id, created_at) — the
-- workload runs a moderately-frequent but expensive query on those columns.
-- Frequency is deliberately BELOW the heuristic seq_scan threshold.
-- PLANTED [GT-5][GT-6] two large unused indexes (type, source).
-- ---------------------------------------------------------------------------
CREATE TABLE events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL,
  type text NOT NULL,
  source text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX idx_events_type ON events (type);
CREATE INDEX idx_events_source ON events (source);
CREATE INDEX idx_events_created_at ON events (created_at);

-- ---------------------------------------------------------------------------
-- sessions: HEALTHY CONTROL. Token lookups served by the unique index.
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL,
  token text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX sessions_token_key ON sessions (token);
CREATE INDEX idx_sessions_user_id ON sessions (user_id);

-- ---------------------------------------------------------------------------
-- invoices: PLANTED TRAP [GT-9]. idx_invoices_unpaid_due is a partial index
-- used ONLY by the monthly dunning job (sandbox/queries/dunning_job.sql),
-- which has not run since the stats window started -> idx_scan = 0.
-- A naive "unused index" rule says DROP. Dropping it would make the dunning
-- job a full seq scan. Correct answer: KEEP.
-- ---------------------------------------------------------------------------
CREATE TABLE invoices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL,
  status text NOT NULL,
  amount_cents int NOT NULL,
  due_date date NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX idx_invoices_user_id ON invoices (user_id);
CREATE INDEX idx_invoices_unpaid_due ON invoices (due_date, user_id, amount_cents) WHERE status = 'unpaid';

-- ---------------------------------------------------------------------------
-- page_views: PLANTED TRAP [GT-10]. High row count + constant seq scans makes
-- naive heuristics scream "add an index", but every workload query aggregates
-- the whole table (or filters on site_id, which has 2 near-50/50 values).
-- No btree index helps; the planner would ignore it. Correct answer: NO INDEX.
-- ---------------------------------------------------------------------------
-- autovacuum off keeps the visibility map unset, mirroring a hot append-only
-- table where index-only scans are unattractive.
CREATE TABLE page_views (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id int NOT NULL,
  path text NOT NULL,
  viewed_at timestamptz NOT NULL
) WITH (autovacuum_enabled = false);

-- ---------------------------------------------------------------------------
-- messages: PLANTED [GT-7] index bloat. Seeded, then 65% of rows deleted and
-- the table vacuumed (without REINDEX) so idx_messages_sender keeps its pages.
-- ---------------------------------------------------------------------------
CREATE TABLE messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id bigint NOT NULL,
  sender_id bigint NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX idx_messages_thread ON messages (thread_id);
CREATE INDEX idx_messages_sender ON messages (sender_id);

-- ---------------------------------------------------------------------------
-- audit_logs: PLANTED [GT-8] dead-row buildup. Autovacuum disabled, then 70%
-- of rows updated in 03_damage.sql -> needs VACUUM.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id bigint NOT NULL,
  action text NOT NULL,
  detail text NOT NULL,
  created_at timestamptz NOT NULL
) WITH (autovacuum_enabled = false);
CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_id);

-- ---------------------------------------------------------------------------
-- api_keys: HEALTHY CONTROL. Small table; unique index has zero scans in the
-- window but enforces uniqueness — must not be flagged.
-- ---------------------------------------------------------------------------
CREATE TABLE api_keys (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL,
  key_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX api_keys_key_hash_key ON api_keys (key_hash);
