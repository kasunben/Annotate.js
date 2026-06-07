// Tests the server-side behaviour that supports the client's Export/Import feature.
// The client stamps imported threads with importedAt (a recent updatedAt) so they
// appear in incremental server pulls. This file verifies the server-side upsert
// semantics that make restoration work correctly.

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const request = require('supertest');
const { createTestApp, clearDb } = require('../helpers/db-factory.js');
const { makeThread }             = require('../helpers/thread-fixtures.js');

const app = createTestApp();

beforeEach(clearDb);

describe('Export/Import server-side upsert semantics', () => {
  it('re-POSTing a thread with a newer updatedAt wins (last-write-wins)', async () => {
    const t = makeThread({ updatedAt: '2024-01-01T00:00:00.000Z', createdAt: '2024-01-01T00:00:00.000Z' });
    await request(app).post('/threads').send(t);

    // Simulate a restored import: same id, bumped updatedAt, different body
    const imported = { ...t, body: 'restored body', updatedAt: '2024-12-01T00:00:00.000Z' };
    const res = await request(app).post('/threads').send(imported);
    expect(res.status).toBe(201);
    expect(res.body.body).toBe('restored body');
    expect(res.body.updatedAt).toBe('2024-12-01T00:00:00.000Z');
  });

  it('imported thread appears in incremental pull because updatedAt is bumped to now', async () => {
    const t = makeThread({ updatedAt: '2024-01-01T00:00:00.000Z', createdAt: '2024-01-01T00:00:00.000Z' });
    await request(app).post('/threads').send(t);

    // Simulate import: stamp with fresh updatedAt
    const importedAt = new Date().toISOString();
    const imported = { ...t, body: 'imported', updatedAt: importedAt };
    await request(app).post('/threads').send(imported);

    // A peer that was last-synced at 2024-06-01 should see the imported thread
    const res = await request(app).get(
      `/threads?siteId=${t.siteId}&pageUrl=${encodeURIComponent(t.pageUrl)}&since=2024-06-01T00:00:00.000Z`
    );
    expect(res.body).toHaveLength(1);
    expect(res.body[0].body).toBe('imported');
  });

  it('restoring a deleted thread requires updatedAt newer than the deletion timestamp', async () => {
    const t = makeThread({ updatedAt: '2024-01-01T00:00:00.000Z', createdAt: '2024-01-01T00:00:00.000Z' });
    await request(app).post('/threads').send(t);

    // Delete bumps updatedAt
    await request(app).delete(`/threads/${t.id}`)
      .send({ deletedAt: '2024-06-01T00:00:00.000Z' });

    // Export-era copy (before deletion) re-posted with importedAt stamp wins because
    // importedAt (now) > deletedAt (June)
    const importedAt = new Date().toISOString();
    const restore = { ...t, deletedAt: null, updatedAt: importedAt };
    const res = await request(app).post('/threads').send(restore);
    expect(res.status).toBe(201);
    expect(res.body.deletedAt).toBeNull();
  });

  it('duplicate import is a no-op: re-posting same updatedAt does not change the body', async () => {
    const t = makeThread();
    await request(app).post('/threads').send(t);

    // Re-post exactly the same thread (INSERT OR REPLACE — it will re-insert with same values)
    const res = await request(app).post('/threads').send(t);
    expect(res.status).toBe(201);
    expect(res.body.body).toBe(t.body);

    // Still only one thread in the DB
    const list = await request(app)
      .get(`/threads?siteId=${t.siteId}&pageUrl=${encodeURIComponent(t.pageUrl)}`);
    expect(list.body).toHaveLength(1);
  });
});
