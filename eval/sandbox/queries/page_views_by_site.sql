-- Analytics dashboard: total views per site (site_id has 2 values). ~600 calls/window.
SELECT count(*) AS views
FROM page_views
WHERE site_id = $1;
