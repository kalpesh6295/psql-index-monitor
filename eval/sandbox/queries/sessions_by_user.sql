-- Account security page: list a user's active sessions. ~500 calls/window.
SELECT id, token, expires_at
FROM sessions
WHERE user_id = $1;
