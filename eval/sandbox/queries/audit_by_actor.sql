-- Compliance view: audit trail for an actor. ~300 calls/window.
SELECT action, detail, created_at
FROM audit_logs
WHERE actor_id = $1
ORDER BY created_at DESC
LIMIT 100;
