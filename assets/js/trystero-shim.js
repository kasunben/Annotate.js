// Build-time shim for esbuild --inject
//
// esbuild replaces every free-variable reference to `_trysteroJoin` in
// annotate.js with the bundled `joinRoom` from trystero/nostr at build time.
//
// This file is NEVER loaded directly in a browser — it is only consumed by
// the `npm run build` step. The raw annotate.js source works without it
// (P2P NOSTR tier is gracefully unavailable when loaded as a plain script).
export { joinRoom as _trysteroJoin } from 'trystero/nostr';
