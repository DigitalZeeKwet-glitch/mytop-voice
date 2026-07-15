import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { EdgeTTS } from 'edge-tts-universal';

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

// Default VIP Users list (can be overridden by VIP_USERS environment variable as a JSON string)
let vipUsers = {
  "000123": "2026-12-15"
};

if (process.env.VIP_USERS) {
  try {
    vipUsers = JSON.parse(process.env.VIP_USERS);
    console.log('Successfully loaded custom VIP users config from environment.');
  } catch (err) {
    console.error('Failed to parse VIP_USERS environment variable. Using default VIP users list.', err);
  }
}

// Password validation helper
function validatePassword(password) {
  if (!password) {
    return { valid: false, error: 'Password is required' };
  }

  if (!Object.prototype.hasOwnProperty.call(vipUsers, password)) {
    return { valid: false, error: 'Password မှားနေပါသည်။ အသစ်ဝယ်ယူရန် Telegram ကို ဆက်သွယ်ပါ။' };
  }

  const expiryDateStr = vipUsers[password];
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

// 1. API: Login endpoint
app.post('/api/login', (req, res) => {
  const { password } = req.body;

  const validation = validatePassword(password);
  if (validation.valid) {
    return res.json({ success: true, expiryDate: validation.expiryDate });
  } else {
    return res.status(401).json({ success: false, error: validation.error });
  }
});

// 2. API: Text-To-Speech endpoint
app.post('/api/tts', async (req, res) => {
  // Extract password from header (Authorization: Bearer <pwd>), body, or query params
  let password = req.body?.password || req.query?.password;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    password = authHeader.substring(7);
  }

  // Validate VIP Access
  const validation = validatePassword(password);
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
