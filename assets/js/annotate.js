(function () {
  'use strict';

  // Injected by esbuild --define at build time from package.json. Falls back
  // to "dev" when the raw source is loaded directly without the build step,
  // making unbundled embeds visually distinguishable from releases.
  var _VERSION = (typeof __ANNOTATE_VERSION__ !== 'undefined') ? __ANNOTATE_VERSION__ : 'dev';

  // ── IndexedDB layer ───────────────────────────────────────────────────────
  //
  // All persistence functions live here, inside the same IIFE, so no separate
  // <script> tag is needed. The library ships as a single file.
  //
  // Database : annotate-{siteId}   Version : 1
  // Stores   : threads (keyed by id, indexed by pageUrl / createdAt)
  //            activity (keyed by id, indexed by pageUrl / timestamp)

  /** UUID v4 — uses crypto.randomUUID where available, Math.random fallback */
  function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  /** Strip the hash fragment so #section links share the same annotation set */
  function normalizeUrl(url) {
    try { const u = new URL(url); u.hash = ''; return u.toString(); }
    catch (_) { return url; }
  }

  /** Open (or create/upgrade) the IndexedDB database for a site */
  function openDB(siteId) {
    return new Promise(function (resolve, reject) {
      if (!siteId) { reject(new Error('Annotate.js: siteId is required')); return; }

      const request = indexedDB.open('annotate-' + siteId, 1);

      request.onupgradeneeded = function (e) {
        const db = e.target.result;

        // threads — boolean is not a valid IDB key type, so no compound index
        // for [pageUrl, resolved]. Filtering happens in JS after a pageUrl fetch.
        if (!db.objectStoreNames.contains('threads')) {
          const s = db.createObjectStore('threads', { keyPath: 'id' });
          s.createIndex('pageUrl',   'pageUrl',   { unique: false });
          s.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // activity log
        if (!db.objectStoreNames.contains('activity')) {
          const s = db.createObjectStore('activity', { keyPath: 'id' });
          s.createIndex('pageUrl',   'pageUrl',   { unique: false });
          s.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = function (e) { resolve(e.target.result); };
      request.onerror   = function (e) {
        console.error('Annotate.js: could not open IndexedDB', e.target.error);
        reject(e.target.error);
      };
    });
  }

  /** Fetch a single Thread by primary key */
  function dbGetThread(db, id) {
    return new Promise(function (resolve, reject) {
      const req = db.transaction('threads', 'readonly').objectStore('threads').get(id);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror   = function () { reject(req.error); };
    });
  }

  /** Internal: fetch all threads for a pageUrl, sorted by createdAt */
  function _dbGetByPage(db, pageUrl) {
    return new Promise(function (resolve, reject) {
      const req = db.transaction('threads', 'readonly')
        .objectStore('threads').index('pageUrl').getAll(pageUrl);
      req.onsuccess = function () {
        resolve((req.result || []).sort(function (a, b) {
          return a.createdAt.localeCompare(b.createdAt);
        }));
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  /** Active (unresolved, not deleted) Threads for a page */
  function dbGetThreads(db, pageUrl) {
    return _dbGetByPage(db, pageUrl).then(function (all) {
      return all.filter(function (t) { return !t.resolved && !t.deletedAt; });
    });
  }

  /** Resolved (not deleted) Threads for a page */
  function dbGetResolvedThreads(db, pageUrl) {
    return _dbGetByPage(db, pageUrl).then(function (all) {
      return all.filter(function (t) { return t.resolved && !t.deletedAt; });
    });
  }

  /** Upsert a Thread (insert or full replace) */
  function dbSaveThread(db, thread) {
    return new Promise(function (resolve, reject) {
      const req = db.transaction('threads', 'readwrite').objectStore('threads').put(thread);
      req.onsuccess = function () { resolve(); };
      req.onerror   = function () { reject(req.error); };
    });
  }

  /** Soft-delete: sets deletedAt + dirty, never hard-removes (needed for future sync) */
  function dbDeleteThread(db, threadId) {
    return dbGetThread(db, threadId).then(function (thread) {
      if (!thread) return;
      thread.deletedAt = new Date().toISOString();
      thread.updatedAt = new Date().toISOString();
      thread.dirty = true;
      return dbSaveThread(db, thread);
    });
  }

  /** Append an ActivityEntry */
  function dbAddActivity(db, entry) {
    return new Promise(function (resolve, reject) {
      const req = db.transaction('activity', 'readwrite').objectStore('activity').put(entry);
      req.onsuccess = function () { resolve(); };
      req.onerror   = function () { reject(req.error); };
    });
  }

  /** All ActivityEntries for a page, newest first */
  function dbGetActivity(db, pageUrl) {
    return new Promise(function (resolve, reject) {
      const req = db.transaction('activity', 'readonly')
        .objectStore('activity').index('pageUrl').getAll(pageUrl);
      req.onsuccess = function () {
        resolve((req.result || []).sort(function (a, b) {
          return b.timestamp.localeCompare(a.timestamp);
        }));
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  /**
   * Delete only threads belonging to a specific author for a site.
   * Activity entries have no authorId, so activity is cleared entirely (same
   * scope as before — documented limitation in sync-modes.md).
   */
  function dbClearMyThreads(db, siteId, authorId) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(['threads', 'activity'], 'readwrite');
      var threadsStore = tx.objectStore('threads');
      var req = threadsStore.getAll();
      req.onsuccess = function () {
        var toDelete = (req.result || []).filter(function (t) {
          return t.siteId === siteId && t.authorId === authorId;
        });
        toDelete.forEach(function (t) { threadsStore.delete(t.id); });
        tx.objectStore('activity').clear();
      };
      tx.oncomplete = resolve;
      tx.onerror    = function () { reject(tx.error); };
    });
  }

  /**
   * Wipe all threads and activity for a site.
   * Prefers clearing the object stores directly when an open IDBDatabase is
   * provided — avoids the deleteDatabase blocking issue caused by the same
   * tab's own open connection.  Falls back to deleteDatabase (with an
   * onblocked→resolve safety net) when no connection is available.
   */
  function dbClearAll(siteId, db) {
    if (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(['threads', 'activity'], 'readwrite');
        tx.objectStore('threads').clear();
        tx.objectStore('activity').clear();
        tx.oncomplete = resolve;
        tx.onerror    = function () { reject(tx.error); };
      });
    }
    return new Promise(function (resolve, reject) {
      var req = indexedDB.deleteDatabase('annotate-' + siteId);
      req.onsuccess = function () { resolve(); };
      req.onerror   = function () { reject(req.error); };
      req.onblocked = function () {
        // Another tab still holds a connection; resolve anyway so the caller
        // can reload — the pending deletion will complete on next page load.
        console.warn('Annotate.js: dbClearAll blocked — deletion will complete on reload');
        resolve();
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────

  // ── Anchor layer ──────────────────────────────────────────────────────────
  //
  // Range objects are ephemeral — destroyed on page unload. We serialize a
  // selection to a stable XPath + character offsets so highlights can be
  // reconstructed on every page load.
  //
  // Anchor shape: { xpath: string, startOffset: number, endOffset: number }
  //
  // ⚠️  Always call serializeRange(range) BEFORE highlightRange(range).
  //     Wrapping the selected text in <mark> mutates the DOM and changes the
  //     XPath of the original text node immediately afterwards.

  /**
   * Walk a node up to the document root, building an absolute XPath.
   *   Text nodes    →  text()[n]   (1-based index among text-node siblings)
   *   Element nodes →  tagname[n]  (1-based index among same-tag siblings)
   *
   * @param  {Node} node
   * @returns {string}
   */
  function _getXPath(node) {
    const parts = [];
    let current = node;

    while (current && current.nodeType !== Node.DOCUMENT_NODE) {
      if (current.nodeType === Node.TEXT_NODE) {
        let index = 1;
        let sib = current.previousSibling;
        while (sib) {
          if (sib.nodeType === Node.TEXT_NODE) index++;
          sib = sib.previousSibling;
        }
        parts.unshift('text()[' + index + ']');

      } else if (current.nodeType === Node.ELEMENT_NODE) {
        const tag = current.tagName.toLowerCase();
        let index = 1;
        let sib = current.previousSibling;
        while (sib) {
          if (sib.nodeType === Node.ELEMENT_NODE &&
              sib.tagName.toLowerCase() === tag) index++;
          sib = sib.previousSibling;
        }
        parts.unshift(tag + '[' + index + ']');
      }

      current = current.parentNode;
    }

    return '/' + parts.join('/');
  }

  /**
   * Serialize a live Range to a persistent Anchor.
   * ⚠️  Call this BEFORE highlightRange() — see note above.
   *
   * @param  {Range} range
   * @returns {{ xpath: string, startOffset: number, endOffset: number }}
   */
  function serializeRange(range) {
    return {
      xpath:       _getXPath(range.startContainer),
      startOffset: range.startOffset,
      endOffset:   range.endOffset,
    };
  }

  /**
   * Reconstruct a Range from a stored Anchor.
   * Returns null (never throws) if the XPath no longer resolves — the DOM
   * changed since the annotation was created. Callers should show a
   * "highlight unavailable" indicator rather than silently dropping the Thread.
   *
   * @param  {{ xpath: string, startOffset: number, endOffset: number }} anchor
   * @returns {Range|null}
   */
  function restoreRange(anchor) {
    try {
      const result = document.evaluate(
        anchor.xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      const node = result.singleNodeValue;
      if (!node) return null;

      // Guard: offsets must be within the text node's actual length
      const len = node.nodeValue ? node.nodeValue.length : 0;
      if (anchor.startOffset > len || anchor.endOffset > len) return null;

      const range = document.createRange();
      range.setStart(node, anchor.startOffset);
      range.setEnd(node, anchor.endOffset);
      return range;
    } catch (e) {
      console.warn('Annotate.js: restoreRange failed', anchor, e);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  // ── Runtime state ─────────────────────────────────────────────────────────
  // document.currentScript is only available during synchronous execution.
  const _siteId   = (document.currentScript && document.currentScript.dataset.siteId) || 'default';
  const _pageUrl  = normalizeUrl(window.location.href);
  const _syncUrl  = (document.currentScript && document.currentScript.dataset.syncUrl) || null;
  let   _db       = null; // IDBDatabase — set by init(); null = memory-only mode
  let   _lastSync         = null; // ISO 8601 — max updatedAt seen from server; drives incremental pulls
  let   _lastActivitySync = null; // ISO 8601 — max timestamp seen from server; drives activity incremental pulls

  // ── Author identity ────────────────────────────────────────────────────────
  // Persistent UUID per browser stored in localStorage. Generated once on
  // first load; used as ownership proof for Edit/Delete gating. Losing
  // localStorage (clear, private mode) loses edit access to old threads.
  const _AUTHOR_ID_KEY = 'annotate_author_id';
  let _authorId = localStorage.getItem(_AUTHOR_ID_KEY);
  if (!_authorId) {
    _authorId = generateId();
    localStorage.setItem(_AUTHOR_ID_KEY, _authorId);
  }

  // ── P2P state ──────────────────────────────────────────────────────────────
  // Activated by data-room-id. Mutually exclusive with data-sync-url (server sync).
  const _roomId    = (document.currentScript && document.currentScript.dataset.roomId)   || null;
  const _relayUrl  = (document.currentScript && document.currentScript.dataset.relayUrl) || 'wss://relay.annotate-js.workers.dev';
  // No-ops replaced by initP2P() when a room is active.
  let _p2pBroadcastThread   = function () {};
  let _p2pBroadcastActivity = function () {};

  console.log('Annotate.js loaded — site:', _siteId);

  // ── BroadcastChannel — same-origin multi-tab sync (zero dependencies) ─────
  // Broadcasts every local mutation to other tabs on the same origin, so tabs
  // stay in sync without a server or WebRTC. Gracefully absent in workers /
  // environments that don't implement BroadcastChannel.
  var _bc = (typeof BroadcastChannel !== 'undefined' && _siteId)
    ? new BroadcastChannel('annotate-' + _siteId)
    : null;

  if (_bc) {
    _bc.onmessage = function (ev) {
      var msg = ev.data;
      if (!_db) return;
      if (msg.type === 'THREAD_UPDATE') {
        dbGetThread(_db, msg.thread.id).then(function (existing) {
          // Use >= not > — IDB is shared across same-origin tabs, so the tab
          // that created the thread has already written it to IDB before posting
          // the BC message. The incoming updatedAt will equal (not exceed) the
          // existing one for new threads; >= correctly triggers a re-render.
          if (!existing || msg.thread.updatedAt >= existing.updatedAt) {
            dbSaveThread(_db, msg.thread).then(function () {
              _rerenderAfterPull([msg.thread]);
            });
          }
        });
      }
      if (msg.type === 'ACTIVITY_UPDATE') {
        dbAddActivity(_db, msg.entry);
      }
    };
  }

  // --- Styles ---
  const style = document.createElement('style');
  style.textContent = `
    /* ===================== SIDEBAR ===================== */
    #annotate-sidebar {
      position: absolute;
      top: 0;
      right: 0;
      width: 360px;
      min-height: 100%;
      background: #f4f5f7;
      border-left: 1px solid #e0e4ea;
      box-shadow: -2px 0 16px rgba(0,0,0,0.07);
      z-index: 9999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      transition: transform 0.25s ease;
    }

    #annotate-sidebar.collapsed {
      transform: translateX(360px);
    }

    /* ===================== HEADER ===================== */
    #annotate-sidebar-header {
      position: sticky;
      top: 0;
      background: #fff;
      border-bottom: 1px solid #e8eaed;
      z-index: 1;
    }

    .annotate-header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 12px 10px 16px;
    }

    .annotate-header-title {
      font-size: 16px;
      font-weight: 700;
      color: #111;
      letter-spacing: -0.015em;
      text-transform: uppercase;
    }

    .annotate-header-icons {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    .annotate-header-icon-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: #6b7280;
      padding: 5px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s;
    }

    .annotate-header-icon-btn:hover {
      background: #f3f4f6;
      color: #111;
    }

    /* ===================== TABS ===================== */
    .annotate-tabs {
      display: flex;
      padding: 0 6px;
    }

    .annotate-tab {
      padding: 8px 10px 7px;
      font-size: 12.5px;
      font-weight: 500;
      color: #9ca3af;
      border: none;
      background: none;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      transition: color 0.15s;
    }

    .annotate-tab.active {
      color: #111;
      border-bottom-color: #111;
      font-weight: 600;
    }

    .annotate-tab:hover:not(.active) {
      color: #374151;
    }

    /* ===================== BODY ===================== */
    #annotate-sidebar-body {
      position: relative;
      padding-top: 10px;
    }

    #annotate-empty {
      position: absolute;
      top: 24px;
      left: 0;
      right: 0;
      text-align: center;
      color: #9ca3af;
      font-size: 13px;
    }

    /* ===================== CARDS ===================== */
    .annotate-card {
      position: absolute;
      left: 10px;
      right: 10px;
      border: 1px solid #e4e7eb;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }

    /* ===================== QUOTE ===================== */
    .annotate-card-quote {
      background: #fdf8f0;
      border-left: 3px solid #d4a843;
      border-radius: 10px 10px 0 0;
      padding: 8px 12px;
      font-size: 12px;
      color: #6b5c3e;
      font-style: italic;
      line-height: 1.5;
    }

    /* ===================== CARD BODY ===================== */
    .annotate-card-body {
      padding: 12px;
    }

    /* ===================== META ROW ===================== */
    .annotate-meta {
      display: flex;
      align-items: flex-start;
      gap: 9px;
      margin-bottom: 0;
    }

    .annotate-avatar {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      color: #fff;
      flex-shrink: 0;
      background: #1a1a1a;
    }

    .annotate-avatar-sm {
      width: 26px;
      height: 26px;
      font-size: 10px;
      margin-top: 1px;
    }

    .annotate-meta-right {
      flex: 1;
      min-width: 0;
    }

    .annotate-author-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      margin-bottom: 4px;
    }

    .annotate-author {
      font-size: 13px;
      font-weight: 600;
      color: #111;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .annotate-author-row-right {
      display: flex;
      align-items: center;
      gap: 2px;
      flex-shrink: 0;
      position: relative;
    }

    .annotate-timestamp {
      font-size: 10.5px;
      color: #9ca3af;
      font-weight: 500;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    /* ===================== NOTE TEXT ===================== */
    .annotate-note-text {
      font-size: 13px;
      color: #374151;
      line-height: 1.6;
      margin: 0 0 9px;
    }

    /* ===================== INLINE ACTION ROW ===================== */
    .annotate-action-row {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .annotate-action-btn {
      background: none;
      border: none;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.07em;
      color: #9ca3af;
      cursor: pointer;
      padding: 0;
      text-transform: uppercase;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      transition: color 0.15s;
    }

    .annotate-action-btn:hover {
      color: #374151;
    }

    /* ===================== ICON BUTTONS ===================== */
    .annotate-icon-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: #d1d5db;
      padding: 3px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      transition: background 0.15s, color 0.15s;
    }

    .annotate-icon-btn:hover {
      background: #f3f4f6;
      color: #6b7280;
    }

    /* ===================== DROPDOWN ===================== */
    .annotate-dropdown {
      position: absolute;
      top: 100%;
      right: 0;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.1);
      z-index: 10002;
      min-width: 140px;
      padding: 4px 0;
    }

    .annotate-dropdown.hidden {
      display: none;
    }

    .annotate-dropdown-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 12px;
      font-size: 13px;
      color: #1a1a1a;
      cursor: pointer;
      background: none;
      border: none;
      width: 100%;
      text-align: left;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    .annotate-dropdown-item:hover {
      background: #f5f5f5;
    }

    .annotate-dropdown-item.danger {
      color: #dc2626;
    }

    /* ===================== COMPOSER ===================== */
    .annotate-card-composer {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #e5e7eb;
      border-radius: 7px;
      padding: 8px 10px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      resize: none;
      outline: none;
      color: #111;
      min-height: 64px;
      background: #fafafa;
    }

    .annotate-card-composer:focus {
      border-color: #1a1a1a;
      background: #fff;
    }

    .annotate-card-actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 8px;
    }

    .annotate-btn-cancel {
      background: none;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 5px 14px;
      font-size: 12px;
      cursor: pointer;
      color: #555;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      transition: background 0.15s;
    }

    .annotate-btn-save {
      background: #1a1a1a;
      border: none;
      border-radius: 6px;
      padding: 5px 14px;
      font-size: 12px;
      cursor: pointer;
      color: #fff;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      transition: background 0.15s;
    }

    .annotate-btn-save:hover { background: #333; }
    .annotate-btn-cancel:hover { background: #f5f5f5; }

    /* ===================== HIGHLIGHT ===================== */
    .annotate-highlight {
      background: #fde68a;
      border-radius: 2px;
    }

    /* ===================== REPLIES ===================== */
    .annotate-replies {
      border-top: 1px solid #f3f4f6;
    }

    .annotate-reply {
      padding: 10px 12px;
      border-top: 1px solid #f3f4f6;
    }

    .annotate-reply-action {
      padding: 8px 12px;
      border-top: 1px solid #f3f4f6;
    }

    .annotate-reply-composer {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #e5e7eb;
      border-radius: 7px;
      padding: 6px 10px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      resize: none;
      outline: none;
      color: #111;
      min-height: 52px;
      margin-bottom: 6px;
      background: #fafafa;
    }

    .annotate-reply-composer:focus {
      border-color: #1a1a1a;
      background: #fff;
    }

    /* ===================== TOGGLE BUTTON ===================== */
    #annotate-toggle {
      position: fixed;
      top: 50%;
      right: 0;
      transform: translateY(-50%);
      background: #1a1a1a;
      color: #fff;
      border: none;
      border-radius: 6px 0 0 6px;
      padding: 10px 8px;
      cursor: pointer;
      z-index: 10000;
      writing-mode: vertical-rl;
      letter-spacing: 0.05em;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 10px;
      font-weight: 600;
      transition: right 0.25s ease;
      text-transform: uppercase;
    }

    #annotate-toggle.sidebar-open {
      right: 360px;
    }

    /* ===================== FLOATING COMMENT BUTTON ===================== */
    #annotate-comment-btn {
      position: fixed;
      background: #1a1a1a;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 4px;
      cursor: pointer;
      z-index: 10001;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      transition: background 0.15s;
    }

    #annotate-comment-btn.hidden {
      display: none;
    }

    #annotate-comment-btn:hover {
      background: #333;
    }

    /* ===================== PANELS (Resolved / Activity / Settings) ===================== */
    .annotate-panel {
      padding: 10px;
      overflow-y: auto;
    }

    /* Resolved tab — flow-layout cards (not absolutely positioned) */
    .annotate-resolved-card {
      border: 1px solid #e4e7eb;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
      margin-bottom: 8px;
    }

    /* Activity tab */
    .annotate-activity-list { padding: 4px 0; }

    .annotate-activity-entry {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 4px;
      border-bottom: 1px solid #f3f4f6;
    }
    .annotate-activity-entry:last-child { border-bottom: none; }

    .annotate-activity-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
      margin-top: 4px;
    }

    .annotate-activity-content { flex: 1; min-width: 0; }

    .annotate-activity-actor {
      font-size: 12px;
      font-weight: 600;
      color: #111;
    }

    .annotate-activity-snapshot {
      font-size: 12px;
      color: #6b7280;
      line-height: 1.4;
      margin-top: 1px;
    }

    .annotate-activity-time {
      font-size: 10px;
      color: #9ca3af;
      white-space: nowrap;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      flex-shrink: 0;
    }

    /* Settings tab */
    .annotate-settings-group {
      padding: 14px 4px;
      border-bottom: 1px solid #f3f4f6;
    }
    .annotate-settings-group:last-child { border-bottom: none; }

    .annotate-settings-label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 6px;
    }

    .annotate-settings-input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #e5e7eb;
      border-radius: 7px;
      padding: 7px 10px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      outline: none;
      color: #111;
      background: #fafafa;
    }
    .annotate-settings-input:focus { border-color: #1a1a1a; background: #fff; }

    .annotate-settings-hint {
      font-size: 11px;
      color: #9ca3af;
      margin-top: 5px;
    }

    .annotate-settings-btn-danger {
      background: none;
      border: 1px solid #dc2626;
      color: #dc2626;
      border-radius: 6px;
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      transition: background 0.15s, color 0.15s;
    }
    .annotate-settings-btn-danger:hover { background: #dc2626; color: #fff; }

    /* Shared empty state */
    .annotate-empty-state {
      text-align: center;
      color: #9ca3af;
      font-size: 13px;
      padding: 32px 0;
    }

    /* Resolved highlight — slightly muted so it reads as "done" */
    .annotate-highlight.is-resolved {
      background: #d1fae5;
      opacity: 0.7;
    }

    /* ===================== ABOUT (Settings → About) ===================== */
    .annotate-about-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .annotate-about-name {
      font-weight: 600;
      color: #1a1a1a;
    }
    .annotate-about-version {
      font-size: 12px;
      color: #888;
      font-variant-numeric: tabular-nums;
    }
    .annotate-mode-chip-row {
      margin-bottom: 6px;
    }
    .annotate-mode-chip {
      font-size: 11px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 10px;
      background: #f0f0f0;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .annotate-privacy-note {
      margin: 4px 0 8px 0;
    }
    .annotate-about-link {
      font-size: 12px;
      color: #2563eb;
      text-decoration: none;
    }
    .annotate-about-link:hover { text-decoration: underline; }
  `;
  document.head.appendChild(style);

  // Attach sidebar to <html> so it's not affected by body margins/padding
  document.documentElement.style.position = 'relative';

  // --- Sidebar ---
  const sidebar = document.createElement('div');
  sidebar.id = 'annotate-sidebar';
  sidebar.innerHTML = `
    <div id="annotate-sidebar-header">
      <div class="annotate-header-top">
        <span class="annotate-header-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px;"><path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/><path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"/></svg>Discussion
        </span>
        <div class="annotate-header-icons">
          <button class="annotate-header-icon-btn" title="Search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </button>
          <button class="annotate-header-icon-btn" title="Filter">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="16" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="14" y2="18"/></svg>
          </button>
          <button id="annotate-close" class="annotate-header-icon-btn" title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="annotate-tabs">
        <button class="annotate-tab active">Threads</button>
        <button class="annotate-tab">Resolved</button>
        <button class="annotate-tab">Activity</button>
        <button class="annotate-tab">Settings</button>
      </div>
    </div>
    <div id="annotate-sidebar-body">
      <span id="annotate-empty">No threads yet.</span>
    </div>
    <div id="annotate-panel-resolved" class="annotate-panel" style="display:none;"></div>
    <div id="annotate-panel-activity"  class="annotate-panel" style="display:none;"></div>
    <div id="annotate-panel-settings"  class="annotate-panel" style="display:none;"></div>
  `;
  document.documentElement.appendChild(sidebar);

  const sidebarBody      = document.getElementById('annotate-sidebar-body');
  const emptyMsg         = document.getElementById('annotate-empty');
  const _panelResolved   = document.getElementById('annotate-panel-resolved');
  const _panelActivity   = document.getElementById('annotate-panel-activity');
  const _panelSettings   = document.getElementById('annotate-panel-settings');

  // threadId → <mark> element; used by Resolved tab delete to remove highlight
  const _threadMarks      = {};
  const _renderedThreadIds = new Set(); // IDs of active thread cards currently in sidebarBody

  // --- Tab switching ---
  const _allPanels   = [sidebarBody, _panelResolved, _panelActivity, _panelSettings];
  const _tabPanelMap = {
    'Threads':  sidebarBody,
    'Resolved': _panelResolved,
    'Activity': _panelActivity,
    'Settings': _panelSettings,
  };

  function _switchTab(name) {
    sidebar.querySelectorAll('.annotate-tab').forEach(function (t) {
      t.classList.toggle('active', t.textContent.trim() === name);
    });
    _allPanels.forEach(function (p) { p.style.display = 'none'; });
    const panel = _tabPanelMap[name];
    if (panel) panel.style.display = '';

    // Re-render on every open so content always reflects latest IDB state
    if (name === 'Resolved' && _db) _renderResolvedTab(_db);
    if (name === 'Activity'  && _db) _renderActivityTab(_db);
    if (name === 'Settings')         _renderSettingsTab();
  }

  sidebar.querySelectorAll('.annotate-tab').forEach(function (tab) {
    tab.addEventListener('click', function () { _switchTab(tab.textContent.trim()); });
  });

  // --- Toggle button ---
  const toggle = document.createElement('button');
  toggle.id = 'annotate-toggle';
  toggle.textContent = 'Annotations';
  document.documentElement.appendChild(toggle);

  // --- Open/close logic ---
  function openSidebar() {
    sidebar.classList.remove('collapsed');
    toggle.classList.add('sidebar-open');
  }

  function closeSidebar() {
    sidebar.classList.add('collapsed');
    toggle.classList.remove('sidebar-open');
  }

  toggle.addEventListener('click', function () {
    sidebar.classList.contains('collapsed') ? openSidebar() : closeSidebar();
  });

  document.getElementById('annotate-close').addEventListener('click', closeSidebar);

  // Start collapsed
  closeSidebar();

  // --- Relative timestamp helper ---
  function relativeTime(date) {
    const diff = Math.floor((Date.now() - date) / 1000);
    if (diff < 60) return 'JUST NOW';
    if (diff < 3600) return Math.floor(diff / 60) + 'M AGO';
    if (diff < 86400) return Math.floor(diff / 3600) + 'H AGO';
    return Math.floor(diff / 86400) + 'D AGO';
  }

  // --- Author (localStorage) ---
  const _AUTHOR_KEY = 'annotate_display_name';

  function getAuthor() {
    return localStorage.getItem(_AUTHOR_KEY) || '';
  }

  /** Return the stored display name, prompting once on first annotation */
  function ensureAuthor() {
    let name = getAuthor();
    if (!name) {
      name = (window.prompt('Enter your display name for annotations:') || '').trim();
      if (!name) name = 'Anonymous';
      localStorage.setItem(_AUTHOR_KEY, name);
    }
    return name;
  }

  // --- Activity factory ---
  function makeActivity(type, threadId, replyId, actor, snapshot) {
    return {
      id:       generateId(),
      siteId:   _siteId,
      pageUrl:  _pageUrl,
      type:     type,
      threadId: threadId,
      replyId:  replyId || null,
      actor:    actor,
      timestamp: new Date().toISOString(),
      snapshot: snapshot,
    };
  }

  /** Save an activity entry to IDB and push to server (no-op push when offline) */
  function logActivity(type, threadId, replyId, actor, snapshot) {
    var entry = makeActivity(type, threadId, replyId, actor, snapshot);
    return dbAddActivity(_db, entry).then(function () {
      syncActivity(entry);
    });
  }

  // --- Shared UI helpers ---
  const _MENU_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>';

  function _avatarLetter(name) {
    return (name || 'A').charAt(0).toUpperCase();
  }

  // --- Resolve card top to avoid overlapping existing cards ---
  function resolveCardTop(desiredTop, newCard) {
    const gap = 8;
    let top = desiredTop;
    const others = Array.from(sidebarBody.querySelectorAll('.annotate-card'))
      .filter(function (c) { return c !== newCard; })
      .sort(function (a, b) { return (parseInt(a.style.top) || 0) - (parseInt(b.style.top) || 0); });

    // Keep iterating until no overlap remains (handles cascading pushes)
    let changed = true;
    while (changed) {
      changed = false;
      for (const other of others) {
        const otherTop = parseInt(other.style.top, 10) || 0;
        const otherBottom = otherTop + other.offsetHeight;
        if (top < otherBottom + gap && top + newCard.offsetHeight > otherTop) {
          top = otherBottom + gap;
          changed = true;
        }
      }
    }
    return top;
  }

  // --- Re-position all cards based on their anchors ---
  // Each card stores _anchorTop — the ideal vertical position aligned with its highlight.
  // Cards are sorted by anchor, then placed greedily: each card sits at its anchor or
  // immediately below the previous card (+ gap), whichever is lower.
  // This means cards push down when a neighbour grows and spring back when it shrinks.
  function repositionCards() {
    const gap = 8;
    const cards = Array.from(sidebarBody.querySelectorAll('.annotate-card'))
      .sort(function (a, b) { return (a._anchorTop || 0) - (b._anchorTop || 0); });

    let floor = 0;
    for (const card of cards) {
      const ideal = card._anchorTop || 0;
      const top = Math.max(ideal, floor);
      card.style.top = top + 'px';
      floor = top + card.offsetHeight + gap;
    }

    if (cards.length > 0) {
      const last = cards[cards.length - 1];
      sidebarBody.style.minHeight = ((parseInt(last.style.top) || 0) + last.offsetHeight + 16) + 'px';
    }
  }

  // Watch a card for height changes and re-position all cards automatically
  function observeCardResize(card) {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(function () {
      requestAnimationFrame(repositionCards);
    });
    ro.observe(card);
  }

  // --- Highlight helper ---
  function highlightRange(range) {
    try {
      const mark = document.createElement('mark');
      mark.className = 'annotate-highlight';
      range.surroundContents(mark);
      return mark;
    } catch (e) {
      console.warn('Annotate.js: could not highlight range', e);
      return null;
    }
  }

  // --- Shared card/reply rendering helpers ---

  /** Wire a three-dot menu button ↔ its dropdown (shared by threads and replies) */
  function _wireMenuDropdown(menuBtn, dropdown) {
    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', function () {
      dropdown.classList.add('hidden');
    });
  }

  /** Human-readable label for the currently-active sync mode. */
  function _syncMode() {
    if (_roomId)  return 'P2P';
    if (_syncUrl) return 'Server sync';
    if (_bc)      return 'Offline + BroadcastChannel';
    return 'Offline';
  }

  /** Short privacy note describing where annotation data lives in the current mode. */
  function _privacyNote() {
    if (_roomId)  return 'End-to-end encrypted between peers. No server sees the content.';
    if (_syncUrl) return 'Synced to your own server. No third party involved.';
    return 'Stored locally in your browser. Never leaves this device.';
  }

  /**
   * Returns true if the current browser owns the given thread or reply.
   * In offline (single-user) mode — no server sync and no P2P — ownership
   * is unrestricted: the user can edit/delete any item. In multi-user modes
   * (server sync or P2P) only the author's own browser can mutate their items.
   */
  function _isOwner(item) {
    if (!_syncUrl && !_roomId) return true; // offline — single user, no restrictions
    if (!item.authorId) return false;       // legacy in multi-user — read-only
    return item.authorId === _authorId;
  }

  function _buildReplyEl(reply) {
    const el = document.createElement('div');
    el.className = 'annotate-reply';
    const replyMenuHtml = _isOwner(reply)
      ? `<button class="annotate-icon-btn annotate-menu-btn" title="More">${_MENU_SVG}</button>
              <div class="annotate-dropdown hidden">
                <button class="annotate-dropdown-item annotate-edit-btn">Edit</button>
                <button class="annotate-dropdown-item danger annotate-delete-btn">Delete</button>
              </div>`
      : '';
    el.innerHTML = `
      <div class="annotate-meta">
        <div class="annotate-avatar annotate-avatar-sm">${_avatarLetter(reply.author)}</div>
        <div class="annotate-meta-right">
          <div class="annotate-author-row">
            <span class="annotate-author">${reply.author}</span>
            <div class="annotate-author-row-right">
              <span class="annotate-timestamp">${relativeTime(new Date(reply.createdAt))}</span>
              ${replyMenuHtml}
            </div>
          </div>
          <p class="annotate-note-text" style="margin-bottom:0;">${reply.body}</p>
        </div>
      </div>
    `;
    return el;
  }

  /** Wire edit + delete on a reply element; persists changes via card._threadId */
  function _wireReplyEl(replyEl, replyId, card, reply) {
    replyEl._replyId = replyId;
    // Only wire interactive handlers for replies the current user owns.
    if (!_isOwner(reply)) return;
    const dropdown = replyEl.querySelector('.annotate-dropdown');
    _wireMenuDropdown(replyEl.querySelector('.annotate-menu-btn'), dropdown);

    // Edit reply
    replyEl.querySelector('.annotate-edit-btn').addEventListener('click', function () {
      dropdown.classList.add('hidden');
      const noteEl      = replyEl.querySelector('.annotate-note-text');
      const currentText = noteEl.textContent;

      const editor = document.createElement('div');
      editor.innerHTML = `
        <textarea class="annotate-reply-composer" style="margin-top:6px;">${currentText}</textarea>
        <div class="annotate-card-actions">
          <button class="annotate-btn-cancel">Cancel</button>
          <button class="annotate-btn-save">Save</button>
        </div>
      `;
      noteEl.replaceWith(editor);
      const ta = editor.querySelector('textarea');
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);

      editor.querySelector('.annotate-btn-save').addEventListener('click', function () {
        const updated = ta.value.trim();
        if (!updated) return;
        if (_db) {
          dbGetThread(_db, card._threadId).then(function (t) {
            if (!t) return;
            const r = t.replies.find(function (x) { return x.id === replyId; });
            if (r) { r.body = updated; r.updatedAt = new Date().toISOString(); t.updatedAt = new Date().toISOString(); t.dirty = true; }
            return dbSaveThread(_db, t).then(function () {
              syncThread(t);
              return logActivity('reply_edited', t.id, replyId, r ? r.author : '', 'edited reply');
            });
          }).catch(function (e) { console.warn('Annotate.js: reply edit persist failed', e); });
        }
        const newNote = document.createElement('p');
        newNote.className = 'annotate-note-text';
        newNote.style.marginBottom = '0';
        newNote.textContent = updated;
        editor.replaceWith(newNote);
      });

      editor.querySelector('.annotate-btn-cancel').addEventListener('click', function () {
        const restored = document.createElement('p');
        restored.className = 'annotate-note-text';
        restored.style.marginBottom = '0';
        restored.textContent = currentText;
        editor.replaceWith(restored);
      });
    });

    // Delete reply
    replyEl.querySelector('.annotate-delete-btn').addEventListener('click', function () {
      if (_db) {
        dbGetThread(_db, card._threadId).then(function (t) {
          if (!t) return;
          const r = t.replies.find(function (x) { return x.id === replyId; });
          if (r) { r.deleted = true; t.updatedAt = new Date().toISOString(); t.dirty = true; }
          return dbSaveThread(_db, t).then(function () {
            syncThread(t);
            return logActivity('reply_deleted', t.id, replyId, r ? r.author : '', 'deleted reply');
          });
        }).catch(function (e) { console.warn('Annotate.js: reply delete persist failed', e); });
      }
      replyEl.remove();
    });
  }

  /**
   * Render the saved-state body of a ThreadCard and wire all interactions.
   * Called both after a fresh save AND when loading threads from IDB on page load.
   */
  function _renderSavedCard(card, thread) {
    card._lastRenderedAt = thread.updatedAt;
    const cardBody = card.querySelector('.annotate-card-body');
    const isOwner = _isOwner(thread);
    // Resolved threads are frozen: Edit AND Delete are hidden for everyone
    // (including the owner) so the record cannot be modified or wiped. Reply
    // is hidden (the conversation is closed). The Resolve button becomes
    // Un-Resolve, open to anyone — sending the thread back to active makes
    // Edit and Delete available again.
    const canModify = isOwner && !thread.resolved;
    const threadMenuHtml = canModify
      ? `<button class="annotate-icon-btn annotate-menu-btn" title="More">${_MENU_SVG}</button>
              <div class="annotate-dropdown hidden">
                <button class="annotate-dropdown-item annotate-edit-btn">Edit</button>
                <button class="annotate-dropdown-item danger annotate-delete-btn">Delete</button>
              </div>`
      : '';
    cardBody.innerHTML = `
      <div class="annotate-meta">
        <div class="annotate-avatar">${_avatarLetter(thread.author)}</div>
        <div class="annotate-meta-right">
          <div class="annotate-author-row">
            <span class="annotate-author">${thread.author}</span>
            <div class="annotate-author-row-right">
              <span class="annotate-timestamp">${relativeTime(new Date(thread.createdAt))}</span>
              ${threadMenuHtml}
            </div>
          </div>
          <p class="annotate-note-text">${thread.body}</p>
          <div class="annotate-action-row">
            ${thread.resolved ? '' : '<button class="annotate-action-btn annotate-reply-trigger">Reply</button>'}
            <button class="annotate-action-btn annotate-resolve-btn">${thread.resolved ? 'Un-Resolve' : 'Resolve'}</button>
          </div>
        </div>
      </div>
    `;

    // Resolve / Un-Resolve — both open to anyone (collaborative action, not
    // gated by ownership). The same button toggles the state based on what
    // the thread currently is.
    cardBody.querySelector('.annotate-resolve-btn').addEventListener('click', function () {
      if (_db) {
        dbGetThread(_db, thread.id).then(function (t) {
          if (!t) return;
          const who = getAuthor();
          const isUnresolve = !!t.resolved;
          if (isUnresolve) {
            t.resolved = false; t.resolvedAt = null; t.resolvedBy = null;
          } else {
            t.resolved = true;  t.resolvedAt = new Date().toISOString(); t.resolvedBy = who;
          }
          t.updatedAt = new Date().toISOString();
          t.dirty = true;
          return dbSaveThread(_db, t).then(function () {
            syncThread(t);
            // When un-resolving from the Resolved tab, the Threads tab will be
            // out of sync until reload: either the original card is still there
            // but dimmed from the prior Resolve click, or it was filtered out by
            // loadThreads on the last page load. Restore it now so the user sees
            // it as soon as they switch back to Threads.
            if (isUnresolve) {
              var mark = _threadMarks[t.id] || null;
              if (mark) mark.classList.remove('is-resolved');
              var threadsCard = sidebarBody.querySelector('[data-thread-id="' + t.id + '"]');
              if (threadsCard) {
                threadsCard.style.opacity = '';
                threadsCard.style.pointerEvents = '';
                _renderSavedCard(threadsCard, t);
                repositionCards();
              } else {
                renderThreadCard(t, mark);
              }
            }
            return logActivity(
              isUnresolve ? 'thread_unresolved' : 'thread_resolved',
              t.id, null, who,
              isUnresolve ? 'un-resolved thread' : 'resolved thread'
            );
          });
        }).catch(function (e) { console.warn('Annotate.js: resolve toggle persist failed', e); });
      }
      card.style.opacity = '0.4';
      card.style.pointerEvents = 'none';
    });

    // Edit + Delete — only wired for the thread owner on non-resolved threads.
    // The menu HTML itself is not rendered when canModify is false, so the
    // querySelectors below would return null without this guard.
    if (canModify) {
      const dropdown = cardBody.querySelector('.annotate-dropdown');
      _wireMenuDropdown(cardBody.querySelector('.annotate-menu-btn'), dropdown);

      // Edit body
      cardBody.querySelector('.annotate-edit-btn').addEventListener('click', function () {
        dropdown.classList.add('hidden');
        const noteEl      = cardBody.querySelector('.annotate-note-text');
        const currentText = noteEl.textContent;

        const editor = document.createElement('div');
        editor.innerHTML = `
          <textarea class="annotate-card-composer" style="margin-top:8px;">${currentText}</textarea>
          <div class="annotate-card-actions">
            <button class="annotate-btn-cancel">Cancel</button>
            <button class="annotate-btn-save">Save</button>
          </div>
        `;
        noteEl.replaceWith(editor);
        const ta = editor.querySelector('textarea');
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);

        editor.querySelector('.annotate-btn-save').addEventListener('click', function () {
          const updated = ta.value.trim();
          if (!updated) return;
          if (_db) {
            dbGetThread(_db, thread.id).then(function (t) {
              if (!t) return;
              t.body = updated; t.updatedAt = new Date().toISOString(); t.dirty = true;
              return dbSaveThread(_db, t).then(function () {
                syncThread(t);
                return logActivity('thread_edited', t.id, null, t.author, 'edited: \'' + updated.slice(0, 40) + '\'');
              });
            }).catch(function (e) { console.warn('Annotate.js: edit persist failed', e); });
          }
          const newNote = document.createElement('p');
          newNote.className = 'annotate-note-text';
          newNote.textContent = updated;
          editor.replaceWith(newNote);
        });

        editor.querySelector('.annotate-btn-cancel').addEventListener('click', function () {
          const restored = document.createElement('p');
          restored.className = 'annotate-note-text';
          restored.textContent = currentText;
          editor.replaceWith(restored);
        });
      });

      // Delete thread
      cardBody.querySelector('.annotate-delete-btn').addEventListener('click', function () {
        if (_db) {
          dbDeleteThread(_db, thread.id)
            .then(function () {
              dbGetThread(_db, thread.id).then(function (t) { if (t) syncThread(t); });
              return logActivity('thread_deleted', thread.id, null, getAuthor(), 'deleted thread');
            })
            .catch(function (e) { console.warn('Annotate.js: delete persist failed', e); });
        }
        if (card._annotationMark) {
          const m = card._annotationMark, p = m.parentNode;
          if (p) { while (m.firstChild) p.insertBefore(m.firstChild, m); p.removeChild(m); }
        }
        card.remove();
        if (!sidebarBody.querySelector('.annotate-card')) emptyMsg.style.display = '';
      });
    } // end canModify

    // Replies — rebuild section (handles both fresh cards and IDB-loaded threads)
    const existing = card.querySelector('.annotate-replies');
    if (existing) existing.remove();

    const replies = document.createElement('div');
    replies.className = 'annotate-replies';

    (thread.replies || []).filter(function (r) { return !r.deleted; }).forEach(function (r) {
      const el = _buildReplyEl(r);
      _wireReplyEl(el, r.id, card, r);
      replies.appendChild(el);
    });

    card.appendChild(replies);

    // Reply trigger only exists on non-resolved cards.
    const replyTrigger = cardBody.querySelector('.annotate-reply-trigger');
    if (replyTrigger) {
      replyTrigger.addEventListener('click', function () {
        openReplyComposer(replies, card);
      });
    }
  }

  /**
   * Create and mount a ThreadCard from a persisted Thread.
   * Used by loadThreads() on page load.
   */
  function renderThreadCard(thread, mark) {
    if (emptyMsg) emptyMsg.style.display = 'none';

    const card = document.createElement('div');
    card.className = 'annotate-card';
    card._threadId = thread.id;
    card.dataset.threadId = thread.id;
    _renderedThreadIds.add(thread.id);

    const unavailableBadge = mark ? '' : ' <span style="font-size:10px;color:#aaa;font-style:normal;">(highlight unavailable)</span>';
    card.innerHTML = `
      <div class="annotate-card-quote">${thread.quote}${unavailableBadge}</div>
      <div class="annotate-card-body"></div>
    `;

    if (mark) {
      card._annotationMark = mark;
      _threadMarks[thread.id] = mark;
      mark.addEventListener('click', function () { openSidebar(); });
    }

    const headerHeight = document.getElementById('annotate-sidebar-header').offsetHeight;
    if (mark) {
      const rect = mark.getBoundingClientRect();
      card._anchorTop = Math.max(0, rect.top + window.scrollY - headerHeight);
    } else {
      card._anchorTop = 8; // fallback — will be pushed below any real cards
    }

    sidebarBody.appendChild(card);
    _renderSavedCard(card, thread);

    if (thread.resolved) {
      card.style.opacity = '0.4';
      card.style.pointerEvents = 'none';
    }

    repositionCards();
    observeCardResize(card);
    return card;
  }

  // --- Panel renderers ---

  /** Resolved tab — flow-layout read-only cards */
  function _renderResolvedTab(db) {
    _panelResolved.innerHTML = '';
    dbGetResolvedThreads(db, _pageUrl).then(function (threads) {
      if (threads.length === 0) {
        _panelResolved.innerHTML = '<div class="annotate-empty-state">No resolved threads yet.</div>';
        return;
      }
      threads.forEach(function (thread) {
        const card = document.createElement('div');
        card.className = 'annotate-resolved-card';
        card._threadId = thread.id;
        card._annotationMark = _threadMarks[thread.id] || null;
        card.innerHTML = `
          <div class="annotate-card-quote">${thread.quote}</div>
          <div class="annotate-card-body"></div>
        `;
        _panelResolved.appendChild(card);
        // _renderSavedCard handles the resolved-state UI:
        // hides Reply + Delete, swaps Resolve label to Un-Resolve.
        _renderSavedCard(card, thread);
      });
    }).catch(function (e) { console.warn('Annotate.js: _renderResolvedTab failed', e); });
  }

  /** Activity tab — chronological event feed */
  function _activityDotColor(type) {
    if (type.includes('deleted'))  return '#dc2626';
    if (type.includes('edited'))   return '#d97706';
    if (type.includes('resolved')) return '#6b7280';
    return '#1a1a1a';
  }

  function _renderActivityTab(db) {
    _panelActivity.innerHTML = '';
    dbGetActivity(db, _pageUrl).then(function (entries) {
      if (entries.length === 0) {
        _panelActivity.innerHTML = '<div class="annotate-empty-state">No activity yet.</div>';
        return;
      }
      const list = document.createElement('div');
      list.className = 'annotate-activity-list';
      entries.forEach(function (entry) {
        const el = document.createElement('div');
        el.className = 'annotate-activity-entry';
        el.innerHTML = `
          <div class="annotate-activity-dot" style="background:${_activityDotColor(entry.type)};"></div>
          <div class="annotate-activity-content">
            <span class="annotate-activity-actor">${entry.actor}</span>
            <div class="annotate-activity-snapshot">${entry.snapshot}</div>
          </div>
          <div class="annotate-activity-time">${relativeTime(new Date(entry.timestamp))}</div>
        `;
        list.appendChild(el);
      });
      _panelActivity.appendChild(list);
    }).catch(function (e) { console.warn('Annotate.js: _renderActivityTab failed', e); });
  }

  /** Settings tab — display name + clear data */
  function _renderSettingsTab() {
    // Hide the bulk-clear button in P2P and server-sync modes. In P2P, wiping
    // local state while peers are online leaves the room inconsistent. In
    // server-sync, per-user clear will be reintroduced once user accounts exist.
    // Only offline / BroadcastChannel mode (no sync URL, no room) shows it.
    var showClearBtn = !_roomId && !_syncUrl;
    var clearGroupHtml = showClearBtn ? `
      <div class="annotate-settings-group">
        <label class="annotate-settings-label">Data</label>
        <button class="annotate-settings-btn-danger" id="annotate-clear-btn">Clear all annotations</button>
        <p class="annotate-settings-hint">Permanently removes all threads and activity for this site.</p>
      </div>` : '';
    var aboutHtml = `
      <div class="annotate-settings-group annotate-about">
        <label class="annotate-settings-label">About</label>
        <div class="annotate-about-row">
          <span class="annotate-about-name">Annotate.js</span>
          <span class="annotate-about-version">${_VERSION === 'dev' ? 'dev' : 'v' + _VERSION}</span>
        </div>
        <div class="annotate-mode-chip-row">
          <span class="annotate-mode-chip" title="Active sync mode">${_syncMode()}</span>
        </div>
        <p class="annotate-settings-hint annotate-privacy-note">${_privacyNote()}</p>
        <a class="annotate-about-link" href="https://github.com/kasunben/Annotate.js"
           target="_blank" rel="noopener">View on GitHub</a>
      </div>`;
    _panelSettings.innerHTML = `
      ${aboutHtml}
      <div class="annotate-settings-group">
        <label class="annotate-settings-label">Display name</label>
        <input class="annotate-settings-input" id="annotate-name-input" type="text"
               value="${getAuthor()}" placeholder="Enter your name…" />
        <p class="annotate-settings-hint">Shown on all your annotations and replies.</p>
      </div>
      ${clearGroupHtml}
    `;

    const nameInput = _panelSettings.querySelector('#annotate-name-input');
    function _saveName() {
      const name = nameInput.value.trim();
      if (name) localStorage.setItem(_AUTHOR_KEY, name);
    }
    nameInput.addEventListener('blur', _saveName);
    nameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { _saveName(); nameInput.blur(); }
    });

    if (!showClearBtn) return; // no clear button in server-sync or P2P modes

    _panelSettings.querySelector('#annotate-clear-btn').addEventListener('click', function () {
      if (!window.confirm('Delete all annotations and activity for this site? This cannot be undone.')) return;
      // This button only renders in offline/BroadcastChannel mode — wipe everything.
      Promise.resolve()
        .then(function () { return dbClearAll(_siteId, _db); })
        .then(function () { window.location.reload(); })
        .catch(function (e) { console.warn('Annotate.js: clearAll failed', e); });
    });
  }

  // ── Sync layer ────────────────────────────────────────────────────────────
  //
  // All functions are no-ops when _syncUrl is null, so existing offline
  // behaviour is preserved when data-sync-url is absent from the script tag.

  /** Unwrap a <mark> element, leaving its text children in place */
  function _unwrapMark(mark) {
    var p = mark.parentNode;
    if (p) { while (mark.firstChild) p.insertBefore(mark.firstChild, mark); p.removeChild(mark); }
  }

  /** Push one activity entry to the server. Fire-and-forget. */
  function syncActivity(entry) {
    // Broadcast to same-origin tabs and P2P peers regardless of server-sync mode.
    if (_bc) _bc.postMessage({ type: 'ACTIVITY_UPDATE', entry: entry });
    _p2pBroadcastActivity(entry);
    if (!_syncUrl) return;
    fetch(_syncUrl + '/activity', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(entry),
    }).catch(function () {});
  }

  /**
   * Pull activity entries from the server since _lastActivitySync, merge into
   * IDB. The Activity tab reads IDB directly, so no re-render is needed here.
   */
  function pullActivity() {
    if (!_syncUrl || !_db) return Promise.resolve();
    var url = _syncUrl + '/activity?siteId=' + encodeURIComponent(_siteId)
            + '&pageUrl=' + encodeURIComponent(_pageUrl)
            + (_lastActivitySync ? '&since=' + encodeURIComponent(_lastActivitySync) : '');
    return fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (entries) {
        if (!entries.length) return;
        var maxTs = _lastActivitySync || '';
        return entries.reduce(function (p, entry) {
          return p.then(function () {
            if (entry.timestamp > maxTs) maxTs = entry.timestamp;
            return dbAddActivity(_db, entry);
          });
        }, Promise.resolve()).then(function () {
          _lastActivitySync = maxTs;
        });
      })
      .catch(function () {});
  }

  /**
   * Push a single thread to the server after a local mutation.
   * Fire-and-forget: clears dirty=false on success, logs a warning on failure.
   * Also broadcasts to same-origin tabs (BroadcastChannel) and P2P peers.
   */
  function syncThread(thread) {
    // Broadcast to same-origin tabs and P2P peers regardless of server-sync mode.
    if (_bc) _bc.postMessage({ type: 'THREAD_UPDATE', thread: thread });
    _p2pBroadcastThread(thread);
    if (!_syncUrl || !_db) return;
    var payload = Object.assign({}, thread);
    delete payload.dirty;
    fetch(_syncUrl + '/threads', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    .then(function (res) {
      if (!res.ok) throw new Error('sync failed: ' + res.status);
      return dbGetThread(_db, thread.id);
    })
    .then(function (t) {
      if (t && t.dirty) { t.dirty = false; return dbSaveThread(_db, t); }
    })
    .catch(function (e) { console.warn('Annotate.js: syncThread failed', e); });
  }

  // ── P2P sync functions ────────────────────────────────────────────────────
  //
  // These functions implement the three-tier P2P signaling strategy:
  //   Tier 1/2 — Custom WebSocket relay (hosted or self-hosted)
  //   Tier 3   — NOSTR signaling via Trystero (automatic fallback)
  //
  // Activated only when data-room-id is present on the script tag.
  // No-ops (and zero overhead) when _roomId is null.

  /** Merge a thread received from any peer into IDB and update the DOM. */
  function _onPeerThread(incoming) {
    if (!_db) return;
    dbGetThread(_db, incoming.id).then(function (existing) {
      if (!existing || incoming.updatedAt > existing.updatedAt) {
        dbSaveThread(_db, incoming).then(function () {
          _rerenderAfterPull([incoming]);
        });
      }
    });
  }

  /** Merge an activity entry received from any peer into IDB. */
  function _onPeerActivity(entry) {
    if (_db) dbAddActivity(_db, entry);
  }

  // ── Relay tier (Tier 1/2): custom WebSocket signaling + RTCPeerConnection ─

  /**
   * Wire up the onmessage handler for a WebRTC data channel.
   * Handles: THREAD, ACTIVITY, REQUEST_STATE, STATE_SNAPSHOT messages.
   */
  function _setupDataChannelMessages(dc) {
    dc.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'THREAD')   { _onPeerThread(msg.thread);   return; }
      if (msg.type === 'ACTIVITY') { _onPeerActivity(msg.entry);  return; }
      if (msg.type === 'REQUEST_STATE') {
        _dbGetByPage(_db, _pageUrl).then(function (threads) {
          if (dc.readyState === 'open')
            dc.send(JSON.stringify({ type: 'STATE_SNAPSHOT', threads: threads }));
        });
        return;
      }
      if (msg.type === 'STATE_SNAPSHOT') {
        var all = msg.threads || [];
        var chain = Promise.resolve();
        all.forEach(function (t) {
          chain = chain.then(function () {
            return dbGetThread(_db, t.id).then(function (existing) {
              if (!existing || t.updatedAt > existing.updatedAt) return dbSaveThread(_db, t);
            });
          });
        });
        chain.then(function () { _rerenderAfterPull(all); });
      }
    };
  }

  /**
   * Create an RTCPeerConnection offer toward a newly-joined peer.
   * Called by the existing peer when the relay signals `peer-joined`.
   */
  function _createRelayOffer(remotePeerId, ws, myPeerId, peers) {
    var pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    var dc = pc.createDataChannel('annotate');
    peers[remotePeerId] = { pc: pc, dc: dc };
    _setupDataChannelMessages(dc);

    pc.onicecandidate = function (ev) {
      if (ev.candidate)
        ws.send(JSON.stringify({ type: 'signal', to: remotePeerId, from: myPeerId,
                                 data: { candidate: ev.candidate } }));
    };
    pc.createOffer()
      .then(function (offer) { return pc.setLocalDescription(offer); })
      .then(function () {
        ws.send(JSON.stringify({ type: 'signal', to: remotePeerId, from: myPeerId,
                                 data: { sdp: pc.localDescription } }));
      })
      .catch(function (e) { console.warn('Annotate.js P2P: offer failed', e); });
  }

  /**
   * Handle an incoming signal message forwarded by the relay (SDP offer/answer
   * or ICE candidate). Creates the answerer RTCPeerConnection on first contact.
   */
  function _handleRelaySignal(msg, ws, myPeerId, peers) {
    var senderId = msg.from;
    var data     = msg.data;

    if (!peers[senderId]) {
      // First contact from this peer — we are the answerer.
      var pc2 = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      peers[senderId] = { pc: pc2, dc: null };

      pc2.ondatachannel = function (ev) {
        peers[senderId].dc = ev.channel;
        _setupDataChannelMessages(ev.channel);
        ev.channel.onopen = function () {
          // As the later joiner, request the existing peer's full state.
          ev.channel.send(JSON.stringify({ type: 'REQUEST_STATE', pageUrl: _pageUrl }));
        };
      };
      pc2.onicecandidate = function (ev) {
        if (ev.candidate)
          ws.send(JSON.stringify({ type: 'signal', to: senderId, from: myPeerId,
                                   data: { candidate: ev.candidate } }));
      };
    }

    var pc = peers[senderId].pc;
    if (data.sdp) {
      if (data.sdp.type === 'offer') {
        pc.setRemoteDescription(data.sdp)
          .then(function () { return pc.createAnswer(); })
          .then(function (ans) { return pc.setLocalDescription(ans); })
          .then(function () {
            ws.send(JSON.stringify({ type: 'signal', to: senderId, from: myPeerId,
                                     data: { sdp: pc.localDescription } }));
          })
          .catch(function (e) { console.warn('Annotate.js P2P: answer failed', e); });
      } else if (data.sdp.type === 'answer') {
        pc.setRemoteDescription(data.sdp).catch(function () {});
      }
    }
    if (data.candidate) {
      pc.addIceCandidate(data.candidate).catch(function () {});
    }
  }

  /**
   * Tier 1/2: connect to the hosted or self-hosted WebSocket relay and establish
   * per-peer RTCPeerConnections for annotation data.
   *
   * Calls onConnected() once the WebSocket opens successfully (so initP2P can
   * cancel the NOSTR fallback timer). Calls onFailure() on connection error.
   */
  function _initRelayP2P(relayUrl, onConnected, onFailure) {
    var myPeerId = generateId();
    var peers    = {};
    var ws;

    try {
      ws = new WebSocket(relayUrl + '/room/' + encodeURIComponent(_roomId));
    } catch (e) {
      onFailure(e);
      return;
    }

    ws.onopen = function () {
      onConnected();
      ws.send(JSON.stringify({ type: 'join', room: _roomId, peerId: myPeerId }));
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'peer-joined') _createRelayOffer(msg.peerId, ws, myPeerId, peers);
      if (msg.type === 'signal')      _handleRelaySignal(msg, ws, myPeerId, peers);
      if (msg.type === 'peer-left' && peers[msg.peerId]) {
        peers[msg.peerId].pc.close(); delete peers[msg.peerId];
      }
    };
    ws.onerror = function (e) { onFailure(e); };
    ws.onclose = function (ev) {
      if (!ev.wasClean) {
        console.warn('Annotate.js P2P: relay disconnected — falling back to NOSTR');
        _initNostrP2P();
      }
    };

    _p2pBroadcastThread = function (t) {
      Object.keys(peers).forEach(function (pid) {
        var p = peers[pid];
        if (p.dc && p.dc.readyState === 'open')
          p.dc.send(JSON.stringify({ type: 'THREAD', thread: t }));
      });
    };
    _p2pBroadcastActivity = function (e) {
      Object.keys(peers).forEach(function (pid) {
        var p = peers[pid];
        if (p.dc && p.dc.readyState === 'open')
          p.dc.send(JSON.stringify({ type: 'ACTIVITY', entry: e }));
      });
    };
  }

  // ── NOSTR tier (Tier 3): Trystero fallback ─────────────────────────────────

  /**
   * Tier 3: use NOSTR relay network (via Trystero) for signaling.
   * Bundled at build time by esbuild — zero runtime network fetch for the library.
   * Used automatically when the relay is unreachable.
   */
  function _initNostrP2P() {
    // _trysteroJoin is only available in the bundled build (annotate.min.js).
    // When the raw source is loaded directly it is undefined — fail gracefully.
    if (typeof _trysteroJoin !== 'function') {
      console.warn('Annotate.js P2P: NOSTR fallback requires the bundled build (annotate.min.js). Raw annotate.js does not include Trystero.');
      return;
    }
    var room;
    try {
      room = _trysteroJoin({ appId: _siteId }, _roomId);
    } catch (e) {
      console.warn('Annotate.js P2P: NOSTR init failed', e);
      return;
    }

    var threadPair   = room.makeAction('thread');
    var activityPair = room.makeAction('activity');
    var requestPair  = room.makeAction('request');
    var snapshotPair = room.makeAction('snapshot');

    var sendThread   = threadPair[0],   getThread   = threadPair[1];
    var sendActivity = activityPair[0], getActivity = activityPair[1];
    var sendRequest  = requestPair[0],  getRequest  = requestPair[1];
    var sendSnapshot = snapshotPair[0], getSnapshot = snapshotPair[1];

    getThread(function (data)   { _onPeerThread(data); });
    getActivity(function (data) { _onPeerActivity(data); });
    getRequest(function (data, peerId) {
      _dbGetByPage(_db, _pageUrl).then(function (threads) {
        sendSnapshot({ threads: threads }, [peerId]);
      });
    });
    getSnapshot(function (data) {
      var all = data.threads || [];
      var chain = Promise.resolve();
      all.forEach(function (t) {
        chain = chain.then(function () {
          return dbGetThread(_db, t.id).then(function (existing) {
            if (!existing || t.updatedAt > existing.updatedAt) return dbSaveThread(_db, t);
          });
        });
      });
      chain.then(function () { _rerenderAfterPull(all); });
    });

    room.onPeerJoin(function (peerId) {
      // As the later-joining peer, request state from the existing peer.
      sendRequest({ pageUrl: _pageUrl }, [peerId]);
    });

    _p2pBroadcastThread   = function (t) { sendThread(t); };
    _p2pBroadcastActivity = function (e) { sendActivity(e); };
  }

  // ── P2P entry point ────────────────────────────────────────────────────────

  /**
   * Initialise P2P mode. Tries the hosted/self-hosted relay first; falls back
   * to NOSTR automatically if the relay is unreachable within 5 seconds.
   * No-op when data-room-id is absent.
   */
  function initP2P() {
    if (!_roomId || !_db) return;

    // Warn immediately if Trystero is not available (raw source loaded directly).
    // All three signaling tiers will fail: the hosted relay is not yet deployed
    // (Tier 1 fails), and the NOSTR fallback requires Trystero (Tier 3 fails).
    // P2P mode requires the bundled build — use annotate.min.js, not annotate.js.
    if (typeof _trysteroJoin !== 'function') {
      console.warn(
        'Annotate.js P2P: data-room-id is set but Trystero is not available. ' +
        'P2P mode requires the bundled build (annotate.min.js). ' +
        'The raw source (annotate.js) does not include Trystero — all signaling tiers will fail. ' +
        'Annotations will save locally only and will not reach other peers.'
      );
    }

    var settled       = false;
    var fallbackTimer = setTimeout(function () {
      if (!settled) { settled = true; _initNostrP2P(); }
    }, 5000);

    _initRelayP2P(
      _relayUrl,
      /* onConnected */ function () {
        // Relay WebSocket opened — cancel the NOSTR fallback.
        if (!settled) { settled = true; clearTimeout(fallbackTimer); }
      },
      /* onFailure */ function () {
        if (!settled) { settled = true; clearTimeout(fallbackTimer); _initNostrP2P(); }
      }
    );
  }

  /**
   * Apply a delta of server threads to the DOM without a full page reload.
   * Called after every successful pull. Only re-renders what actually changed.
   */
  function _rerenderAfterPull(serverThreads) {
    serverThreads.forEach(function (st) {
      var existingCard = sidebarBody.querySelector('[data-thread-id="' + st.id + '"]');
      var existingMark = _threadMarks[st.id];

      // Deleted on server — remove card and/or mark from DOM
      if (st.deletedAt) {
        if (existingCard) {
          if (existingCard._annotationMark) _unwrapMark(existingCard._annotationMark);
          existingCard.remove();
          _renderedThreadIds.delete(st.id);
        } else if (existingMark) {
          _unwrapMark(existingMark);
        }
        delete _threadMarks[st.id];
        return;
      }

      // Resolved — dim the active card if still shown; ensure mark has .is-resolved
      if (st.resolved) {
        if (existingCard) {
          existingCard.style.opacity      = '0.4';
          existingCard.style.pointerEvents = 'none';
          _renderedThreadIds.delete(st.id);
        }
        if (existingMark) {
          existingMark.classList.add('is-resolved');
        } else if (st.anchor) {
          var rr = restoreRange(st.anchor);
          if (rr) {
            var rm = highlightRange(rr);
            rm.classList.add('is-resolved');
            rm.addEventListener('click', function () { openSidebar(); _switchTab('Resolved'); });
            _threadMarks[st.id] = rm;
          }
        }
        return;
      }

      // New active thread from another user — render a fresh card.
      // Guard: if the id is already tracked (e.g. a locally-created card), skip
      // to avoid duplicating a thread we already rendered.
      if (!existingCard) {
        if (_renderedThreadIds.has(st.id)) return;
        var nr = st.anchor ? restoreRange(st.anchor) : null;
        var nm = nr ? highlightRange(nr) : null;
        renderThreadCard(st, nm);
        return;
      }

      // Updated active thread — re-render only if updatedAt changed and no composer is open
      if (st.updatedAt !== existingCard._lastRenderedAt &&
          !existingCard.querySelector('.annotate-card-composer') &&
          !existingCard.querySelector('.annotate-reply-composer')) {
        _renderSavedCard(existingCard, st);
      }
    });

    if (!sidebarBody.querySelector('.annotate-card') && emptyMsg) {
      emptyMsg.style.display = '';
    }
  }

  /**
   * Fetch threads updated since _lastSync from the server, merge into IDB,
   * and update the DOM delta. Runs on load, on tab focus, and every 30 s.
   */
  function pullThreads() {
    if (!_syncUrl || !_db) return;
    var since = _lastSync ? ('&since=' + encodeURIComponent(_lastSync)) : '';
    var url   = _syncUrl + '/threads?siteId=' + encodeURIComponent(_siteId)
              + '&pageUrl=' + encodeURIComponent(_pageUrl) + since;
    fetch(url)
    .then(function (res) { return res.ok ? res.json() : Promise.reject('pull failed: ' + res.status); })
    .then(function (serverThreads) {
      // Update _lastSync to the server's latest updatedAt (avoids client clock skew)
      serverThreads.forEach(function (st) {
        if (!_lastSync || st.updatedAt > _lastSync) _lastSync = st.updatedAt;
      });
      // Merge into IDB: server wins unless local record is dirty (pending push)
      return Promise.all(serverThreads.map(function (st) {
        return dbGetThread(_db, st.id).then(function (local) {
          if (local && local.dirty) return; // local mutation not yet pushed — skip
          st.dirty = false;
          return dbSaveThread(_db, st);
        });
      })).then(function () { _rerenderAfterPull(serverThreads); });
    })
    .catch(function (e) { console.warn('Annotate.js: pullThreads failed', e); });
  }

  /**
   * Push any locally-mutated threads that never made it to the server.
   * Called once on startup to recover from offline sessions.
   */
  function flushDirtyThreads() {
    if (!_syncUrl || !_db) return;
    _dbGetByPage(_db, _pageUrl).then(function (all) {
      all.filter(function (t) { return t.dirty; }).forEach(syncThread);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────

  /** Load all threads for this page, render active ones as cards, restore all highlights */
  function loadThreads(db) {
    return Promise.all([
      dbGetThreads(db, _pageUrl),
      dbGetResolvedThreads(db, _pageUrl),
    ]).then(function (results) {
      const active   = results[0];
      const resolved = results[1];

      // Active threads → full ThreadCards in the Threads panel
      if (active.length > 0 && emptyMsg) emptyMsg.style.display = 'none';
      active.forEach(function (thread) {
        const range = thread.anchor ? restoreRange(thread.anchor) : null;
        const mark  = range ? highlightRange(range) : null;
        renderThreadCard(thread, mark);
      });

      // Resolved threads → restore highlight only (card rendered on Resolved tab open)
      resolved.forEach(function (thread) {
        const range = thread.anchor ? restoreRange(thread.anchor) : null;
        const mark  = range ? highlightRange(range) : null;
        if (mark) {
          mark.classList.add('is-resolved');
          mark.addEventListener('click', function () {
            openSidebar();
            _switchTab('Resolved');
          });
          _threadMarks[thread.id] = mark;
        }
      });
    }).catch(function (e) { console.warn('Annotate.js: loadThreads failed', e); });
  }

  // --- New annotation card (composer → save → _renderSavedCard) ---
  function addAnnotationCard(selectedText, range) {
    if (emptyMsg) emptyMsg.style.display = 'none';

    const card = document.createElement('div');
    card.className = 'annotate-card';
    card.innerHTML = `
      <div class="annotate-card-quote">${selectedText}</div>
      <div class="annotate-card-body">
        <textarea class="annotate-card-composer" placeholder="Add a note…"></textarea>
        <div class="annotate-card-actions">
          <button class="annotate-btn-cancel">Cancel</button>
          <button class="annotate-btn-save">Save</button>
        </div>
      </div>
    `;

    const headerHeight = document.getElementById('annotate-sidebar-header').offsetHeight;
    let pendingTop = 8;
    if (range) {
      const rect = range.getBoundingClientRect();
      pendingTop = Math.max(0, rect.top + window.scrollY - headerHeight);
    }
    sidebarBody.appendChild(card);
    card._anchorTop = pendingTop;
    repositionCards();
    observeCardResize(card);

    const textarea  = card.querySelector('.annotate-card-composer');
    const saveBtn   = card.querySelector('.annotate-btn-save');
    const cancelBtn = card.querySelector('.annotate-btn-cancel');

    setTimeout(function () { textarea.focus(); }, 50);

    saveBtn.addEventListener('click', function () {
      const body = textarea.value.trim();
      if (!body) return;

      const author = ensureAuthor();
      const now    = new Date().toISOString();

      // ⚠️ Serialize BEFORE highlightRange — surroundContents mutates the DOM
      const anchor = range ? serializeRange(range) : null;
      const mark   = range ? highlightRange(range) : null;

      if (mark) {
        card._annotationMark = mark;
        const markTop = Math.max(0, mark.getBoundingClientRect().top + window.scrollY - headerHeight);
        card._anchorTop = markTop;
        repositionCards();
      }

      const thread = {
        id:         generateId(),
        siteId:     _siteId,
        pageUrl:    _pageUrl,
        quote:      selectedText,
        anchor:     anchor,
        body:       body,
        author:     author,
        authorId:   _authorId,
        createdAt:  now,
        updatedAt:  now,
        resolved:   false,
        resolvedAt: null,
        resolvedBy: null,
        replies:    [],
        dirty:      true,
        deletedAt:  null,
      };

      // Register card identity exactly as renderThreadCard does, so the next
      // pull recognises this thread as already-rendered and does not create a
      // duplicate. Without dataset.threadId, _rerenderAfterPull's querySelector
      // misses this card and re-renders it as a "new" thread.
      card._threadId = thread.id;
      card.dataset.threadId = thread.id;
      _renderedThreadIds.add(thread.id);

      if (_db) {
        dbSaveThread(_db, thread)
          .then(function () {
            syncThread(thread);
            return logActivity('thread_created', thread.id, null, author, 'created: \'' + body.slice(0, 40) + '\'');
          })
          .catch(function (e) { console.warn('Annotate.js: save failed', e); });
      }

      _renderSavedCard(card, thread);
    });

    cancelBtn.addEventListener('click', function () {
      card.remove();
      if (!sidebarBody.querySelector('.annotate-card')) emptyMsg.style.display = '';
    });
  }

  // --- Reply composer (appends to replies div, persists via card._threadId) ---
  function openReplyComposer(replies, card) {
    if (replies.querySelector('.annotate-reply-composer')) return;

    const composerWrap = document.createElement('div');
    composerWrap.className = 'annotate-reply-action';
    composerWrap.innerHTML = `
      <textarea class="annotate-reply-composer" placeholder="Reply…"></textarea>
      <div class="annotate-card-actions">
        <button class="annotate-btn-cancel">Cancel</button>
        <button class="annotate-btn-save">Reply</button>
      </div>
    `;
    replies.appendChild(composerWrap);

    const textarea = composerWrap.querySelector('.annotate-reply-composer');
    setTimeout(function () { textarea.focus(); }, 50);

    composerWrap.querySelector('.annotate-btn-save').addEventListener('click', function () {
      const text = textarea.value.trim();
      if (!text) return;

      const author = ensureAuthor();
      const reply  = {
        id:        generateId(),
        body:      text,
        author:    author,
        authorId:  _authorId,
        createdAt: new Date().toISOString(),
        updatedAt: null,
        deleted:   false,
      };

      if (_db) {
        dbGetThread(_db, card._threadId).then(function (t) {
          if (!t) return;
          t.replies.push(reply);
          t.updatedAt = new Date().toISOString();
          t.dirty = true;
          return dbSaveThread(_db, t).then(function () {
            syncThread(t);
            return logActivity('reply_added', t.id, reply.id, author, 'replied: \'' + text.slice(0, 40) + '\'');
          });
        }).catch(function (e) { console.warn('Annotate.js: reply persist failed', e); });
      }

      const replyEl = _buildReplyEl(reply);
      _wireReplyEl(replyEl, reply.id, card, reply);
      replies.insertBefore(replyEl, composerWrap);
      composerWrap.remove();
    });

    composerWrap.querySelector('.annotate-btn-cancel').addEventListener('click', function () {
      composerWrap.remove();
    });
  }

  // --- Floating annotation button ---
  const commentBtn = document.createElement('button');
  commentBtn.id = 'annotate-comment-btn';
  commentBtn.title = 'Add a comment';
  commentBtn.classList.add('hidden');
  commentBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M7 11h10"/><path d="M7 15h6"/><path d="M7 7h8"/></svg>';
  document.documentElement.appendChild(commentBtn);

  let lastSelectedText = '';
  let lastSelectedRange = null;

  function hideCommentBtn() {
    commentBtn.classList.add('hidden');
    lastSelectedText = '';
    lastSelectedRange = null;
  }

  document.addEventListener('mouseup', function (e) {
    if (sidebar.contains(e.target) || commentBtn.contains(e.target)) return;

    // If clicking on highlighted text, open the sidebar instead
    if (e.target.closest('.annotate-highlight')) {
      openSidebar();
      return;
    }

    const selection = window.getSelection();
    const selectedText = selection ? selection.toString().trim() : '';
    if (!selectedText) return;

    lastSelectedText = selectedText;
    lastSelectedRange = selection.getRangeAt(0).cloneRange();

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const btnSize = 28;
    let x = rect.left + (rect.width / 2) - (btnSize / 2);
    let y = rect.top - btnSize - 6;

    if (x < 8) x = 8;
    if (x + btnSize > window.innerWidth - 8) x = window.innerWidth - btnSize - 8;

    commentBtn.style.left = x + 'px';
    commentBtn.style.top = y + 'px';
    commentBtn.classList.remove('hidden');
  });

  commentBtn.addEventListener('click', function () {
    const text = lastSelectedText;
    const range = lastSelectedRange;
    hideCommentBtn();
    openSidebar();
    addAnnotationCard(text, range);
  });

  document.addEventListener('mousedown', function (e) {
    if (!commentBtn.contains(e.target)) {
      hideCommentBtn();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hideCommentBtn();
  });

  // ── Initialise ────────────────────────────────────────────────────────────
  openDB(_siteId)
    .then(function (db) {
      _db = db;
      return loadThreads(db);
    })
    .then(function () {
      if (_syncUrl) {
        pullThreads();
        pullActivity();
        flushDirtyThreads();
        setInterval(function () { pullThreads(); pullActivity(); }, 30000);
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible') { pullThreads(); pullActivity(); }
        });
      }
      if (_roomId) { initP2P(); }
    })
    .catch(function (err) {
      console.warn('Annotate.js: IndexedDB unavailable — running in memory-only mode', err);
    });

})();
