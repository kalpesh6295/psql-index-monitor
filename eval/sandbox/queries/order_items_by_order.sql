-- Order detail page: line items for an order. ~1500 calls/window.
SELECT product_id, qty
FROM order_items
WHERE order_id = $1;
