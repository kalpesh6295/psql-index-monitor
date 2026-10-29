-- Auth middleware: session lookup on every API request. ~2000 calls/window.
SELECT user_id, expires_at
FROM sessions
WHERE token = $1;
