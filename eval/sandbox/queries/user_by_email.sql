-- Login flow: look up user by email. ~2000 calls/window.
SELECT id, email, country, plan
FROM users
WHERE email = $1;
