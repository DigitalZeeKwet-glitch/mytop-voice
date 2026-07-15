import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { EdgeTTS } from 'edge-tts-universal';
import pg from 'pg';
import jwt from 'jsonwebtoken';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Resolve static paths in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// PostgreSQL Database Connection Pool
const { Pool } = pg;
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:mysecretpassword@localhost:5432/postgres';

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Admin session JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'mytop-voice-admin-secret-key-12345';

// Database Initialization (Schema Creation, Legacy Data Migration & Admin Credentials Seeding)
async function initDatabase() {
  try {
    console.log('Connecting to PostgreSQL database...');

    // Create the admin_credentials table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_credentials (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(100) NOT NULL
      )
    `);
    console.log('PostgreSQL database check: admin_credentials table is ready.');

    // Seed default credentials if table is empty
    const adminCheck = await pool.query('SELECT COUNT(*) FROM admin_credentials');
    if (parseInt(adminCheck.rows[0].count) === 0) {
      const defaultUser = process.env.ADMIN_USERNAME || 'admin';
      const defaultPass = process.env.ADMIN_PASSWORD || 'admin123';
      await pool.query('INSERT INTO admin_credentials (username, password) VALUES ($1, $2)', [defaultUser, defaultPass]);
      console.log(`Seeded default admin credentials in PostgreSQL: ${defaultUser}`);
    }

    // Create the vip_users table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vip_users (
        password VARCHAR(100) PRIMARY KEY,
        expiry_date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('PostgreSQL database check: vip_users table is ready.');

    // Seed/migrate default legacy VIP users if defined
    let legacyVipUsers = {
      "000123": "2026-12-15"
    };

    if (process.env.VIP_USERS) {
      try {
        legacyVipUsers = JSON.parse(process.env.VIP_USERS);
        console.log('Successfully parsed VIP_USERS environment variable for migration.');
      } catch (err) {
        console.error('Failed to parse VIP_USERS environment variable. Using default legacy values.', err);
      }
    }

    // Insert legacy accounts into the database if not already present
    for (const [pwd, expiry] of Object.entries(legacyVipUsers)) {
      if (pwd && expiry && /^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
        const checkRes = await pool.query('SELECT 1 FROM vip_users WHERE password = $1', [pwd]);
        if (checkRes.rowCount === 0) {
          await pool.query('INSERT INTO vip_users (password, expiry_date) VALUES ($1, $2)', [pwd, expiry]);
          console.log(`Migrated legacy VIP user "${pwd}" (${expiry}) into PostgreSQL.`);
        }
      }
    }
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

// Call Database initialization on server start
initDatabase();

// In-Memory Rate Limiter Middleware
const rateLimitMap = new Map();

function rateLimiter({ windowMs, max, message }) {
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();

    if (!rateLimitMap.has(ip)) {
      rateLimitMap.set(ip, []);
    }

    let requests = rateLimitMap.get(ip);
    // Filter requests older than the sliding window size
    requests = requests.filter(time => now - time < windowMs);

    if (requests.length >= max) {
      return res.status(429).json({ error: message || 'Too many requests, please try again later.' });
    }

    requests.push(now);
    rateLimitMap.set(ip, requests);
    next();
  };
}

// Apply authentication & TTS generation rate limits
const authLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: 'ထပ်ခါထပ်ခါ စမ်းသပ်မှု များနေပါသည်။ ၁ မိနစ်ခန့် စောင့်ပြီးမှ ပြန်လည်စမ်းသပ်ပေးပါ။'
});

const ttsLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 40,
  message: 'အသံဖိုင်ဖန်တီးမှု များနေပါသည်။ ခဏစောင့်ပြီးမှ ပြန်လည်စမ်းသပ်ပေးပါ။'
});

// Password validation helper querying the PostgreSQL database
async function validatePassword(password) {
  if (!password) {
    return { valid: false, error: 'Password is required' };
  }

  try {
    const res = await pool.query('SELECT password, expiry_date FROM vip_users WHERE password = $1', [password]);
    if (res.rowCount === 0) {
      return { valid: false, error: 'Password မှားနေပါသည်။ အသစ်ဝယ်ယူရန် Telegram ကို ဆက်သွယ်ပါ။' };
    }

    const expiryDateObj = res.rows[0].expiry_date;

    // Format expiration date string to YYYY-MM-DD
    const year = expiryDateObj.getFullYear();
    const month = String(expiryDateObj.getMonth() + 1).padStart(2, '0');
    const day = String(expiryDateObj.getDate()).padStart(2, '0');
    const expiryDateStr = `${year}-${month}-${day}`;

    const expiryDate = new Date(expiryDateObj);
    const today = new Date();

    // Reset hours to compare dates only
    today.setHours(0, 0, 0, 0);
    expiryDate.setHours(0, 0, 0, 0);

    if (today <= expiryDate) {
      return { valid: true, expiryDate: expiryDateStr };
    } else {
      return { valid: false, error: `ဒီ Password က ${expiryDateStr} နေ့မှာ သက်တမ်းကုန်သွားပါပြီ။` };
    }
  } catch (err) {
    console.error('Error querying DB in validatePassword:', err);
    return { valid: false, error: 'ဒေတာဘေ့စ် စစ်ဆေးရာတွင် အမှားအယွင်း ရှိနေပါသည်။' };
  }
}

// Middleware: Verify Admin JWT Tokens
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or expired token' });
  }
}

// -----------------------------------------
// PUBLIC ENDPOINTS
// -----------------------------------------

// 1. API: Login validation
app.post('/api/login', authLimiter, async (req, res) => {
  const { password } = req.body;
  const validation = await validatePassword(password);
  if (validation.valid) {
    return res.json({ success: true, expiryDate: validation.expiryDate });
  } else {
    return res.status(401).json({ success: false, error: validation.error });
  }
});

// 2. API: Text-To-Speech generator
app.post('/api/tts', ttsLimiter, async (req, res) => {
  // Extract password from header (Authorization: Bearer <pwd>), body, or query params
  let password = req.body?.password || req.query?.password;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    password = authHeader.substring(7);
  }

  // Validate VIP password access
  const validation = await validatePassword(password);
  if (!validation.valid) {
    return res.status(401).json({ error: validation.error || 'Unauthorized VIP access' });
  }

  const { text, voice = 'my-MM-NilarNeural' } = req.body;

  if (!text || text.trim() === '') {
    return res.status(400).json({ error: 'စာသား ထည့်သွင်းပေးပါ' });
  }

  try {
    console.log(`Generating TTS for text: "${text.substring(0, 30)}..." using voice ${voice}`);

    // Synthesize audio using edge-tts-universal
    const tts = new EdgeTTS(text, voice);
    const result = await tts.synthesize();
    const audioBuffer = Buffer.from(await result.audio.arrayBuffer());

    // Send the MP3 file directly
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="my_audio_${Date.now()}.mp3"`);
    res.setHeader('Content-Length', audioBuffer.length);
    return res.send(audioBuffer);

  } catch (error) {
    console.error('Error generating neural speech:', error);
    return res.status(500).json({ error: 'အသံဖိုင်ဖန်တီးရာတွင် အမှားအယွင်းရှိနေပါသည်။ ခဏကြာမှ ပြန်စမ်းပါ။' });
  }
});

