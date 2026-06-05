# Annotate.js

Lightweight inline annotation and threaded comments for any web page — added via a single `<script>` tag.

![Demo screenshot showing highlighted text and comment sidebar](docs/screenshot.png)

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

Open `http://localhost:3000/demo/demo.html` in two browser windows and annotate — changes appear in both within 30 seconds, or immediately on tab focus.

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
├── assets/js/annotate.js   # Entire client library — single IIFE, no build needed
├── demo/demo.html           # Manual test page (served by the server at /demo/demo.html)
├── server/
│   ├── index.js             # Express entry point; also serves static files
│   ├── db.js                # SQLite schema + rowToThread/threadToRow helpers
│   └── routes/threads.js    # REST endpoints
├── package.json
└── docs/
```

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

No automated test suite. Use the demo page:

```bash
npm start
# open http://localhost:3000/demo/demo.html
```

**Checklist:**
- [ ] Select text → comment button appears
- [ ] Add thread → highlight + card appear in sidebar
- [ ] Reload → threads and highlights restored
- [ ] Edit / delete / resolve persist across reload
- [ ] Replies persist across reload
- [ ] Resolved tab shows resolved threads
- [ ] Activity tab shows all events
- [ ] Kill server → can still annotate (offline mode)
- [ ] Restart server → offline annotations sync automatically
- [ ] Open two windows → changes appear in both within 30 s
- [ ] Settings → Clear all → sidebar empties immediately, stays empty after reload

---

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

## Roadmap

- [ ] Authentication / per-user access control
- [ ] Real-time push (SSE or WebSocket) to replace polling
- [ ] Server-side activity log
- [ ] Deploy guide
