# Myanmar AI Audio Studio - VIP with Admin Panel

A modern, fast, mobile-friendly Web Application designed for high-quality Myanmar text-to-speech generation. Powered by **Microsoft Edge Neural Text-To-Speech (TTS)**. Now with a secure, production-ready Admin Panel and persistent PostgreSQL database support.

## Features

- **🔑 Secure VIP Login:** Safely validate passwords against the backend. Active/Expired status is verified in real-time.
- **🎙️ Microsoft Edge Neural TTS:** Premium, natural-sounding neural voices for Myanmar language:
  - **မနီလာ (Nilar):** Female / အမျိုးသမီးအသံ (`my-MM-NilarNeural`)
  - **မောင်သီဟ (Thiha):** Male / အမျိုးသားအသံ (`my-MM-ThihaNeural`)
- **🛡️ Secure Admin Panel (`/admin`):** Fully-featured, secure administrator portal:
  - View all VIP accounts with live Active or Expired indicators.
  - Search VIP users by Password/ID in real time.
  - Add new VIP users with explicit expiry dates.
  - Extend, update, or edit existing VIP users' expiry dates.
  - Delete VIP users.
- **🔒 Security Features:**
  - Password and Date inputs validated securely on the backend.
  - Admin area protected via environment variables `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
  - Secure signed JSON Web Tokens (JWT) for admin sessions.
  - Rate limiting & custom HTTP headers (CSP, X-Frame-Options, X-Content-Type-Options) to protect against attacks.
  - Credentials never exposed in the client code.
- **💾 Dual Storage Strategy (PostgreSQL + In-Memory Fallback):**
  - Uses full persistent PostgreSQL in production.
  - Automatic database tables creation and initial import from the `VIP_USERS` environment variable.
  - Fallback to safe In-Memory storage if database is offline or not configured.

---

## Directory Structure

```text
├── public/
│   ├── index.html        # Responsive frontend studio & login page
│   └── admin/
│       └── index.html    # Interactive, glassmorphic Admin Panel
├── .env.example          # Local configuration template
├── db.js                 # Database wrapper (PostgreSQL & In-Memory fallback)
├── package.json          # Node.js dependencies & scripts
├── README.md             # Documentation
└── server.js             # Main Express server, Admin API & TTS broker
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
Customize your environment variables in `.env`:
```env
PORT=3000
DATABASE_URL=postgresql://username:password@localhost:5432/mytop_voice
JWT_SECRET=use_a_strong_secret_key_here
ADMIN_USERNAME=admin
ADMIN_PASSWORD=strong_admin_password_here
VIP_USERS={"000123":"2026-12-15","test_user_777":"2025-06-30"}
```

### 4. Run the Server
```bash
# Start in production mode
npm start

# Start in development mode
npm run dev
```
Open your browser to:
- Frontend Studio: `http://localhost:3000`
- Admin Panel: `http://localhost:3000/admin`

---

## API Endpoints Reference

### Public APIs
- **POST `/api/login`:** Checks if a VIP password is valid and active.
- **POST `/api/tts`:** Generates high-fidelity neural speech binary stream.

### Admin APIs (Require JWT in Authorization Bearer)
- **POST `/api/admin/login`:** Authenticates admin and returns signed JWT.
- **GET `/api/admin/me`:** Validates admin JWT session.
- **GET `/api/admin/users`:** Lists and searches VIP users.
- **POST `/api/admin/users`:** Adds a new VIP user.
- **PUT `/api/admin/users/:id`:** Edits/extends a VIP user's expiry date.
- **DELETE `/api/admin/users/:id`:** Deletes a VIP user.

---

## Database Schema & Migrations

The application manages PostgreSQL setup automatically. On startup, if a `DATABASE_URL` is set:
1. It connects and runs an initialization query to create the `vip_users` table:
   ```sql
   CREATE TABLE IF NOT EXISTS vip_users (
     password VARCHAR(255) PRIMARY KEY,
     expiry_date DATE NOT NULL,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );
   ```
2. If the table is empty, it automatically parses the `VIP_USERS` environment variable and imports all valid accounts into the database persistently.

---

## Render.com Deployment Guide

To deploy this application to **Render.com** with PostgreSQL:

### Step 1: Create a PostgreSQL Database on Render
1. Go to your **Render Dashboard** -> **New +** -> **Database**.
2. Name your database (e.g., `mytop-voice-db`) and click **Create Database**.
3. Once active, copy the **Internal Database URL** (if deploying backend on Render) or **External Database URL**.

### Step 2: Deploy the Web Service on Render
1. Click **New +** -> **Web Service**.
2. Connect your GitHub repository.
3. Configure the following service settings:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Under **Environment Variables**, add the following configs:
   - `DATABASE_URL` -> *(Paste your copied PostgreSQL URL)*
   - `JWT_SECRET` -> *(Generate a strong secure secret)*
   - `ADMIN_USERNAME` -> *(Your custom admin username)*
   - `ADMIN_PASSWORD` -> *(Your custom admin password)*
   - `VIP_USERS` -> `{"000123":"2026-12-15"}` *(Optional: Seed data)*
5. Click **Deploy Web Service**. Render will spin up the backend, connect to PostgreSQL, run database migrations, import your seed VIP users, and launch the application!
