# Security & Infrastructure Engineer Challenge — Report

Author: Purushotham Muktha
Target: `cors-demo` vulnerable webapp (this repo), run locally per `README.md`
Evidence referenced below lives in `evidence/`.
Architecture diagrams, key takeaways, the security-automation roadmap, and the tech stack are in
**`ARCHITECTURE.md`**.

---

## Part 1: CORS Vulnerability

### Setup

Ran the app per `README.md` (`pnpm install && pnpm start`), added the required `/etc/hosts` entries, and walked the **"Theft successful - Set allow to Origin"** scenario end to end: visited the attacker blog, logged into the fake NC webapp, returned to the attacker blog, and observed the threatening "stolen data" message render successfully.

Full reproduction (browser steps + an automated curl equivalent + captured request/response headers) is in **`evidence/cors-attack-repro.md`**.

### 1. Why does the attack work?

The `/json-cors-origin/*` route in `app.js` (lines 78–92) builds its CORS response by **reflecting whatever `Origin` header the requester sends** back as `Access-Control-Allow-Origin`, and unconditionally sets `Access-Control-Allow-Credentials: true`:

```js
if (req.get("Origin") != null) {
  res.setHeader('Access-Control-Allow-Origin', req.get("Origin"));
} else {
  res.setHeader('Access-Control-Allow-Origin', "https://" + req.hostname + ":3000");
}
res.setHeader('Access-Control-Allow-Credentials', 'true');
```

This is the canonical CORS misconfiguration: reflect-origin + allow-credentials together mean *any* website on the internet can make a `fetch`/XHR request with `credentials: 'include'` and have the browser both send the victim's session cookie **and** allow the JS to read the response. There is no origin allow-list, so the Same-Origin Policy provides zero protection here. Compounding it, the session cookie (`superSecretSession`, set in `app.js:105` and again client-side in `views/cors/allow-origin/webapp.ejs`) is **not `HttpOnly`** and uses `SameSite=None`, so it's both readable by JS and sent on cross-site requests — there's no secondary defense layer (no `SameSite=Lax/Strict`, no CSRF token, no per-origin allow-list) to fall back on once the CORS check is bypassed.

### 2. How could an attacker get the user to visit the malicious blog?

Realistic delivery vectors for a logged-in NC user, any of which just need the victim's browser to load attacker-controlled JS while the session cookie is still valid (no interaction with the NC app itself required):
- **Phishing / social engineering**: an email, SMS, or social media post ("read this health article") linking to the attacker's page.
- **Malvertising**: a paid ad network serving the attacker's page/script on otherwise legitimate sites.
- **Compromised third-party content**: a supply-chain compromise of a JS library, widget, or ad tag embedded in a site the victim already trusts (the victim never has to knowingly visit "evil.com" — the payload can be injected into a page they already trust).
- **Open redirect / link shortener abuse**: hiding the true destination behind a trusted-looking shortened or redirected URL.
- **Watering hole**: compromising a site frequented by the target demographic (e.g. a fertility/wellness forum) and injecting the theft script there.

None of these require compromising Natural Cycles' own infrastructure — the vulnerability lives entirely in the CORS/cookie configuration, so *any* page the victim's browser loads while authenticated is a viable delivery mechanism.

### 3. How can this attack be prevented?

