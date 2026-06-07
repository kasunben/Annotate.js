'use strict';

// Minimal WebSocket relay that mirrors the Cloudflare Worker relay protocol.
// Used by p2p-relay.spec.js to provide local signaling for WebRTC tests.
//
// Protocol (matches relay/worker.js):
//   Client → Relay: { type: 'join',   room, peerId }
//   Client → Relay: { type: 'signal', to, from, data }
//   Client → Relay: { type: 'leave',  room, peerId }
//   Relay  → Client: { type: 'peer-joined', peerId }
//   Relay  → Client: { type: 'peer-left',   peerId }
//   Relay  → Client: { type: 'signal', ... } — forwarded verbatim

const { WebSocketServer } = require('ws');

function startMockRelay(port = 0) {
  return new Promise((resolve, reject) => {
    const rooms = new Map(); // roomId → Map(peerId → ws)
    const wss   = new WebSocketServer({ port });

    wss.on('error', reject);

    wss.on('listening', () => {
      resolve({
        port:  wss.address().port,
        close: () => new Promise((res) => wss.close(res)),
      });
    });

    wss.on('connection', (ws, req) => {
      const match = req.url && req.url.match(/\/room\/([^/?]+)/);
      if (!match) { ws.close(4000, 'bad path'); return; }

      const roomId = decodeURIComponent(match[1]);
      ws._peerId = null;
      ws._roomId = roomId;

      ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        if (msg.type === 'join' && msg.peerId) {
          ws._peerId = msg.peerId;
          if (!rooms.has(roomId)) rooms.set(roomId, new Map());
          const room = rooms.get(roomId);
          room.forEach((peer) => safeSend(peer, { type: 'peer-joined', peerId: msg.peerId }));
          room.set(msg.peerId, ws);
        }

        if (msg.type === 'signal' && msg.to) {
          const room = rooms.get(roomId);
          if (!room) return;
          const target = room.get(msg.to);
          if (target) safeSend(target, msg);
        }

        if (msg.type === 'leave') removePeer(ws);
      });

      ws.on('close', () => removePeer(ws));
      ws.on('error', () => removePeer(ws));
    });

    function removePeer(ws) {
      const { _peerId: peerId, _roomId: rid } = ws;
      if (!peerId) return;
      const room = rooms.get(rid);
      if (room) {
        room.delete(peerId);
        room.forEach((peer) => safeSend(peer, { type: 'peer-left', peerId }));
      }
      ws._peerId = null;
    }

    function safeSend(ws, msg) {
      try { ws.send(JSON.stringify(msg)); } catch { /* peer closed */ }
    }
  });
}

module.exports = { startMockRelay };
