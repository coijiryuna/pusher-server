module.exports = {
  apps: [
    {
      name: 'pusher-soketi',
      script: 'node',
      args: 'index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'pusher-admin',
      script: 'node',
      args: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        API_PORT: 9000
      }
    }
  ]
};