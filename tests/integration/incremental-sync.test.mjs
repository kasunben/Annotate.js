import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const request = require('supertest');
const { createTestApp, clearDb } = require('../helpers/db-factory.js');
const { makeThread, makeActivity } = require('../helpers/thread-fixtures.js');

const app = createTestApp();

beforeEach(clearDb);

const PAGE = 'http://localhost:3000/page';
const SITE = 'test-site';

describe('Incremental thread sync — ?since=', () => {
  it('returns threads created after since', async () => {
    const old    = makeThread({ pageUrl: PAGE, updatedAt: '2024-01-01T00:00:00.000Z', createdAt: '2024-01-01T00:00:00.000Z' });
    const newer  = makeThread({ pageUrl: PAGE, updatedAt: '2024-06-01T00:00:00.000Z', createdAt: '2024-06-01T00:00:00.000Z' });
    const newest = makeThread({ pageUrl: PAGE, updatedAt: '2024-12-01T00:00:00.000Z', createdAt: '2024-12-01T00:00:00.000Z' });
    await Promise.all([
      request(app).post('/threads').send(old),
      request(app).post('/threads').send(newer),
      request(app).post('/threads').send(newest),
    ]);

    const res = await request(app).get(
      `/threads?siteId=${old.siteId}&pageUrl=${encodeURIComponent(PAGE)}&since=2024-03-01T00:00:00.000Z`
    );
    const ids = res.body.map((t) => t.id);
    expect(ids).not.toContain(old.id);
    expect(ids).toContain(newer.id);
    expect(ids).toContain(newest.id);
  });

  it('returns soft-deleted threads in since= pull so other clients reconcile the deletion', async () => {
    const t = makeThread({ pageUrl: PAGE, updatedAt: '2024-01-01T00:00:00.000Z', createdAt: '2024-01-01T00:00:00.000Z' });
    await request(app).post('/threads').send(t);

    // Soft-delete bumps updated_at to now
    await request(app).delete(`/threads/${t.id}`).send({ deletedAt: new Date().toISOString() });

    const res = await request(app).get(
      `/threads?siteId=${t.siteId}&pageUrl=${encodeURIComponent(PAGE)}&since=2024-06-01T00:00:00.000Z`
    );
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(t.id);
    expect(res.body[0].deletedAt).not.toBeNull();
  });

  it('returns edited threads in since= pull', async () => {
    const t = makeThread({ pageUrl: PAGE, updatedAt: '2024-01-01T00:00:00.000Z', createdAt: '2024-01-01T00:00:00.000Z' });
    await request(app).post('/threads').send(t);

    const newUpdatedAt = '2024-12-01T00:00:00.000Z';
    await request(app).patch(`/threads/${t.id}`).send({ body: 'new body', updatedAt: newUpdatedAt });

    const res = await request(app).get(
      `/threads?siteId=${t.siteId}&pageUrl=${encodeURIComponent(PAGE)}&since=2024-06-01T00:00:00.000Z`
    );
    expect(res.body).toHaveLength(1);
    expect(res.body[0].body).toBe('new body');
  });

  it('returns empty array when nothing changed since the given timestamp', async () => {
    const t = makeThread({ pageUrl: PAGE, updatedAt: '2024-01-01T00:00:00.000Z', createdAt: '2024-01-01T00:00:00.000Z' });
    await request(app).post('/threads').send(t);

    const res = await request(app).get(
      `/threads?siteId=${t.siteId}&pageUrl=${encodeURIComponent(PAGE)}&since=2024-06-01T00:00:00.000Z`
    );
    expect(res.body).toHaveLength(0);
  });
});

describe('Incremental activity sync — ?since=', () => {
  it('returns only activity entries with timestamp after since', async () => {
    const a1 = makeActivity({ pageUrl: PAGE, timestamp: '2024-01-01T00:00:00.000Z' });
    const a2 = makeActivity({ pageUrl: PAGE, timestamp: '2024-12-01T00:00:00.000Z' });
    await request(app).post('/activity').send(a1);
    await request(app).post('/activity').send(a2);

    const res = await request(app).get(
      `/activity?siteId=${a1.siteId}&pageUrl=${encodeURIComponent(PAGE)}&since=2024-06-01T00:00:00.000Z`
    );
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(a2.id);
  });
});
