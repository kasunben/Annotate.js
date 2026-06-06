# RFC: Peer-to-Peer Sync Mode

**Status:** Draft  
**Author:** kasunben  
**Created:** 2026-06-06

---

## Summary

Add an optional peer-to-peer sync mode to Annotate.js, activated by a new `data-room-id` script attribute. Annotation data flows directly between browsers via WebRTC (DTLS-encrypted) and never touches any server. Signaling (the initial peer handshake) uses a **tiered strategy**:

1. **Hosted relay** (default) — a lightweight WebSocket relay operated by the project on Cloudflare Workers. Zero setup for users; GDPR-controllable; no third-party operators.
2. **Self-hosted relay** (enterprise override) — the same relay code, self-deployed, pointed to via `data-relay-url`.
3. **NOSTR relays** (automatic fallback) — used if the hosted relay is unreachable, for resilience.

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

<!-- P2P sync — uses hosted relay by default (NEW) -->
<script src="annotate.min.js"
        data-site-id="my-site"
        data-room-id="f3a9c271-8d4e-4b1a-9c3f-d17b2e5a08cc">
</script>

<!-- P2P sync — self-hosted relay (enterprise / full control) -->
<script src="annotate.min.js"
        data-site-id="my-site"
        data-room-id="f3a9c271-8d4e-4b1a-9c3f-d17b2e5a08cc"
        data-relay-url="wss://your-relay.example.com">
</script>

<!-- Server sync (current — unchanged) -->
<script src="annotate.min.js"
        data-site-id="my-site"
        data-sync-url="https://your-server.example.com">
</script>
```

`data-room-id` activates P2P mode. `data-relay-url` overrides the signaling relay (optional). `data-sync-url` activates server mode. Neither room nor sync URL = offline.  
P2P and server sync modes are **mutually exclusive** — mixing them on a single page is not supported.

---

## Architecture

### Signaling: tiered strategy

Signaling is the initial handshake that lets two browsers find each other before establishing a direct WebRTC connection. Annotation content never passes through any signaling layer. The project uses three tiers, tried in order:

#### Tier 1 — Hosted relay (default)

The project operates a minimal WebSocket relay at `wss://relay.annotatejs.io` (or similar), deployed on **Cloudflare Workers + Durable Objects**. This is the recommended default for all users.

The relay protocol is 4 message types:

```
Client → Relay:  { type: 'join',   room, peerId }
Client → Relay:  { type: 'signal', to, from, data }   ← SDP + ICE candidates only
Client → Relay:  { type: 'leave',  room, peerId }
Relay  → Peers:  { type: 'peer-joined' } / { type: 'peer-left' }
```

The relay stores nothing — rooms are ephemeral in-memory state in a Durable Object that evaporates when the last peer disconnects. The relay code is published in the repository so anyone can audit or self-host it.

**Why Cloudflare Workers?**
- Global edge deployment — peers connect to the nearest PoP, minimising signaling latency
- Free tier covers millions of requests for a small project, zero ops overhead
- Durable Objects provide consistent room state without a database
- Cloudflare is a GDPR-compliant data processor; a Data Processing Agreement is available

#### Tier 2 — Self-hosted relay (enterprise override)

Setting `data-relay-url="wss://your-relay.example.com"` replaces the hosted relay entirely. The relay is the same published codebase — deployable anywhere that supports WebSockets (Cloudflare Workers, Fly.io, a $5 VPS). This gives enterprises full control over what infrastructure sees their users' IP addresses and room names.

#### Tier 3 — NOSTR relays (automatic fallback)

