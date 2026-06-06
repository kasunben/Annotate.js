'use strict';

// Guard: node:sqlite requires Node.js >= 22.5 (experimental) or >= 23 (stable)
const nodeVersion = process.versions.node.split('.').map(Number);
const major = nodeVersion[0];
const minor = nodeVersion[1];
if (major < 23 && (major < 22 || minor < 5)) {
  console.error(
    'Annotate.js server requires Node.js >= 22.5 (or >= 23 for stable support).\n' +
    'The server uses the built-in node:sqlite module which is not available in earlier versions.\n' +
    'Current version: ' + process.versions.node + '\n' +
    'Please upgrade: https://nodejs.org/'
  );
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

// Serve demo/ and assets/ from the project root
app.use(express.static(path.join(__dirname, '..')));

app.use('/threads', require('./routes/threads'));
app.use('/activity', require('./routes/activity'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log('Annotate server running on http://localhost:' + PORT);
  console.log('Demo (Offline + BroadcastChannel): http://localhost:' + PORT + '/demo/demo.html');
  console.log('Demo (P2P): http://localhost:' + PORT + '/demo/demo-p2p.html');
  console.log('Demo ( Server sync ): http://localhost:' + PORT + '/demo/demo-sync-with-server.html');
});
