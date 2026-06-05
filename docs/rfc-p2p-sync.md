# RFC: Peer-to-Peer Sync Mode

**Status:** Draft  
**Author:** kasunben  
**Created:** 2026-06-06

---

## Summary

Add an optional peer-to-peer sync mode to Annotate.js, activated by a new `data-room-id` script attribute. Annotation data flows directly between browsers via WebRTC (DTLS-encrypted), with no server required. Signaling is handled by public BitTorrent trackers and NOSTR relays via the Trystero library — zero infrastructure cost.

The existing offline mode and server sync path are unchanged. P2P is a third, parallel mode.

---

## Motivation

The current server sync path requires users to host a Node.js + SQLite server. This creates three friction points:

1. **Hosting cost** — a VPS or container is needed even for small private annotation use cases
2. **Complexity** — self-hosters must manage a server, database, and deployment
3. **Privacy** — annotation content is stored on a central server the user may not fully control

The goal is a mode where embedding a single `<script>` tag is sufficient for multi-user sync, with no server to run and no annotation data leaving the browser.

---

## Proposed Interface

```html
<!-- Offline-only (current behaviour — unchanged) -->
<script src="annotate.min.js"
        data-site-id="my-site">
</script>

<!-- P2P sync — no server needed (NEW) -->
<script src="annotate.min.js"
        data-site-id="my-site"
        data-room-id="my-project-annotations">
</script>

<!-- Server sync (current — unchanged) -->
<script src="annotate.min.js"
        data-site-id="my-site"
        data-sync-url="https://your-server.example.com">
</script>
```

`data-room-id` activates P2P mode. `data-sync-url` activates server mode. Neither = offline.  
The two sync modes are **mutually exclusive** — mixing them on a single page is not supported.

---

## Architecture

### Signaling: Trystero

