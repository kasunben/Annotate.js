# Annotate.js

Lightweight inline annotation and threaded comments for any web page — added via a single `<script>` tag.

![Demo screenshot showing highlighted text and comment sidebar](docs/screenshot.png)

---

## Features

- **Select any text** → floating button → add a comment
- **Threaded replies** on every annotation
- **Resolve** threads when addressed
- **Offline-first** — works with no server; annotations persist in IndexedDB
- **Multi-user sync** — optional Node.js + SQLite backend syncs annotations across browsers in near-real-time (30 s poll + tab-focus refresh)
- **Zero dependencies, zero build step** — one JS file, drop it in and go

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
# Node.js >= 22.5 (experimental) or >= 23 (stable) required
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

## How it works

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
│   ├── js/annotate.js               # Client library source — single IIFE
│   └── annotate.min.js              # Production build (gitignored — run npm run build)
├── demo/
│   ├── demo.html                    # Offline-only test page (no data-sync-url)
│   └── demo-sync-with-server.html   # Multi-user sync test page (data-sync-url set)
├── server/
│   ├── index.js                     # Express entry point; also serves static files
│   ├── db.js                        # SQLite schema + rowToThread/threadToRow helpers
│   ├── routes/threads.js            # REST endpoints
│   └── data/                        # annotate.db lives here (gitignored)
├── Dockerfile                       # Multi-stage build → lean production image
├── docker-compose.yml               # Named volume for SQLite persistence
├── ecosystem.config.js              # PM2 config (instances: 1 — SQLite single-writer)
├── .nvmrc                           # Pins Node 23
├── package.json
└── docs/
    ├── screenshot.png               
    └── annotate-js-concept.md       # Phase 1 spec & architecture decisions
```

---

## npm scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Minify `assets/js/annotate.js` → `assets/annotate.min.js` |
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

---

## Sidebar tabs

| Tab | Content |
|-----|---------|
| **Threads** | Active annotations for the current page |
| **Resolved** | Resolved annotations (read-only) |
| **Activity** | Local event feed — every create, reply, edit, resolve, delete |
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

No automated test suite. Two demo pages available after `npm start`:

| Page | URL | Use for |
|------|-----|---------|
| Offline | `http://localhost:3000/demo/demo.html` | IDB-only testing, no server needed |
| Sync | `http://localhost:3000/demo/demo-sync-with-server.html` | Multi-user sync — open in two windows |

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
npm run build   # → assets/annotate.min.js
```

### 2a. Deploy with Docker (recommended for PaaS / containerized VPS)

```bash
docker compose up -d
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
  src="https://your-server.example.com/assets/annotate.min.js"
  data-site-id="my-site"
  data-sync-url="https://your-server.example.com">
</script>
```

---

## Roadmap

- [ ] Authentication / per-user access control
- [ ] Real-time push (SSE or WebSocket) to replace polling
- [ ] Server-side activity log
