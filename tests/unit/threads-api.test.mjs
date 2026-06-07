import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const request = require('supertest');
const { createTestApp, clearDb, getDb } = require('../helpers/db-factory.js');
const { makeThread, makeReply }         = require('../helpers/thread-fixtures.js');

const app = createTestApp();

beforeEach(clearDb);

// ── GET /threads ──────────────────────────────────────────────────────────────

describe('GET /threads', () => {
  it('returns 400 when siteId is missing', async () => {
    const res = await request(app).get('/threads?pageUrl=http://x.com');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/siteId/);
  });

  it('returns 400 when pageUrl is missing', async () => {
    const res = await request(app).get('/threads?siteId=s1');
    expect(res.status).toBe(400);
  });

  it('returns empty array for an unknown site', async () => {
    const res = await request(app).get('/threads?siteId=none&pageUrl=http://x.com');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns threads for the matching siteId+pageUrl', async () => {
    const t = makeThread();
    await request(app).post('/threads').send(t);

    const res = await request(app)
      .get(`/threads?siteId=${t.siteId}&pageUrl=${encodeURIComponent(t.pageUrl)}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(t.id);
  });

  it('does not return threads for a different siteId', async () => {
    const t = makeThread({ siteId: 'site-a' });
    await request(app).post('/threads').send(t);

    const res = await request(app)
      .get(`/threads?siteId=site-b&pageUrl=${encodeURIComponent(t.pageUrl)}`);
    expect(res.body).toHaveLength(0);
  });

  it('includes soft-deleted threads so deletes propagate to other clients', async () => {
    const t = makeThread();
    await request(app).post('/threads').send(t);
    await request(app).delete(`/threads/${t.id}`).send({ deletedAt: new Date().toISOString() });

    const res = await request(app)
      .get(`/threads?siteId=${t.siteId}&pageUrl=${encodeURIComponent(t.pageUrl)}`);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].deletedAt).not.toBeNull();
  });
});

// ── GET /threads?since= ───────────────────────────────────────────────────────

describe('GET /threads?since=', () => {
  it('returns only threads updated after the given timestamp', async () => {
    const t1 = makeThread({ updatedAt: '2024-01-01T00:00:00.000Z', createdAt: '2024-01-01T00:00:00.000Z' });
    const t2 = makeThread({ updatedAt: '2024-06-01T00:00:00.000Z', createdAt: '2024-06-01T00:00:00.000Z', pageUrl: t1.pageUrl });
    await request(app).post('/threads').send(t1);
    await request(app).post('/threads').send(t2);

    const res = await request(app).get(
      `/threads?siteId=${t1.siteId}&pageUrl=${encodeURIComponent(t1.pageUrl)}&since=2024-03-01T00:00:00.000Z`
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(t2.id);
  });

  it('returns all threads when since is before all updatedAt values', async () => {
    const t = makeThread({ updatedAt: '2024-06-01T00:00:00.000Z', createdAt: '2024-06-01T00:00:00.000Z' });
    await request(app).post('/threads').send(t);

    const res = await request(app).get(
      `/threads?siteId=${t.siteId}&pageUrl=${encodeURIComponent(t.pageUrl)}&since=2024-01-01T00:00:00.000Z`
    );
    expect(res.body).toHaveLength(1);
  });
});

// ── POST /threads ─────────────────────────────────────────────────────────────

describe('POST /threads', () => {
  it('creates a new thread and returns 201 with the full thread', async () => {
    const t = makeThread();
    const res = await request(app).post('/threads').send(t);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(t.id);
    expect(res.body.body).toBe(t.body);
    expect(res.body.author).toBe(t.author);
  });

  it('returns 400 when id is missing', async () => {
    const { id: _id, ...rest } = makeThread();
    const res = await request(app).post('/threads').send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/id/);
  });

  it('returns 400 when siteId is missing', async () => {
    const { siteId: _s, ...rest } = makeThread();
    const res = await request(app).post('/threads').send(rest);
    expect(res.status).toBe(400);
  });

  it('returns 400 when pageUrl is missing', async () => {
    const { pageUrl: _p, ...rest } = makeThread();
    const res = await request(app).post('/threads').send(rest);
    expect(res.status).toBe(400);
  });

  it('returns 400 for an empty body', async () => {
    const res = await request(app).post('/threads').send({});
    expect(res.status).toBe(400);
  });

  it('allows owner to re-upsert their own thread (matching authorId)', async () => {
    const t = makeThread();
    await request(app).post('/threads').send(t);

    const updated = { ...t, body: 'updated body' };
    const res = await request(app).post('/threads').send(updated);
    expect(res.status).toBe(201);
    expect(res.body.body).toBe('updated body');
  });

  it('returns 403 when authorId does not match the stored thread', async () => {
    const t = makeThread({ authorId: 'owner-uuid' });
    await request(app).post('/threads').send(t);

    const rogue = { ...t, authorId: 'rogue-uuid' };
    const res = await request(app).post('/threads').send(rogue);
    expect(res.status).toBe(403);
  });

  it('returns 403 for a legacy thread that has no authorId in the DB', async () => {
    const db = getDb();
    const t = makeThread();
    db.prepare(`
      INSERT INTO threads (id, site_id, page_url, quote, anchor, body, author, author_id,
        created_at, updated_at, resolved, replies)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, '[]')
    `).run(t.id, t.siteId, t.pageUrl, t.quote, JSON.stringify(t.anchor),
           t.body, t.author, t.createdAt, t.updatedAt);

    const res = await request(app).post('/threads').send({ ...t, authorId: 'any-uuid' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/legacy/);
  });
});

// ── PATCH /threads/:id ────────────────────────────────────────────────────────

describe('PATCH /threads/:id', () => {
  it('updates the body and updatedAt', async () => {
    const t = makeThread();
    await request(app).post('/threads').send(t);

    const newUpdatedAt = new Date().toISOString();
    const res = await request(app)
      .patch(`/threads/${t.id}`)
      .send({ body: 'edited', updatedAt: newUpdatedAt });
    expect(res.status).toBe(200);
    expect(res.body.body).toBe('edited');
    expect(res.body.updatedAt).toBe(newUpdatedAt);
  });

  it('returns 404 for a non-existent thread', async () => {
    const res = await request(app)
      .patch('/threads/does-not-exist')
      .send({ body: 'x' });
    expect(res.status).toBe(404);
  });
});

// ── PATCH /threads/:id/resolve ────────────────────────────────────────────────

describe('PATCH /threads/:id/resolve', () => {
  it('marks the thread as resolved', async () => {
    const t = makeThread();
    await request(app).post('/threads').send(t);

    const res = await request(app)
      .patch(`/threads/${t.id}/resolve`)
      .send({ resolvedBy: 'Alice', resolvedAt: new Date().toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.resolved).toBe(true);
    expect(res.body.resolvedBy).toBe('Alice');
    expect(res.body.resolvedAt).not.toBeNull();
  });
});

// ── DELETE /threads/:id (soft-delete) ─────────────────────────────────────────

describe('DELETE /threads/:id', () => {
  it('soft-deletes — sets deletedAt; thread is still returned by GET', async () => {
    const t = makeThread();
    await request(app).post('/threads').send(t);

    const now = new Date().toISOString();
    const del = await request(app).delete(`/threads/${t.id}`).send({ deletedAt: now });
    expect(del.status).toBe(204);

    const get = await request(app)
      .get(`/threads?siteId=${t.siteId}&pageUrl=${encodeURIComponent(t.pageUrl)}`);
    expect(get.body[0].deletedAt).toBe(now);
  });
});

// ── DELETE /threads (hard-delete) ────────────────────────────────────────────

describe('DELETE /threads (bulk)', () => {
  it('returns 400 when siteId is missing', async () => {
    const res = await request(app).delete('/threads');
    expect(res.status).toBe(400);
  });

  it('deletes all threads for a siteId (admin clear)', async () => {
    const t1 = makeThread({ siteId: 'my-site' });
    const t2 = makeThread({ siteId: 'my-site', pageUrl: t1.pageUrl });
    await request(app).post('/threads').send(t1);
    await request(app).post('/threads').send(t2);

    const del = await request(app).delete('/threads?siteId=my-site');
    expect(del.status).toBe(204);

    const res = await request(app)
      .get(`/threads?siteId=my-site&pageUrl=${encodeURIComponent(t1.pageUrl)}`);
    expect(res.body).toHaveLength(0);
  });

  it('scopes deletion by authorId when provided', async () => {
    const alice = makeThread({ siteId: 'site', authorId: 'alice-id' });
    const bob   = makeThread({ siteId: 'site', authorId: 'bob-id', pageUrl: alice.pageUrl });
    await request(app).post('/threads').send(alice);
    await request(app).post('/threads').send(bob);

    await request(app).delete('/threads?siteId=site&authorId=alice-id');

    const res = await request(app)
      .get(`/threads?siteId=site&pageUrl=${encodeURIComponent(alice.pageUrl)}`);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(bob.id);
  });
});

// ── Replies ───────────────────────────────────────────────────────────────────

describe('POST /threads/:id/replies', () => {
  it('appends a reply and returns the updated thread', async () => {
    const t = makeThread();
    await request(app).post('/threads').send(t);

    const reply = makeReply();
    const res = await request(app)
      .post(`/threads/${t.id}/replies`)
      .send({ reply });
    expect(res.status).toBe(201);
    expect(res.body.replies).toHaveLength(1);
    expect(res.body.replies[0].body).toBe(reply.body);
  });

  it('returns 404 for a non-existent thread', async () => {
    const res = await request(app)
      .post('/threads/no-such-id/replies')
      .send({ reply: makeReply() });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /threads/:id/replies/:replyId', () => {
  it('edits the reply body', async () => {
    const t = makeThread();
    const reply = makeReply();
    await request(app).post('/threads').send(t);
    await request(app).post(`/threads/${t.id}/replies`).send({ reply });

    const res = await request(app)
      .patch(`/threads/${t.id}/replies/${reply.id}`)
      .send({ body: 'edited reply', updatedAt: new Date().toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.replies[0].body).toBe('edited reply');
  });

  it('returns 404 for a non-existent thread', async () => {
    const res = await request(app)
      .patch('/threads/no-such-id/replies/r1')
      .send({ body: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /threads/:id/replies/:replyId', () => {
  it('soft-deletes the reply (sets deleted: true)', async () => {
    const t = makeThread();
    const reply = makeReply();
    await request(app).post('/threads').send(t);
    await request(app).post(`/threads/${t.id}/replies`).send({ reply });

    const res = await request(app)
      .delete(`/threads/${t.id}/replies/${reply.id}`);
    expect(res.status).toBe(200);
    expect(res.body.replies[0].deleted).toBe(true);
  });

  it('returns 404 for a non-existent thread', async () => {
    const res = await request(app)
      .delete('/threads/no-such-id/replies/r1');
    expect(res.status).toBe(404);
  });
});
