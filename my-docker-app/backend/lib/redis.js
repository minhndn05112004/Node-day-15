const { createClient } = require('redis');

const client = createClient({
  url: process.env.REDIS_URL || 'redis://app-redis:6379',
});

client.on('error', (err) => {
  console.error('[Redis] Client error:', err.message);
});

client.on('connect', () => {
  console.log('[Redis] Connected to Redis server.');
});

// Connect immediately and export the promise so callers can await it
const connectPromise = client.connect();

module.exports = { client, connectPromise };
