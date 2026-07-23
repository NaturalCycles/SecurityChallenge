# Slack security-response bot (Part 5)

A small, standalone Slack app that turns a detected security event into an interactive Slack
message, lets a human classify it, and persists the full lifecycle for later analytics.

## How it's built

- **Framework**: [`@slack/bolt`](https://slack.dev/bolt-js/) in **Socket Mode**. Socket Mode opens
  a persistent WebSocket from this process out to Slack, so there is no public HTTP endpoint,
  no ngrok/tunnel, and no Request URL to configure for Events/Interactivity — everything (button
  clicks included) flows over that single outbound connection. This keeps the whole thing
  runnable on localhost with nothing exposed to the internet.
- **Trigger / detection hook**: rather than a fake button to press, the alert is a real
  side-effect of the Part 1 CORS attack actually happening. `app.js`'s `/json-cors-origin/*`
  route (the vulnerable one) now also checks whether an incoming request is a **credentialed
  cross-origin request from an origin that isn't the app's own** — i.e. exactly the shape of the
  attack from Part 1 — and if so, `POST`s the relevant context (Origin header, source IP, path,
  User-Agent) to this bot's `POST /internal/alert` endpoint. That endpoint is a tiny Express app
  bound to `127.0.0.1` only (not reachable from outside the machine) — it exists purely so the
  main webapp process (which itself has no Slack SDK/socket) can hand off "an attack just
  happened" to this bot. A 30-second debounce (keyed on origin+IP) collapses a burst of repeated
  attack requests into a single Slack alert.
- **Interactive message**: on receiving an alert, the bot posts a Block Kit message to the
  configured channel with the attack context and three buttons — *Cyber attack*,
  *Infrastructure instability*, *False positive* — matching the PDF's example.
- **Resolution**: clicking any button acknowledges the interaction, records the classification,
  and uses `chat.update` to replace the original message in place with a compact, discreet
  line: `✅ <classification> · marked by <user> at <time>` — no more action buttons, matching the
  "resolved" screenshot in the PDF.
- **Persistence**: Node's built-in `node:sqlite` module (`DatabaseSync`, stable since Node 22.5+
  — no native/`node-gyp` build step, so it Just Works on any machine running a modern Node,
  unlike `better-sqlite3` which needed a native compile that failed against newer V8/Node
  releases during development), writing to a local file `security_events.db` (created
  automatically, gitignored — not shipped with secrets/state). Schema (`db.js`):

  ```
  security_events(
    id, type, status, origin_header, source_ip, path, user_agent,
    detected_at, classified_by, classified_at, slack_channel, slack_ts, raw_context
  )
  ```

  `status` moves from `pending` -> one of `confirmed_cyber_attack` / `infra_instability` /
  `false_positive`, with `classified_by` (the Slack user ID who clicked) and `classified_at`
  recorded. `raw_context` keeps the original alert payload as JSON for later analytics/audit.
  SQLite was chosen over standing up MongoDB (already an unused dependency in the root
  `package.json`) purely to avoid needing Docker/a running `mongod` for what is a single-process
  local demo — the schema above would map onto a Mongo collection with the same fields with no
  change in approach if persistence needs to grow beyond a single file later.

## Setup

1. `cd slackbot && pnpm install` (or `npm install`).
2. Copy `.env.example` to `.env` and fill in real values from your Slack app config
   (api.slack.com/apps -> your app):
   - `SLACK_BOT_TOKEN` — Bot User OAuth Token (`xoxb-...`), needs `chat:write` scope.
   - `SLACK_SIGNING_SECRET` — from Basic Information.
   - `SLACK_APP_TOKEN` — an App-Level Token (`xapp-...`) with the `connections:write` scope,
     required for Socket Mode.
   - `SLACK_CHANNEL_ID` — the channel to post alerts into (invite the bot to it first).
   - Make sure **Socket Mode** is turned on and **Interactivity** is enabled (Request URL isn't
     needed in Socket Mode) in the app config, and the bot is a member of the target channel.
3. `pnpm start` (or `npm start`). You should see:
   ```
   Internal alert receiver listening on http://127.0.0.1:3001/internal/alert
   Slack security-response bot running (Socket Mode)
   ```
4. Start the main webapp (`pnpm start` in the repo root) as usual — it will call this bot's
   `/internal/alert` endpoint automatically whenever a real CORS-theft-shaped request hits
   `/json-cors-origin/*`.

## Manual test (without re-running the full Part 1 browser flow)

```bash
curl -s http://127.0.0.1:3001/internal/alert \
  -H "Content-Type: application/json" \
  -d '{"type":"cyber_attack_suspected","origin":"https://www.evil.com:3000","ip":"203.0.113.7","path":"/json-cors-origin/appInit","userAgent":"curl/test"}'
```

This should produce the same Slack message as a real detection.
