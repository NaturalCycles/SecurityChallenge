# Slack screenshots

## slackbot-resolved-alerts.png

The `#candidate-purushotham` channel in the "NC Security Engineering 2026" workspace showing
three security alerts posted by **Security Challenge Bot 8**, each auto-triggered by a real
credentialed cross-origin request (the Part 1 CORS attack), and each classified via the
interactive buttons into the **discreet resolved state**:

> :warning: Security alert — Suspicious cross-origin credentialed request from `https://www.evil.com:3000`
> :white_check_mark: Confirmed cyber attack · marked by @Purushotham Muktha at 10:52:00 PM

This is the "message made more discreet and clear that all required actions have been taken"
end state (buttons removed, classifier + timestamp recorded), corresponding to the persisted
SQLite rows documented in `../part5-slackbot-repro.md`.
