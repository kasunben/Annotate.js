'use strict';

const { randomUUID } = require('crypto');

function makeThread(overrides = {}) {
  const now = new Date().toISOString();
  const defaults = {
    id:         randomUUID(),
    siteId:     'test-site',
    pageUrl:    'http://localhost:3000/test',
    quote:      'selected text',
    anchor:     { xpath: '//p[1]/text()', startOffset: 0, endOffset: 13 },
    body:       'test body',
    author:     'Test User',
    authorId:   randomUUID(),
    createdAt:  now,
    updatedAt:  now,
    resolved:   false,
    resolvedAt: null,
    resolvedBy: null,
    replies:    [],
    dirty:      false,
    deletedAt:  null,
  };
  return Object.assign({}, defaults, overrides);
}

function makeReply(overrides = {}) {
  const defaults = {
    id:        randomUUID(),
    body:      'test reply',
    author:    'Test User',
    authorId:  randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: null,
    deleted:   false,
  };
  return Object.assign({}, defaults, overrides);
}

function makeActivity(overrides = {}) {
  const defaults = {
    id:        randomUUID(),
    siteId:    'test-site',
    pageUrl:   'http://localhost:3000/test',
    type:      'thread_created',
    threadId:  randomUUID(),
    replyId:   null,
    actor:     'Test User',
    timestamp: new Date().toISOString(),
    snapshot:  "created: 'test body'",
  };
  return Object.assign({}, defaults, overrides);
}

module.exports = { makeThread, makeReply, makeActivity };
