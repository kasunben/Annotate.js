import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const request = require('supertest');
const { createTestApp, clearDb, getDb } = require('../helpers/db-factory.js');
const { makeThread }                    = require('../helpers/thread-fixtures.js');

const app = createTestApp();

beforeEach(clearDb);

describe('Ownership enforcement', () => {
  it('Alice can create a thread and Bob cannot overwrite it', async () => {
    const alice = makeThread({ authorId: 'alice-id' });
    const created = await request(app).post('/threads').send(alice);
    expect(created.status).toBe(201);

    const bobAttempt = await request(app).post('/threads').send({ ...alice, authorId: 'bob-id', body: 'hijacked' });
    expect(bobAttempt.status).toBe(403);
    expect(bobAttempt.body.error).toBe('forbidden');

    // Body unchanged
    const get = await request(app)
      .get(`/threads?siteId=${alice.siteId}&pageUrl=${encodeURIComponent(alice.pageUrl)}`);
    expect(get.body[0].body).toBe(alice.body);
  });

  it('Alice can re-upsert her own thread', async () => {
    const alice = makeThread({ authorId: 'alice-id' });
    await request(app).post('/threads').send(alice);

    const updated = await request(app).post('/threads').send({ ...alice, body: 'updated by Alice' });
    expect(updated.status).toBe(201);
    expect(updated.body.body).toBe('updated by Alice');
  });

  it('legacy thread (no author_id in DB) is permanently read-only for all authors', async () => {
    const db = getDb();
    const t = makeThread();
    db.prepare(`
      INSERT INTO threads (id, site_id, page_url, quote, anchor, body, author, author_id,
        created_at, updated_at, resolved, replies)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, '[]')
    `).run(t.id, t.siteId, t.pageUrl, t.quote, JSON.stringify(t.anchor),
           t.body, t.author, t.createdAt, t.updatedAt);

    // Any author attempt is rejected
    const res1 = await request(app).post('/threads').send({ ...t, authorId: 'any-uuid' });
    expect(res1.status).toBe(403);
    expect(res1.body.error).toMatch(/legacy/);

    // Even null authorId is rejected
    const res2 = await request(app).post('/threads').send({ ...t, authorId: null });
    expect(res2.status).toBe(403);
  });

  it('scoped DELETE removes only the requesting author\'s threads', async () => {
    const alice = makeThread({ siteId: 'site', authorId: 'alice-id' });
    const bob   = makeThread({ siteId: 'site', authorId: 'bob-id', pageUrl: alice.pageUrl });
    await request(app).post('/threads').send(alice);
    await request(app).post('/threads').send(bob);

    await request(app).delete('/threads?siteId=site&authorId=alice-id');

    const res = await request(app)
      .get(`/threads?siteId=site&pageUrl=${encodeURIComponent(alice.pageUrl)}`);
    const ids = res.body.map((t) => t.id);
    expect(ids).not.toContain(alice.id);
    expect(ids).toContain(bob.id);
  });
});
