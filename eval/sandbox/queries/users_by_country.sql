-- Admin report: user count per country. ~300 calls/window.
SELECT count(*) AS n
FROM users
WHERE country = $1;
