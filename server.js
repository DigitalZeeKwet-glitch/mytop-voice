import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { EdgeTTS } from 'edge-tts-universal';
import jwt from 'jsonwebtoken';
import db from './db.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'mytop-voice-super-secret-key-12345';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Initialize Database connection & migrations
await db.init();

// Resolve static paths in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Rate Limiter implementation
const rateLimits = {};
const rateLimitWindow = 60000; // 1 minute
const maxRequests = 60; // 60 requests per window

function rateLimiter(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();

  if (!rateLimits[ip]) {
    rateLimits[ip] = [];
  }

  // Filter out requests older than current window
  rateLimits[ip] = rateLimits[ip].filter(timestamp => now - timestamp < rateLimitWindow);

  if (rateLimits[ip].length >= maxRequests) {
    return res.status(429).json({
      error: 'အလွန်အကျွံ တောင်းဆိုမှုများ ပြုလုပ်ထားပါသည်။ ခဏ စောင့်ဆိုင်းပေးပါ။',
      message: 'Too many requests, please try again later.'
    });
  }

  rateLimits[ip].push(now);
  next();
}

// Basic security middleware: Sets HTTP headers
function basicSecurity(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Content Security Policy
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:;"
  );
  next();
}

// Middlewares
app.use(cors());
app.use(express.json());
app.use(basicSecurity);

// Authenticate static file server (except admin folder from general SPA catch-all, but served by express.static)
app.use(express.static(path.join(__dirname, 'public')));

// Admin JWT verify middleware
function verifyAdminJWT(req, res, next) {
  let token = req.headers['authorization'];
  if (token && token.startsWith('Bearer ')) {
    token = token.substring(7);
  } else {
    // Also support cookies or custom headers if required, but header is cleanest
    token = req.headers['x-admin-token'];
  }

  if (!token) {
    return res.status(401).json({ error: 'အက်ဒမင် လော့ဂ်အင် ဝင်ရောက်ရန် လိုအပ်ပါသည်။', code: 'UNAUTHORIZED' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.username !== ADMIN_USERNAME) {
      return res.status(403).json({ error: 'ခွင့်ပြုချက် မရှိပါ။' });
    }
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'ဆက္ရှင် သက်တမ်းကုန်ဆုံးသွားပါပြီ။ ပြန်လည်ဝင်ရောက်ပါ။', code: 'TOKEN_EXPIRED' });
  }
}

// Password validation helper
async function validatePassword(password) {
  if (!password) {
    return { valid: false, error: 'Password is required' };
  }

  const user = await db.getUser(password);

  if (!user) {
    return { valid: false, error: 'Password မှားနေပါသည်။ အသစ်ဝယ်ယူရန် Telegram ကို ဆက်သွယ်ပါ။' };
  }

  const expiryDateStr = user.expiry_date;
  const expiryDate = new Date(expiryDateStr);
  const today = new Date();

  // Reset hours to compare dates only
  today.setHours(0, 0, 0, 0);
  expiryDate.setHours(0, 0, 0, 0);

  if (today <= expiryDate) {
    return { valid: true, expiryDate: expiryDateStr };
  } else {
    return { valid: false, error: `ဒီ Password က ${expiryDateStr} နေ့မှာ သက်တမ်းကုန်သွားပါပြီ။` };
  }
}

// ==========================================
// PUBLIC API ENDPOINTS
// ==========================================

// 1. API: Login endpoint
app.post('/api/login', rateLimiter, async (req, res) => {
  const { password } = req.body;

  const validation = await validatePassword(password);
  if (validation.valid) {
    return res.json({ success: true, expiryDate: validation.expiryDate });
  } else {
    return res.status(401).json({ success: false, error: validation.error });
  }
});

// 2. API: Text-To-Speech endpoint
app.post('/api/tts', rateLimiter, async (req, res) => {
  // Extract password from header (Authorization: Bearer <pwd>), body, or query params
  let password = req.body?.password || req.query?.password;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    password = authHeader.substring(7);
  }

  // Validate VIP Access
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


// ==========================================
// ADMIN API ENDPOINTS
// ==========================================

// 1. Admin Login
app.post('/api/admin/login', rateLimiter, (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'အသုံးပြုသူအမည်နှင့် လျှို့ဝှက်နံပါတ် ဖြည့်သွင်းရန် လိုအပ်ပါသည်။' });
  }

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    // Sign JWT token
    const token = jwt.sign(
      { username: ADMIN_USERNAME },
      JWT_SECRET,
      { expiresIn: '2h' }
    );
    return res.json({ success: true, token });
  }

  return res.status(401).json({ error: 'အသုံးပြုသူအမည် (သို့) လျှို့ဝှက်နံပါတ် မှားယွင်းနေပါသည်။' });
});

// 2. Admin Check Session
app.get('/api/admin/me', verifyAdminJWT, (req, res) => {
  res.json({ success: true, username: req.admin.username });
});

