require('dotenv').config();
const { App } = require('@slack/bolt');
const express = require('express');
const db = require('./db');

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID;
const ALERT_PORT = process.env.ALERT_PORT || 3001;

// Socket Mode only needs the bot token + an app-level token; the signing secret is only
// used by the HTTP receiver (which we don't use here), so it's optional.
if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_APP_TOKEN) {
  console.error('Missing SLACK_BOT_TOKEN / SLACK_APP_TOKEN in slackbot/.env');
  process.exit(1);
}
if (!CHANNEL_ID) {
  console.error('Missing SLACK_CHANNEL_ID in slackbot/.env');
  process.exit(1);
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET || 'unused-in-socket-mode',
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

const CLASSIFICATIONS = {
  classify_cyber_attack: { status: 'confirmed_cyber_attack', resolvedText: 'Confirmed cyber attack' },
  classify_infra_instability: { status: 'infra_instability', resolvedText: 'Marked as infrastructure instability' },
  classify_false_positive: { status: 'false_positive', resolvedText: 'Marked as false positive' },
};

function buildAlertBlocks(event) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:warning: *New potential cyber attack*\nSuspicious cross-origin credentialed request detected.`,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Origin:*\n\`${event.origin_header || 'n/a'}\`` },
        { type: 'mrkdwn', text: `*Source IP:*\n\`${event.source_ip || 'n/a'}\`` },
        { type: 'mrkdwn', text: `*Path:*\n\`${event.path || 'n/a'}\`` },
        { type: 'mrkdwn', text: `*Detected at:*\n${event.detected_at}` },
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Please review and classify this alert.` }],
    },
    {
      type: 'actions',
      block_id: 'security_event_actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Cyber attack' },
          style: 'danger',
          action_id: 'classify_cyber_attack',
          value: String(event.id),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Infrastructure instability' },
          action_id: 'classify_infra_instability',
          value: String(event.id),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'False positive' },
          action_id: 'classify_false_positive',
          value: String(event.id),
        },
      ],
    },
  ];
}

function buildResolvedBlocks(event, resolvedText, userId) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:warning: *Security alert* — Suspicious cross-origin credentialed request from \`${event.origin_header || 'n/a'}\``,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `:white_check_mark: *${resolvedText}* · marked by <@${userId}> at ${new Date().toLocaleTimeString()}`,
        },
      ],
    },
  ];
}

// Recent-alert debounce so a burst of requests from the same origin/IP only pages once.
const recentAlertKeys = new Map();
const DEBOUNCE_MS = 30_000;

function shouldDebounce(key) {
  const last = recentAlertKeys.get(key);
  const now = Date.now();
  if (last && now - last < DEBOUNCE_MS) return true;
  recentAlertKeys.set(key, now);
  return false;
}

async function postAlert(payload) {
  const debounceKey = `${payload.originHeader}|${payload.sourceIp}`;
  if (shouldDebounce(debounceKey)) {
    console.log('Debounced duplicate alert for', debounceKey);
    return;
  }

  const detectedAt = new Date().toISOString();
  const id = db.insertEvent({
    type: payload.type || 'cyber_attack_suspected',
    originHeader: payload.origin,
    sourceIp: payload.ip,
    path: payload.path,
    userAgent: payload.userAgent,
    detectedAt,
    rawContext: payload,
  });

  const event = db.getEvent(id);
  const result = await app.client.chat.postMessage({
    channel: CHANNEL_ID,
    text: `New potential cyber attack detected from origin ${payload.origin || 'unknown'}`,
    blocks: buildAlertBlocks(event),
  });

  db.setSlackMessageRef(id, result.channel, result.ts);
  console.log(`Posted security alert #${id} to Slack (${result.channel}/${result.ts})`);
}

// Internal-only HTTP receiver for the webapp's real detection hook (see app.js).
// Bound to localhost so it is never reachable from outside this machine.
const internalApi = express();
internalApi.use(express.json());
internalApi.post('/internal/alert', async (req, res) => {
  try {
    await postAlert(req.body || {});
    res.sendStatus(202);
  } catch (err) {
    console.error('Failed to post alert to Slack:', err);
    res.sendStatus(500);
  }
});
internalApi.listen(ALERT_PORT, '127.0.0.1', () => {
  console.log(`Internal alert receiver listening on http://127.0.0.1:${ALERT_PORT}/internal/alert`);
});

Object.keys(CLASSIFICATIONS).forEach((actionId) => {
  app.action(actionId, async ({ ack, body, client }) => {
    await ack();
    const eventId = Number(body.actions[0].value);
    const { status, resolvedText } = CLASSIFICATIONS[actionId];
    const event = db.getEvent(eventId);
    if (!event) return;

    db.classifyEvent(eventId, status, body.user.id);

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `${resolvedText} · marked by <@${body.user.id}>`,
      blocks: buildResolvedBlocks(event, resolvedText, body.user.id),
    });
  });
});

(async () => {
  await app.start();
  console.log('Slack security-response bot running (Socket Mode)');
})();
