-- Moderation tool: all messages sent by a user. ~600 calls/window.
SELECT thread_id, body, created_at
FROM messages
WHERE sender_id = $1
ORDER BY created_at DESC
LIMIT 50;
