'use strict';

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(path.join(__dirname, 'data', 'annotate.db'));

db.exec('PRAGMA journal_mode=WAL');
db.exec('PRAGMA foreign_keys=ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS threads (
    id          TEXT PRIMARY KEY,
    site_id     TEXT NOT NULL,
    page_url    TEXT NOT NULL,
    quote       TEXT NOT NULL,
    anchor      TEXT NOT NULL,
    body        TEXT NOT NULL,
    author      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    resolved    INTEGER NOT NULL DEFAULT 0,
    resolved_at TEXT,
    resolved_by TEXT,
    replies     TEXT NOT NULL DEFAULT '[]',
    deleted_at  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_threads_site_page
    ON threads (site_id, page_url);

  CREATE INDEX IF NOT EXISTS idx_threads_updated
    ON threads (site_id, page_url, updated_at);
`);

/** Convert a SQLite row to a Thread object matching the client data model */
function rowToThread(row) {
  return {
    id:         row.id,
    siteId:     row.site_id,
    pageUrl:    row.page_url,
    quote:      row.quote,
    anchor:     JSON.parse(row.anchor),
    body:       row.body,
    author:     row.author,
    createdAt:  row.created_at,
    updatedAt:  row.updated_at,
    resolved:   row.resolved === 1,
    resolvedAt: row.resolved_at || null,
    resolvedBy: row.resolved_by || null,
    replies:    JSON.parse(row.replies),
    deletedAt:  row.deleted_at || null,
  };
}

/** Convert a Thread object to a flat row for SQLite insertion */
function threadToRow(thread) {
  return {
    id:          thread.id,
    site_id:     thread.siteId,
    page_url:    thread.pageUrl,
    quote:       thread.quote,
    anchor:      JSON.stringify(thread.anchor || null),
    body:        thread.body,
    author:      thread.author,
    created_at:  thread.createdAt,
    updated_at:  thread.updatedAt,
    resolved:    thread.resolved ? 1 : 0,
    resolved_at: thread.resolvedAt || null,
    resolved_by: thread.resolvedBy || null,
    replies:     JSON.stringify(thread.replies || []),
    deleted_at:  thread.deletedAt || null,
  };
}

module.exports = { db, rowToThread, threadToRow };
