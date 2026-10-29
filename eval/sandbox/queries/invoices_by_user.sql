-- Billing page: a user's invoices. ~800 calls/window.
SELECT id, status, amount_cents, due_date
FROM invoices
WHERE user_id = $1
ORDER BY due_date DESC;