[Trystero](https://github.com/dmotz/trystero) is a ~20 KB JavaScript library that establishes WebRTC connections between browsers using public BitTorrent trackers and NOSTR relays as the signaling channel. No server is needed. The only information visible to the signaling infrastructure is the **room name** — annotation content never passes through it.

Once connected, data flows over WebRTC data channels encrypted with DTLS (the same transport security as HTTPS).

### Data flow

```
Browser A                                        Browser B
────────────────────────────────────────────────────────────
openDB → loadThreads (IDB)                       openDB → loadThreads (IDB)
         ↓
Trystero.joinRoom(_roomId)  ←── signaling ──►  Trystero.joinRoom(_roomId)
                                 (BitTorrent trackers / NOSTR)
                                 only room name visible
              ↕  WebRTC data channel (DTLS encrypted)

User A adds thread
  → dbSaveThread (IDB)
  → broadcastThread(thread) ──────────────────► onPeerData(thread)
                                                  → merge by updatedAt
                                                  → dbSaveThread (IDB)
                                                  → _rerenderAfterPull([thread])
```

### Peer join — full state exchange

When a new peer connects to the room, it requests the full current state from any online peer. This replaces the server's `GET /threads` on page load:

```
New peer joins
  → send { type: 'REQUEST_STATE', pageUrl }
Existing peer receives
  → dbGetThreads(_db, pageUrl)
  → send { type: 'STATE_SNAPSHOT', threads: [...] }
New peer receives snapshot
  → merge each thread into IDB (last-write-wins by updatedAt)
  → _rerenderAfterPull(threads)
```

### Conflict resolution

Identical to the current server sync strategy: **last-write-wins by `updatedAt`**. On receiving a thread from a peer:

```js
function onPeerThread(incoming) {
  dbGetThread(_db, incoming.id).then(function (existing) {
    if (!existing || incoming.updatedAt > existing.updatedAt) {
      dbSaveThread(_db, incoming);
      _rerenderAfterPull([incoming]);
    }
  });
}
```

The risk of clock skew between clients is low for the annotation use case — threads are rarely edited to the exact same millisecond by two users.

### Activity log

Activity entries are immutable (no conflict possible). They are broadcast to all peers on write and merged into IDB on receive, identical to threads but without the `updatedAt` comparison guard.

---

## What changes

| Component | Change |
|---|---|
| `assets/js/annotate.js` | Add `_roomId` state var; `initP2P()`, `broadcastThread()`, `broadcastActivity()`, `onPeerData()` functions; wire into existing `dbSaveThread` + `_rerenderAfterPull` call sites |
| Build | Trystero must be bundled into the output. Requires switching from terser-only to **esbuild** or **rollup** for the build step |
| `annotate.min.js` | Estimated final size: ~60–80 KB minified (up from ~40 KB) |
| `README.md` / `CLAUDE.md` | Document `data-room-id` and P2P mode |

Server files (`server/`) are **not touched**. The P2P mode is purely additive.

---

## Tradeoffs vs server sync

| | Server sync | P2P (Trystero) |
|---|---|---|
| **Persistence** | SQLite — survives all browsers closing | IDB only — latecomers sync from an online peer, not a database |
| **Privacy** | Annotations stored server-side | Annotations never leave the browser |
| **Hosting cost** | VPS / container required | Zero |
| **Offline writes** | `dirty` flag, flushed on next server contact | Queued in IDB; broadcast when a peer is online |
| **Conflict resolution** | Last-write-wins (server clock) | Last-write-wins (client clocks) |
| **Activity history** | Server-persisted, visible to latecomers | Broadcast only — latecomers miss offline events |
| **Reliability** | Depends on your server uptime | Depends on BitTorrent tracker / NOSTR relay availability |

### The persistence gap

The main weakness of P2P mode: if User A annotates while all other peers are offline, those peers will not see A's annotations until A comes back online and they are in the same room simultaneously. There is no shared durable store.

**This is acceptable for:** live sessions, meetings, real-time collaborative review  
**This is not ideal for:** async annotation over days or weeks where users work independently

For async workflows, the server sync path remains the better choice.

---

## Open questions

### 1. Bundle strategy

Trystero is published as an ES module. The current `annotate.js` is a plain IIFE with no build-time bundling — terser only minifies it.

Options:
- **(a) esbuild/rollup bundle step** — bundle Trystero into the IIFE at build time. Clean, self-contained output. Adds a build dependency and slightly changes the build pipeline.
- **(b) Dynamic `import()` at runtime** — load Trystero from a CDN (e.g. jsDelivr) when P2P mode is activated. Keeps the build simple but adds a runtime network dependency, which conflicts with the offline-first goal.

**Recommendation: option (a)** — esbuild replaces terser; it handles both bundling and minification, and the output is still a single file.

### 2. Room ID derivation

Should `data-room-id` be explicit, or auto-derived from `data-site-id`?

- **Explicit `data-room-id`** — clearest intent; users choose their room name deliberately
- **Auto-derive from `data-site-id`** — simpler embed (one fewer attribute); risk that two unrelated sites using the same `siteId` string accidentally share a room

**Recommendation: explicit `data-room-id`** for the initial implementation. Could add auto-derivation as a convenience later.

### 3. Server + P2P simultaneously

It is architecturally possible to run both modes at once (P2P for real-time latency, server for persistence). This would give the best of both worlds but meaningfully increases implementation complexity and is out of scope for the initial P2P milestone.

---

## Phased rollout

### Phase P1 — BroadcastChannel (prerequisite, zero deps)

Add same-browser multi-tab sync via the `BroadcastChannel` API. ~10 lines of code, no library, no WebRTC. Gives free instant sync across open tabs on the same origin.

This validates the broadcast/receive pattern and the `_rerenderAfterPull` reuse before introducing WebRTC complexity.

### Phase P2 — WebRTC P2P via Trystero

Full cross-device P2P sync via `data-room-id`. Requires resolving the bundle strategy (Open Question 1) and implementing `initP2P` / `onPeerData`.

---

## Alternatives considered

### PeerJS cloud

PeerJS offers a hosted signaling server (free tier). Simpler API than raw WebRTC, but depends on PeerJS's cloud infrastructure and requires a `peerjs` dependency. Trystero is preferred because it has no single point of failure.

### Self-hosted signaling server

A tiny WebSocket server that only brokers ICE SDP exchanges (no data stored). More private and reliable than public infrastructure, but reintroduces a hosting requirement — contradicting the main goal.

### Yjs / CRDTs

Yjs provides mathematically conflict-free merging and supports swappable providers (`y-webrtc`, `y-indexeddb`, `y-websocket`). More robust than last-write-wins for concurrent edits. Rejected for the initial P2P milestone because it would require migrating the entire data model — a much larger scope. Worth revisiting if conflict resolution proves problematic in practice.
