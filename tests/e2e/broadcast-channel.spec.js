import { test, expect } from '@playwright/test';
import { initUser, selectText } from './helpers.js';

const FIXTURE = '/tests/fixtures/demo-test.html';

// BroadcastChannel works within the same browser context (same origin, same
// browser process). Two pages in the same context share IDB and BC.

test.describe('BroadcastChannel — same-origin multi-tab sync', () => {
  test('annotation created in Tab A appears in Tab B without reload', async ({ browser }) => {
    const ctx = await browser.newContext();

    const pageA = ctx.pages()[0] || await ctx.newPage();
    const pageB = await ctx.newPage();

    // Pre-set display name on both tabs
    await initUser(pageA, 'Alice', 'alice-uuid-000000');
    await initUser(pageB, 'Alice', 'alice-uuid-000000');

    await pageA.goto(FIXTURE);
    await pageB.goto(FIXTURE);

    await pageA.waitForSelector('#annotate-sidebar');
    await pageB.waitForSelector('#annotate-sidebar');

    // Alice creates an annotation in Tab A
    await selectText(pageA, '#p1', 'two decades optimising');
    await pageA.click('#annotate-comment-btn');
    await pageA.fill('.annotate-card-composer', 'Tab A annotation');
    await pageA.click('.annotate-btn-save');
    await pageA.waitForSelector('[data-thread-id]');

    // Tab B should receive it via BroadcastChannel and render the card
    await pageB.waitForSelector('[data-thread-id]', { timeout: 3000 });
    await expect(pageB.locator('.annotate-highlight')).toBeVisible();

    await ctx.close();
  });

  test('annotation created in Tab B appears in Tab A', async ({ browser }) => {
    const ctx = await browser.newContext();

    const pageA = ctx.pages()[0] || await ctx.newPage();
    const pageB = await ctx.newPage();

    await initUser(pageA, 'Bob', 'bob-uuid-000000');
    await initUser(pageB, 'Bob', 'bob-uuid-000000');

    await pageA.goto(FIXTURE);
    await pageB.goto(FIXTURE);
    await pageA.waitForSelector('#annotate-sidebar');
    await pageB.waitForSelector('#annotate-sidebar');

    await selectText(pageB, '#p2', 'speed has a shadow');
    await pageB.click('#annotate-comment-btn');
    await pageB.fill('.annotate-card-composer', 'From Tab B');
    await pageB.click('.annotate-btn-save');
    await pageB.waitForSelector('[data-thread-id]');

    await pageA.waitForSelector('[data-thread-id]', { timeout: 3000 });

    await ctx.close();
  });

  test('delete in Tab A removes thread and highlight in Tab B', async ({ browser }) => {
    const ctx = await browser.newContext();

    const pageA = ctx.pages()[0] || await ctx.newPage();
    const pageB = await ctx.newPage();

    await initUser(pageA, 'Alice', 'alice-uuid-000000');
    await initUser(pageB, 'Alice', 'alice-uuid-000000');

    await pageA.goto(FIXTURE);
    await pageB.goto(FIXTURE);
    await pageA.waitForSelector('#annotate-sidebar');
    await pageB.waitForSelector('#annotate-sidebar');

    // Create in Tab A, wait for it to appear in Tab B
    await selectText(pageA, '#p3', 'deliberation between impulse');
    await pageA.click('#annotate-comment-btn');
    await pageA.fill('.annotate-card-composer', 'Will be deleted');
    await pageA.click('.annotate-btn-save');
    await pageA.waitForSelector('[data-thread-id]');
    await pageB.waitForSelector('[data-thread-id]', { timeout: 3000 });

    // Delete in Tab A — register dialog handler BEFORE clicking Delete
    await pageA.click('.annotate-menu-btn');
    pageA.once('dialog', (d) => d.accept());
    await pageA.click('.annotate-delete-btn');

    // Tab B's highlight should disappear
    await pageB.waitForSelector('.annotate-highlight', { state: 'hidden', timeout: 3000 }).catch(() => {});
    await expect(pageB.locator('.annotate-highlight')).toHaveCount(0);

    await ctx.close();
  });
});