// -----------------------------------------
// ADMIN OPERATIONS (CRUD)
// -----------------------------------------

// A1. Admin Login
app.post('/api/admin/login', authLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required' });
  }

  try {
    const checkRes = await pool.query('SELECT username, password FROM admin_credentials WHERE username = $1', [username.trim()]);
    if (checkRes.rowCount > 0) {
      const dbAdmin = checkRes.rows[0];
      if (dbAdmin.password === password) {
        const token = jwt.sign({ username: dbAdmin.username }, JWT_SECRET, { expiresIn: '2h' });
        return res.json({ success: true, token });
      }
    }
    return res.status(401).json({ success: false, error: 'အက်ဒမင် အကောင့်အမည် သို့မဟုတ် လျှို့ဝှက်နံပါတ် မှားယွင်းနေပါသည်။' });
  } catch (err) {
    console.error('Error in admin login:', err);
    return res.status(500).json({ success: false, error: 'ဒေတာဘေ့စ် စစ်ဆေးရာတွင် အမှားအယွင်း ရှိနေပါသည်။' });
  }
});

// A1.5. Change Admin Credentials
app.post('/api/admin/change-credentials', authenticateAdmin, async (req, res) => {
  const { newUsername, newPassword } = req.body;

  if (!newUsername || newUsername.trim() === '' || !newPassword || newPassword.trim() === '') {
    return res.status(400).json({ success: false, error: 'Username and password cannot be empty.' });
  }

  try {
    // Since we only maintain one admin or a small set, we update the existing admin record.
    // To be perfectly safe, we'll update based on the token's decoded username.
    const currentUsername = req.admin.username;

    const result = await pool.query(
      'UPDATE admin_credentials SET username = $1, password = $2 WHERE username = $3',
      [newUsername.trim(), newPassword.trim(), currentUsername]
    );

    if (result.rowCount === 0) {
      // If for some reason the current user is not found, we insert or update the first admin
      const countCheck = await pool.query('SELECT id FROM admin_credentials LIMIT 1');
      if (countCheck.rowCount > 0) {
        await pool.query(
          'UPDATE admin_credentials SET username = $1, password = $2 WHERE id = $3',
          [newUsername.trim(), newPassword.trim(), countCheck.rows[0].id]
        );
      } else {
        await pool.query(
          'INSERT INTO admin_credentials (username, password) VALUES ($1, $2)',
          [newUsername.trim(), newPassword.trim()]
        );
      }
    }

    return res.json({ success: true, message: 'Admin credentials permanently updated successfully!' });
  } catch (err) {
    console.error('Error changing admin credentials:', err);
    return res.status(500).json({ success: false, error: 'အက်ဒမင် အကောင့် အချက်အလက်များ ပြောင်းလဲရာတွင် အမှားအယွင်းရှိသည်။' });
  }
});

