# RFC: Peer-to-Peer Sync Mode

**Status:** Draft  
**Author:** kasunben  
**Created:** 2026-06-06

---

## Summary

Add an optional peer-to-peer sync mode to Annotate.js, activated by a new `data-room-id` script attribute. Annotation data flows directly between browsers via WebRTC (DTLS-encrypted), with no server required. Signaling (the initial peer handshake) is handled by **NOSTR relays** via the Trystero library — zero infrastructure cost, no BitTorrent involvement.

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

### Signaling: Trystero (NOSTR strategy)

[Trystero](https://github.com/dmotz/trystero) is a ~20 KB JavaScript library that establishes WebRTC connections between browsers using a pluggable signaling backend. This project uses the **NOSTR strategy** (`trystero/nostr`) exclusively.

NOSTR is a decentralized relay protocol. Trystero uses it to exchange the small ICE SDP offer/answer messages needed to set up a WebRTC connection. The only information visible to NOSTR relays is the **room name** — annotation content never passes through any relay.

Once connected, data flows over WebRTC data channels encrypted with DTLS (the same transport security as HTTPS).

Trystero also supports BitTorrent trackers as a signaling backend. **This project does not use that strategy** — see the [Legal & Compliance](#legal--compliance) section.

### Data flow

```
Browser A                                        Browser B
────────────────────────────────────────────────────────────
openDB → loadThreads (IDB)                       openDB → loadThreads (IDB)
         ↓
Trystero.joinRoom(_roomId)  ←── signaling ──►  Trystero.joinRoom(_roomId)
                                 (NOSTR relays)
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
| **Privacy** | Annotations stored server-side | Annotation content never leaves the browser (DTLS E2E); room name + IPs visible to NOSTR relay operators |
| **Hosting cost** | VPS / container required | Zero |
| **Offline writes** | `dirty` flag, flushed on next server contact | Queued in IDB; broadcast when a peer is online |
| **Conflict resolution** | Last-write-wins (server clock) | Last-write-wins (client clocks) |
| **Activity history** | Server-persisted, visible to latecomers | Broadcast only — latecomers miss offline events |
| **Reliability** | Depends on your server uptime | Depends on NOSTR relay availability (multiple public relays; highly resilient) |

### The persistence gap

The main weakness of P2P mode: if User A annotates while all other peers are offline, those peers will not see A's annotations until A comes back online and they are in the same room simultaneously. There is no shared durable store.

**This is acceptable for:** live sessions, meetings, real-time collaborative review  
**This is not ideal for:** async annotation over days or weeks where users work independently

For async workflows, the server sync path remains the better choice.

---

## Security Model

### What WebRTC already protects

WebRTC data channels are **mandatorily DTLS-encrypted** — this cannot be disabled and requires no configuration. DTLS is negotiated end-to-end between the two browsers. Even when a TURN server is used to relay traffic (common behind strict NAT), the TURN server forwards encrypted packets it cannot read. Annotation content is therefore protected from:

- NOSTR relay operators (signaling only; no annotation data passes through)
- Network observers and ISPs
- TURN relay servers

No additional application-level encryption is needed to protect annotation content in transit.

### What IS visible to third parties

| Data | Visible to | Notes |
|---|---|---|
| Annotation content | Peers in the room only | DTLS-encrypted end-to-end |
| Room name | NOSTR relay operators | Plain text in signaling messages |
| IP addresses | NOSTR relay operators | Present in ICE candidates |
| Ephemeral peer public keys | NOSTR relay operators | Trystero-generated per session; not linked to identity |

### Room name as access control

The room name (`data-room-id`) is the only access control mechanism for P2P mode. **Anyone who knows the room name can join the room and read all annotations.** This makes the room name effectively a shared password.

**Guidance for site operators:**

- Use a **long random string** for `data-room-id` — a UUID v4 or a 128-bit hex token is appropriate. Do not use human-readable or guessable names like `"my-project"` or `"acme-docs"`.
- Treat the room ID as a secret. Do not embed it in public HTML — generate it server-side and inject it only for authenticated users, or distribute it via a secure channel.
- Rotating the room ID revokes access for anyone who had the old value.

Example of a safe room ID:

```html
<script src="annotate.min.js"
        data-site-id="my-site"
        data-room-id="f3a9c271-8d4e-4b1a-9c3f-d17b2e5a08cc">
</script>
```

### Multi-peer rooms (3+ users)

Each WebRTC connection in a room is DTLS-encrypted pairwise. Application-level encryption with a shared secret derived from the room ID would not add meaningful protection — every peer in the room already knows the room ID and is already trusted by being there. The trust boundary is room membership, not encryption.

### When to use self-hosted signaling instead

If the room name and user IP addresses must not be visible to any third party (e.g. internal enterprise annotation of confidential documents), use the **self-hosted signaling server** alternative (see Alternatives Considered). It is a tiny WebSocket server (~50 lines) that brokers only ICE SDP messages, stores nothing, and is fully under your control. This satisfies strict GDPR data minimisation requirements where NOSTR relay operators cannot be included in a Data Processing Agreement.

---

## Legal & Compliance

### Why not BitTorrent trackers?

Trystero's BitTorrent tracker strategy works by announcing a room name to public torrent trackers (e.g. `wss://tracker.openwebtorrent.com`) to exchange ICE SDP messages. Using a tracker for peer signaling is not copyright infringement — no content swarm is joined, no files are shared. However, it creates several practical problems for EU deployments:

**1. GDPR — IP address exposure**  
Connecting to a BitTorrent tracker causes your IP address to be logged by the tracker operator. Under GDPR (Article 4), IP addresses are personal data. Public BitTorrent tracker operators are typically outside the EU and operate with no Data Processing Agreement, no privacy policy targeting EU users, and no mechanism for data deletion requests. Embedding a script that causes users' IPs to be sent to such operators without disclosure creates GDPR liability for the site operator.

**2. German & EU copyright enforcement climate**  
Germany, Austria, and the Netherlands have historically seen mass Abmahnung (cease-and-desist) campaigns where law firms subpoenaed ISPs for the identities of IP addresses that appeared in tracker logs — even for brief, non-infringing connections. While courts would not find signaling-only tracker use to be infringement, the IP appearing in tracker logs is enough to trigger automated enforcement letters. The legal defence is valid; the cost and disruption of receiving one is not.

**3. Corporate and institutional network blocks**  
Many enterprise networks, universities, and government institutions in Germany and across the EU firewall all BitTorrent tracker traffic at the network layer. A script that relies on BT tracker signaling silently fails to connect for these users, with no fallback.

### NOSTR as the signaling backend

NOSTR relays are lightweight WebSocket servers that relay signed events. They carry no BitTorrent association, are not blocked by enterprise firewalls, and are operated by a wide variety of independent operators in multiple jurisdictions (including EU-based ones). The room name is visible to relay operators as a short string; no annotation content passes through.

GDPR exposure is reduced: NOSTR relay operators are more likely to be accessible, documentable entities, and the data exchanged (a room name + ephemeral public key) is less sensitive than an IP/swarm association.

**For maximum privacy** (self-hosted signaling): the self-hosted signaling server alternative (see Alternatives Considered) stores no data and is fully GDPR-controllable, at the cost of reintroducing a hosting requirement.

### Privacy policy guidance

Sites using P2P mode should disclose in their privacy policy:
- That WebRTC connections are established between users' browsers
- That the room name is shared with NOSTR relay infrastructure during connection setup
- That annotation data is transmitted directly between browsers and not stored on any server

### 1. Bundle strategy

Trystero is published as an ES module. The current `annotate.js` is a plain IIFE with no build-time bundling — terser only minifies it. Using the NOSTR strategy requires importing from `trystero/nostr`:

```js
import { joinRoom } from 'trystero/nostr'
```

Options:
- **(a) esbuild/rollup bundle step** — bundle `trystero/nostr` into the IIFE at build time. Clean, self-contained output. Adds a build dependency and replaces terser with esbuild (which also handles minification).
- **(b) Dynamic `import()` at runtime** — load Trystero from a CDN (e.g. jsDelivr) when P2P mode is activated. Keeps the build simple but adds a runtime network dependency, which conflicts with the offline-first goal.

**Recommendation: option (a)** — esbuild replaces terser; it handles both bundling and minification, and the output is still a single self-contained file.

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

### Trystero — BitTorrent tracker strategy

Trystero's `trystero/torrent` strategy uses public BitTorrent trackers for signaling. Technically functional and zero-cost, but rejected for the reasons detailed in the [Legal & Compliance](#legal--compliance) section: GDPR IP exposure, German/EU enforcement climate risk, and widespread enterprise firewall blocks.

### PeerJS cloud

PeerJS offers a hosted signaling server (free tier). Simpler API than raw WebRTC, but depends on PeerJS's cloud infrastructure and requires a `peerjs` dependency. Trystero with NOSTR is preferred because it has no single point of failure and no dependency on a commercial service's free tier.

### Self-hosted signaling server

A tiny WebSocket server (~50 lines of Node.js) that only brokers ICE SDP exchanges — no annotation data stored, no database. This is the highest-privacy option (fully GDPR-controllable, no third-party infrastructure) but reintroduces a hosting requirement, contradicting the zero-server goal. Recommended as an opt-in alternative for privacy-sensitive enterprise deployments.

### Yjs / CRDTs

Yjs provides mathematically conflict-free merging and supports swappable providers (`y-webrtc`, `y-indexeddb`, `y-websocket`). More robust than last-write-wins for concurrent edits. Rejected for the initial P2P milestone because it would require migrating the entire data model — a much larger scope. Worth revisiting if conflict resolution proves problematic in practice.
