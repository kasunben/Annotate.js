'use strict';

// DATABASE_PATH=:memory: is injected by vitest.config env for every fork.
// Each forked test-file process gets a fresh require cache → fresh db singleton
// → isolated in-memory SQLite. Tests within the same file share that db.

const express = require('express');
const cors    = require('cors');

function createTestApp() {
  const threadsRouter  = require('../../server/routes/threads');
  const activityRouter = require('../../server/routes/activity');

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/threads',  threadsRouter);
  app.use('/activity', activityRouter);
  return app;
}

function getDb() {
  return require('../../server/db').db;
}

function clearDb() {
  const db = getDb();
  db.exec('DELETE FROM threads');
  db.exec('DELETE FROM activity');
}

module.exports = { createTestApp, getDb, clearDb };
