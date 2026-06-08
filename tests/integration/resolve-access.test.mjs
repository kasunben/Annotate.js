import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const request = require('supertest');
const { createTestApp, clearDb } = require('../helpers/db-factory.js');
const { makeThread }             = require('../helpers/thread-fixtures.js');

const app = createTestApp();

beforeEach(clearDb);

describe('PATCH /threads/:id/resolve — open to any user (no ownership check)', () => {
  it('owner can resolve their own thread', async () => {
    const alice = makeThread({ authorId: 'alice-id' });
    await request(app).post('/threads').send(alice);

    const resolvedAt = new Date().toISOString();
    const res = await request(app)
      .patch(`/threads/${alice.id}/resolve`)
      .send({ resolved: true, resolvedBy: 'Alice', resolvedAt });

    expect(res.status).toBe(200);
    expect(res.body.resolved).toBe(true);
    expect(res.body.resolvedBy).toBe('Alice');
    expect(res.body.resolvedAt).toBe(resolvedAt);
  });

  it('non-owner can resolve a thread they did not create', async () => {
    const alice = makeThread({ authorId: 'alice-id' });
    await request(app).post('/threads').send(alice);

    // Bob resolves Alice's thread
    const res = await request(app)
      .patch(`/threads/${alice.id}/resolve`)
      .send({ resolved: true, resolvedBy: 'Bob', resolvedAt: new Date().toISOString() });

    expect(res.status).toBe(200);
    expect(res.body.resolved).toBe(true);
    expect(res.body.resolvedBy).toBe('Bob');
  });

  it('non-owner can un-resolve a thread they did not create', async () => {
    const alice = makeThread({ authorId: 'alice-id' });
    await request(app).post('/threads').send(alice);

    // Bob resolves then un-resolves Alice's thread
    await request(app)
      .patch(`/threads/${alice.id}/resolve`)
      .send({ resolved: true, resolvedBy: 'Bob', resolvedAt: new Date().toISOString() });

    const unres = await request(app)
      .patch(`/threads/${alice.id}/resolve`)
      .send({ resolved: false });

    expect(unres.status).toBe(200);
    expect(unres.body.resolved).toBe(false);
    expect(unres.body.resolvedBy).toBeNull();
    expect(unres.body.resolvedAt).toBeNull();
  });

  it('un-resolve clears resolvedBy and resolvedAt', async () => {
    const t = makeThread();
    await request(app).post('/threads').send(t);

    await request(app)
      .patch(`/threads/${t.id}/resolve`)
      .send({ resolved: true, resolvedBy: 'Alice', resolvedAt: new Date().toISOString() });

    const unres = await request(app)
      .patch(`/threads/${t.id}/resolve`)
      .send({ resolved: false });

    expect(unres.body.resolved).toBe(false);
    expect(unres.body.resolvedBy).toBeNull();
    expect(unres.body.resolvedAt).toBeNull();
  });

  it('resolve bumps updatedAt so incremental pulls see the change', async () => {
    const t = makeThread({
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    await request(app).post('/threads').send(t);

    await request(app)
      .patch(`/threads/${t.id}/resolve`)
      .send({ resolved: true, resolvedBy: 'Alice' });

    const since = await request(app).get(
      `/threads?siteId=${t.siteId}&pageUrl=${encodeURIComponent(t.pageUrl)}&since=2024-01-01T00:00:00.000Z`
    );
    expect(since.body).toHaveLength(1);
    expect(since.body[0].resolved).toBe(true);
  });

  it('un-resolve bumps updatedAt so incremental pulls see the change', async () => {
    const t = makeThread({
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    await request(app).post('/threads').send(t);

    await request(app)
      .patch(`/threads/${t.id}/resolve`)
      .send({ resolved: true, resolvedBy: 'Alice' });

    await request(app)
      .patch(`/threads/${t.id}/resolve`)
      .send({ resolved: false });

    const since = await request(app).get(
      `/threads?siteId=${t.siteId}&pageUrl=${encodeURIComponent(t.pageUrl)}&since=2024-01-01T00:00:00.000Z`
    );
    expect(since.body).toHaveLength(1);
    expect(since.body[0].resolved).toBe(false);
  });

  it('returns 404 for a thread id that does not exist', async () => {
    const res = await request(app)
      .patch('/threads/nonexistent-id/resolve')
      .send({ resolved: true });
    expect(res.status).toBe(404);
  });
});
