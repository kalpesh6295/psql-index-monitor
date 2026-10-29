-- Activity feed: recent events for a user. ~400 calls/window.
SELECT type, source, created_at
FROM events
WHERE user_id = $1
  AND created_at > now() - interval '7 days'
ORDER BY created_at DESC
LIMIT 100;