If the active relay (tier 1 or 2) is unreachable, the client automatically falls back to [Trystero](https://github.com/dmotz/trystero)'s NOSTR strategy (`trystero/nostr`). NOSTR relays are decentralised, widely distributed, and not blocked by enterprise firewalls. This provides resilience without requiring the hosted relay to have 100% uptime.

Trystero's BitTorrent tracker strategy is **not used** — see the [Legal & Compliance](#legal--compliance) section.

Once signaling completes (via any tier), data flows over **WebRTC data channels encrypted with DTLS** — the same transport security as HTTPS, end-to-end between browsers.

### Data flow

```
Browser A                                        Browser B
────────────────────────────────────────────────────────────
openDB → loadThreads (IDB)                       openDB → loadThreads (IDB)
         ↓
Trystero.joinRoom(_roomId)  ←── signaling ──►  Trystero.joinRoom(_roomId)
                   (hosted relay → self-hosted relay → NOSTR fallback)
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
| `assets/js/annotate.js` | Add `_roomId`, `_relayUrl` state vars; `initP2P()`, `broadcastThread()`, `broadcastActivity()`, `onPeerData()` functions; wire into existing `dbSaveThread` + `_rerenderAfterPull` call sites |
| Build | Trystero must be bundled. Requires switching from terser-only to **esbuild** (handles bundling + minification) |
| `annotate.min.js` | Estimated final size: ~60–80 KB minified (up from ~40 KB) |
| `relay/` (new) | Cloudflare Worker + Durable Object implementing the relay protocol; published in the repo for self-hosters |
| `README.md` / `CLAUDE.md` | Document `data-room-id`, `data-relay-url`, and P2P mode |

Existing `server/` files are **not touched**. The P2P mode is purely additive.

---

## Tradeoffs vs server sync

| | Server sync | P2P (Trystero) |
|---|---|---|
| **Persistence** | SQLite — survives all browsers closing | IDB only — latecomers sync from an online peer, not a database |
| **Privacy** | Annotations stored server-side | Annotation content never leaves the browser (DTLS E2E); room name + IPs visible to relay operator (project-operated or self-hosted) |
| **Hosting cost** | VPS / container required | Zero for annotation data; hosted relay is free-tier CF Workers |
| **Offline writes** | `dirty` flag, flushed on next server contact | Queued in IDB; broadcast when a peer is online |
| **Conflict resolution** | Last-write-wins (server clock) | Last-write-wins (client clocks) |
| **Activity history** | Server-persisted, visible to latecomers | Broadcast only — latecomers miss offline events |
| **Reliability** | Depends on your server uptime | Hosted relay (CF edge) + NOSTR fallback; highly resilient |

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
| Annotation content | Peers in the room only | DTLS-encrypted end-to-end; no relay sees it |
| Room name | Active relay operator | Hosted relay (project) or self-hosted relay or NOSTR relays |
| IP addresses | Active relay operator | Present in WebSocket connection + ICE candidates |
| Ephemeral peer public keys | NOSTR relay operators (fallback only) | Trystero-generated per session; not linked to identity |

**Hosted relay (default):** the project operates the relay under a published privacy policy with zero data retention. Room names and IPs are not logged. A GDPR Data Processing Agreement is available on request.

**Self-hosted relay:** the operator controls all visibility entirely — the strongest privacy posture short of running no relay at all.

**NOSTR fallback:** room name and ephemeral keys visible to relay operators; IP visible via WebSocket connection. Used only when the primary relay is unreachable.

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

### When to use a self-hosted relay instead

Set `data-relay-url="wss://your-relay.example.com"` when:
- Your organisation requires that no third party (including the project) sees room names or user IPs
- You need a signed GDPR Data Processing Agreement with the relay operator (i.e. yourself)
- You are annotating confidential internal documents and need full infrastructure control

The relay codebase is published in `relay/` — deploy it to your own Cloudflare account, a Fly.io app, or any WebSocket-capable host. It stores nothing and requires no database.

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

### Signaling infrastructure and GDPR

**Hosted relay (default):** operated by the project with zero data retention. No logs of room names or IP addresses are written to persistent storage. A GDPR Article 28 Data Processing Agreement is available on request. This is the recommended path for GDPR-compliant EU deployments.

**Self-hosted relay:** you are both the data controller and processor. Full GDPR compliance is in your hands.

**NOSTR fallback:** NOSTR relay operators are third parties with no DPA relationship. NOSTR is used only as an automatic fallback when the primary relay is unreachable. Sites with strict GDPR requirements who cannot accept any NOSTR exposure should use a self-hosted relay and disable the NOSTR fallback (a build-time option, see Open Questions).

### Privacy policy guidance

Sites using P2P mode should disclose in their privacy policy:
- That WebRTC connections are established directly between users' browsers
- That a signaling relay (project-hosted, self-hosted, or NOSTR fallback) is used during connection setup to exchange peer metadata; it does not receive annotation content
- That annotation data is transmitted directly between browsers and not stored on any server

---

## Open questions

### 1. Bundle strategy

Trystero is published as an ES module. The current `annotate.js` is a plain IIFE with no build-time bundling — terser only minifies it. Using the NOSTR fallback requires importing from `trystero/nostr`:

```js
import { joinRoom } from 'trystero/nostr'
```

Options:
- **(a) esbuild bundle step** — bundle `trystero/nostr` into the IIFE at build time. Clean, self-contained output. esbuild replaces terser (it handles both bundling and minification); output is still a single file.
- **(b) Dynamic `import()` at runtime** — load Trystero from a CDN when P2P mode is activated. Keeps the build simple but adds a runtime network dependency, conflicting with the offline-first goal.

**Recommendation: option (a).**

### 2. NOSTR fallback opt-out

For deployments that require zero third-party relay exposure, there should be a build-time flag to compile out the NOSTR fallback entirely. When disabled, the client uses only the configured relay (hosted or self-hosted) and fails gracefully if it is unreachable.

**Recommendation: implement as an esbuild define flag** (`NOSTR_FALLBACK=false`) so it can be toggled without modifying source code.

### 3. Room ID derivation

Should `data-room-id` be explicit, or auto-derived from `data-site-id`?

- **Explicit `data-room-id`** — clearest intent; users choose their room name deliberately
- **Auto-derive from `data-site-id`** — simpler embed (one fewer attribute); risk that two unrelated sites using the same `siteId` string accidentally share a room

**Recommendation: explicit `data-room-id`** for the initial implementation.

### 4. Hosted relay domain & branding

The relay URL (`wss://relay.annotatejs.io`) needs a domain decision before launch. Options: subdomain of an existing project domain, a dedicated domain, or a Cloudflare Workers subdomain (`relay.annotate-js.workers.dev`). The workers.dev subdomain requires zero DNS setup and is available immediately.

### 5. Server + P2P simultaneously

It is architecturally possible to run both modes at once (P2P for real-time, server for persistence). Out of scope for the initial P2P milestone.

---

## Phased rollout

### Phase P1 — BroadcastChannel (prerequisite, zero deps)

Add same-browser multi-tab sync via the `BroadcastChannel` API. ~10 lines of code, no library, no WebRTC. Gives free instant sync across open tabs on the same origin.

This validates the broadcast/receive pattern and the `_rerenderAfterPull` reuse before introducing WebRTC complexity.

### Phase P2 — Hosted relay deployment

Deploy the `relay/` Cloudflare Worker before shipping P2P mode. Resolve the hosted relay domain (Open Question 4). Publish the relay code and self-hosting instructions. Establish the privacy policy and DPA process.

### Phase P3 — WebRTC P2P in annotate.js

Full cross-device P2P sync via `data-room-id`. Requires resolving the bundle strategy (Open Question 1) and implementing `initP2P` / `onPeerData`. The NOSTR fallback is included by default; the opt-out flag (Open Question 2) ships alongside.

---

## Alternatives considered

### Trystero — BitTorrent tracker strategy

Trystero's `trystero/torrent` strategy uses public BitTorrent trackers for signaling. Technically functional and zero-cost, but rejected for the reasons detailed in the [Legal & Compliance](#legal--compliance) section: GDPR IP exposure, German/EU enforcement climate risk, and widespread enterprise firewall blocks.

### PeerJS cloud

PeerJS offers a hosted signaling server (free tier). Simpler API than raw WebRTC, but depends on PeerJS's cloud infrastructure and requires a `peerjs` dependency. Trystero with NOSTR is preferred because it has no single point of failure and no dependency on a commercial service's free tier.

### Self-hosted relay

The same relay codebase published in `relay/`, deployed by the user on their own infrastructure. This is now a **first-class supported option** (not just an alternative) — it is the recommended path for enterprise deployments requiring full GDPR control. Activated via `data-relay-url`. No hosting cost argument applies here since the user has already decided to run infrastructure.

### Yjs / CRDTs

Yjs provides mathematically conflict-free merging and supports swappable providers (`y-webrtc`, `y-indexeddb`, `y-websocket`). More robust than last-write-wins for concurrent edits. Rejected for the initial P2P milestone because it would require migrating the entire data model — a much larger scope. Worth revisiting if conflict resolution proves problematic in practice.