// A2. List & Search VIP Users
app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
  const { search } = req.query;
  try {
    let queryText = 'SELECT password, expiry_date, created_at FROM vip_users ORDER BY created_at DESC';
    let params = [];

    if (search && search.trim() !== '') {
      queryText = 'SELECT password, expiry_date, created_at FROM vip_users WHERE password ILIKE $1 ORDER BY created_at DESC';
      params = [`%${search.trim()}%`];
    }

    const result = await pool.query(queryText, params);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const users = result.rows.map(row => {
      const expiryDateObj = new Date(row.expiry_date);

      // Local formatted date YYYY-MM-DD
      const year = expiryDateObj.getFullYear();
      const month = String(expiryDateObj.getMonth() + 1).padStart(2, '0');
      const day = String(expiryDateObj.getDate()).padStart(2, '0');
      const expiryDateStr = `${year}-${month}-${day}`;

      expiryDateObj.setHours(0, 0, 0, 0);
      const isActive = today <= expiryDateObj;

      return {
        password: row.password,
        expiryDate: expiryDateStr,
        createdAt: row.created_at,
        isActive
      };
    });

    return res.json({ success: true, users });
  } catch (err) {
    console.error('Error listing VIP users:', err);
    return res.status(500).json({ success: false, error: 'ဒေတာဘေ့စ်မှ VIP အသုံးပြုသူစာရင်း ယူရာတွင် အမှားအယွင်းရှိသည်။' });
  }
});

