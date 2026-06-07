// P2P relay test — requires annotate.min.js (bundled build with Trystero).
// Uses a local mock WebSocket relay for deterministic signaling.
// Skip by default; opt-in by setting RUN_P2P=1.

import { test, expect } from '@playwright/test';
import { initUser, selectText } from './helpers.js';

const ROOM_ID = 'e2e-p2p-test-room-12345';

test.describe('@slow P2P relay test', () => {
  let relay;
  let relayUrl;

  test.beforeAll(async () => {
    if (!process.env.RUN_P2P) return;
    // Dynamic import so the ws module is only loaded when needed
    const { startMockRelay } = await import('../helpers/mock-relay.js');
    relay = await startMockRelay();
    relayUrl = `ws://localhost:${relay.port}`;
  });

  test.afterAll(async () => {
    if (relay) await relay.close();
  });

  test('annotation created on Peer A appears on Peer B via WebRTC data channel', async ({ browser }) => {
    if (!process.env.RUN_P2P) {
      test.skip(true, 'P2P tests require annotate.min.js (npm run build) and RUN_P2P=1');
    }

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await initUser(pageA, 'Peer A', 'peer-a-uuid-0000');
    await initUser(pageB, 'Peer B', 'peer-b-uuid-0000');

    const p2pUrl = `/tests/fixtures/demo-p2p-test.html?relay=${encodeURIComponent(relayUrl)}&room=${ROOM_ID}`;
    await pageA.goto(p2pUrl);
    await pageB.goto(p2pUrl);
    await pageA.waitForSelector('#annotate-sidebar');
    await pageB.waitForSelector('#annotate-sidebar');

    // Wait for WebRTC data channel to open (up to 10 s)
    await pageA.waitForFunction(() => window._p2pConnectedCount > 0, { timeout: 10_000 });
    await pageB.waitForFunction(() => window._p2pConnectedCount > 0, { timeout: 10_000 });

    await selectText(pageA, '#p1', 'two decades optimising');
    await pageA.click('#annotate-comment-btn');
    await pageA.fill('.annotate-card-composer', 'P2P annotation from A');
    await pageA.click('.annotate-btn-save');
    await pageA.waitForSelector('[data-thread-id]');

    await pageB.waitForSelector('[data-thread-id]', { timeout: 5000 });
    await expect(pageB.locator('.annotate-highlight')).toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });
});
