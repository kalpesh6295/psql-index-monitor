-- MONTHLY dunning job (cron, 1st of month): overdue unpaid invoices.
-- Runs rarely — it will often show ZERO calls in a short stats window,
-- but it depends on the partial index idx_invoices_unpaid_due.
SELECT id, user_id, amount_cents, due_date
FROM invoices
WHERE status = 'unpaid'
  AND due_date < current_date
ORDER BY due_date
LIMIT 500;
