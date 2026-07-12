require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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
      console.log('Database connected and table ready.');
      return;
    } catch (err) {
      attempt++;
      console.log(`DB not ready (attempt ${attempt}/${maxRetries}). Retrying in 3s...`);
      await new Promise((res) => setTimeout(res, 3000));
    }
  }

  console.error('Could not connect to database after maximum retries.');
  process.exit(1);
}

app.get('/', (req, res) => {
  res.json({ message: 'Backend is running' });
});

app.get('/health', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    res.status(200).json({ db: 'connected' });
  } catch (err) {
    console.error('Health check failed:', err.message);
    res.status(500).json({ db: 'disconnected', error: err.message });
  }
});

app.get('/items', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, created_at FROM items ORDER BY created_at DESC'
    );
    res.status(200).json(rows);
  } catch (err) {
    console.error('GET /items error:', err.message);
    res.status(500).json({ error: 'Failed to fetch items', detail: err.message });
  }
});

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
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /items error:', err.message);
    res.status(500).json({ error: 'Failed to create item', detail: err.message });
  }
});

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on 0.0.0.0:${PORT}`);
  });
});
