-- Index Doctor sandbox data (~6M rows total, deterministic via setseed).
-- Approx runtime: 1-2 minutes.

SELECT setseed(0.42);

INSERT INTO users (email, country, plan, created_at)
SELECT
  'user' || g || '@example.com',
  (ARRAY['US','GB','DE','IN','BR','JP'])[1 + floor(random() * 6)::int],
  (ARRAY['free','free','free','pro','enterprise'])[1 + floor(random() * 5)::int],
  now() - (random() * interval '720 days')
FROM generate_series(1, 200000) g;

INSERT INTO products (sku, name, category, price_cents)
SELECT
  'SKU-' || lpad(g::text, 8, '0'),
  'Product ' || g,
  (ARRAY['electronics','apparel','home','toys','grocery','sports','beauty','auto'])[1 + floor(random() * 8)::int],
  100 + floor(random() * 9999900)::int
FROM generate_series(1, 800000) g;

INSERT INTO orders (user_id, status, total_cents, created_at)
SELECT
  1 + floor(random() * 200000)::bigint,
  (ARRAY['pending','paid','paid','paid','shipped','cancelled'])[1 + floor(random() * 6)::int],
  500 + floor(random() * 50000)::int,
  now() - (random() * interval '365 days')
FROM generate_series(1, 300000) g;

INSERT INTO order_items (order_id, product_id, qty)
SELECT
  1 + floor(random() * 300000)::bigint,
  1 + floor(random() * 600000)::bigint,
  1 + floor(random() * 5)::int
FROM generate_series(1, 900000) g;

INSERT INTO events (user_id, type, source, payload, created_at)
SELECT
  1 + floor(random() * 200000)::bigint,
  (ARRAY['login','logout','click','purchase','signup','page_view','error','share'])[1 + floor(random() * 8)::int],
  (ARRAY['web','ios','android','api','cron'])[1 + floor(random() * 5)::int],
  jsonb_build_object('v', g % 97, 'ok', g % 3 = 0),
  now() - (random() * interval '60 days')
FROM generate_series(1, 2000000) g;

INSERT INTO sessions (user_id, token, expires_at)
SELECT
  1 + floor(random() * 200000)::bigint,
  md5(g::text || 'session-salt'),
  now() + (random() * interval '30 days')
FROM generate_series(1, 150000) g;

INSERT INTO invoices (user_id, status, amount_cents, due_date, created_at)
SELECT
  1 + floor(random() * 200000)::bigint,
  (ARRAY['unpaid','unpaid','paid','paid','paid'])[1 + floor(random() * 5)::int],
  1000 + floor(random() * 200000)::int,
  current_date - 60 + floor(random() * 120)::int,
  now() - (random() * interval '180 days')
FROM generate_series(1, 1500000) g;

INSERT INTO page_views (site_id, path, viewed_at)
SELECT
  1 + floor(random() * 2)::int,
  (ARRAY['/','/pricing','/docs','/blog','/about','/signup'])[1 + floor(random() * 6)::int],
  now() - (random() * interval '90 days')
FROM generate_series(1, 200000) g;

INSERT INTO messages (thread_id, sender_id, body, created_at)
SELECT
  1 + floor(random() * 50000)::bigint,
  1 + floor(random() * 200000)::bigint,
  'message body ' || g,
  now() - (random() * interval '120 days')
FROM generate_series(1, 900000) g;

INSERT INTO audit_logs (actor_id, action, detail, created_at)
SELECT
  1 + floor(random() * 200000)::bigint,
  (ARRAY['create','update','delete','login','export'])[1 + floor(random() * 5)::int],
  'detail ' || g,
  now() - (random() * interval '90 days')
FROM generate_series(1, 400000) g;

INSERT INTO api_keys (user_id, key_hash)
SELECT
  1 + floor(random() * 200000)::bigint,
  md5(g::text || 'key-salt')
FROM generate_series(1, 5000) g;
