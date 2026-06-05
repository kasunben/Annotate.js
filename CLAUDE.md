# Annotate.js

Lightweight vanilla JS library that adds inline annotation and threaded comments to any web page via a single `<script>` tag. Zero dependencies, zero build step.

## Project Structure

```
Annotate.js/
├── assets/js/annotate.js   # Entire library (single IIFE — DB layer + anchor + sync + UI all inlined)
├── demo/demo.html           # Manual test harness / integration example
├── server/
│   ├── index.js             # Express entry point; also serves static files
│   ├── db.js                # node:sqlite setup, schema migrations, rowToThread/threadToRow
│   ├── routes/threads.js    # 8 REST endpoints
│   └── data/                # annotate.db lives here (gitignored)
├── package.json             # express + cors only (node:sqlite is built-in)
├── README.md
└── docs/annotate-js-concept.md  # Phase 1 spec & architecture decisions
```

The client distributes as a **single JS file**. The server is optional — omit `data-sync-url` to run offline-only.

## Integration

```html
<!-- Offline-only (IDB only, no server needed) -->
<script src="annotate.js" data-site-id="your-site-id"></script>

<!-- With multi-user sync -->
<script src="annotate.js"
        data-site-id="your-site-id"
        data-sync-url="https://your-server.example.com"></script>
```

Everything (IndexedDB layer, anchor serialization, sync layer, UI, CSS) is inlined into the IIFE.
Injects a collapsible right sidebar + floating comment button. All CSS embedded via `document.createElement('style')`.

## Running the Server

**Prerequisite:** Node.js ≥ 22.5 (experimental) or ≥ 23 (stable)

The server uses the built-in `node:sqlite` module, which requires this version. Check your version:
```bash
node --version
```

Then:
```bash
npm install
npm start
# open http://localhost:3000/demo/demo.html
```

The server also serves the demo and assets via `express.static`, so `python3 -m http.server` is no longer needed.

## Tech Stack

**Client**
- **Vanilla ES6+ JavaScript** — no React, Vue, etc.
- **Browser APIs only** — DOM, Text Selection, Range, IndexedDB, localStorage, fetch

**Server**
- **Node.js + Express** — lightweight REST API; **requires Node.js ≥ 22.5 (experimental) or ≥ 23 (stable)**
- **`node:sqlite`** — Node's built-in SQLite module, zero native compilation, zero `npm install` build time
- **No ORM** — raw SQL prepared statements

---

## Canonical Terminology

Use these terms consistently in code, comments, and future API design:

| Concept | Canonical term | Notes |
|---|---|---|
| Top-level annotation unit | **Thread** | Old names: annotation, card, node |
| Text highlighted on the page | **Highlight** | DOM: `<mark class="annotate-highlight">` |
| Selected text shown in quote block | **quote** (field) | Old: selectedText |
| Serialized DOM position for reload | **Anchor** | Old: range (Range is ephemeral) |
| Root text of a Thread | **body** (field) | Old: note, comment |
| Response to a Thread | **Reply** | Unchanged |
| Person who wrote a Thread/Reply | **Author** | Old: Anonymous (was hardcoded) |
| Script tag identifier | **siteId** | From `data-site-id` attribute |
| Full page URL being annotated | **pageUrl** | `window.location.href` normalized |
| UI container for quote+body+replies | **ThreadCard** | UI term only, not a data concept |

---

## Data Model

### Thread
```js
{
  id:          string,   // UUID v4, client-generated
  siteId:      string,   // from data-site-id
  pageUrl:     string,   // window.location.href (no hash)

  quote:       string,   // snapshot of selected text
  anchor: {
    xpath:       string, // XPath to text node
    startOffset: number,
    endOffset:   number,
  },

  body:        string,
  author:      string,
  createdAt:   string,   // ISO 8601
  updatedAt:   string,

  resolved:    boolean,
  resolvedAt:  string | null,
  resolvedBy:  string | null,

  replies: [{
    id:        string,
    body:      string,
    author:    string,
    createdAt: string,
    updatedAt: string | null,
    deleted:   boolean,        // soft-delete
  }],

  dirty:       boolean,        // true = not yet synced to server (client-only field)
  deletedAt:   string | null,  // soft-delete
}
```

