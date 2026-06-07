import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const request = require('supertest');
const { createTestApp, clearDb } = require('../helpers/db-factory.js');
const { makeThread, makeReply }  = require('../helpers/thread-fixtures.js');

const app = createTestApp();

beforeEach(clearDb);

describe('Thread lifecycle — create → reply → edit → resolve → un-resolve → delete', () => {
  it('full lifecycle persists correctly through each mutation', async () => {
    const t = makeThread();

    // 1. Create
    const created = await request(app).post('/threads').send(t);
    expect(created.status).toBe(201);
    expect(created.body.id).toBe(t.id);
    expect(created.body.resolved).toBe(false);

    // 2. Add reply
    const reply = makeReply();
    const replied = await request(app).post(`/threads/${t.id}/replies`).send({ reply });
    expect(replied.status).toBe(201);
    expect(replied.body.replies).toHaveLength(1);
    expect(replied.body.replies[0].body).toBe(reply.body);

    // 3. Edit thread body
    const editedAt = new Date().toISOString();
    const edited = await request(app)
      .patch(`/threads/${t.id}`)
      .send({ body: 'edited body', updatedAt: editedAt });
    expect(edited.status).toBe(200);
    expect(edited.body.body).toBe('edited body');
    expect(edited.body.updatedAt).toBe(editedAt);

    // 4. Edit reply
    const editedReply = await request(app)
      .patch(`/threads/${t.id}/replies/${reply.id}`)
      .send({ body: 'edited reply' });
    expect(editedReply.status).toBe(200);
    expect(editedReply.body.replies[0].body).toBe('edited reply');

    // 5. Resolve
    const resolvedAt = new Date().toISOString();
    const resolved = await request(app)
      .patch(`/threads/${t.id}/resolve`)
      .send({ resolvedBy: 'Alice', resolvedAt });
    expect(resolved.status).toBe(200);
    expect(resolved.body.resolved).toBe(true);
    expect(resolved.body.resolvedBy).toBe('Alice');

    // 6. Verify thread is still retrievable after resolve
    const getResolved = await request(app)
      .get(`/threads?siteId=${t.siteId}&pageUrl=${encodeURIComponent(t.pageUrl)}`);
    expect(getResolved.body[0].resolved).toBe(true);

    // 7. Soft-delete the reply
    const deletedReply = await request(app)
      .delete(`/threads/${t.id}/replies/${reply.id}`);
    expect(deletedReply.status).toBe(200);
    expect(deletedReply.body.replies[0].deleted).toBe(true);

    // 8. Soft-delete the thread
    const deletedAt = new Date().toISOString();
    const deleted = await request(app)
      .delete(`/threads/${t.id}`)
      .send({ deletedAt });
    expect(deleted.status).toBe(204);

    // 9. Thread still returned by GET (soft-delete propagation to other clients)
    const afterDelete = await request(app)
      .get(`/threads?siteId=${t.siteId}&pageUrl=${encodeURIComponent(t.pageUrl)}`);
    expect(afterDelete.body).toHaveLength(1);
    expect(afterDelete.body[0].deletedAt).toBe(deletedAt);
  });

  it('updatedAt is bumped on every mutation so incremental pulls see changes', async () => {
    const t = makeThread({ updatedAt: '2024-01-01T00:00:00.000Z', createdAt: '2024-01-01T00:00:00.000Z' });
    await request(app).post('/threads').send(t);

    const laterAt = '2024-06-01T00:00:00.000Z';
    await request(app).patch(`/threads/${t.id}`).send({ body: 'x', updatedAt: laterAt });

    // Pull with since= original timestamp should catch the edit
    const res = await request(app).get(
      `/threads?siteId=${t.siteId}&pageUrl=${encodeURIComponent(t.pageUrl)}&since=2024-01-01T00:00:00.000Z`
    );
    expect(res.body).toHaveLength(1);
    expect(res.body[0].body).toBe('x');
  });

  it('soft-deleted threads appear in since= pulls so deletions propagate', async () => {
    const t = makeThread({ updatedAt: '2024-01-01T00:00:00.000Z', createdAt: '2024-01-01T00:00:00.000Z' });
    await request(app).post('/threads').send(t);

    const now = new Date().toISOString();
    await request(app).delete(`/threads/${t.id}`).send({ deletedAt: now });

    const res = await request(app).get(
      `/threads?siteId=${t.siteId}&pageUrl=${encodeURIComponent(t.pageUrl)}&since=2024-01-01T00:00:00.000Z`
    );
    expect(res.body).toHaveLength(1);
    expect(res.body[0].deletedAt).not.toBeNull();
  });
});
