# Annotate.js

Lightweight inline annotation and threaded comments for any web page — added via a single `<script>` tag.

![Demo screenshot showing highlighted text and comment sidebar](docs/screenshot.png)

---

## Features

- **Select any text** → floating button → add a comment
- **Threaded replies** on every annotation
- **Resolve** threads when addressed
- **Offline-first** — works with no server; annotations persist in IndexedDB
- **Multi-tab sync** — BroadcastChannel keeps tabs on the same origin in sync instantly, zero deps
- **P2P sync** — optional `data-room-id` activates WebRTC peer-to-peer sync; no server needed; annotation content is DTLS-encrypted end-to-end
- **Multi-user sync** — optional Node.js + SQLite backend syncs annotations across browsers (30 s poll + tab-focus refresh)
- **Zero runtime dependencies** — one JS file; Trystero bundled at build time

---

## Quick start (offline, no server)

```html
<script src="annotate.js" data-site-id="my-site"></script>
```

That's it. Annotations are stored locally in IndexedDB and survive page reloads.

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

Add `data-room-id` to the script tag instead of `data-sync-url`:

```html
<script
  src="annotate.min.js"
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

- Annotation content **never** passes through the relay — only the WebRTC handshake (SDP + ICE)
- Three-tier signaling: hosted relay (default) → self-hosted relay (`data-relay-url`) → NOSTR (automatic fallback)
- Last-write-wins by `updatedAt` — same conflict model as server sync

### Tradeoffs vs server sync

| | Server sync | P2P |
|---|---|---|
| Persistence | SQLite — survives all browsers closing | IDB only — latecomers see peer state when a peer is online |
| Privacy | Annotations on your server | Annotation content never leaves the browser |
| Hosting cost | VPS / container | Zero (annotation data); relay is a free Cloudflare Workers app |
| Offline writes | `dirty` flag, flushed on reconnect | Broadcast when a peer comes online |
| Activity history | Server-persisted | Broadcast only — latecomers miss offline events |

P2P is ideal for **live collaborative review sessions**. For async annotation over days, server sync provides better durability.

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
│   └── js/annotate.js               # Client library source — single IIFE (+ Trystero import)
├── annotate.min.js                  # Production build — esbuild bundles Trystero; run npm run build
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
├── Dockerfile                       # Multi-stage build → lean production image
├── docker-compose.yml               # Named volume for SQLite persistence
├── ecosystem.config.js              # PM2 config (instances: 1 — SQLite single-writer)
├── .nvmrc                           # Pins Node 23
├── package.json
└── docs/
    ├── screenshot.png               
    ├── annotate-js-concept.md       # Phase 1 spec & architecture decisions
    └── rfc-p2p-sync.md             # P2P architecture RFC
```

---

## npm scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Bundle + minify via esbuild → `annotate.min.js` (Trystero bundled in) |
| `npm start` | Start the server on port 3000 |
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
| `DELETE` | `/threads?siteId=` | Hard-delete all threads for a site (Settings → Clear all) |
| `GET` | `/activity?siteId=&pageUrl=[&since=]` | Fetch activity for page; `since` for incremental pull |
| `POST` | `/activity` | Push one activity entry (`INSERT OR IGNORE` — entries are immutable) |
| `DELETE` | `/activity?siteId=` | Hard-delete all activity for a site (Settings → Clear all) |

---

## Sidebar tabs

| Tab | Content |
|-----|---------|
| **Threads** | Active annotations for the current page |
| **Resolved** | Resolved annotations (read-only) |
| **Activity** | Shared event feed — all users' creates, replies, edits, resolves, deletes |
| **Settings** | Display name · Clear all annotations |

---

## Data model

```js
Thread {
  id, siteId, pageUrl,
  quote,          // snapshot of selected text
  anchor,         // { xpath, startOffset, endOffset } — survives page reload
  body, author, createdAt, updatedAt,
  resolved, resolvedAt, resolvedBy,
  replies: [{ id, body, author, createdAt, updatedAt, deleted }],
  dirty,          // true = not yet synced (client-only, never sent to server)
  deletedAt,      // soft-delete
}
```

---

## Testing

No automated test suite. Three demo pages available after `npm start`:

| Page | URL | Use for |
|------|-----|---------|
| Offline | `http://localhost:3000/demo/demo.html` | IDB-only testing, no server needed |
| Sync | `http://localhost:3000/demo/demo-sync-with-server.html` | Multi-user sync — open in two windows |
| P2P | `http://localhost:3000/demo/demo-p2p.html` | P2P sync — open in two browsers or incognito windows |

**Core checklist** (use either demo page):
- [ ] Select text → comment button appears
- [ ] Add thread → highlight + card appear in sidebar
- [ ] Reload → threads and highlights restored
- [ ] Edit / delete / resolve persist across reload
- [ ] Replies persist across reload
- [ ] Resolved tab shows resolved threads
- [ ] Activity tab shows all events
- [ ] Settings → Clear all → sidebar empties immediately, stays empty after reload

**Sync checklist** (use `demo-sync-with-server.html` in two windows):
- [ ] User A annotates → User B sees it within 30 s (or on tab focus)
- [ ] User A resolves → User B's card dims within 30 s
- [ ] User A deletes → User B's highlight unwraps within 30 s
- [ ] Kill server → User A can still annotate (offline mode, `dirty=true`)
- [ ] Restart server → User A's offline annotations push automatically
- [ ] User A annotates → User B's Activity tab shows `thread_created` within 30 s
- [ ] User A resolves → User B's Activity tab shows `thread_resolved` within 30 s
- [ ] Settings → Clear all on User A → User B's Activity tab empties on next pull

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
- [ ] Authentication / per-user access control
- [ ] User account registration + annotation profile management (Milestone 2)
