-- Cart service: fetch products currently in a cart. ~400 calls/window.
SELECT id, name, price_cents
FROM products
WHERE id = ANY($1::bigint[]);
