const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'security_events.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    origin_header TEXT,
    source_ip TEXT,
    path TEXT,
    user_agent TEXT,
    detected_at TEXT NOT NULL,
    classified_by TEXT,
    classified_at TEXT,
    slack_channel TEXT,
    slack_ts TEXT,
    raw_context TEXT
  )
`);

function insertEvent(event) {
  const stmt = db.prepare(`
    INSERT INTO security_events
      (type, status, origin_header, source_ip, path, user_agent, detected_at, raw_context)
    VALUES (?, 'pending', ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    event.type,
    event.originHeader || null,
    event.sourceIp || null,
    event.path || null,
    event.userAgent || null,
    event.detectedAt || new Date().toISOString(),
    JSON.stringify(event.rawContext || {})
  );
  return info.lastInsertRowid;
}

function setSlackMessageRef(id, channel, ts) {
  db.prepare(`UPDATE security_events SET slack_channel = ?, slack_ts = ? WHERE id = ?`)
    .run(channel, ts, id);
}

function classifyEvent(id, status, classifiedBy) {
  db.prepare(`
    UPDATE security_events
    SET status = ?, classified_by = ?, classified_at = ?
    WHERE id = ?
  `).run(status, classifiedBy, new Date().toISOString(), id);
}

function getEvent(id) {
  return db.prepare(`SELECT * FROM security_events WHERE id = ?`).get(id);
}

function findBySlackMessage(channel, ts) {
  return db.prepare(`SELECT * FROM security_events WHERE slack_channel = ? AND slack_ts = ?`).get(channel, ts);
}

module.exports = { insertEvent, setSlackMessageRef, classifyEvent, getEvent, findBySlackMessage };
