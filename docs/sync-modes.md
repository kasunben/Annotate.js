# Sync Modes

Annotate.js supports four sync modes. They are layered — each mode adds capability on top of the previous one. Modes 1 and 2 are always active with zero configuration. Modes 3 and 4 are opt-in and mutually exclusive with each other.

| # | Mode | Activated by | Sync scope | Requires |
|---|---|---|---|---|
| 1 | **Offline** | Default (no attributes needed) | Single browser, persists in IndexedDB | Nothing |
| 2 | **BroadcastChannel** | Automatic alongside Mode 1 | Same browser, all tabs on same origin, instant | Nothing |
| 3 | **Server sync** | `data-sync-url="https://…"` | Any browser, any device, durable | Node.js + SQLite server |
| 4 | **P2P** | `data-room-id="<uuid>"` | Any browser, DTLS-encrypted peer-to-peer | Room UUID (shared secret) |

---

## Mode 1 — Offline (default)

No configuration needed. Drop the script tag on any page and annotations work immediately.

```html
<script src="https://cdn.jsdelivr.net/gh/kasunben/Annotate.js@latest/annotate.min.js"
        data-site-id="my-site"></script>
```

**How it works:**
- Every annotation is saved to **IndexedDB** in the user's browser
- Highlights and thread cards are re-applied on every page load from IDB
- Fully functional with no network access — works on localhost, intranets, offline pages

**Limitations:**
- Annotations are local to the browser they were created in
- Clearing browser storage wipes all annotations
- No sharing with other users or other browsers

---

## Mode 2 — BroadcastChannel (automatic)

No configuration needed. Automatically layered on top of Mode 1 whenever the page is open in more than one tab in the same browser.

**How it works:**
- A `BroadcastChannel` named `annotate-{siteId}` is created at startup
- Every `syncThread` and `syncActivity` call posts a message to the channel before the server-sync guard — so broadcasts fire in all modes, including offline
- The receiving tab merges the incoming thread (last-write-wins by `updatedAt`) and re-renders the card without a page reload

**Scope:** same browser application, same origin. This is a browser API constraint — BroadcastChannel cannot cross browser processes (e.g. Firefox → Brave). For cross-browser sync use Mode 4.

**Important implementation note:** IDB is shared across all same-origin tabs in the same browser. When Tab A writes a thread to IDB and then posts the BroadcastChannel message, the write has already committed by the time Tab B's handler calls `dbGetThread`. This means the incoming `updatedAt` will equal the stored `updatedAt` for brand-new threads. The merge condition must use `>=` (not `>`) to trigger a re-render in this case.

---

## Mode 3 — Server sync

Activated by adding `data-sync-url` to the script tag. Requires the Node.js + SQLite backend to be running.

```html
<script src="https://cdn.jsdelivr.net/gh/kasunben/Annotate.js@latest/annotate.min.js"
        data-site-id="my-site"
        data-sync-url="https://your-server.example.com"></script>
```

**How it works:**

| Trigger | Action |
|---|---|
| Every local mutation | `POST /threads` or `POST /activity` — fire-and-forget push |
| Page load | Full pull + `flushDirtyThreads()` to push any offline writes |
| Every 30 seconds | Incremental pull via `?since=<lastSync>` |
| Tab becomes visible | Incremental pull |

**Conflict resolution:** last-write-wins by `updatedAt`. Server wins for non-dirty local records on pull. Local `dirty=true` records are skipped during pull and pushed on the next `syncThread` or `flushDirtyThreads` call. `_lastSync` is set to the max `updatedAt` seen in each server response (not the client clock) to avoid clock-skew issues.

**Offline resilience:** annotations made while the server is unreachable are saved to IDB with `dirty=true`. On the next page load or reconnect they are automatically flushed to the server.

**Mutual exclusivity:** `data-sync-url` and `data-room-id` cannot be used together — pick one mode per embed.

---

## Mode 4 — P2P (WebRTC)

Activated by adding `data-room-id` to the script tag. No server required. Annotation content flows directly browser-to-browser over DTLS-encrypted WebRTC data channels — no relay ever sees it.

```html
<!-- Using jsDelivr CDN -->
<script src="https://cdn.jsdelivr.net/gh/kasunben/Annotate.js@latest/annotate.min.js"
        data-site-id="my-site"
        data-room-id="f3a9c271-8d4e-4b1a-9c3f-d17b2e5a08cc"></script>
```

**The room ID is the shared secret.** Use a long random UUID. Anyone who knows the room ID and visits the same `pageUrl` can read and write all annotations in that room.

### Three-tier signaling fallback

The relay is used only for the WebRTC handshake (SDP offers/answers and ICE candidates). Annotation data never passes through it.

| Tier | Method | Activated when |
|---|---|---|
| **1 — Hosted relay** | WebSocket to `wss://relay.annotate-js.workers.dev` | Default |
| **2 — Self-hosted relay** | WebSocket to `data-relay-url="wss://…"` | `data-relay-url` is set |
| **3 — NOSTR (Trystero)** | Public NOSTR relays via Trystero | Automatic fallback if Tier 1/2 fails within 5 s |

