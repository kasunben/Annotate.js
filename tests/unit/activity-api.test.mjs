import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const request = require('supertest');
const { createTestApp, clearDb } = require('../helpers/db-factory.js');
const { makeActivity }           = require('../helpers/thread-fixtures.js');

const app = createTestApp();

beforeEach(clearDb);

// ── GET /activity ─────────────────────────────────────────────────────────────

describe('GET /activity', () => {
  it('returns 400 when siteId is missing', async () => {
    const res = await request(app).get('/activity?pageUrl=http://x.com');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/siteId/);
  });

  it('returns 400 when pageUrl is missing', async () => {
    const res = await request(app).get('/activity?siteId=s1');
    expect(res.status).toBe(400);
  });

  it('returns empty array when no activity exists', async () => {
    const res = await request(app).get('/activity?siteId=s1&pageUrl=http://x.com');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns activity entries in ascending timestamp order', async () => {
    const a1 = makeActivity({ timestamp: '2024-01-01T00:00:00.000Z' });
    const a2 = makeActivity({ timestamp: '2024-06-01T00:00:00.000Z', pageUrl: a1.pageUrl });
    await request(app).post('/activity').send(a2);
    await request(app).post('/activity').send(a1);

    const res = await request(app)
      .get(`/activity?siteId=${a1.siteId}&pageUrl=${encodeURIComponent(a1.pageUrl)}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].timestamp).toBe('2024-01-01T00:00:00.000Z');
    expect(res.body[1].timestamp).toBe('2024-06-01T00:00:00.000Z');
  });
});

// ── GET /activity?since= ──────────────────────────────────────────────────────

describe('GET /activity?since=', () => {
  it('returns only entries with timestamp after since', async () => {
    const a1 = makeActivity({ timestamp: '2024-01-01T00:00:00.000Z' });
    const a2 = makeActivity({ timestamp: '2024-06-01T00:00:00.000Z', pageUrl: a1.pageUrl });
    await request(app).post('/activity').send(a1);
    await request(app).post('/activity').send(a2);

    const res = await request(app).get(
      `/activity?siteId=${a1.siteId}&pageUrl=${encodeURIComponent(a1.pageUrl)}&since=2024-03-01T00:00:00.000Z`
    );
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(a2.id);
  });
});

// ── POST /activity ────────────────────────────────────────────────────────────

describe('POST /activity', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).post('/activity').send({ id: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  it('creates a new activity entry and returns 201', async () => {
    const a = makeActivity();
    const res = await request(app).post('/activity').send(a);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(a.id);
  });

  it('is idempotent — posting the same id twice does not create a duplicate', async () => {
    const a = makeActivity();
    await request(app).post('/activity').send(a);
    const res = await request(app).post('/activity').send(a);
    expect(res.status).toBe(201);

    const list = await request(app)
      .get(`/activity?siteId=${a.siteId}&pageUrl=${encodeURIComponent(a.pageUrl)}`);
    expect(list.body).toHaveLength(1);
  });

  it('stores replyId when provided', async () => {
    const a = makeActivity({ replyId: 'reply-uuid' });
    await request(app).post('/activity').send(a);

    const res = await request(app)
      .get(`/activity?siteId=${a.siteId}&pageUrl=${encodeURIComponent(a.pageUrl)}`);
    expect(res.body[0].replyId).toBe('reply-uuid');
  });

  it('returns 400 when threadId is null/missing (server requires a non-null threadId)', async () => {
    const { threadId: _t, ...rest } = makeActivity();
    const res = await request(app).post('/activity').send(rest);
    expect(res.status).toBe(400);
  });
});

// ── DELETE /activity ──────────────────────────────────────────────────────────

describe('DELETE /activity', () => {
  it('returns 400 when siteId is missing', async () => {
    const res = await request(app).delete('/activity');
    expect(res.status).toBe(400);
  });

  it('hard-deletes all activity for a siteId', async () => {
    const a = makeActivity();
    await request(app).post('/activity').send(a);

    const del = await request(app).delete(`/activity?siteId=${a.siteId}`);
    expect(del.status).toBe(204);

    const list = await request(app)
      .get(`/activity?siteId=${a.siteId}&pageUrl=${encodeURIComponent(a.pageUrl)}`);
    expect(list.body).toHaveLength(0);
  });

  it('only deletes activity for the given siteId', async () => {
    const a1 = makeActivity({ siteId: 'site-a' });
    const a2 = makeActivity({ siteId: 'site-b', pageUrl: a1.pageUrl });
    await request(app).post('/activity').send(a1);
    await request(app).post('/activity').send(a2);

    await request(app).delete('/activity?siteId=site-a');

    const res = await request(app)
      .get(`/activity?siteId=site-b&pageUrl=${encodeURIComponent(a2.pageUrl)}`);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(a2.id);
  });
});
