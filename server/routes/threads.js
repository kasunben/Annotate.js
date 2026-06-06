'use strict';

const express             = require('express');
const { db, rowToThread, threadToRow } = require('../db');

const router = express.Router();

const getById = db.prepare('SELECT * FROM threads WHERE id = ?');

/**
 * Returns true if the upsert is allowed; sends a 403 and returns false otherwise.
 * Rules:
 *   - No existing row → new thread, always allowed.
 *   - Existing row has no author_id → legacy thread, permanently read-only.
 *   - Existing row's author_id must match the incoming author_id.
 */
function checkOwnership(res, existing, incomingAuthorId) {
  if (!existing) return true;                         // new thread — allow
  if (!existing.author_id) {
    res.status(403).json({ error: 'forbidden: legacy thread has no owner' });
    return false;
  }
  if (existing.author_id !== incomingAuthorId) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /threads?siteId=X&pageUrl=Y[&since=ISO8601]
router.get('/', function (req, res) {
  const { siteId, pageUrl, since } = req.query;
  if (!siteId || !pageUrl) {
    return res.status(400).json({ error: 'siteId and pageUrl are required' });
  }
  let rows;
  if (since) {
    rows = db.prepare(
      'SELECT * FROM threads WHERE site_id = ? AND page_url = ? AND updated_at > ?'
    ).all(siteId, pageUrl, since);
  } else {
    rows = db.prepare(
      'SELECT * FROM threads WHERE site_id = ? AND page_url = ?'
    ).all(siteId, pageUrl);
  }
  res.json(rows.map(rowToThread));
});

// POST /threads  — upsert (full thread, INSERT OR REPLACE)
router.post('/', function (req, res) {
  const row      = threadToRow(req.body);
  const existing = getById.get(row.id);
  if (!checkOwnership(res, existing, row.author_id)) return;
  db.prepare(`
    INSERT OR REPLACE INTO threads
      (id, site_id, page_url, quote, anchor, body, author, author_id,
       created_at, updated_at, resolved, resolved_at, resolved_by, replies, deleted_at)
    VALUES
      (@id, @site_id, @page_url, @quote, @anchor, @body, @author, @author_id,
       @created_at, @updated_at, @resolved, @resolved_at, @resolved_by, @replies, @deleted_at)
  `).run(row);
  res.status(201).json(rowToThread(getById.get(row.id)));
});

// PATCH /threads/:id  — edit body
router.patch('/:id', function (req, res) {
  const { body, updatedAt } = req.body;
  const now = updatedAt || new Date().toISOString();
  db.prepare('UPDATE threads SET body = ?, updated_at = ? WHERE id = ?').run(body, now, req.params.id);
  const row = getById.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(rowToThread(row));
});

// PATCH /threads/:id/resolve
router.patch('/:id/resolve', function (req, res) {
  const { resolvedBy, resolvedAt } = req.body;
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE threads SET resolved = 1, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?'
  ).run(resolvedBy || null, resolvedAt || now, now, req.params.id);
  const row = getById.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(rowToThread(row));
});

// DELETE /threads?siteId=X[&authorId=Y]
// With authorId: deletes only threads owned by that author (used by Settings → Clear my annotations).
// Without authorId: deletes all threads for the site (admin escape hatch).
router.delete('/', function (req, res) {
  const { siteId, authorId } = req.query;
  if (!siteId) return res.status(400).json({ error: 'siteId is required' });
  if (authorId) {
    db.prepare('DELETE FROM threads WHERE site_id = ? AND author_id = ?').run(siteId, authorId);
  } else {
    db.prepare('DELETE FROM threads WHERE site_id = ?').run(siteId);
  }
  res.status(204).end();
});

// DELETE /threads/:id  — soft-delete
router.delete('/:id', function (req, res) {
  const { deletedAt } = req.body;
  const now = deletedAt || new Date().toISOString();
  db.prepare('UPDATE threads SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, req.params.id);
  res.status(204).end();
});

// POST /threads/:id/replies  — append reply
router.post('/:id/replies', function (req, res) {
  const row = getById.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const replies = JSON.parse(row.replies || '[]');
  replies.push(req.body.reply);
  const now = new Date().toISOString();
  db.prepare('UPDATE threads SET replies = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(replies), now, req.params.id);
  res.status(201).json(rowToThread(getById.get(req.params.id)));
});

// PATCH /threads/:id/replies/:replyId  — edit reply
router.patch('/:id/replies/:replyId', function (req, res) {
  const row = getById.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const replies = JSON.parse(row.replies || '[]');
  const r = replies.find(function (x) { return x.id === req.params.replyId; });
  if (r) {
    r.body      = req.body.body;
    r.updatedAt = req.body.updatedAt || new Date().toISOString();
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE threads SET replies = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(replies), now, req.params.id);
  res.json(rowToThread(getById.get(req.params.id)));
});

// DELETE /threads/:id/replies/:replyId  — soft-delete reply
router.delete('/:id/replies/:replyId', function (req, res) {
  const row = getById.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const replies = JSON.parse(row.replies || '[]');
  const r = replies.find(function (x) { return x.id === req.params.replyId; });
  if (r) r.deleted = true;
  const now = new Date().toISOString();
  db.prepare('UPDATE threads SET replies = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(replies), now, req.params.id);
  res.json(rowToThread(getById.get(req.params.id)));
});

module.exports = router;