### ActivityEntry
```js
{
  id:        string,
  siteId:    string,
  pageUrl:   string,
  type:      'thread_created' | 'thread_resolved' | 'thread_deleted'
           | 'thread_edited'  | 'reply_added'     | 'reply_edited'
           | 'reply_deleted',
  threadId:  string,
  replyId:   string | null,
  actor:     string,
  timestamp: string,   // ISO 8601
  snapshot:  string,   // short human summary e.g. "replied: 'great point'"
}
```

ActivityEntries are **local-only** — not synced to the server. Each browser keeps its own audit trail.

### UserConfig (localStorage only)
```js
{ displayName: string, configuredAt: string }
```

---

## Storage Architecture

| Data | Store | Why |
|---|---|---|
| Threads | **IndexedDB** (primary) + **SQLite** (server) | IDB is the offline working store; server is canonical for multi-user |
| Activity log | **IndexedDB only** | Local audit trail; no server sync needed |
| User config | **localStorage** | Tiny, simple, global |

**IDB name:** `annotate-{siteId}` · **Version:** 1

| Object store | Key | Indexes |
|---|---|---|
| `threads` | `id` | `[pageUrl]`, `createdAt` |
| `activity` | `id` | `[pageUrl]`, `timestamp` |

**SQLite** (`server/data/annotate.db`): single `threads` table. `anchor` and `replies` stored as JSON columns. `dirty` field is client-only and never written to SQLite.

---

## Sidebar Tabs

| Tab | Shows | Scope |
|---|---|---|
| **Threads** | Active threads (`resolved=false, deletedAt=null`) | current pageUrl |
| **Resolved** | Resolved threads (`resolved=true, deletedAt=null`) | current pageUrl |
| **Activity** | ActivityEntry list, newest first | current pageUrl |
| **Settings** | displayName input, clear-data option | global |

---

## Highlight Re-anchoring

`Range` objects are ephemeral. On save, serialize to a stable `Anchor`:
```js
// Serialize
anchor = { xpath: getXPath(range.startContainer), startOffset, endOffset }

// Restore on page load
range = document.evaluate(anchor.xpath) → set offsets → reconstruct Range → apply <mark>
```
If XPath no longer resolves (DOM changed), show Thread in sidebar with a
"highlight unavailable" badge rather than dropping it silently.

---

## Sync Architecture

Sync is **opt-in** via `data-sync-url`. When absent, the library behaves exactly as before (IDB-only).

### Strategy

| Trigger | Action |
|---|---|
| Every local mutation | `syncThread(t)` — fire-and-forget `POST /threads` (upsert) |
| Page load (after `loadThreads`) | `pullThreads()` — full pull; `flushDirtyThreads()` — push any offline mutations |
| Every 30 seconds | `pullThreads()` — incremental pull via `?since=_lastSync` |
| Tab becomes visible | `pullThreads()` — incremental pull |

### Conflict resolution

**Last-write-wins by `updatedAt`.** Server wins for non-dirty local records on pull. Local dirty records are skipped during pull and pushed on the next `syncThread` or `flushDirtyThreads` call.

`_lastSync` is set to the max `updatedAt` seen in each server response (not client clock), avoiding clock skew issues.

### `_rerenderAfterPull(serverThreads)`

Delta DOM update after every pull — no full page reload:
- **Deleted** thread: remove card from sidebar + unwrap `<mark>`
- **Resolved** thread (from another user): dim active card or apply `.is-resolved` mark
- **New** active thread: `restoreRange` + `renderThreadCard`
- **Updated** active thread: `_renderSavedCard` — skipped if a composer textarea is open (open-composer guard prevents wiping a draft)

---

## REST API

| Method | Path | Body | Action |
|---|---|---|---|
| GET | `/threads` | `?siteId&pageUrl[&since]` | All threads for page; `since` enables incremental pull |
| POST | `/threads` | full Thread object | Upsert (`INSERT OR REPLACE`) |
| PATCH | `/threads/:id` | `{ body, updatedAt }` | Edit body |
| PATCH | `/threads/:id/resolve` | `{ resolvedBy, resolvedAt }` | Resolve |
| DELETE | `/threads/:id` | `{ deletedAt }` | Soft-delete |
| POST | `/threads/:id/replies` | `{ reply }` | Append reply |
| PATCH | `/threads/:id/replies/:replyId` | `{ body, updatedAt }` | Edit reply |
| DELETE | `/threads/:id/replies/:replyId` | — | Soft-delete reply (`deleted: true`) |
| DELETE | `/threads` | `?siteId=` | Hard-delete all threads for a site (Settings → Clear all) |

