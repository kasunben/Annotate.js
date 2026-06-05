'use strict';

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();

app.use(cors());
app.use(express.json());

// Serve demo/ and assets/ from the project root
app.use(express.static(path.join(__dirname, '..')));

app.use('/threads', require('./routes/threads'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log('Annotate server running on http://localhost:' + PORT);
  console.log('Demo: http://localhost:' + PORT + '/demo/demo.html');
});
