import { test, expect } from '@playwright/test';
import { initUser, selectText, triggerPull } from './helpers.js';

// Each test gets its own URL query param so pageUrl differs on the server —
// threads from one test can't contaminate another's pull results.
const url = (tag) => `/tests/fixtures/demo-sync-test.html?ss=${tag}`;

// Two separate browser contexts = two distinct users (different localStorage/IDB).
// annotate.js polls every 30 s, but we trigger an immediate pull via
// visibilitychange (annotate.js calls pullThreads() on tab focus).

// All mutation syncs use POST /threads. Set up the listener BEFORE the action
// so we don't race the response.
function expectPost(page) {
  return page.waitForResponse(
    (r) => r.url().includes('/threads') && r.request().method() === 'POST',
    { timeout: 8000 }
  );
}

test.describe('Server sync — two-user multi-browser sync', () => {
  test('User A annotates → User B sees it after a triggered pull', async ({ browser }) => {
    const FIXTURE = url('annotate');
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await initUser(pageA, 'Alice', 'alice-server-uuid');
    await initUser(pageB, 'Bob',   'bob-server-uuid');

    await pageA.goto(FIXTURE);
    await pageB.goto(FIXTURE);
    // networkidle: initial pullThreads() completes and visibilitychange handler is registered
    await pageA.waitForLoadState('networkidle');
    await pageB.waitForLoadState('networkidle');

    // Alice creates a thread; wait for the POST to land before Bob pulls
    await selectText(pageA, '#p1', 'two decades optimising');
    await pageA.click('#annotate-comment-btn');
    await pageA.fill('.annotate-card-composer', 'Alice\'s note');
    const postDone = expectPost(pageA);
    await pageA.click('.annotate-btn-save');
    await postDone;

    // Bob triggers a pull and should see Alice's thread
    await triggerPull(pageB);
    await pageB.waitForSelector('[data-thread-id]', { timeout: 5000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('User A resolves → User B sees resolved card after pull', async ({ browser }) => {
    const FIXTURE = url('resolve');
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await initUser(pageA, 'Alice', 'alice-server-uuid');
    await initUser(pageB, 'Bob',   'bob-server-uuid');

    await pageA.goto(FIXTURE);
    await pageB.goto(FIXTURE);
    await pageA.waitForLoadState('networkidle');
    await pageB.waitForLoadState('networkidle');

    // Alice creates a thread
    await selectText(pageA, '#p2', 'speed has a shadow');
    await pageA.click('#annotate-comment-btn');
    await pageA.fill('.annotate-card-composer', 'Resolve test');
    const createDone = expectPost(pageA);
    await pageA.click('.annotate-btn-save');
    await createDone;

    // Bob pulls to see Alice's thread
    await triggerPull(pageB);
    await pageB.waitForSelector('[data-thread-id]', { timeout: 5000 });

    // Alice resolves (syncThread fires a POST with resolved:true)
    const resolveDone = expectPost(pageA);
    await pageA.locator('.annotate-resolve-btn').first().click();
    await resolveDone;

    // Bob triggers another pull
    await triggerPull(pageB);

    // Open Bob's sidebar so tab buttons are within the viewport for clicking
    await pageB.click('#annotate-toggle');

    // Bob's thread card should be in the Resolved tab (moved from Threads)
    await pageB.click('button.annotate-tab:has-text("Resolved")');
    await pageB.waitForSelector('#annotate-panel-resolved .annotate-resolved-card', { timeout: 5000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('User A deletes → User B\'s highlight unwraps after pull', async ({ browser }) => {
    const FIXTURE = url('delete');
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await initUser(pageA, 'Alice', 'alice-server-uuid');
    await initUser(pageB, 'Bob',   'bob-server-uuid');

    await pageA.goto(FIXTURE);
    await pageB.goto(FIXTURE);
    await pageA.waitForLoadState('networkidle');
    await pageB.waitForLoadState('networkidle');

    // Alice creates a thread
    await selectText(pageA, '#p3', 'deliberation between impulse');
    await pageA.click('#annotate-comment-btn');
    await pageA.fill('.annotate-card-composer', 'Will be deleted by Alice');
    const createDone = expectPost(pageA);
    await pageA.click('.annotate-btn-save');
    await createDone;

    // Bob sees it
    await triggerPull(pageB);
    await pageB.waitForSelector('[data-thread-id]', { timeout: 5000 });

    // Alice deletes (syncThread fires a POST with deletedAt set)
    const deleteDone = expectPost(pageA);
    await pageA.click('.annotate-menu-btn');
    pageA.once('dialog', (d) => d.accept());
    await pageA.click('.annotate-delete-btn');
    await deleteDone;

    // Bob triggers a pull
    await triggerPull(pageB);

    // Bob's highlight should be removed
    await pageB.waitForSelector('.annotate-highlight', { state: 'detached', timeout: 5000 }).catch(() => {});
    await expect(pageB.locator('.annotate-highlight')).toHaveCount(0);

    await ctxA.close();
    await ctxB.close();
  });

  test('User B cannot edit or delete User A\'s thread', async ({ browser }) => {
    const FIXTURE = url('ownership');
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await initUser(pageA, 'Alice', 'alice-server-uuid');
    await initUser(pageB, 'Bob',   'bob-server-uuid');

    await pageA.goto(FIXTURE);
    await pageB.goto(FIXTURE);
    await pageA.waitForLoadState('networkidle');
    await pageB.waitForLoadState('networkidle');

    // Alice creates a thread
    await selectText(pageA, '#p1', 'speed of delivery');
    await pageA.click('#annotate-comment-btn');
    await pageA.fill('.annotate-card-composer', 'Alice owns this');
    const createDone = expectPost(pageA);
    await pageA.click('.annotate-btn-save');
    await createDone;

    // Bob pulls
    await triggerPull(pageB);
    await pageB.waitForSelector('[data-thread-id]', { timeout: 5000 });

    // Bob should NOT see the three-dot menu (Edit/Delete) on Alice's thread
    await expect(pageB.locator('.annotate-menu-btn')).toHaveCount(0);

    // Bob CAN see the Resolve button (collaborative action)
    await expect(pageB.locator('.annotate-resolve-btn').first()).toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });
});
