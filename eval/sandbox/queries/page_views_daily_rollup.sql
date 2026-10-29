-- Analytics dashboard: daily traffic rollup over the whole table. ~600 calls/window.
SELECT date_trunc('day', viewed_at) AS day, count(*) AS views
FROM page_views
GROUP BY 1
ORDER BY 1;
