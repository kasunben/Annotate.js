'use strict';

const express = require('express');
const { db, rowToActivity } = require('../db');

const router = express.Router();

// GET /activity?siteId=&pageUrl=[&since=]
router.get('/', function (req, res) {
  const { siteId, pageUrl, since } = req.query;
  if (!siteId || !pageUrl) return res.status(400).json({ error: 'siteId and pageUrl required' });

  let rows;
  if (since) {
    rows = db.prepare(
      'SELECT * FROM activity WHERE site_id = ? AND page_url = ? AND timestamp > ? ORDER BY timestamp ASC'
    ).all(siteId, pageUrl, since);
  } else {
    rows = db.prepare(
      'SELECT * FROM activity WHERE site_id = ? AND page_url = ? ORDER BY timestamp ASC'
    ).all(siteId, pageUrl);
  }
  res.json(rows.map(rowToActivity));
});

// POST /activity  — push one entry; INSERT OR IGNORE (entries are immutable)
router.post('/', function (req, res) {
  const e = req.body;
  if (!e || !e.id || !e.siteId || !e.pageUrl || !e.type || !e.threadId) {
    return res.status(400).json({ error: 'id, siteId, pageUrl, type, threadId required' });
  }
  db.prepare(`
    INSERT OR IGNORE INTO activity (id, site_id, page_url, type, thread_id, reply_id, actor, timestamp, snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(e.id, e.siteId, e.pageUrl, e.type, e.threadId, e.replyId || null, e.actor, e.timestamp, e.snapshot);
  res.status(201).json(e);
});

// DELETE /activity?siteId=  — hard-delete all entries for a site (Settings → Clear all)
router.delete('/', function (req, res) {
  const { siteId } = req.query;
  if (!siteId) return res.status(400).json({ error: 'siteId required' });
  db.prepare('DELETE FROM activity WHERE site_id = ?').run(siteId);
  res.sendStatus(204);
});

module.exports = router;