The fallback is fully automatic. If the relay WebSocket does not connect within 5 seconds, `_initNostrP2P()` fires and Trystero takes over using public NOSTR relays. No configuration required.

### Self-hosted relay

For enterprise or air-gapped deployments you can run your own relay using the Cloudflare Worker in `relay/`:

```bash
cd relay
npx wrangler deploy
# → wss://annotate-relay.<your-subdomain>.workers.dev
```

Then set `data-relay-url` on the script tag:

```html
<script src="https://cdn.jsdelivr.net/gh/kasunben/Annotate.js@latest/annotate.min.js"
        data-site-id="my-site"
        data-room-id="f3a9c271-8d4e-4b1a-9c3f-d17b2e5a08cc"
        data-relay-url="wss://annotate-relay.<your-subdomain>.workers.dev"></script>
```

### How sync works once peers connect

```
Browser A                                          Browser B
───────────────────────────────────────────────────────────────
User A adds annotation
  → save to IDB
  → _p2pBroadcastThread(thread) ────────────────► _onPeerThread(thread)
                                                     → last-write-wins by updatedAt
                                                     → dbSaveThread → IDB
                                                     → _rerenderAfterPull → card appears

New peer joins
  → sends REQUEST_STATE ───────────────────────► existing peer responds STATE_SNAPSHOT
                          ◄────────────────────── all threads for this pageUrl
  → merges snapshot into IDB
  → re-renders all cards
```

### Tradeoffs vs server sync

| | Mode 3 — Server sync | Mode 4 — P2P |
|---|---|---|
| **Persistence** | SQLite — survives all browsers closing | IDB only — latecomers need a peer online to get history |
| **Privacy** | Annotations stored on your server | Annotation content never leaves the browser |
| **Hosting cost** | VPS / container required | Zero for annotation data; relay is a free Cloudflare Workers app |
| **Offline writes** | `dirty` flag, flushed on reconnect | Broadcast when a peer comes online |
| **Activity history** | Server-persisted, shared across all users | Broadcast only — latecomers miss events from before they joined |
| **Best for** | Async annotation over days or weeks | Live collaborative review sessions |

### Expected console output before the hosted relay is deployed

```
WebSocket connection to 'wss://relay.annotate-js.workers.dev/…' failed
Annotate.js P2P: relay disconnected — falling back to NOSTR
Trystero: relay failure from wss://relay.damus.io/ — rate-limited: you are noting too much
```

All three are **expected and harmless**. P2P works via Tier 3 (NOSTR). The warnings disappear once the hosted Cloudflare relay is deployed.

---

---

## Access control

Annotate.js uses **ownership-based** access control rather than full authentication. A persistent UUID (`annotate_author_id` in `localStorage`) is generated on first load and attached to every Thread and Reply as `authorId`. Edit and Delete buttons are only shown to the browser that created the item.

| Mode | Enforcement | Notes |
|---|---|---|
| **Offline** | **None** | Single-user by definition — all edit/delete/clear operations are unrestricted |
| **BroadcastChannel** | **None** | Automatic alongside offline; same single-user context, same unrestricted behaviour |
| **Server sync** | UI + server | `POST /threads` returns 403 on ownership mismatch; `DELETE /threads?authorId=` scopes to own threads |
| **P2P** | UI only | `authorId` travels with thread objects; each peer enforces via `_isOwner` locally |

Access control only activates when `data-sync-url` or `data-room-id` is present (multi-user modes). Without either attribute the library operates as a single-user tool with no restrictions.

**Resolve** is not ownership-gated in any mode — anyone can resolve a thread (collaborative action by design).

### Settings button — "Clear all" vs "Clear my annotations"

| Mode | Button label | What it deletes |
|---|---|---|
| Offline / BroadcastChannel | **Clear all annotations** | Every thread and all activity for the site |
| Server sync / P2P | **Clear my annotations** | Only threads owned by the current browser; other users' threads remain |

### Known limitations (multi-user modes only)

1. **localStorage clear = permanent loss of edit access** — no recovery without proper user accounts
2. **UUID copy = impersonation possible** — requires DevTools access, deliberate effort
3. **P2P has no server enforcement** — a modified client could spoof `authorId`
4. **Legacy threads permanently read-only** — threads created before this access control update have `authorId: null`; the server returns 403 for mutations on them. Operator can reclaim ownership via: `UPDATE threads SET author_id = '<uuid>' WHERE author_id IS NULL`
5. **Activity log not scoped** — "Clear my annotations" wipes all site activity (entries have no `authorId`)

---

## Choosing a mode

```
Need to share annotations with other users?
├── No  → Mode 1 (offline) + Mode 2 (BroadcastChannel, automatic)
└── Yes
    ├── Need annotations to persist after all browsers close?
    │   └── Yes → Mode 3 (server sync) — requires Node.js server
    └── No server, privacy-first, or live session?
        └── Mode 4 (P2P) — just add data-room-id
```
