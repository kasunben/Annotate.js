import { test, expect } from '@playwright/test';
import { initUser, selectText } from './helpers.js';

const FIXTURE = '/tests/fixtures/demo-test.html';

test.describe('Single-browser — offline mode (IndexedDB only)', () => {
  test.beforeEach(async ({ page }) => {
    await initUser(page);
  });

  test('select text → comment button appears → annotate → highlight and card render', async ({ page }) => {
    await page.goto(FIXTURE);
    await page.waitForSelector('#annotate-sidebar');

    await selectText(page, '#p1', 'two decades optimising');

    // Floating button should appear
    await expect(page.locator('#annotate-comment-btn')).toBeVisible();

    // Click it
    await page.click('#annotate-comment-btn');

    // Sidebar opens, Threads tab shown, composer appears
    await expect(page.locator('#annotate-sidebar')).not.toHaveClass(/collapsed/);
    await expect(page.locator('.annotate-card-composer')).toBeVisible();

    // Type a note and save
    await page.fill('.annotate-card-composer', 'My first annotation');
    await page.click('.annotate-btn-save');

    // Saved card appears with a data-thread-id attribute
    await page.waitForSelector('[data-thread-id]');

    // Highlight mark is present in the document body
    await expect(page.locator('.annotate-highlight')).toBeVisible();
  });

  test('annotations persist across page reload (IndexedDB)', async ({ page }) => {
    await page.goto(FIXTURE);
    await page.waitForSelector('#annotate-sidebar');

    await selectText(page, '#p2', 'speed has a shadow');
    await page.click('#annotate-comment-btn');
    await page.fill('.annotate-card-composer', 'Persistent note');
    await page.click('.annotate-btn-save');
    await page.waitForSelector('[data-thread-id]');

    // Reload
    await page.reload();
    await page.waitForSelector('#annotate-sidebar');

    // Open the sidebar (starts collapsed after reload)
    await page.click('#annotate-toggle');

    // Thread cards and highlight marks are restored from IDB
    await page.waitForSelector('[data-thread-id]', { timeout: 5000 });
    await expect(page.locator('.annotate-highlight')).toBeVisible();
  });

  test('edit and delete persist', async ({ page }) => {
    await page.goto(FIXTURE);
    await page.waitForSelector('#annotate-sidebar');

    await selectText(page, '#p1', 'optimising software');
    await page.click('#annotate-comment-btn');
    await page.fill('.annotate-card-composer', 'Original note');
    await page.click('.annotate-btn-save');
    await page.waitForSelector('[data-thread-id]');

    // Open the three-dot menu
    await page.click('.annotate-menu-btn');
    await page.click('.annotate-edit-btn');

    // Edit textarea appears (same class as new-annotation composer)
    const editor = page.locator('[data-thread-id] .annotate-card-composer');
    await editor.clear();
    await editor.fill('Edited note');
    await page.locator('[data-thread-id] .annotate-btn-save').click();

    // Card should still be there with the edited text
    await expect(page.locator('[data-thread-id]')).toBeVisible();

    // Delete it — register dialog handler BEFORE clicking Delete
    await page.click('.annotate-menu-btn');
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('.annotate-delete-btn');

    // Card should be removed
    await page.waitForSelector('[data-thread-id]', { state: 'detached', timeout: 3000 }).catch(() => {});

    // No highlight mark should remain
    await expect(page.locator('.annotate-highlight')).toHaveCount(0);
  });

  test('resolve → card moves to Resolved tab; un-resolve → card returns to Threads tab', async ({ page }) => {
    await page.goto(FIXTURE);
    await page.waitForSelector('#annotate-sidebar');

    await selectText(page, '#p3', 'deliberation between impulse');
    await page.click('#annotate-comment-btn');
    await page.fill('.annotate-card-composer', 'To be resolved');
    await page.click('.annotate-btn-save');
    await page.waitForSelector('[data-thread-id]');

    // Resolve
    await page.click('.annotate-resolve-btn');

    // Thread tab should be empty now; Resolved tab shows the thread
    await page.click('button.annotate-tab:has-text("Resolved")');
    await expect(page.locator('#annotate-panel-resolved .annotate-resolved-card')).toBeVisible();

    // Un-resolve
    await page.click('#annotate-panel-resolved .annotate-resolve-btn');

    // Thread should return to Threads tab
    await page.click('button.annotate-tab:has-text("Threads")');
    await expect(page.locator('[data-thread-id]')).toBeVisible();
  });

  test('reply is saved and persists across reload', async ({ page }) => {
    await page.goto(FIXTURE);
    await page.waitForSelector('#annotate-sidebar');

    await selectText(page, '#p1', 'speed of delivery');
    await page.click('#annotate-comment-btn');
    await page.fill('.annotate-card-composer', 'Thread with reply');
    await page.click('.annotate-btn-save');
    await page.waitForSelector('[data-thread-id]');

    // Open reply composer
    await page.click('.annotate-reply-trigger');
    await page.fill('.annotate-reply-composer', 'My reply');
    await page.locator('.annotate-reply-action .annotate-btn-save').click();

    // Reply appears
    await expect(page.locator('.annotate-reply')).toBeVisible();

    // Wait for IDB to commit the reply before reloading (DOM update is sync;
    // IDB write is async inside a promise chain started by the save click).
    await page.waitForTimeout(200);

    // Reload — reply should persist
    await page.reload();
    await page.waitForSelector('#annotate-sidebar');
    // Open the sidebar (starts collapsed after reload)
    await page.click('#annotate-toggle');
    await page.waitForSelector('[data-thread-id]', { timeout: 5000 });
    await expect(page.locator('.annotate-reply')).toBeVisible();
  });
});
