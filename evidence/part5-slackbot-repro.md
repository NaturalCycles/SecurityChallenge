# Part 5 — Slack Security-Response Bot: End-to-End Evidence

Captured 2026-07-23 against the running app + bot, Slack workspace
"NC Security Engineering 2026", channel `C0BK9ALD8S2`.

## The full automatic chain (real attack -> Slack alert)

With the main webapp running the updated `app.js` (detection hook live) and `slackbot/index.js`
connected via Socket Mode, a single real Part 1 attack request:

```bash
curl -sk https://localhost:3000/json-cors-origin/appInit -X POST \
  -H "Origin: https://www.evil.com:3000" \
  -H "Cookie: superSecretSession=123" \
  -H "Content-Type: application/json"
```

produced this chain with **no manual steps**:

1. **Webapp console** (`app.js` detection hook):
   ```
   SECURITY ALERT: possible CORS data theft in progress from origin https://www.evil.com:3000
   ```
2. **Slackbot console**:
   ```
   Posted security alert #3 to Slack (C0BK9ALD8S2/1784840148.992399)
   ```
3. **SQLite** (`security_events.db`) — new row inserted:
   ```json
   { "id": 3, "status": "pending", "origin_header": "https://www.evil.com:3000",
     "source_ip": "::1", "user_agent": "curl/8.7.1", "detected_at": "2026-07-23T20:55:48.687Z" }
   ```

i.e. the alert is a genuine side-effect of the Part 1 exploit actually occurring — not a canned button.

## Interactive classification round-trip

Clicking **Cyber attack** on an alert message routes over the Socket Mode connection to the bot,
which (a) records the classification in SQLite and (b) `chat.update`s the message in place to the
discreet resolved state (`:white_check_mark: Confirmed cyber attack · marked by <user> at <time>`,
buttons removed).

Verified final DB state after classifying events #1 and #2:
```json
[
  { "id": 1, "status": "confirmed_cyber_attack", "classified_by": "U0BKD82JN3B",
    "classified_at": "2026-07-23T20:52:00.993Z", "slack_ts": "1784838612.429849" },
  { "id": 2, "status": "confirmed_cyber_attack", "classified_by": "U0BKD82JN3B",
    "classified_at": "2026-07-23T20:54:07.745Z", "slack_ts": "1784840017.955589" }
]
```

`status` moved `pending -> confirmed_cyber_attack`, and `classified_by` captured the Slack user
ID of the person who clicked, with a timestamp — exactly the audit trail the challenge asks for
(current state + who acted + when), stored for later analytics.

## Config note discovered during testing

The bot connects to Slack purely with a Bot Token (`xoxb-`) + App-Level Token (`xapp-`,
`connections:write`) over Socket Mode — no public URL / ngrok needed. Interactivity only reaches
the bot once **both** "Socket Mode" and "Interactivity & Shortcuts" are toggled **on** in the app
config; with Socket Mode on, no Request URL is set (interactions are delivered over the socket).
Before those toggles were enabled, button clicks failed with "this app is not configured to
handle interactive responses" and never reached the backend — worth calling out as an
operational gotcha.

## Screenshots

`slack-screenshots/slackbot-resolved-alerts.png` — the `#candidate-purushotham` channel showing
three bot-posted security alerts, each auto-triggered by a real credentialed cross-origin request
and each classified into the discreet resolved state
(`✅ Confirmed cyber attack · marked by @Purushotham Muktha at <time>`, buttons removed). This is
the visual counterpart to the persisted SQLite rows above. See
`slack-screenshots/README.md` for the caption.