// A3. Create VIP User
app.post('/api/admin/users', authenticateAdmin, async (req, res) => {
  const { password, expiryDate } = req.body;

  if (!password || password.trim() === '') {
    return res.status(400).json({ success: false, error: 'VIP Password/User ID values are required.' });
  }

  if (!expiryDate || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
    return res.status(400).json({ success: false, error: 'Expiry date must be in YYYY-MM-DD format.' });
  }

  const parsedDate = new Date(expiryDate);
  if (isNaN(parsedDate.getTime())) {
    return res.status(400).json({ success: false, error: 'Invalid expiry date value.' });
  }

  try {
    const checkRes = await pool.query('SELECT 1 FROM vip_users WHERE password = $1', [password.trim()]);
    if (checkRes.rowCount > 0) {
      return res.status(400).json({ success: false, error: 'ဒီ VIP Password/User ID က ရှိပြီးသား ဖြစ်နေသည်။' });
    }

    await pool.query('INSERT INTO vip_users (password, expiry_date) VALUES ($1, $2)', [password.trim(), expiryDate]);
    return res.json({ success: true, message: 'VIP User created successfully!' });
  } catch (err) {
    console.error('Error creating VIP user:', err);
    return res.status(500).json({ success: false, error: 'VIP အသုံးပြုသူအသစ် ထည့်သွင်းရာတွင် အမှားအယွင်းရှိသည်။' });
  }
});

// A4. Update VIP Expiry Date
app.put('/api/admin/users/:password', authenticateAdmin, async (req, res) => {
  const { password } = req.params;
  const { expiryDate } = req.body;

  if (!expiryDate || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
    return res.status(400).json({ success: false, error: 'Expiry date must be in YYYY-MM-DD format.' });
  }

  const parsedDate = new Date(expiryDate);
  if (isNaN(parsedDate.getTime())) {
    return res.status(400).json({ success: false, error: 'Invalid expiry date value.' });
  }

  try {
    const result = await pool.query('UPDATE vip_users SET expiry_date = $1 WHERE password = $2', [expiryDate, password]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'ရှာမတွေ့ပါ။' });
    }
    return res.json({ success: true, message: 'VIP Expiry extended successfully.' });
  } catch (err) {
    console.error('Error updating VIP expiry:', err);
    return res.status(500).json({ success: false, error: 'သက်တမ်းတိုးမြှင့်ရာတွင် အမှားအယွင်းရှိသည်။' });
  }
});

// A5. Delete VIP User
app.delete('/api/admin/users/:password', authenticateAdmin, async (req, res) => {
  const { password } = req.params;

  try {
    const result = await pool.query('DELETE FROM vip_users WHERE password = $1', [password]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'ရှာမတွေ့ပါ။' });
    }
    return res.json({ success: true, message: 'VIP user removed successfully.' });
  } catch (err) {
    console.error('Error deleting VIP user:', err);
    return res.status(500).json({ success: false, error: 'VIP အသုံးပြုသူ ဖျက်သိမ်းရာတွင် အမှားအယွင်းရှိသည်။' });
  }
});

// -----------------------------------------
// FILE ROUTE HANDLERS
// -----------------------------------------

// Route /admin explicitly to the admin interface
app.get(['/admin', '/admin/'], (req, res) => {
  const adminFilePath = path.join(__dirname, 'public', 'admin.html');
  res.sendFile(adminFilePath, (err) => {
    if (err) {
      console.error('Error serving admin.html:', err);
      if (!res.headersSent) {
        res.status(500).send('<h3>Error: Admin Panel file (admin.html) is missing on the server. Please check deployment.</h3>');
      }
    }
  });
});

// Fallback: Send static frontend index file for any other requests
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start listening
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(' Myanmar AI Audio Studio is running on port ' + PORT);
  console.log(' Mode: Deployment ready (Render.com + PostgreSQL)');
  console.log(' Admin Portal available at /admin');
  console.log(`====================================================`);
});
