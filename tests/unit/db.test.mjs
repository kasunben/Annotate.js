import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { rowToThread, threadToRow, rowToActivity, db } = require('../../server/db.js');

// ── rowToThread ──────────────────────────────────────────────────────────────

describe('rowToThread', () => {
  const baseRow = {
    id:          'id-1',
    site_id:     'site',
    page_url:    'http://example.com',
    quote:       'text',
    anchor:      '{"xpath":"//p[1]/text()","startOffset":0,"endOffset":4}',
    body:        'body',
    author:      'Alice',
    author_id:   'uuid-1',
    created_at:  '2024-01-01T00:00:00.000Z',
    updated_at:  '2024-01-01T01:00:00.000Z',
    resolved:    0,
    resolved_at: null,
    resolved_by: null,
    replies:     '[]',
    deleted_at:  null,
  };

  it('maps snake_case fields to camelCase', () => {
    const t = rowToThread(baseRow);
    expect(t.id).toBe('id-1');
    expect(t.siteId).toBe('site');
    expect(t.pageUrl).toBe('http://example.com');
    expect(t.createdAt).toBe('2024-01-01T00:00:00.000Z');
    expect(t.updatedAt).toBe('2024-01-01T01:00:00.000Z');
    expect(t.resolvedAt).toBeNull();
    expect(t.resolvedBy).toBeNull();
    expect(t.deletedAt).toBeNull();
    expect(t.authorId).toBe('uuid-1');
  });

  it('parses anchor JSON string to object', () => {
    const t = rowToThread(baseRow);
    expect(t.anchor).toEqual({ xpath: '//p[1]/text()', startOffset: 0, endOffset: 4 });
  });

  it('parses replies JSON string to array', () => {
    expect(rowToThread(baseRow).replies).toEqual([]);
  });

  it('coerces resolved=0 to false', () => {
    expect(rowToThread({ ...baseRow, resolved: 0 }).resolved).toBe(false);
  });

  it('coerces resolved=1 to true', () => {
    expect(rowToThread({ ...baseRow, resolved: 1 }).resolved).toBe(true);
  });

  it('falls back to null for missing author_id', () => {
    expect(rowToThread({ ...baseRow, author_id: null }).authorId).toBeNull();
  });

  it('parses a non-empty replies array', () => {
    const replies = [{ id: 'r1', body: 'hi', author: 'Bob', createdAt: '2024-01-02T00:00:00.000Z' }];
    const t = rowToThread({ ...baseRow, replies: JSON.stringify(replies) });
    expect(t.replies).toHaveLength(1);
    expect(t.replies[0].body).toBe('hi');
  });
});

// ── threadToRow ──────────────────────────────────────────────────────────────

describe('threadToRow', () => {
  const baseThread = {
    id:         'id-1',
    siteId:     'site',
    pageUrl:    'http://example.com',
    quote:      'text',
    anchor:     { xpath: '//p[1]/text()', startOffset: 0, endOffset: 4 },
    body:       'body',
    author:     'Alice',
    authorId:   'uuid-1',
    createdAt:  '2024-01-01T00:00:00.000Z',
    updatedAt:  '2024-01-01T01:00:00.000Z',
    resolved:   false,
    resolvedAt: null,
    resolvedBy: null,
    replies:    [],
    dirty:      false,
    deletedAt:  null,
  };

  it('maps camelCase fields to snake_case', () => {
    const row = threadToRow(baseThread);
    expect(row.site_id).toBe('site');
    expect(row.page_url).toBe('http://example.com');
    expect(row.author_id).toBe('uuid-1');
    expect(row.created_at).toBe('2024-01-01T00:00:00.000Z');
    expect(row.updated_at).toBe('2024-01-01T01:00:00.000Z');
    expect(row.resolved_at).toBeNull();
    expect(row.resolved_by).toBeNull();
    expect(row.deleted_at).toBeNull();
  });

  it('serialises anchor to JSON string', () => {
    expect(JSON.parse(threadToRow(baseThread).anchor))
      .toEqual({ xpath: '//p[1]/text()', startOffset: 0, endOffset: 4 });
  });

  it('serialises replies to JSON string', () => {
    expect(JSON.parse(threadToRow(baseThread).replies)).toEqual([]);
  });

  it('coerces resolved=false to 0', () => {
    expect(threadToRow({ ...baseThread, resolved: false }).resolved).toBe(0);
  });

  it('coerces resolved=true to 1', () => {
    expect(threadToRow({ ...baseThread, resolved: true }).resolved).toBe(1);
  });

  it('falls back to null for missing authorId', () => {
    expect(threadToRow({ ...baseThread, authorId: null }).author_id).toBeNull();
    expect(threadToRow({ ...baseThread, authorId: undefined }).author_id).toBeNull();
  });
});

// ── round-trip ────────────────────────────────────────────────────────────────

describe('rowToThread / threadToRow round-trip', () => {
  it('preserves all persisted fields through a full round-trip', () => {
    const original = {
      id:         'rt-1',
      siteId:     'site',
      pageUrl:    'http://example.com/page',
      quote:      'some text',
      anchor:     { xpath: '//body/p[2]/text()', startOffset: 5, endOffset: 15 },
      body:       'my note',
      author:     'Bob',
      authorId:   'uuid-bob',
      createdAt:  '2024-06-01T12:00:00.000Z',
      updatedAt:  '2024-06-01T13:00:00.000Z',
      resolved:   true,
      resolvedAt: '2024-06-01T13:00:00.000Z',
      resolvedBy: 'Alice',
      replies:    [],
      dirty:      false,
      deletedAt:  null,
    };
    const roundTripped = rowToThread(threadToRow(original));
    const { dirty: _d, ...expected } = original;
    expect(roundTripped).toMatchObject(expected);
  });
});

// ── rowToActivity ────────────────────────────────────────────────────────────

describe('rowToActivity', () => {
  it('maps snake_case to camelCase', () => {
    const row = {
      id:        'act-1',
      site_id:   'site',
      page_url:  'http://example.com',
      type:      'thread_created',
      thread_id: 'thread-1',
      reply_id:  null,
      actor:     'Alice',
      timestamp: '2024-01-01T00:00:00.000Z',
      snapshot:  "created: 'hello'",
    };
    const a = rowToActivity(row);
    expect(a.siteId).toBe('site');
    expect(a.pageUrl).toBe('http://example.com');
    expect(a.threadId).toBe('thread-1');
    expect(a.replyId).toBeNull();
    expect(a.timestamp).toBe('2024-01-01T00:00:00.000Z');
  });
});

// ── schema verification ───────────────────────────────────────────────────────

describe('schema', () => {
  it('has expected indexes on threads table', () => {
    const indexes = db.prepare('PRAGMA index_list(threads)').all();
    const names = indexes.map((i) => i.name);
    expect(names).toContain('idx_threads_site_page');
    expect(names).toContain('idx_threads_updated');
  });

  it('has expected indexes on activity table', () => {
    const indexes = db.prepare('PRAGMA index_list(activity)').all();
    const names = indexes.map((i) => i.name);
    expect(names).toContain('idx_activity_page');
    expect(names).toContain('idx_activity_ts');
  });

  it('threads table has an author_id column', () => {
    const cols = db.prepare('PRAGMA table_info(threads)').all();
    const names = cols.map((c) => c.name);
    expect(names).toContain('author_id');
  });
});
