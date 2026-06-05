# Annotate.js

Lightweight vanilla JS library that adds inline annotation and threaded comments to any web page via a single `<script>` tag. Zero dependencies, zero build step.

## Project Structure

```
Annotate.js/
├── assets/js/annotate.js   # Entire library (~700 lines, single IIFE)
├── demo/demo.html           # Manual test harness / integration example
└── docs/annotate-js-concept.md  # Phase 1 spec & architecture decisions
```

No `package.json`, no build tools, no framework — intentional. Distribute as a plain JS file.

## Integration

```html
<script src="annotate.js" data-site-id="your-site-id"></script>
```

Injects a collapsible right sidebar + floating comment button. All CSS embedded in JS via `document.createElement('style')`.

## Tech Stack

- **Vanilla ES6+ JavaScript** — no React, Vue, etc.
- **Browser APIs only** — DOM, Text Selection, Range, localStorage (wiring in progress)
- **No build tooling** — edit `assets/js/annotate.js` directly, open `demo/demo.html` to test

## Current State

### Done
- Collapsible sidebar UI (right-aligned, 320px)
- Floating comment button on text selection
- Text highlighting via `<mark>` elements
- Annotation cards with quote, note, avatar, timestamp
- Resolve, Edit, Delete actions (three-dot menu)
- Threaded replies per annotation

### Not Yet Implemented (frontend)
- **LocalStorage persistence** — annotations lost on reload; `localStorage` is available but not wired up
- **Display name UI** — hardcoded "Anonymous"; needs localStorage read/write + input form
- `data-site-id` attribute is read from the script tag but never used yet

### Not Started (backend — deferred)
- Node.js + SQLite REST API (5 endpoints: list, create, reply, resolve, delete)
- API integration in the frontend client

## Development Approach

**Finish frontend with offline support first, then backend.**

"Offline support" here means full LocalStorage persistence so annotations survive page reloads without any server. The library should be fully usable as a standalone local tool before backend sync is introduced.

Frontend offline milestones:
1. Persist all annotations (quote, note, highlight range, timestamp, author) to localStorage keyed by `data-site-id` + `window.location.href`
2. Load and re-render saved annotations on page load (re-apply highlights + populate sidebar)
3. Display name — read from localStorage, prompt user on first annotation, save for future use
4. Persist resolve/edit/delete actions to localStorage
5. Handle edge cases: DOM changes that break highlight anchoring, duplicate highlights on reload

Backend sync comes after all of the above works reliably offline.

## Testing

No automated tests. Use `demo/demo.html` as the manual test harness:

```bash
open demo/demo.html
# or serve locally to avoid file:// quirks:
python3 -m http.server 8080
# then open http://localhost:8080/demo/demo.html
```

Test checklist for any change:
- Select text → comment button appears, positioned correctly
- Add annotation → highlight appears, card created in sidebar
- Reload page → annotations reload correctly (once offline persistence is done)
- Edit, delete, resolve each work correctly
- Replies thread correctly under parent annotation
- Sidebar toggle opens/closes
- No JS errors in console

## Key Implementation Details

- **IIFE pattern** — everything scoped inside `(function() { ... })()` to avoid global pollution
- **Highlight anchoring** — `Range` serialization strategy needed for reload; currently uses live `Range` objects (ephemeral)
- **Card positioning** — `getBoundingClientRect()` relative to highlighted text; recalculate on scroll/resize if needed
- **`data-site-id`** — read via `document.currentScript.dataset.siteId`; use as the localStorage namespace key

## Planned Backend (future, not current focus)

- Node.js + SQLite, self-hosted
- 5 REST endpoints: `list`, `create`, `reply`, `resolve`, `delete`
- Comments keyed by: `site_id` + page URL
- No auth in Phase 1 (display name only)
