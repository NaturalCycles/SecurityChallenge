# Part 2 — X-Forwarded-For IP Spoofing: Reproduction Evidence

## Test methodology

`app.js:14` sets `app.set('trust proxy', true)`, and `app.js:111` logs the audit line using `req.ip`:
```js
app.get('/', function (req, res) {
  console.log("Audit log: Received request from: " + req.ip)
  ...
```

Express (via the `proxy-addr` library) treats `trust proxy: true` as "trust every hop in `X-Forwarded-For`," which means it returns the **left-most** (i.e. client-supplied) address in the header as `req.ip` — with no validation of who actually sent the request. This is testable directly against the live app: any request that carries a custom `X-Forwarded-For` header will have that value logged verbatim.

A minimal harness reproducing the exact same middleware (`trust proxy: true` + `req.ip` logging) was run standalone to capture deterministic, timestamped proof without needing access to the main app's console:

```js
const express = require('express');
const app = express();
app.set('trust proxy', true); // identical to app.js:14
app.get('/', (req, res) => {
  console.log("Audit log: Received request from: " + req.ip +
    "  (raw XFF header: " + req.get('X-Forwarded-For') + ")");
  res.send('ok');
});
app.listen(3999);
```

## Captured result (2026-07-23)

```
--- request with NO XFF header ---
Audit log: Received request from: ::1  (raw XFF header: undefined)

--- request with spoofed single XFF: "X-Forwarded-For: 6.6.6.6" ---
Audit log: Received request from: 6.6.6.6  (raw XFF header: 6.6.6.6)

--- request with spoofed chain: "X-Forwarded-For: 9.9.9.9, 6.6.6.6" ---
Audit log: Received request from: 9.9.9.9  (raw XFF header: 9.9.9.9, 6.6.6.6)
```

**Confirmed vulnerable.** In all cases `req.ip` echoes exactly whatever left-most value the *client* put in the header — including a fully fabricated address (`6.6.6.6`), and even the left-most entry of a multi-hop chain the client made up entirely (`9.9.9.9`). No real reverse proxy sits between curl and this app, yet Express accepted the header at face value. Anyone can:
- Poison the audit log with an arbitrary source IP (defeats forensic/audit value of the log).
- Trivially bypass any IP-based rate limiting or IP allow/deny-listing built on `req.ip`, by rotating the header value per request.

## Why this happens

`trust proxy: true` tells Express "every hop between the client and this process is a trusted proxy that correctly appended to `X-Forwarded-For`." That assumption is only valid if the app is *actually* deployed behind infrastructure that (a) strips/overwrites any client-supplied `X-Forwarded-For` before appending its own, and (b) is the only path by which traffic can reach the app. Locally (and in many misconfigured deployments), neither holds, so the header is attacker-controlled end to end.

See `REPORT.md` Part 2 for the GCP/Load-Balancer-specific fix and rate-limiting recommendation.
