-- Ops dashboard: most recent orders. ~300 calls/window.
SELECT id, user_id, status, total_cents
FROM orders
ORDER BY created_at DESC
LIMIT 50;
