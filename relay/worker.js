'use strict';

/**
 * Annotate.js WebSocket Relay — Cloudflare Worker + Durable Object
 *
 * Implements a minimal, ephemeral signaling relay for WebRTC peer discovery.
 * Annotation content NEVER passes through this relay — only SDP offers/answers
 * and ICE candidates (the WebRTC handshake). Actual annotation data flows
 * peer-to-peer over DTLS-encrypted WebRTC data channels.
 *
 * Protocol (4 message types):
 *   Client → Relay:  { type: 'join',   room, peerId }
 *   Client → Relay:  { type: 'signal', to, from, data }  — SDP / ICE only
 *   Client → Relay:  { type: 'leave',  room, peerId }
 *   Relay  → Client: { type: 'peer-joined', peerId }
 *   Relay  → Client: { type: 'peer-left',   peerId }
 *   Relay  → Client: { type: 'signal', to, from, data }  — forwarded verbatim
 *
 * Room state is held entirely in-memory inside the Durable Object — no SQLite,
 * no KV, no persistence. Rooms evaporate when the last peer disconnects.
 *
 * Deploy:
 *   cd relay && npx wrangler deploy
 *
 * Self-host:
 *   Fork the repo, deploy your own Worker, then set data-relay-url on the script tag:
 *   <script src="annotate.min.js"
 *           data-room-id="..."
 *           data-relay-url="wss://your-worker.your-subdomain.workers.dev">
 *
 * GDPR / privacy:
 *   The relay logs nothing. Room names and peer IDs are ephemeral in DO memory.
 *   IP addresses are visible to Cloudflare per their standard privacy policy.
 *   A Data Processing Agreement (DPA) is available for enterprise users.
 */

export default {
  async fetch(request, env) {
    const url   = new URL(request.url);
    const match = url.pathname.match(/^\/room\/([^/]+)$/);

    if (!match) {
      return new Response('Not found.\n\nValid path: /room/{roomId}', { status: 404 });
    }

    const roomId = decodeURIComponent(match[1]);
    const id     = env.ROOMS.idFromName(roomId);
    return env.ROOMS.get(id).fetch(request);
  },
};

// ── Durable Object: one instance per room ────────────────────────────────────

export class RoomDO {
  constructor(state) {
    // peerId (string) → WebSocket
    this.peers = new Map();
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    server.accept();

    server.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this._onMessage(msg, server);
    });

    server.addEventListener('close',  () => this._removePeer(server));
    server.addEventListener('error',  () => this._removePeer(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  _onMessage(msg, ws) {
    switch (msg.type) {
      case 'join': {
        if (!msg.peerId) return;
        ws._peerId = msg.peerId;

        // Notify all existing peers that a new peer joined.
        this.peers.forEach((existingWs) => {
          this._send(existingWs, { type: 'peer-joined', peerId: msg.peerId });
        });

        this.peers.set(msg.peerId, ws);
        break;
      }
      case 'signal': {
        // Forward SDP / ICE to the target peer only.
        if (!msg.to) return;
        const target = this.peers.get(msg.to);
        if (target) this._send(target, msg);
        break;
      }
      case 'leave': {
        this._removePeer(ws);
        break;
      }
    }
  }

  _removePeer(ws) {
    const peerId = ws._peerId;
    if (!peerId) return;

    this.peers.delete(peerId);

    // Notify remaining peers.
    this.peers.forEach((existingWs) => {
      this._send(existingWs, { type: 'peer-left', peerId });
    });
  }

  _send(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch { /* peer already closed */ }
  }
}
