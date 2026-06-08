# Annotate.js

Lightweight inline annotation and threaded comments for any web page — added via a single `<script>` tag.

![Demo screenshot showing highlighted text and comment sidebar](docs/screenshot.png)

> Annotate.js was initially built to solve a specific problem: adding inline comments to a published
> HTML document — a citizen proposal on child rights — without Google Docs and without a heavy backend.
>
> [Read the full story →](docs/origin.md)

---

## Features

- **Select any text** → floating button → add a comment
- **Click any highlight** → sidebar opens, page scrolls to the mark, matching card pulses amber so the eye lands on the right thread instantly
- **Threaded replies** on every annotation
- **Resolve / Un-Resolve** — resolved threads are frozen (no Edit / Delete / Reply); anyone can revert one back to active
- **Ownership-based access control** — in multi-user modes, each browser only edits or deletes its own threads and replies; Resolve is collaborative; offline mode is unrestricted
- **Offline-first** — works with no server; annotations persist in IndexedDB
- **Multi-tab sync** — BroadcastChannel keeps tabs on the same origin in sync instantly, zero deps
- **P2P sync** — optional `data-room-id` activates WebRTC peer-to-peer sync; no server needed; annotation content is DTLS-encrypted end-to-end
- **Multi-user sync** — optional Node.js + SQLite backend syncs annotations across browsers (30 s poll + tab-focus refresh)
- **Display name changes propagate retroactively** — renaming yourself in Settings backfills the new name onto all your existing threads and replies and syncs the change to other users immediately
- **Export / Import** — download all threads, activity, and settings for the current page as a JSON file; import merges back (last-write-wins); restores previously deleted threads; propagates to all peers via the active sync mode
- **About panel in Settings** — surfaces the build version, active sync mode, and a mode-aware privacy note
- **Zero runtime dependencies** — one JS file; Trystero bundled at build time

---

## Sync modes

Annotate.js has four sync modes. Modes 1 and 2 are always active with zero configuration. Modes 3 and 4 are opt-in and mutually exclusive with each other.

| Mode | Activated by | Sync scope | Server needed? |
|---|---|---|---|
| **1 — Offline** | Default (no attributes needed) | Single browser, persists in IndexedDB | No |
| **2 — BroadcastChannel** | Automatic alongside Mode 1 | Same browser, multiple tabs, instant | No |
| **3 — Server sync** | `data-sync-url="https://…"` | Any browser, any device, durable | Yes (Node.js + SQLite) |
| **4 — P2P** | `data-room-id="<uuid>"` | Any browser, encrypted peer-to-peer | No (signaling relay only) |

