# OWASP ZAP Baseline Scan — Notes

## How it was run

Ran the official OWASP ZAP baseline (passive) scan in Docker against the running app:

```bash
docker run --rm -v "$(pwd)":/zap/wrk/:rw -t zaproxy/zap-stable zap-baseline.py \
  -t https://host.docker.internal:3000 \
  -r zap-report.html -J zap-report.json
```

(`host.docker.internal` lets the container reach the app running on the macOS host.)
Full reports: `zap-report.html` (human-readable) and `zap-report.json` (machine-readable) in this folder.

## Result summary (2026-07-23)

`FAIL-NEW: 0  WARN-NEW: 13  PASS: 54`. Alerts found:

| Risk | Alert |
|---|---|
| Medium | CSP: Failure to Define Directive with No Fallback |
| Medium | Content Security Policy (CSP) Header Not Set |
| Medium | Missing Anti-clickjacking Header (X-Frame-Options/CSP frame-ancestors) |
| Medium | Sub Resource Integrity Attribute Missing (CDN `<script>`/`<link>` tags) |
| Low | Cross-Domain JavaScript Source File Inclusion (jQuery/Bootstrap from CDNs) |
| Low | COEP / COOP / CORP headers missing or invalid |
| Low | Permissions-Policy header not set |
| Low | Server leaks info via `X-Powered-By` (Express) |
| Low | Strict-Transport-Security (HSTS) header not set |
| Low | X-Content-Type-Options header missing |
| Info | Cacheable content / cache-control review |

## Important interpretation note (scope honesty)

The **baseline scan is passive** — it spiders the app and inspects responses to the requests
it happens to make. Two things follow:

1. It did **not** by itself exercise the core Part 1 CORS reflection vuln. That endpoint
   (`/json-cors-origin/appInit`) requires both a valid session cookie **and** a cross-origin
   `Origin` request header to reveal the misconfiguration, which a passive spider doesn't
   supply. The definitive proof of the CORS flaw is the manual `curl`/browser reproduction in
   `cors-attack-repro.md`, not this scan. ZAP is included as **supplementary** breadth evidence
   (missing hardening headers) — not as the primary proof of the headline vulnerability.
2. To have ZAP actively confirm the CORS reflection, you'd run the **full/active** scan with an
   authenticated context (session cookie configured) or use the ZAP desktop HUD / Manual Request
   Editor to replay a `GET /json-cors-origin/appInit` with `Origin: https://www.evil.com:3000`
   and observe the reflected `Access-Control-Allow-Origin` — which is exactly what the curl
   reproduction already demonstrates deterministically.

## How these findings reinforce the report

The passive findings corroborate the Part 1 write-up's "defense in depth" recommendations:
the app ships **no CSP, no HSTS, no X-Content-Type-Options at the document level, no
anti-clickjacking header, and loads scripts from third-party CDNs without Subresource
Integrity** — so even beyond the CORS/cookie issue, a compromised CDN or an injected script
would run unconstrained. Hardening these headers is part of reducing the blast radius of the
kind of client-side data theft demonstrated in Part 1.
