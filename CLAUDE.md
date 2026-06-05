# Annotate.js

Lightweight vanilla JS library that adds inline annotation and threaded comments to any web page via a single `<script>` tag. Zero dependencies, zero build step.

## Project Structure

```
Annotate.js/
├── assets/js/annotate.js   # Entire library (~800 lines, single IIFE)
├── assets/js/db.js         # IndexedDB wrapper (planned)
├── assets/js/anchor.js     # Range serialization / restore (planned)
├── demo/demo.html           # Manual test harness / integration example
└── docs/annotate-js-concept.md  # Phase 1 spec & architecture decisions
```

No `package.json`, no build tools, no framework — intentional. Distribute as plain JS files.

## Integration

```html
<script src="assets/js/db.js"></script>
<script src="assets/js/anchor.js"></script>
<script src="assets/js/annotate.js" data-site-id="your-site-id"></script>
```

Injects a collapsible right sidebar + floating comment button. All CSS embedded in JS via `document.createElement('style')`.

## Tech Stack

- **Vanilla ES6+ JavaScript** — no React, Vue, etc.
- **Browser APIs only** — DOM, Text Selection, Range, IndexedDB, localStorage
- **No build tooling** — edit source files directly, open `demo/demo.html` to test

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

  dirty:       boolean,        // true = not yet synced to server
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

### UserConfig (localStorage only)
```js
{ displayName: string, configuredAt: string }
```

---

## Storage Architecture

| Data | Store | Why |
|---|---|---|
| Threads | **IndexedDB** | Indexed by `[siteId, pageUrl]`, atomic updates, no size limit |
| Activity log | **IndexedDB** | Append-only, unbounded growth, queryable by timestamp |
| User config | **localStorage** | Tiny, simple, global |

**DB name:** `annotate-{siteId}` · **Version:** 1

| Object store | Key | Indexes |
|---|---|---|
| `threads` | `id` | `[pageUrl]`, `[pageUrl, resolved]`, `createdAt` |
| `activity` | `id` | `[pageUrl]`, `timestamp` |

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
// Serialize (anchor.js)
anchor = { xpath: getXPath(range.startContainer), startOffset, endOffset }

// Restore on page load (anchor.js)
range = document.evaluate(anchor.xpath) → set offsets → reconstruct Range → apply <mark>
```
If XPath no longer resolves (DOM changed), show Thread in sidebar with a
"highlight unavailable" badge rather than dropping it silently.

---

## Implementation Phases

### Phase A — Persistence (current focus)
1. `db.js` — IndexedDB wrapper: `openDB`, `getThreads`, `saveThread`, `updateThread`, `deleteThread`, `addActivity`, `getActivity`
2. `anchor.js` — `serializeRange(range) → Anchor`, `restoreRange(anchor) → Range`
3. Wire `annotate.js`: save Thread on note submit, update on resolve/edit/delete/reply, load + re-render on page load
4. Display name prompt on first annotation, persist to localStorage

### Phase B — Tab views
- Resolved tab: read-only ThreadCards filtered by `resolved=true`
- Activity tab: render ActivityEntry list
- Settings tab: displayName field + clear-data

### Phase C — Backend sync (deferred)
- Node.js + SQLite REST API (5 endpoints)
- Sync layer: push `dirty=true` records, pull newer than last-sync timestamp

---

## Future API Mapping

| Local action | REST endpoint |
|---|---|
| Save Thread | `POST /threads` |
| Edit Thread body | `PATCH /threads/:id` |
| Resolve Thread | `PATCH /threads/:id/resolve` |
| Delete Thread | `DELETE /threads/:id` |
| Add Reply | `POST /threads/:id/replies` |
| Edit Reply | `PATCH /threads/:id/replies/:replyId` |
| Delete Reply | `DELETE /threads/:id/replies/:replyId` |

---

## Testing

No automated tests. Use `demo/demo.html` as the manual test harness:

```bash
# Must serve over HTTP — IndexedDB and file:// don't mix well
python3 -m http.server 8080
# then open http://localhost:8080/demo/demo.html
```

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

## Key Implementation Notes

- **IIFE pattern** — all files scoped in `(function() { ... })()` to avoid globals
- **`siteId`** — read via `document.currentScript.dataset.siteId`; used as IDB namespace
- **Card positioning** — `_anchorTop` on each DOM element; `repositionCards()` re-evaluates on every height change via `ResizeObserver`
- **Soft-delete** — `deletedAt` field on Threads and `deleted` flag on Replies; never hard-delete locally so sync can propagate removals to the server later
