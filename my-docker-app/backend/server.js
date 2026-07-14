require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { client: redisClient, connectPromise: redisReady } = require('./lib/redis');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey';

// Cache TTL in seconds
const CACHE_TTL = 60;

// Cache keys
const CACHE_KEY_ALL = 'items:getAll';
const cacheKeyOne = (id) => `items:getOne:${id}`;

// Blacklist key prefix
const blacklistKey = (token) => `blacklist:${token}`;

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
// MySQL Pool
// ─────────────────────────────────────────────
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'db',
  user: process.env.DB_USER || 'appuser',
  password: process.env.DB_PASSWORD || 'apppassword',
  database: process.env.DB_NAME || 'appdb',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function initDB() {
  const maxRetries = 10;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const conn = await pool.getConnection();
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS items (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      conn.release();
      console.log('[DB] Database connected and table ready.');
      return;
    } catch (err) {
      attempt++;
      console.log(`[DB] Not ready (attempt ${attempt}/${maxRetries}). Retrying in 3s...`);
      await new Promise((res) => setTimeout(res, 3000));
    }
  }

  console.error('[DB] Could not connect after maximum retries.');
  process.exit(1);
}

// ─────────────────────────────────────────────
// Auth Middleware (optional – protects routes that need it)
// ─────────────────────────────────────────────
async function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }

  const token = authHeader.slice(7);

  // Verify JWT signature & expiry
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  // Check Redis blacklist
  const isBlacklisted = await redisClient.get(blacklistKey(token));
  if (isBlacklisted) {
    return res.status(401).json({ error: 'Token has been revoked (logged out).' });
  }

  req.user = decoded;
  next();
}

// ─────────────────────────────────────────────
// Routes — Health & Root
// ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ message: 'Backend is running' });
});

app.get('/health', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    const redisPong = await redisClient.ping();
    res.status(200).json({ db: 'connected', redis: redisPong === 'PONG' ? 'connected' : 'error' });
  } catch (err) {
    console.error('[Health] Check failed:', err.message);
    res.status(500).json({ db: 'disconnected', error: err.message });
  }
});

// ─────────────────────────────────────────────
// Auth Routes — Login / Logout
// ─────────────────────────────────────────────

/**
 * POST /auth/login
 * Demo login — accepts any username/password, issues a JWT valid for 1 hour.
 */
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '`username` and `password` are required.' });
  }

  // In a real app you would verify credentials against the database.
  // Here we issue a token for any non-empty credentials for demo purposes.
  const payload = { sub: username, iat: Math.floor(Date.now() / 1000) };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });

  console.log(`[Auth] User "${username}" logged in.`);
  res.status(200).json({ token, expiresIn: '1h' });
});

/**
 * POST /auth/logout
 * Adds the token to the Redis blacklist with the exact remaining TTL.
 */
app.post('/auth/logout', authenticate, async (req, res) => {
  const token = req.headers['authorization'].slice(7);

  // Calculate remaining lifetime of the token
  const decoded = jwt.decode(token);
  const expiresAt = decoded.exp; // Unix timestamp (seconds)
  const now = Math.floor(Date.now() / 1000);
  const remainingTTL = expiresAt - now;

  if (remainingTTL > 0) {
    await redisClient.set(blacklistKey(token), '1', { EX: remainingTTL });
    console.log(`[Auth] Token blacklisted for ${remainingTTL}s.`);
  }

  res.status(200).json({ message: 'Logged out successfully.' });
});

// ─────────────────────────────────────────────
// Items Routes — GET /items (with cache)
// ─────────────────────────────────────────────

/**
 * GET /items
 * Task 2: 3-step cache logic for list endpoint.
 * Cache key: items:getAll  |  TTL: 60s
 */
app.get('/items', async (req, res) => {
  try {
    // Step 1: Read from cache
    const cached = await redisClient.get(CACHE_KEY_ALL);
    if (cached) {
      console.log('[Cache] GET /items → from redis');
      return res.status(200).json(JSON.parse(cached));
    }

    // Step 2: Cache miss — read from database
    console.log('[Cache] GET /items → from database');
    const [rows] = await pool.execute(
      'SELECT id, name, created_at FROM items ORDER BY created_at DESC'
    );

    // Step 3: Write result into cache with expiry
    await redisClient.set(CACHE_KEY_ALL, JSON.stringify(rows), { EX: CACHE_TTL });

    res.status(200).json(rows);
  } catch (err) {
    console.error('[GET /items] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch items', detail: err.message });
  }
});

