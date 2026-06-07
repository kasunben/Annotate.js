import { test, expect } from '@playwright/test';
import { initUser, selectText, triggerPull } from './helpers.js';

// Each test uses a unique URL suffix so server-side threads don't cross-contaminate.
const OFFLINE = '/tests/fixtures/demo-test.html';
const syncUrl = (tag) => `/tests/fixtures/demo-sync-test.html?ac=${tag}`;

test.describe('Access control — ownership-based Edit/Delete visibility', () => {
  test('offline mode: owner sees Edit+Delete; Resolve is always visible', async ({ page }) => {
    await initUser(page, 'Owner', 'owner-uuid-000000');
    await page.goto(OFFLINE);
    await page.waitForSelector('#annotate-sidebar');

    await selectText(page, '#p1', 'two decades optimising');
    await page.click('#annotate-comment-btn');
    await page.fill('.annotate-card-composer', 'Owner note');
    await page.click('.annotate-btn-save');
    await page.waitForSelector('[data-thread-id]');

    // Owner sees the three-dot menu
    await expect(page.locator('.annotate-menu-btn').first()).toBeVisible();
    // Owner sees Resolve
    await expect(page.locator('.annotate-resolve-btn').first()).toBeVisible();
  });

  test('server sync: non-owner does not see Edit/Delete but sees Resolve', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await initUser(pageA, 'Alice', 'alice-ac-uuid');
    await initUser(pageB, 'Bob',   'bob-ac-uuid');

    const FIXTURE = syncUrl('nonowner');
    await pageA.goto(FIXTURE);
    await pageB.goto(FIXTURE);
    await pageA.waitForLoadState('networkidle');
    await pageB.waitForLoadState('networkidle');

    // Alice creates
    await selectText(pageA, '#p2', 'speed has a shadow');
    await pageA.click('#annotate-comment-btn');
    await pageA.fill('.annotate-card-composer', 'Alice controls this');
    await pageA.click('.annotate-btn-save');
    await pageA.waitForSelector('[data-thread-id]');

    // Alice sees the menu on her own thread
    await expect(pageA.locator('.annotate-menu-btn').first()).toBeVisible();

    // Bob pulls and sees thread without menu
    await triggerPull(pageB);
    await pageB.waitForSelector('[data-thread-id]', { timeout: 5000 });
    await expect(pageB.locator('.annotate-menu-btn')).toHaveCount(0);

    // Bob can resolve (collaborative)
    await expect(pageB.locator('.annotate-resolve-btn').first()).toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });

  test('resolved thread: Edit/Delete/Reply hidden for everyone including owner', async ({ page }) => {
    await initUser(page, 'Owner', 'owner-uuid-000000');
    await page.goto(OFFLINE);
    await page.waitForSelector('#annotate-sidebar');

    await selectText(page, '#p3', 'deliberation between impulse');
    await page.click('#annotate-comment-btn');
    await page.fill('.annotate-card-composer', 'Resolved thread');
    await page.click('.annotate-btn-save');
    await page.waitForSelector('[data-thread-id]');

    // Resolve
    await page.locator('.annotate-resolve-btn').first().click();

    // Card moves to Resolved tab — check the resolved panel
    await page.click('button.annotate-tab:has-text("Resolved")');
    const resolvedCard = page.locator('#annotate-panel-resolved .annotate-resolved-card');
    await expect(resolvedCard).toBeVisible();

    // No Edit/Delete menu on resolved card
    await expect(resolvedCard.locator('.annotate-menu-btn')).toHaveCount(0);

    // No Reply button on resolved card
    await expect(resolvedCard.locator('.annotate-reply-trigger')).toHaveCount(0);

    // Un-Resolve button is visible
    await expect(resolvedCard.locator('.annotate-resolve-btn')).toBeVisible();
  });
});
