import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const request = require('supertest');
const { createTestApp, clearDb } = require('../helpers/db-factory.js');
const { makeThread, makeActivity } = require('../helpers/thread-fixtures.js');

const app = createTestApp();

beforeEach(clearDb);

describe('Admin delete — DELETE /threads (unscoped)', () => {
  it('returns 400 when siteId is missing', async () => {
    const res = await request(app).delete('/threads');
    expect(res.status).toBe(400);
  });

  it('hard-deletes ALL threads for a site including other users\'', async () => {
    const alice = makeThread({ siteId: 'site', authorId: 'alice-id' });
    const bob   = makeThread({ siteId: 'site', authorId: 'bob-id', pageUrl: alice.pageUrl });
    await request(app).post('/threads').send(alice);
    await request(app).post('/threads').send(bob);

    const del = await request(app).delete('/threads?siteId=site');
    expect(del.status).toBe(204);

    const res = await request(app)
      .get(`/threads?siteId=site&pageUrl=${encodeURIComponent(alice.pageUrl)}`);
    expect(res.body).toHaveLength(0);
  });

  it('does not affect threads on a different site', async () => {
    const t1 = makeThread({ siteId: 'target-site' });
    const t2 = makeThread({ siteId: 'other-site', pageUrl: t1.pageUrl });
    await request(app).post('/threads').send(t1);
    await request(app).post('/threads').send(t2);

    await request(app).delete('/threads?siteId=target-site');

    const res = await request(app)
      .get(`/threads?siteId=other-site&pageUrl=${encodeURIComponent(t2.pageUrl)}`);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(t2.id);
  });
});

describe('Admin delete — DELETE /activity (unscoped)', () => {
  it('returns 400 when siteId is missing', async () => {
    const res = await request(app).delete('/activity');
    expect(res.status).toBe(400);
  });

  it('hard-deletes all activity for a site', async () => {
    const a = makeActivity({ siteId: 'site' });
    await request(app).post('/activity').send(a);

    const del = await request(app).delete('/activity?siteId=site');
    expect(del.status).toBe(204);

    const res = await request(app)
      .get(`/activity?siteId=site&pageUrl=${encodeURIComponent(a.pageUrl)}`);
    expect(res.body).toHaveLength(0);
  });
});

describe('Admin clear-all — threads + activity in one operation', () => {
  it('both tables are wiped for the given site after a coordinated clear', async () => {
    const t = makeThread({ siteId: 'site' });
    const a = makeActivity({ siteId: 'site', pageUrl: t.pageUrl });
    await request(app).post('/threads').send(t);
    await request(app).post('/activity').send(a);

    await Promise.all([
      request(app).delete('/threads?siteId=site'),
      request(app).delete('/activity?siteId=site'),
    ]);

    const [threadsRes, activityRes] = await Promise.all([
      request(app).get(`/threads?siteId=site&pageUrl=${encodeURIComponent(t.pageUrl)}`),
      request(app).get(`/activity?siteId=site&pageUrl=${encodeURIComponent(a.pageUrl)}`),
    ]);
    expect(threadsRes.body).toHaveLength(0);
    expect(activityRes.body).toHaveLength(0);
  });
});
