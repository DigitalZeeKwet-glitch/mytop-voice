# Myanmar AI Audio Studio - VIP

A modern, fast, mobile-friendly Web Application designed for high-quality Myanmar text-to-speech generation. Built on a Node.js + Express backend and powered by **Microsoft Edge Neural Text-To-Speech (TTS)**.

## Features

- **🔑 Secure VIP Login:** Move password validation safely to the Node.js backend. Expiry dates are verified in real time, with configurable passwords.
- **🎙️ Microsoft Edge Neural TTS:** Premium, natural-sounding neural voices for Myanmar language.
  - **မနီလာ (Nilar):** Female / အမျိုးသမီးအသံ (`my-MM-NilarNeural`)
  - **မောင်သီဟ (Thiha):** Male / အမျိုးသားအသံ (`my-MM-ThihaNeural`)
- **📱 Modern Glassmorphic UI:** Built with Bootstrap 5, premium icons, sleek animations, and a responsive mobile-first design.
- **⏳ Loading Animation:** Visual indicators and custom timers during MP3 generation.
- **📥 One-Click Download:** Play audio immediately in the browser or download high-fidelity MP3 files locally.
- **🚀 Render.com Deployment Ready:** Out-of-the-box configuration with zero configuration required on deployment platforms.

## Tech Stack

- **Frontend:** HTML5, CSS3, ES6 JavaScript, Bootstrap 5, FontAwesome Icons.
- **Backend:** Node.js, Express, Cors, Dotenv, `edge-tts-universal`.

---

## Directory Structure

```text
├── public/
│   └── index.html      # Responsive frontend studio & login page
├── .env.example        # Local configuration template
├── .gitignore          # standard git ignores
├── package.json        # Node.js dependencies & scripts
├── README.md           # Documentation
└── server.js           # Main Express server and TTS broker
```

---

## Local Setup Instructions

### 1. Prerequisites
Ensure you have [Node.js](https://nodejs.org/) installed (v18 or higher is recommended).

### 2. Clone and Install Dependencies
```bash
# Clone the repository
git clone https://github.com/DigitalZeeKwet-glitch/mytop-voice.git
cd mytop-voice

# Install npm packages
npm install
```

### 3. Setup Configuration
Copy the `.env.example` file and configure your variables:
```bash
cp .env.example .env
```
Inside `.env`, customize your VIP credentials in a JSON format:
```env
PORT=3000
VIP_USERS={"000123":"2026-12-15","test_user_777":"2025-06-30"}
```

### 4. Run the Server
```bash
# Start in production mode
npm start

# Start in development mode (if nodemon is installed)
npm run dev
```
Open your browser to `http://localhost:3000` to access the application.

---

## API Endpoints Reference

### 1. **POST** `/api/login`
Validates a user password.
- **Request Body:**
  ```json
  { "password": "your_password" }
  ```
- **Response (Success):**
  ```json
  { "success": true, "expiryDate": "2026-12-15" }
  ```
- **Response (Error):**
  ```json
  { "success": false, "error": "ဒီ Password က သက်တမ်းကုန်သွားပါပြီ။" }
  ```

### 2. **POST** `/api/tts`
Converts Myanmar text into high-fidelity Neural MP3 audio.
- **Authentication Headers:**
  `Authorization: Bearer <your_password>` (or pass `{ "password": "..." }` in the body/query)
- **Request Body:**
  ```json
  {
    "text": "မင်္ဂလာပါ၊ နေကောင်းလားခင်ဗျာ။",
    "voice": "my-MM-ThihaNeural"
  }
  ```
- **Response:**
  Direct stream of raw MP3 binary data with correct `Content-Type: audio/mpeg` header.

---

## Render.com Deployment Guide

To host this on [Render](https://render.com/) for free:

1. Create a free account on **Render.com**.
2. Click **New +** -> **Web Service**.
3. Connect your GitHub repository.
4. Set the following details:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Under **Environment Variables**, you may add:
   - `VIP_USERS` with value: `{"000123":"2026-12-15"}` (optional, defaults to this value if not provided).
6. Click **Deploy Web Service**. Render will automatically deploy your Node.js + Express backend alongside the static UI.
