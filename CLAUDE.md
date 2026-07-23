# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is `cors-demo`, a security *training* application (branded "Natural Cycles Security Training") that intentionally demonstrates client-side/CORS data-theft vulnerabilities so engineers can see the attack in action. Almost every file here is deliberately insecure — that is the point of the app. Do not "fix" the vulnerabilities in `app.js` or the views unless a task explicitly asks for that; the misconfigured CORS/cookie logic is the product, not a bug.

## Running the app

- Install: `pnpm install`
- Start: `pnpm start` (runs `node app.js`)
- Serves HTTPS on port 3000 using the checked-in self-signed cert (`www.nc.com.key` / `www.nc.com.pem`)
- Browse to `https://localhost:3000` (or `https://www.nc.com:3000`) and accept the self-signed cert warning
- The attack scenarios require simulating two origins on one machine. Add to `/etc/hosts`:
  ```
  127.0.0.1  www.nc.com www.evil.com
  ```
- Third-party cookies must be allowed in the browser for the CORS scenario to work
- There are no build steps, no test suite, and no linter configured in this repo — `pnpm start` is the only script

## Architecture

Single-file Express ("Express 5") server (`app.js`) with EJS views, no database/session store despite `mongodb`/`monk` being listed as dependencies (unused in current `app.js`). Everything hinges on a small set of middleware behaviors near the top of `app.js`:

1. **`POST -> GET` override hack**: any POST to a path matching `*appInit` is rewritten to `GET` before continuing, so a real backend JSON endpoint can be simulated by Express's static file server.
2. **Fake-JSON-via-static-file trick**: paths starting with `/json-` get `Content-Type: application/json` forced, then fall through to `express.static('public')`, which serves flat files under `public/json-default/`, `public/json-cors-origin/`, `public/json-cors-wildcard/` (e.g. `public/json-cors-origin/appInit`). These static files are the "backend response" payloads (fake user data, PII, etc.) used to prove data exfiltration worked. The `objects/` directory holds the canonical copies of these JSON fixtures (`appInit`, `postInit`, `webSignupInit`) that the `public/json-*` files are copied from.
3. **CORS header branches by path prefix**, controlled by the module-level `allowOrigin` variable (`'*' | 'origin' | 'null'`) near the top of `app.js`:
   - `/json-default/*` — no CORS headers set at all (baseline/safe comparison case)
   - `/json-cors-wildcard/*` — sets `Access-Control-Allow-Origin` to `*` or to the reflected `Origin` depending on `allowOrigin`, plus `Allow-Credentials: true` (a known-bad combination the demo exploits)
   - `/json-cors-origin/*` — always reflects the request's `Origin` header (or defaults to `https://<hostname>:3000`) back as `Access-Control-Allow-Origin`, with credentials allowed — this is the "vulnerable" explicit-origin scenario
   - There's a dead/disabled branch (`false && ...`) left in place showing an earlier variant of the wildcard logic; it's unreachable and not worth "cleaning up" unless asked.
4. **Cookie-gated JSON routes**: `blockIfNoCookie` rejects any `/json-*` request with HTTP 400 unless a `superSecretSession` cookie is present, simulating an authenticated backend call that will be stolen via CORS.
5. **Login**: `GET /login` sets `superSecretSession` as a non-httpOnly cookie (`res.cookie(...)`), so it can also be read/exfiltrated from JS (used by the local-storage scenario).
6. **Local-storage theft scenario**: `PUT /local-storage/yummy` (with a matching `OPTIONS` preflight handler) reflects `Origin` back and accepts arbitrary JSON bodies, simulating an attacker endpoint receiving stolen `localStorage` contents.

### View/route structure

- `views/index.ejs` — landing page linking to the active demo scenarios. The Local Storage scenario section is currently commented out (see `54b5224 feat: hide local storage scenario`); the routes and views for it (`views/local-storage/*`, `public/steal.js`) still exist and work, just aren't linked from the homepage.
- `views/cors/allow-origin/{index,webapp,attacker}.ejs` — the CORS attack walkthrough:
  - `webapp.ejs` — a fake "target" site (`www.nc.com`) where a victim logs in (sets the `superSecretSession` cookie via JS, `SameSite=None; Secure`) and stores "secret" data
  - `attacker.ejs` — the malicious third-party page (served from `www.evil.com`) that loads `public/front.js`, which fires a cross-origin, credentialed AJAX request at `/json-cors-origin/appInit` (or `/json-cors-wildcard/appInit` depending on `mode` attribute on the script tag) and displays whatever "stolen" data comes back
- `views/local-storage/{index,webapp,vulnerable}.ejs` + `public/steal.js` — parallel scenario for exfiltrating `localStorage` (rather than a cookie-authenticated API) to an attacker-controlled `PUT` endpoint
- `public/cookie-steal.js` — a minimal image-beacon cookie exfiltration payload, referenced conceptually rather than wired into a specific route

### Key files to read together when modifying a scenario

Because the attack flow spans server route, static fixture data, and two+ EJS views, always check all of these before changing one:
- `app.js` (routing + CORS header logic for the scenario's path prefix)
- `objects/<fixture>` and the matching `public/json-*/<fixture>` copy (the payload "stolen")
- the relevant `views/<scenario>/*.ejs` pair (victim/webapp page + attacker page)
- the relevant `public/*.js` (e.g. `front.js`, `steal.js`) that performs the cross-origin call