In priority order:
1. **Never reflect `Origin` when `Access-Control-Allow-Credentials: true`.** Maintain an explicit allow-list of known, trusted origins (e.g. `https://app.naturalcycles.com`) and only set `Access-Control-Allow-Origin` to the request's `Origin` if it matches an entry in that list — otherwise omit the header entirely.
2. **Make the session cookie `HttpOnly`** so client-side JS (attacker's or otherwise) can never read it directly, and set **`SameSite=Lax` or `Strict`** so it isn't attached to cross-site requests at all in modern browsers — this alone would have blocked this specific attack even with the CORS misconfiguration in place.
3. **Prefer token-based auth for API calls** (e.g. short-lived bearer tokens sent explicitly by client code) over ambient cookie auth for endpoints that must be reachable cross-origin — tokens aren't automatically attached the way cookies are.
4. **Defense in depth**: CSRF tokens on state-changing requests, `Vary: Origin` (already present) to avoid cache poisoning across origins, and monitoring for the "credentialed request from unlisted Origin" signature (see Part 4).

---

## Part 2: X-Forwarded-For IP Spoofing

Full reproduction and captured output is in **`evidence/xff-spoof-repro.md`**.

### 1. Is the audit logging vulnerable to XFF spoofing?

**Yes, confirmed.** `app.js:14` sets `app.set('trust proxy', true)`, which tells Express to trust *every* hop declared in `X-Forwarded-For` and take the left-most (client-supplied) address as `req.ip` — used directly in the audit log at `app.js:111`. Sending `curl` requests with an arbitrary `X-Forwarded-For: 6.6.6.6` (or a fabricated multi-hop chain) causes that exact value to appear as the "received from" IP, with no real proxy in the path validating it. An attacker can make every request appear to originate from any IP they choose, defeating both the audit trail and any IP-based controls built on `req.ip`.

### 2. Fix for a GCP + Load Balancer deployment

The core problem is `trust proxy: true` trusts an *unbounded* number of hops. The fix is to trust **only the exact number of hops that are actually real infrastructure**, not a blanket `true`:

- On Cloud Run behind an external HTTPS Load Balancer, the request path is: `client -> GCLB -> Cloud Run's own front end -> your container`. GCLB appends the true client IP to `X-Forwarded-For` before forwarding; Cloud Run's ingress may append again. That means there are a small, fixed number of *trusted* hops closest to the app — set `app.set('trust proxy', N)` to that exact count (verified against current GCP documentation for Cloud Run + LB) rather than `true`. With a numeric hop count, Express walks in from the right and only trusts that many entries, so anything the original client injected into `X-Forwarded-For` themselves gets correctly ignored.
- Stronger option: don't parse `X-Forwarded-For` for trust decisions at all. Put a **Cloud Armor security policy** in front of the Load Balancer and have it inject a header GCLB/Cloud Armor controls (Cloud Armor exposes the verified client IP it evaluated its rules against); trust that header unconditionally since the client can never write to it (Cloud Armor/GCLB overwrite it at the edge, stripping anything the client sent under that name).
- Either way: **never leave `trust proxy` as the boolean `true`** in a production deployment — it silently trusts an unbounded, attacker-influenced chain.

### 3. IP-based rate limiting recommendation, pros & cons

**Recommendation: rate-limit at the edge, in Cloud Armor, not in the app.**

Configure a Cloud Armor **rate-based ban rule** on the Load Balancer, keyed on the client IP as GCLB itself observed the TCP connection (never on a header value) — e.g. threshold N requests/min per IP, then temporary ban.

| | Edge rate limiting (Cloud Armor) | App-level rate limiting (e.g. `express-rate-limit` keyed on `req.ip`) |
|---|---|---|
| **Pros** | Sees the *real* client IP directly from the TCP/TLS connection — immune to header spoofing; blocks traffic before it consumes app/container resources or scales up Cloud Run instances (cost control); scales independently of the app; centrally managed across all services behind the LB | Can implement business-logic-aware limits (e.g. per authenticated user/API key, not just per IP; different limits per route) |
| **Cons** | Coarser-grained — can't easily key on application concepts like "logged-in user ID"; another GCP resource to configure/pay for | Only as trustworthy as the `trust proxy` configuration behind it (must be fixed per above); consumes app compute for requests that get limited anyway; a single Cloud Run instance's in-memory limiter doesn't share state across autoscaled instances without an external store (e.g. Redis) |

**Best practice**: use both, in layers — Cloud Armor for coarse, IP-based, pre-app protection (immune to spoofing once `X-Forwarded-For`/trust proxy is fixed per above), and app-level limiting for finer-grained per-user/per-API-key logic where IP alone isn't the right key.

---

## Part 3: Data Pipeline for Logs (ELK SIEM, Cloud Run)

**Assumptions**: app is deployed on Google Cloud Run; SIEM is a self-managed ELK stack (Elasticsearch + Logstash/Kibana, not Elastic Cloud).

**Design:**

```
Cloud Run container (stdout/stderr, structured JSON logs)
        |  (automatic — Cloud Run always forwards container stdout/stderr)
        v
  Google Cloud Logging
        |  (Log Router: a Cloud Logging *sink* with an inclusion filter,
        |   e.g. resource.type="cloud_run_revision" AND relevant severity/labels)
        v
  Pub/Sub topic (+ a dead-letter topic for failed deliveries)
        |
        v
  Logstash (or Elastic Agent's GCP Pub/Sub input) subscribed to the topic
        |  (parse/enrich: geoip on client IP, field renames, drop noisy fields)
        v
  Elasticsearch (ILM policy: hot/warm/cold + retention matching compliance needs)
        |
        v
  Kibana (SIEM detections, dashboards, alerting)
```

**Why this shape:**
- **No agent to install** on Cloud Run itself — Cloud Run's platform already captures stdout/stderr into Cloud Logging automatically, so the app only needs to log **structured JSON** (not free-text) so fields like `origin`, `sourceIp`, `path`, `cookiePresent` are queryable without regex parsing downstream.
- **Cloud Logging sink -> Pub/Sub** is the standard GCP-native export path and decouples "how logs are produced" from "how ELK consumes them" — if Logstash/ES is down or being upgraded, Pub/Sub retains messages (configurable retention, e.g. 7 days) instead of losing them, and a dead-letter topic catches anything Logstash can't process after N delivery attempts, so malformed events don't silently vanish.
- **Reliability**: Pub/Sub gives at-least-once delivery with retries; combine with Logstash's persistent queue (or the Elastic Agent's own on-disk buffering) so a Logstash restart doesn't drop in-flight messages. Idempotent ingestion (e.g. a stable `_id` for dedup) handles the at-least-once (rather than exactly-once) delivery semantics.
- **Scalability**: Cloud Run autoscaling and Pub/Sub both scale independently of each other and of Elasticsearch — a traffic spike doesn't require scaling ES in lockstep; Pub/Sub simply buffers until Logstash/ES catches up. Logstash workers can be scaled horizontally (multiple consumers on the same subscription) if ingest volume grows.
- **Cost/relevance filtering**: apply the inclusion filter at the Cloud Logging sink stage (not "ship everything") so only security-relevant log entries (auth events, CORS/audit log lines, 4xx/5xx, admin actions) cross into the pipeline, keeping ES storage and Logstash CPU proportional to what's actually useful for detection.
- **Sensitive data**: since some of this app's payloads are PII-shaped (health/reproductive data per the demo's fixtures), redact or tokenize sensitive fields either at the app's structured-logging layer or in a Logstash filter *before* the data lands in Elasticsearch, not after.