// 3. Admin: List/Search VIP Users
app.get('/api/admin/users', verifyAdminJWT, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    const search = req.query.search ? String(req.query.search).trim().toLowerCase() : '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const mappedUsers = users.map(user => {
      const expiryDate = new Date(user.expiry_date);
      expiryDate.setHours(0, 0, 0, 0);
      const isActive = today <= expiryDate;

      return {
        id: user.password, // user ID / password is the unique identifier
        password: user.password,
        expiryDate: user.expiry_date,
        status: isActive ? 'active' : 'expired'
      };
    });

    if (search) {
      const filtered = mappedUsers.filter(u => u.password.toLowerCase().includes(search));
      return res.json({ success: true, users: filtered });
    }

    return res.json({ success: true, users: mappedUsers });
  } catch (error) {
    console.error('Error listing admin users:', error);
    res.status(500).json({ error: 'အချက်အလက်များ ဆွဲထုတ်ရာတွင် အမှားအယွင်း ဖြစ်ပွားခဲ့ပါသည်။' });
  }
});

// 4. Admin: Add VIP User
app.post('/api/admin/users', verifyAdminJWT, async (req, res) => {
  const { password, expiryDate } = req.body;

  // Validate Input
  if (!password || !password.trim()) {
    return res.status(400).json({ error: 'VIP Password ကို ဖြည့်စွက်ရန် လိုအပ်ပါသည်။' });
  }

  if (!expiryDate || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
    return res.status(400).json({ error: 'သက်တမ်းကုန်ဆုံးမည့် ရက်စွဲကို YYYY-MM-DD ပုံစံဖြင့် မှန်ကန်စွာ ဖြည့်သွင်းပါ။' });
  }

  // Check if date is valid
  const parsedDate = Date.parse(expiryDate);
  if (isNaN(parsedDate)) {
    return res.status(400).json({ error: 'မှားယွင်းသော ရက်စွဲဖြစ်နေပါသည်။' });
  }

  const normalizedPwd = password.trim();

  try {
    const existing = await db.getUser(normalizedPwd);
    if (existing) {
      return res.status(409).json({ error: 'ဤ VIP User (Password) ရှိနှင့်ပြီးသား ဖြစ်ပါသည်။' });
    }

    const newUser = await db.addUser(normalizedPwd, expiryDate);
    return res.status(211 || 201).json({
      success: true,
      user: {
        id: newUser.password,
        password: newUser.password,
        expiryDate: newUser.expiry_date,
        status: new Date() <= new Date(newUser.expiry_date) ? 'active' : 'expired'
      }
    });
  } catch (error) {
    console.error('Error adding VIP user:', error);
    res.status(500).json({ error: 'VIP အသုံးပြုသူအသစ် ထည့်သွင်းခြင်း မအောင်မြင်ပါ။' });
  }
});

// 5. Admin: Update VIP User (Change/Extend expiry date)
app.put('/api/admin/users/:id', verifyAdminJWT, async (req, res) => {
  const { id } = req.params;
  const { expiryDate } = req.body;

  if (!expiryDate || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
    return res.status(400).json({ error: 'သက်တမ်းကုန်ဆုံးမည့် ရက်စွဲကို YYYY-MM-DD ပုံစံဖြင့် မှန်ကန်စွာ ဖြည့်သွင်းပါ။' });
  }

  // Check if date is valid
  const parsedDate = Date.parse(expiryDate);
  if (isNaN(parsedDate)) {
    return res.status(400).json({ error: 'မှားယွင်းသော ရက်စွဲဖြစ်နေပါသည်။' });
  }

  try {
    const existing = await db.getUser(id);
    if (!existing) {
      return res.status(404).json({ error: 'ရှာမတွေ့ပါ။' });
    }

    const updated = await db.updateUser(id, expiryDate);
    return res.json({
      success: true,
      user: {
        id: updated.password,
        password: updated.password,
        expiryDate: updated.expiry_date,
        status: new Date() <= new Date(updated.expiry_date) ? 'active' : 'expired'
      }
    });
  } catch (error) {
    console.error('Error updating VIP user:', error);
    res.status(500).json({ error: 'သက်တမ်းတိုးမြှင့်ခြင်း မအောင်မြင်ပါ။' });
  }
});

// 6. Admin: Delete VIP User
app.delete('/api/admin/users/:id', verifyAdminJWT, async (req, res) => {
  const { id } = req.params;

  try {
    const deleted = await db.deleteUser(id);
    if (!deleted) {
      return res.status(404).json({ error: 'ရှာမတွေ့ပါ။' });
    }
    return res.json({ success: true, message: 'VIP User ကို အောင်မြင်စွာ ဖျက်သိမ်းပြီးပါပြီ။' });
  } catch (error) {
    console.error('Error deleting VIP user:', error);
    res.status(500).json({ error: 'ဖျက်သိမ်းခြင်း မအောင်မြင်ပါ။' });
  }
});


// Serve admin panel directly for requests to /admin or /admin/*
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});


// Fallback: Send static frontend index file for any other requests
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start listening
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` Myanmar AI Audio Studio is running on port ${PORT}`);
  console.log(` Mode: Deployment ready (Render.com)`);
  console.log(`====================================================`);
});
