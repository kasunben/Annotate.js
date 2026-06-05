module.exports = {
  apps: [{
    name: 'annotate',
    script: 'server/index.js',
    instances: 1,              // SQLite is single-writer — do not increase
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
  }],
};
