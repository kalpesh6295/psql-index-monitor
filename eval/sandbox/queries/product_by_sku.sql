-- Catalog service: product lookup by SKU. ~800 calls/window.
SELECT id, name, category, price_cents
FROM products
WHERE sku = $1;
