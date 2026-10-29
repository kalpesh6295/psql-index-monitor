-- Inbox: messages in a thread. ~800 calls/window.
SELECT sender_id, body, created_at
FROM messages
WHERE thread_id = $1
ORDER BY created_at
LIMIT 50;