### Mode 1 — Offline (default)
Annotations are saved to IndexedDB and survive page reloads. No network required. Works with the raw `annotate.js` source file — no build step needed. **Raw `annotate.js` supports Modes 1, 2, and 3 only. Mode 4 (P2P) requires `annotate.min.js`** — see [P2P sync requirements](#p2p-sync-no-server-required).

### Mode 2 — BroadcastChannel (automatic)
Layered on top of Mode 1 at zero cost. Any tabs open on the **same origin in the same browser** stay in sync instantly — no server, no WebRTC, no configuration. Uses the built-in [BroadcastChannel API](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel).

> Cross-browser (e.g. Firefox → Brave) is not possible via BroadcastChannel — that requires Mode 4.

### Mode 3 — Server sync
Activated by `data-sync-url`. Every mutation is pushed to a shared SQLite backend immediately and pulled back on page load, every 30 seconds, and on tab focus. Supports any number of concurrent users across any browser or device. Offline writes are queued (`dirty=true`) and flushed automatically on reconnect.

### Mode 4 — P2P (WebRTC)
Activated by `data-room-id`. Annotation content flows **directly browser-to-browser** over DTLS-encrypted WebRTC data channels — no server ever sees it. Uses a three-tier signaling fallback for the WebRTC handshake:

| Tier | Signaling method | Used when |
|---|---|---|
| **1** | Hosted Cloudflare relay (`wss://relay.annotate-js.workers.dev`) | Default — sub-second peer discovery |
| **2** | Self-hosted relay (`data-relay-url="wss://…"`) | Enterprise / air-gapped deployments |
| **3** | NOSTR public relays via [Trystero](https://github.com/dmotz/trystero) | Automatic fallback if Tiers 1 & 2 fail |

The fallback is automatic — if the relay WebSocket fails to connect within 5 seconds the client silently switches to NOSTR. Annotation data never passes through any relay regardless of tier.

> **Heads up:** the hosted relay (`wss://relay.annotate-js.workers.dev`) is not yet deployed. Until it is, Tier 3 (NOSTR) is the active path. A failed WebSocket connection to the relay URL and occasional NOSTR rate-limit warnings in the console are both expected and harmless — see [Troubleshooting](#troubleshooting).

---

## Quick start (offline, no server)

**Via jsDelivr CDN — no install, no server:**

```html
<!-- Always latest release -->
<script src="https://cdn.jsdelivr.net/gh/kasunben/Annotate.js@latest/annotate.min.js"
        data-site-id="my-site"></script>

<!-- Pin to a specific version (recommended for production) -->
<script src="https://cdn.jsdelivr.net/gh/kasunben/Annotate.js@v0.3.5/annotate.min.js"
        data-site-id="my-site"></script>
```

`annotate.min.js` is committed to the repo on every release, so jsDelivr serves it directly from the git tag — no build step needed on your end.

**Or load the raw source locally (offline + server-sync only — no P2P):**

```html
<script src="annotate.js" data-site-id="my-site"></script>
```

> **P2P requires `annotate.min.js`.** The raw source is a classic `<script>` tag and cannot use ES module imports, so Trystero (the NOSTR signaling library) is never available. If `data-room-id` is set on the raw source, all signaling tiers fail silently and annotations save to local IDB only — nothing reaches other peers. Always use `annotate.min.js` (CDN or locally built) for P2P mode.

In all cases, annotations are stored in IndexedDB and survive page reloads.

---

## Script tag API

All configuration is done via `data-*` attributes on the `<script>` tag. These are the stable public interface of Annotate.js — all six attributes will be preserved without breaking changes from v1 onwards.

| Attribute | Type | Default | Notes |
|---|---|---|---|
| `data-site-id` | string | `"default"` | Namespaces annotations — IDB, server, and P2P scope. Set a unique value per site. |
| `data-sync-url` | URL | — | Activates server sync (Mode 3). **Mutually exclusive with `data-room-id`**. |
| `data-room-id` | UUID | — | Activates P2P sync (Mode 4). **Mutually exclusive with `data-sync-url`**. Requires `annotate.min.js`. |
| `data-relay-url` | WSS URL | hosted relay | Override the hosted signaling relay with a self-hosted one (P2P mode only). |
| `data-admin-id` | UUID | — | Grants the admin Data panel to the browser whose `localStorage.annotate_author_id` matches. If absent, the first annotator becomes admin. |
| `data-sync-ms` | integer (ms) | `30000` | Server sync poll interval (Mode 3 only). Values ≤ 0 or non-numeric fall back to 30 s with a console warning. |

> `data-sync-url` and `data-room-id` are mutually exclusive. If both are set the library logs a console warning and ignores `data-room-id`.

---

## Multi-user sync

### 1. Check Node.js version

```bash
node --version
# Node.js >= 23 required
```

The server uses the built-in `node:sqlite` module, which is not available in earlier versions.
[Download Node.js](https://nodejs.org/) if you need to upgrade.

### 2. Install and start the server

```bash
npm install
npm start
# → http://localhost:3000
```

### 3. Add `data-sync-url` to your script tag

```html
<!-- Remove data-sync-url to go back to offline-only mode -->
<script src="annotate.js"
        data-site-id="my-site"
        data-sync-url="http://localhost:3000"></script>
```

Two demo pages are available:

- **`http://localhost:3000/demo/demo.html`** — Offline-only (IndexedDB, no server)
- **`http://localhost:3000/demo/demo-sync-with-server.html`** — Multi-user sync enabled

To test multi-user sync, open the second URL in two browser windows and annotate — changes appear in both within 30 seconds, or immediately on tab focus.

---

## P2P sync (no server required)

> **Requirements:** P2P mode requires `annotate.min.js` (CDN or locally built via `npm run build`). The raw source file `assets/js/annotate.js` does **not** support P2P — see [Troubleshooting](#raw-source-annotate-js--p2p-doesnt-work) for details.

Add `data-room-id` to the script tag instead of `data-sync-url`:

```html
<script
  src="https://cdn.jsdelivr.net/gh/kasunben/Annotate.js@latest/annotate.min.js"
  data-site-id="my-site"
  data-room-id="f3a9c271-8d4e-4b1a-9c3f-d17b2e5a08cc">
</script>
```

**Use a long random UUID** — it's the shared secret. Anyone who knows the room ID on the same `pageUrl` can read and write all annotations.

### How P2P sync works

```
Browser A                  Relay (signaling only)          Browser B
────────────────────────────────────────────────────────────────────────
 joinRoom(roomId) ─────── WebSocket handshake ──────────── joinRoom(roomId)
                            (only room name visible)
                  ◄──────── DTLS-encrypted WebRTC ────────►
  User A adds thread
    → save to IDB
    → broadcastThread() ──────────────────────────────────► onPeerThread()
                                                              → merge by updatedAt
                                                              → save to IDB
                                                              → re-render card
```

- Annotation content **never** passes through any relay — only the WebRTC handshake (SDP + ICE)
- Three-tier signaling fallback: hosted relay → self-hosted relay (`data-relay-url`) → NOSTR via Trystero (automatic, ~5–15 s discovery)
- Last-write-wins by `updatedAt` — same conflict model as server sync
- See [Sync modes](#sync-modes) for the full tier table and when each is used

### Tradeoffs vs server sync

| | Server sync | P2P |
|---|---|---|
| Persistence | SQLite — survives all browsers closing | IDB only — latecomers see peer state when a peer is online |
| Privacy | Annotations on your server | Annotation content never leaves the browser |
| Hosting cost | VPS / container | Zero (annotation data); relay is a free Cloudflare Workers app |
| Offline writes | `dirty` flag, flushed on reconnect | Broadcast when a peer comes online |
| Activity history | Server-persisted | Broadcast only — latecomers miss offline events |

P2P is ideal for **live collaborative review sessions**. For async annotation over days, server sync provides better durability.

### Access control in P2P mode

Each browser has a persistent UUID (`annotate_author_id` in `localStorage`) attached to every thread and reply. Edit and Delete buttons are only shown to the browser that created the item — other users see the thread but cannot modify it. Anyone can mark a thread Resolved (collaborative action).

---

## Admin role

### What "admin" means — and what it doesn't

Admin is a **UI gate, not a cryptographic lock.**

The feature exists to prevent well-meaning collaborators from accidentally wiping shared annotation data. It is **not** designed to stop a determined person who is willing to inspect the page.

**What admin protects against:**
- A regular user accidentally seeing and triggering a destructive action they shouldn't have access to
- Anonymous guests clearing annotations they did not create

**What admin does NOT protect against:**
- Someone who views the page HTML — `data-admin-id` is visible in the source
- Someone who opens DevTools and runs `localStorage.setItem('annotate_author_id', '<admin-uuid>')` to claim any identity
- A malicious peer in P2P mode (though the `ADMIN_CLEAR` message is verified on receive, a peer who knows the admin UUID can forge the signal)

**The honest framing:** Annotate.js admin is appropriate for trusted groups — teams, reviewers who know each other, public documents where participants act in good faith. For adversarial environments where you cannot trust everyone who can view the page source, infrastructure-level access controls (server authentication, firewall rules, private deployment) are the right answer. The admin feature alone is not sufficient.

### What admin can do

In multi-user modes (server sync and P2P), the admin sees a **Data** section in Settings with two destructive actions that are hidden from all other users:

- **Clear all annotations** — permanently wipes all threads and activity for the current page (server + local IDB in server-sync; broadcasts a purge signal to all connected peers + wipes local IDB in P2P)
- **Reset identity** — clears the display name and browser UUID from this device, issuing a new anonymous identity

In offline and BroadcastChannel mode everyone is treated as admin (single-user context, no other users to protect).

### How admin is determined

Two layers, evaluated in order:

| Layer | How | When to use |
|---|---|---|
| **Explicit** (`data-admin-id`) | Add `data-admin-id="<uuid>"` to the script tag. The browser whose `localStorage.annotate_author_id` matches that UUID sees the Data section, on any device. | Shared sites, P2P rooms, any case where you want a stable, permanent designated admin |
| **First-annotator** (default, no config) | The author of the oldest active thread on the page becomes admin automatically. Recomputed on each page load. | Quick setups and single-operator pages where the first person to annotate is naturally the admin |

> The first-annotator heuristic is convenient but fragile in collaborative settings: if the first annotator deletes all their threads, admin shifts to the next oldest author. For stable, multi-user deployments set `data-admin-id` explicitly.

### How to find your UUID

Open **Settings → Display Name** in the sidebar. Your **Browser ID** is shown below the name field as a monospace pill. Click it to copy to the clipboard. That is the UUID to use as `data-admin-id`.

### How to assign admin

```html
<!-- 1. Open Settings → Display Name → copy the Browser ID pill -->
<!-- 2. Add it to your script tag: -->
<script src="annotate.min.js"
        data-site-id="my-site"
        data-room-id="f3a9c271-…"
        data-admin-id="550e8400-e29b-41d4-a716-446655440000">
</script>
```

Only the browser whose `localStorage.annotate_author_id` equals the `data-admin-id` value will see the Data section. Every other browser — including other tabs in the same browser — sees no admin controls.

> **Note:** `data-admin-id` is visible in your page's HTML source. Anyone who can read the source knows which UUID grants admin. Do not treat the UUID itself as a secret. The protection is the UI gate, not secrecy of the value.

**To use the same admin identity on a second device:** copy your UUID from Settings, then on the second device open the browser console and run:

```js
localStorage.setItem('annotate_author_id', '<your-uuid>');
```

Reload — that device is now also an admin. This is intentional: it lets the same person use admin controls from multiple devices. It also means that if someone else knows your UUID and is willing to run this command, they can claim admin — which is why this system suits trusted environments only.

### How to reassign admin

| Scenario | What to do |
|---|---|
| Transfer to a new person | Get their UUID (they open Settings → Display Name and copy it), update `data-admin-id` in your HTML, and deploy. |
| Admin leaves the team | Same as above — update `data-admin-id` to the new admin's UUID and deploy. |
| Admin cleared their browser storage / lost their UUID | New admin copies their UUID from their Settings, you update `data-admin-id` in the HTML and deploy. |
| No `data-admin-id` set (first-annotator) and admin is gone | Add an explicit `data-admin-id` pointing to the new admin's UUID. From that point admin is stable regardless of who annotated first. |

The HTML attribute is always the escape hatch — whoever controls the HTML controls admin. This means in practice: the admin system is only as strong as the access control on your HTML file.

### Choosing the right deployment for your threat model

| Context | Recommended approach |
|---|---|
| Personal notes / offline use | No concern — you are the only user |
| Trusted team (everyone can be trusted not to misuse access) | First-annotator default or explicit `data-admin-id` — either works |
| Public page with anonymous readers, trusted author | Explicit `data-admin-id`; accept that a motivated person with DevTools access could claim admin |
| Public page, genuinely adversarial users | Server sync behind authentication + infrastructure-level access controls — the admin UI gate alone is not sufficient |

---

## How server sync works

```
Browser A                          Server                      Browser B
─────────────────────────────────────────────────────────────────────────
Select text → add comment
  └─ save to IndexedDB
  └─ POST /threads ──────────────► store in SQLite
                                                          30s poll fires
                                   GET /threads?since=T ◄─────────────
                                        └─ return new threads ─────────►
                                                          new card appears
```

- **Every mutation** (create, reply, edit, resolve, delete) is pushed to the server immediately
- **Incremental pulls** use a `?since=` timestamp so only changed threads travel the wire
- **Offline edits** are flagged `dirty=true` in IndexedDB and flushed to the server on next load
- **Conflict resolution** is last-write-wins by `updatedAt` — server wins for non-dirty local records

---

## Project structure

```
Annotate.js/
├── assets/
│   ├── js/annotate.js               # Client library source — single IIFE; no imports (loads as plain script)
│   └── js/trystero-shim.js          # esbuild --inject shim; wires Trystero into the bundle at build time
├── annotate.min.js                  # Production build — committed to repo; served via jsDelivr CDN
├── demo/
│   ├── demo.html                    # Offline-only test page
│   ├── demo-sync-with-server.html   # Multi-user sync test page (data-sync-url set)
│   └── demo-p2p.html                # P2P test page (data-room-id set, no server needed)
├── relay/
│   ├── worker.js                    # Cloudflare Worker + Durable Object WebSocket relay
│   └── wrangler.toml                # Wrangler deploy config
├── server/
│   ├── index.js                     # Express entry point; also serves static files
│   ├── db.js                        # SQLite schema + rowToThread/threadToRow helpers
│   ├── routes/threads.js            # Thread REST endpoints
│   ├── routes/activity.js           # Activity REST endpoints
│   └── data/                        # annotate.db lives here (gitignored)
├── tests/
│   ├── unit/                        # Vitest — REST endpoint + db helper unit tests
│   ├── integration/                 # Vitest — full HTTP lifecycle tests
│   ├── e2e/                         # Playwright — browser E2E specs
│   ├── helpers/                     # Shared test factories and mock relay
│   └── fixtures/                    # Minimal HTML pages for E2E tests
├── vitest.config.mjs                # Vitest config (pool: forks, DATABASE_PATH=:memory:)
├── playwright.config.mjs            # Playwright config (Chromium, webServer)
├── .github/workflows/ci.yml         # CI — unit+integration → E2E on every push/PR
├── Dockerfile                       # Multi-stage build → lean production image
├── docker-compose.yml               # Named volume for SQLite persistence
├── ecosystem.config.js              # PM2 config (instances: 1 — SQLite single-writer)
├── .nvmrc                           # Pins Node 23
├── package.json
└── docs/
    ├── screenshot.png               
    ├── annotate-js-concept.md       # Phase 1 spec & architecture decisions
    ├── rfc-p2p-sync.md             # P2P architecture RFC
    └── sync-modes.md               # All four sync modes — overview, embed examples, tradeoffs
```

---

## npm scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Bundle + minify via esbuild → `annotate.min.js` (Trystero bundled in) |
| `npm start` | Start the server on port 3000 |
| `npm test` | Run unit + integration tests (Vitest) |
| `npm run test:coverage` | Unit + integration tests with lcov coverage report |
| `npm run test:e2e` | E2E tests (Playwright, headless Chromium) |
| `npm run test:all` | Unit + integration + coverage + E2E |
| `npm run kill-port` | Free port 3000 if already in use |
| `npm run pm2:start` | Start with PM2 (requires `npm i -g pm2`) |
| `npm run pm2:restart` | Restart the PM2 process |
| `npm run pm2:stop` | Stop the PM2 process |
| `npm run pm2:logs` | Tail PM2 logs |

---

## REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/threads?siteId=&pageUrl=[&since=]` | Fetch threads; `since` for incremental pull |
| `POST` | `/threads` | Upsert a thread |
| `PATCH` | `/threads/:id` | Edit body |
| `PATCH` | `/threads/:id/resolve` | Resolve thread |
| `DELETE` | `/threads/:id` | Soft-delete thread |
| `POST` | `/threads/:id/replies` | Add reply |
| `PATCH` | `/threads/:id/replies/:replyId` | Edit reply |
| `DELETE` | `/threads/:id/replies/:replyId` | Soft-delete reply |
| `DELETE` | `/threads?siteId=[&authorId=]` | Delete threads for a site; scoped to `authorId` when provided (Settings → Clear my annotations); unscoped = admin delete-all |
| `GET` | `/activity?siteId=&pageUrl=[&since=]` | Fetch activity for page; `since` for incremental pull |
| `POST` | `/activity` | Push one activity entry (`INSERT OR IGNORE` — entries are immutable) |
| `DELETE` | `/activity?siteId=` | Hard-delete all activity for a site (Settings → Clear all) |

---

## Sidebar tabs

| Tab | Content |
|-----|---------|
| **Threads** | Active annotations for the current page |
| **Resolved** | Resolved annotations. Fully frozen — Edit, Delete, and Reply are hidden for everyone (including the owner). Anyone can click **Un-Resolve** to send the thread back to active, where Edit and Delete become available to the owner again. |
| **Activity** | Shared event feed — all users' creates, replies, edits, resolves, deletes, exports, and imports (blue dot for export/import events) |
| **Settings** | **About** (app name, version, active sync mode chip, mode-aware privacy note, GitHub link) · **Display name** (changes backfill all your existing threads and replies and sync to peers; **Browser ID** click-to-copy pill shown below the field) · **P2P Session** (Room, live Peers count, Via tier — P2P mode only) · **Export / Import** (download JSON backup; import merges by last-write-wins; available in all sync modes) · **Data** (admin only: "Clear all annotations" + "Reset identity") |

---

## Data model

```js
Thread {
  id, siteId, pageUrl,
  quote,          // snapshot of selected text
  anchor,         // { xpath, startOffset, endXpath, endOffset } — survives page reload
  body, author,
  authorId,       // UUID from localStorage 'annotate_author_id'; null for legacy threads
  createdAt, updatedAt,
  resolved, resolvedAt, resolvedBy,
  replies: [{ id, body, author, authorId, createdAt, updatedAt, deleted }],
  dirty,          // true = not yet synced (client-only, never sent to server)
  deletedAt,      // soft-delete
}
```

`authorId` is the ownership proof used by `_isOwner(item)` for the UI gating and by the server's `checkOwnership` helper on `POST /threads`. Threads with `authorId: null` (created before access control existed) are permanently read-only in multi-user modes; the operator can reclaim ownership via direct SQL.

---

## Testing

### Automated test suite

```bash
npm test               # unit + integration (Vitest, in-memory SQLite)
npm run test:coverage  # same + lcov coverage report
npm run test:e2e       # E2E browser tests (Playwright, headless Chromium)
npm run test:all       # unit + integration + coverage + E2E
```

| Layer | Tool | What it covers |
|-------|------|---------------|
| **Unit** | Vitest + supertest | `rowToThread`/`threadToRow` mapping, all 11 REST endpoints |
| **Integration** | Vitest | Full thread lifecycle, ownership rules, admin delete, incremental `?since=` pull, export/import merge |
| **E2E** | Playwright (Chromium) | Select → annotate → persist; BroadcastChannel multi-tab; server-sync two-user; access control; resolve/un-resolve; replies |

Each Vitest test file runs in a forked process with `DATABASE_PATH=:memory:` so every file gets a fresh, isolated SQLite database.

CI runs on every push and pull request via `.github/workflows/ci.yml` (unit + integration with coverage upload → E2E with Playwright report on failure).

### Demo pages (manual testing)

Three demo pages available after `npm start`:

| Page | URL | Use for |
|------|-----|---------|
| Offline | `http://localhost:3000/demo/demo.html` | IDB-only testing, no server needed |
| Sync | `http://localhost:3000/demo/demo-sync-with-server.html` | Multi-user sync — open in two windows |
| P2P | `http://localhost:3000/demo/demo-p2p.html` | P2P sync — open in two browsers or incognito windows |

**Core checklist** (use either demo page):
- [ ] Select text → comment button appears (tooltip "Add a comment" on hover)
- [ ] Add thread → highlight + card appear in sidebar
- [ ] Reload → threads and highlights restored
- [ ] **Cross-paragraph selection** — select text spanning two `<p>` elements → highlight covers both paragraphs; reload → both segments re-highlighted; card positioned at start of selection
- [ ] **Inline-element selection** — select text spanning a `<strong>` or other inline element → multi-segment highlight applied; reload → highlight fully restored
- [ ] Edit / delete / resolve persist across reload
- [ ] Replies persist across reload
- [ ] Resolved tab shows resolved threads; Edit / Delete / Reply hidden on resolved cards
- [ ] **Un-Resolve** from Resolved tab → card disappears from Resolved and reappears in Threads (active state, owner gets Edit/Delete back) without reload
- [ ] Activity tab shows all events including `thread_resolved` / `thread_unresolved`
- [ ] Settings → About shows correct name, version, sync mode chip, and privacy note for the current mode
- [ ] Settings → change display name → all existing cards and replies by that author update to the new name immediately (no reload); in server-sync / P2P modes other users see the updated name within 30 s / on next P2P broadcast
- [ ] Settings → "Clear all annotations" (offline only) → sidebar empties, stays empty after reload; button absent in server-sync and P2P modes
- [ ] Settings → Export / Import → **Download annotations** → JSON file downloads; open and verify threads, activity, and settings blocks are present
- [ ] Clear all annotations, then **Import from file…** the downloaded JSON → threads reappear without reload; Activity tab shows a blue-dot `data_imported` entry
- [ ] Import the same file again → alert "Import complete — all threads are already up to date."
- [ ] Delete a thread, then import a backup made before the deletion → thread is restored; Activity tab shows `data_imported (1 restored)`
- [ ] **Multi-browser import**: delete threads on Browser A, import a pre-deletion export on Browser A (while on the Settings tab) → threads appear immediately on Browser A at the correct page positions; Browser B (connected via P2P or server-sync) also shows correct positions without reloading either browser

**Access control checklist** (server-sync or P2P, two browser profiles):
- [ ] User A creates a thread → User B sees the thread but no Edit / Delete menu on it
- [ ] User B can still hit **Resolve** on User A's thread (collaborative action)
- [ ] User A and User B can each Edit / Delete their **own** threads / replies
- [ ] Server endpoint: `curl -X POST /threads` with empty body → 400 JSON `{"error":"id, siteId, and pageUrl are required"}`
- [ ] Server endpoint: `curl -X POST /threads` with an existing thread id + wrong `authorId` → 403 `{"error":"forbidden"}`

**Sync checklist** (use `demo-sync-with-server.html` in two windows):
- [ ] User A annotates → User B sees it within 30 s (or on tab focus)
- [ ] User A resolves → User B's card dims and the highlight gains `is-resolved` within 30 s
- [ ] User A **un-resolves** → User B's card undims and the highlight loses `is-resolved` without reload
- [ ] User A deletes → User B's highlight unwraps within 30 s
- [ ] Kill server → User A can still annotate (offline mode, `dirty=true`)
- [ ] Restart server → User A's offline annotations push automatically
- [ ] User A annotates → User B's Activity tab shows `thread_created` within 30 s
- [ ] User A resolves → User B's Activity tab shows `thread_resolved` within 30 s
- [ ] User A un-resolves → User B's Activity tab shows `thread_unresolved` within 30 s

---

## Troubleshooting

### Port 3000 already in use

If the server won't start because port 3000 is already occupied:

```bash
# Find the process using port 3000
lsof -nP -iTCP:3000 -sTCP:LISTEN

# Kill it by PID (replace 12345 with the actual PID)
kill -9 12345
```

Or use the npm script:
```bash
npm run kill-port
```

### Expected console warnings in P2P mode

When using `demo-p2p.html` (or any `data-room-id` embed) before the hosted relay is deployed, you will see:

```
WebSocket connection to 'wss://relay.annotate-js.workers.dev/room/…' failed
Annotate.js P2P: relay disconnected — falling back to NOSTR
Trystero: relay failure from wss://relay.damus.io/ — rate-limited: you are noting too much
```

All three are **expected and harmless**:

| Warning | Cause | Impact |
|---|---|---|
| WebSocket connection failed | Hosted relay not yet deployed | None — 5 s fallback to NOSTR fires automatically |
| Relay disconnected — falling back to NOSTR | Tier 1 failed, Tier 3 activating | None — P2P works via NOSTR |
| Trystero rate-limited from relay.damus.io | NOSTR relay throttles rapid reconnects during testing | None — Trystero tries its other 7+ relays |

P2P will still work. The warnings disappear once the hosted Cloudflare relay is deployed (see [Roadmap](#roadmap)).

### Raw source (`annotate.js`) + P2P doesn't work

**Symptom:** You changed the `<script src>` to `assets/js/annotate.js` in `demo-p2p.html`. Annotations save locally but never appear in the other browser. The console shows:
```
Annotate.js P2P: data-room-id is set but Trystero is not available. P2P mode requires the bundled build…
```

**Cause:** The raw source is a classic `<script>` tag and cannot `import` ES modules. Trystero (the NOSTR signaling library) is only available in `annotate.min.js` — it is injected at build time by esbuild via `--inject:assets/js/trystero-shim.js`. Without Trystero, the NOSTR fallback (Tier 3) is a no-op, and the hosted relay (Tier 1) is not yet deployed, so all signaling paths fail.

**Fix:** Use `annotate.min.js` for P2P. Either serve it locally after `npm run build`, or use the jsDelivr CDN. The raw source is for Modes 1–3 (offline + server sync) only.

---

## Self-hosting

Anyone can clone this repo, build the minified library, and deploy the server.

### 1. Build the minified library

```bash
git clone https://github.com/kasunben/Annotate.js
npm install
npm run build   # → annotate.min.js
```

### 2a. Deploy with Docker (recommended for PaaS / containerized VPS)

The image is published to GitHub Container Registry on every version tag:

```bash
# Pull the pre-built image and start (no build step needed)
docker compose pull && docker compose up -d
```

Or build locally from source (useful during development):

```bash
# Edit docker-compose.yml: remove the image: line, keep build: .
docker compose up -d --build
```

The `docker-compose.yml` mounts a named volume at `/app/server/data` so the SQLite database
persists across container restarts. Override the port with `PORT=8080 docker compose up -d`.

Works on any Docker host: DigitalOcean, Hetzner, Fly.io, Railway, Render, etc.

### 2b. Deploy with PM2 (bare-metal VPS)

```bash
npm install -g pm2
npm run pm2:start
pm2 save && pm2 startup   # survive server reboots
```

**Note:** `ecosystem.config.js` sets `instances: 1`. Do not increase this — `node:sqlite` holds a
write lock on the database; multiple instances deadlock on writes.

### 3. Embed on any page

Point `src` at your deployed server and you're done:

```html
<script
  src="https://your-server.example.com/annotate.min.js"
  data-site-id="my-site"
  data-sync-url="https://your-server.example.com">
</script>
```

---

## Roadmap

- [ ] Deploy hosted relay to `wss://relay.annotate-js.workers.dev` (relay code in `relay/` is ready)
- [ ] User account registration + annotation profile management (Milestone 2)
- [ ] Server enforcement parity for collaborative actions — `checkOwnership` currently blocks non-owner Resolve / Un-Resolve in server-sync mode
- [ ] Live re-render of the Resolved tab on inbound peer updates (currently re-renders only on tab switch)

**Shipped:**
- [x] Cross-node anchor + multi-mark highlights — selections that span paragraph or inline-element boundaries now survive page reload (`endXpath` field in anchor); `highlightRange` falls back to per-segment `<mark>` wrapping when `surroundContents` would throw; all mark operations (unwrap, resolve, focus) treat the group atomically
- [x] `data-sync-ms` — configurable server sync poll interval; defaults to 30 s; invalid values fall back with a console warning
- [x] `data-sync-url` + `data-room-id` mutual exclusivity enforced at runtime — console warning + P2P suppressed when both set
- [x] Stable `data-*` attribute API documented as public interface ahead of v1
- [x] Ownership-based access control — Edit/Delete gated per browser; Resolve open to all; offline mode unrestricted
- [x] Frozen Resolved tab — Edit / Delete / Reply hidden on resolved threads; **Un-Resolve** toggle open to anyone, reseeds the Threads tab locally and across peers without reload
- [x] About panel in Settings — app name, version (injected at build time from `package.json`), sync mode chip, mode-aware privacy note, GitHub link
- [x] Tooltip on the floating comment button
- [x] Display name rename propagation — `_renameAuthorEverywhere` backfills new name onto all owned threads/replies in IDB, syncs via active mode
- [x] Export / Import — JSON backup/restore for threads, activity, and settings; merge-on-import (last-write-wins); restored threads get a fresh `updatedAt` so they propagate correctly via BC, P2P, and server incremental pulls; `data_exported` / `data_imported` activity entries with blue dot