All mutation endpoints return the full updated Thread object so the client can `dbSaveThread` directly.
GET includes soft-deleted threads so deletes propagate to other clients on pull.

---

## Implementation Phases

### Phase A — Persistence ✅
1. ✅ IndexedDB layer — inlined into `annotate.js`
2. ✅ Anchor layer — `serializeRange` / `restoreRange`
3. ✅ Wire mutations → IDB, load + re-render on page load
4. ✅ Display name prompt on first annotation

### Phase B — Tab views ✅
- ✅ Resolved tab, Activity tab, Settings tab

### Phase C — Backend sync ✅
- ✅ Node.js + Express + `node:sqlite` REST server (`server/`)
- ✅ Sync layer inlined into `annotate.js`: `syncThread`, `pullThreads`, `flushDirtyThreads`, `_rerenderAfterPull`
- ✅ Multi-user: 30s poll + visibility-change refresh

### Phase D — Future work
- Authentication / per-user access control
- Server-side activity log (currently local-only)
- Real-time push (SSE or WebSocket) to replace polling
- Deploy target (Fly.io, Railway, etc.)

---

## Testing

```bash
npm start
# open http://localhost:3000/demo/demo.html in two browser windows
```

**Note:** The server runs on port 3000. If the port is already in use (common during development when testing stops and the process remains), use `npm run kill-port` to free it, or manually kill the process with `lsof -nP -iTCP:3000 -sTCP:LISTEN` and `kill -9 <PID>`.

Test checklist for any change:
- Select text → comment button appears, positioned correctly
- Add Thread → Highlight appears, ThreadCard created in sidebar
- Reload page → Threads reload, Highlights re-applied
- Edit, delete, resolve each work and persist
- Replies thread correctly, persist across reload
- Resolved threads appear in Resolved tab, not Threads tab
- Activity tab shows all events in order
- Sidebar toggle opens/closes
- No JS errors in console

**Multi-user sync checklist:**
- User A annotates → User B sees it within 30 s (or on tab focus)
- User A resolves → User B's card dims within 30 s
- User A deletes → User B's highlight unwraps within 30 s
- Kill server → User A can still annotate (IDB saves, `dirty=true`)
- Restart server → User A's offline annotations push on next load (`flushDirtyThreads`)
- Remove `data-sync-url` → page works exactly as before (no fetch calls, no regressions)
- Settings → Clear all → sidebar empties immediately, stays empty after reload

## Key Implementation Notes

- **IIFE pattern** — all client code scoped in `(function() { ... })()` to avoid globals
- **`siteId`** — read via `document.currentScript.dataset.siteId`; IDB namespace + server scope
- **`syncUrl`** — read via `document.currentScript.dataset.syncUrl`; `null` = sync disabled
- **Card positioning** — `_anchorTop` on each DOM element; `repositionCards()` re-evaluates on every height change via `ResizeObserver`
- **Soft-delete** — `deletedAt` on Threads, `deleted` on Replies; never hard-delete so deletes propagate to other clients via GET
- **`dirty` flag** — client-only; never stored in SQLite; cleared after a successful `syncThread` push
- **`_renderedThreadIds`** — `Set` tracking IDs of active cards in `sidebarBody`; prevents double-render on first pull after `loadThreads`
- **`_lastRenderedAt`** — stored on each card DOM element; `_rerenderAfterPull` skips re-render if `updatedAt` hasn't changed
- **`updatedAt` on every mutation** — all mutations (reply add/edit/delete, resolve, thread delete) must bump `t.updatedAt = new Date().toISOString()` before saving; the `?since` incremental pull filters by `updated_at > _lastSync`, so any mutation that skips this is invisible to other users
- **`dbClearAll(siteId, db)`** — pass the open `_db` connection to clear stores via `readwrite` transaction instead of `deleteDatabase`; `deleteDatabase` is blocked by the tab's own open connection, causing the reload to never fire; falls back to `deleteDatabase` (with `onblocked → resolve` safety net) when no connection is available