---

## Part 4: Identifying the Attack Through Log Search

**Given the pipeline from Part 3, how would you search for the Part 1 attack?**

**Answer: a hybrid — generic infrastructure logs as the reliable base signal, enriched with a small number of targeted fields logged by the app itself, not full bespoke in-app detection logic.**

Rationale (per the hint):
- **Pure generic logging** (just HTTP access logs: method, path, status, IP, user-agent) is always-on, requires zero app changes, and can't be bypassed by a bug in app-level detection code — but it can't see the actual CORS-theft signature at all, because the interesting fact ("this credentialed request's `Origin` doesn't match our own domain, and we reflected it back") lives in header *semantics* that generic access logs don't usually capture verbatim (many LB/proxy access log formats don't log the `Origin` request header or the `Access-Control-Allow-Origin` response header by default).
- **Pure in-app detection** (e.g. hand-rolled logic buried in a route handler) is fragile: easy to accidentally bypass with a code change elsewhere, adds attack-surface-specific logic that has to be re-implemented per route/service, and if the detection logic itself has a bug, you silently lose visibility with no generic fallback.
- **The practical middle ground**: keep detection *data* generic (log the handful of raw header values at the access-log/app-log layer — `Origin`, `Referer`, whether a session cookie was present, the actual `Access-Control-Allow-Origin` value the server sent back, `User-Agent`, source IP, path, status) and build the *detection query/alert* in the SIEM (Kibana) as a saved search/detection rule over that generic data, rather than hardcoding "if this looks like an attack, alert" inside `app.js`. This keeps the app's job simple (log good structured facts) and keeps the actual detection logic centralized, versioned, and adjustable in the SIEM without a code deploy.

