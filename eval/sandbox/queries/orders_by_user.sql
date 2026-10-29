-- Order history page: every profile visit. ~1200 calls/window.
SELECT id, status, total_cents, created_at
FROM orders
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT 20;