/**
 * GET /items/:id
 * Task 3: Cache for individual item.
 * Cache key: items:getOne:<id>  |  TTL: 60s
 */
app.get('/items/:id', async (req, res) => {
  const { id } = req.params;
  const key = cacheKeyOne(id);

  try {
    // Step 1: Read from cache
    const cached = await redisClient.get(key);
    if (cached) {
      console.log(`[Cache] GET /items/${id} → from redis`);
      return res.status(200).json(JSON.parse(cached));
    }

    // Step 2: Cache miss — read from database
    console.log(`[Cache] GET /items/${id} → from database`);
    const [rows] = await pool.execute(
      'SELECT id, name, created_at FROM items WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: `Item ${id} not found.` });
    }

    // Step 3: Write result into cache with expiry
    await redisClient.set(key, JSON.stringify(rows[0]), { EX: CACHE_TTL });

    res.status(200).json(rows[0]);
  } catch (err) {
    console.error(`[GET /items/${id}] Error:`, err.message);
    res.status(500).json({ error: 'Failed to fetch item', detail: err.message });
  }
});

// ─────────────────────────────────────────────
// Items Routes — POST /items (create + invalidate list cache)
// ─────────────────────────────────────────────

/**
 * POST /items
 * Task 4: After creating a new item, invalidate the list cache so the
 * next GET /items fetches fresh data from the database.
 */
app.post('/items', async (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: '`name` field is required and must be a non-empty string.' });
  }

  try {
    const [result] = await pool.execute(
      'INSERT INTO items (name) VALUES (?)',
      [name.trim()]
    );
    const [rows] = await pool.execute('SELECT * FROM items WHERE id = ?', [result.insertId]);

    // Cache invalidation: new item must appear in the list
    await redisClient.del(CACHE_KEY_ALL);
    console.log(`[Cache] POST /items → deleted cache key "${CACHE_KEY_ALL}"`);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /items] Error:', err.message);
    res.status(500).json({ error: 'Failed to create item', detail: err.message });
  }
});

// ─────────────────────────────────────────────
// Items Routes — PUT /items/:id (update + invalidate)
// ─────────────────────────────────────────────

/**
 * PUT /items/:id
 * Task 4: After updating, invalidate both the list cache and the item's
 * own detail cache so stale data is never served.
 */
app.put('/items/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: '`name` field is required and must be a non-empty string.' });
  }

  try {
    const [result] = await pool.execute(
      'UPDATE items SET name = ? WHERE id = ?',
      [name.trim(), id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: `Item ${id} not found.` });
    }

    const [rows] = await pool.execute('SELECT * FROM items WHERE id = ?', [id]);

    // Cache invalidation: remove stale list cache and stale detail cache
    await redisClient.del(CACHE_KEY_ALL);
    await redisClient.del(cacheKeyOne(id));
    console.log(`[Cache] PUT /items/${id} → deleted "${CACHE_KEY_ALL}" and "${cacheKeyOne(id)}"`);

    res.status(200).json(rows[0]);
  } catch (err) {
    console.error(`[PUT /items/${id}] Error:`, err.message);
    res.status(500).json({ error: 'Failed to update item', detail: err.message });
  }
});

// ─────────────────────────────────────────────
// Items Routes — DELETE /items/:id (delete + invalidate)
// ─────────────────────────────────────────────

/**
 * DELETE /items/:id
 * Task 4: After deleting, invalidate both the list cache and the item's
 * own detail cache.
 */
app.delete('/items/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.execute('DELETE FROM items WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: `Item ${id} not found.` });
    }

    // Cache invalidation: deleted item must disappear from list; its detail is now invalid
    await redisClient.del(CACHE_KEY_ALL);
    await redisClient.del(cacheKeyOne(id));
    console.log(`[Cache] DELETE /items/${id} → deleted "${CACHE_KEY_ALL}" and "${cacheKeyOne(id)}"`);

    res.status(200).json({ message: `Item ${id} deleted successfully.` });
  } catch (err) {
    console.error(`[DELETE /items/${id}] Error:`, err.message);
    res.status(500).json({ error: 'Failed to delete item', detail: err.message });
  }
});

// ─────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────
async function bootstrap() {
  await redisReady; // Wait for Redis connection
  console.log('[Bootstrap] Redis ready.');

  await initDB(); // Wait for MySQL

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Bootstrap] Server listening on 0.0.0.0:${PORT}`);
  });
}

bootstrap();