**Specific data points useful for detecting this attack:**
- Requests to `/json-*` (or any authenticated API) where the `Origin` header is present **and** does not match the known set of first-party origins.
- Whether a session/auth cookie was present on that same request (i.e. it was a *credentialed* cross-origin request, not just any cross-origin hit).
- The actual `Access-Control-Allow-Origin` value the server sent back — if it equals the request's `Origin` (reflection) rather than a fixed value, that's the smoking gun of the misconfiguration being actively exploited, not just probed.
- Volume/burst pattern: a spike of distinct, previously-unseen `Origin` values hitting the same authenticated endpoint in a short window (mass/automated exploitation vs. a one-off manual test).
- Correlate by session/cookie value across origins: the *same* session cookie being presented from multiple, unrelated `Origin` values in a short time window is a strong indicator the session has been stolen and replayed, independent of whether this specific CORS bug is the vector.

---

## Part 5: Operationalizing Attack Response on Slack

Implementation writeup is in **`slackbot/README.md`**; end-to-end evidence (console logs + DB
states from a real attack) is in **`evidence/part5-slackbot-repro.md`**.

**What was built** (`slackbot/`, a standalone Node service):
- A **Bolt** app in **Socket Mode** — connects to Slack with just a Bot Token + App-Level Token,
  no public URL/ngrok, so it runs entirely on localhost.
- **Real trigger, not a fake button**: `app.js`'s vulnerable `/json-cors-origin/*` route now also
  detects the Part 1 attack signature — a *credentialed cross-origin request whose `Origin` isn't
  one of the app's own* — and fires a fire-and-forget notification to the bot's localhost-only
  `POST /internal/alert` endpoint. So the Slack alert is a genuine side-effect of the exploit
  happening.
- **Interactive Block Kit message** with three buttons — *Cyber attack*, *Infrastructure
  instability*, *False positive* — matching the PDF's example.
- **On classification**: the bot records who classified it (Slack user ID) and when, then
  `chat.update`s the message in place to a **discreet resolved state**
  (`✅ Confirmed cyber attack · marked by <user> at <time>`, buttons removed).
- **Persistence**: Node's built-in `node:sqlite` (`security_events.db`), one `security_events`
  row per event tracking `pending -> confirmed_cyber_attack | infra_instability | false_positive`
  with `classified_by` / `classified_at` and the original context JSON — the audit trail +
  analytics store the challenge asks for.

**Verified live** in the "NC Security Engineering 2026" workspace (channel `C0BK9ALD8S2`): a real
attack request auto-posted an alert, a human click classified it as a cyber attack, the message
collapsed to the resolved state, and the SQLite row reflected the final classification, actor, and
timestamp. See the evidence file for exact captured logs and DB rows.

**Operational note for reviewers**: interactivity only reaches a Socket Mode bot once both
"Socket Mode" and "Interactivity & Shortcuts" are enabled in the Slack app config; with Socket
Mode on there is no Request URL to set. Before enabling them, clicks fail with "this app is not
configured to handle interactive responses" — a useful gotcha to document for anyone standing this
up.
