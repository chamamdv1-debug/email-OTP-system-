// server.js
// Simple Express server that sends OTP emails using Nodemailer.
// Uses in-memory stores so restarting the server clears users/otps/sessions.

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory stores
const users = new Map();      // email -> { name, email }
const otps = new Map();       // email -> { code, expiresAt }
const sessions = new Map();   // token -> email

// Env / config
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 465;
const SMTP_USER = process.env.SMTP_USER || 'ransikachamindu43@gmail.com';
const SMTP_PASS = process.env.SMTP_PASS || 'vijxbtyysegggvop';
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER || 'no-reply@example.com';
const APP_PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.warn('⚠️  Warning: SMTP environment variables not set. Emails will fail until you set SMTP_HOST, SMTP_USER, SMTP_PASS.');
}

// nodemailer transporter
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465, // true for 465, false for other ports
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS
  }
});

// Utility: generate 6-digit OTP
function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Utility: random auth token
function genToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Email HTML template (dark, GitLab-like style)
function otpEmailHTML({ name = '', code = '' }) {
  const now = new Date();
  return `
  <!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>Verify your identity</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      body { background: #0f0f10; color: #ddd; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial; margin:0; padding:0; }
      .container { max-width:700px; margin:32px auto; background:#121212; border-radius:8px; overflow:hidden; box-shadow: 0 6px 30px rgba(0,0,0,0.6); }
      .header { background: linear-gradient(90deg,#6f42c1,#f66d3a); padding:22px 24px; text-align:center; }
      .logo { width:54px; height:40px; display:inline-block; filter: drop-shadow(0 2px 8px rgba(0,0,0,0.5)); }
      .content { padding:28px 36px; }
      h1 { margin:0 0 8px 0; font-size:20px; color:#fff; }
      p { color:#cfcfcf; line-height:1.5; margin:8px 0 20px; }
      .code-box { display:inline-block; background:#222; padding:18px 30px; border-radius:6px; font-weight:700; font-size:28px; letter-spacing:6px; color:#fff; box-shadow: inset 0 -6px 20px rgba(0,0,0,0.6); }
      .muted { color:#9aa0a6; font-size:13px; margin-top:18px; }
      .footer { background:#0b0b0b; color:#8b8b8b; padding:14px 20px; text-align:center; font-size:13px; }
      a { color:#7cc0ff; text-decoration:none; }
      @media (max-width:520px){ .content{padding:20px} .code-box{font-size:24px;padding:14px 22px} }
    </style>
  </head>
  <body>
    <div class="container" role="article" aria-label="OTP">
      <div class="header">
        <svg class="logo" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 0l2.2 3.2L12.9 1 16 5l-5.3 5L8 9l-2.7 1L0 5l3.1-4L5.8 3.2 8 0z" fill="#ff6b6b"/>
        </svg>
      </div>
      <div class="content">
        <h1>Help us protect your account</h1>
        <p>Before you sign in, we need to verify your identity. Enter the following code on the sign-in page.</p>

        <div style="text-align:center;margin:22px 0;">
          <div class="code-box">${code}</div>
        </div>

        <div class="muted">
          If you have not recently tried to sign in, we recommend changing your password and setting up Two-Factor Authentication to keep your account safe. Your verification code expires after 10 minutes.
        </div>
      </div>
      <div class="footer">You are receiving this email because of your account. &nbsp; · &nbsp; ${now.toDateString()}</div>
    </div>
  </body>
  </html>
  `;
}

// Serve the single frontend file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ----- API endpoints ----- //

// Register (creates a user record; no password needed for OTP flow)
app.post('/api/register', (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  if (users.has(email)) return res.status(400).json({ error: 'User already exists' });
  users.set(email, { email, name: name || '' });
  return res.json({ ok: true, message: 'Registered' });
});

// Send OTP for login (or registration)
app.post('/api/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    // If user not registered yet, create a lightweight record
    if (!users.has(email)) {
      users.set(email, { email, name: '' });
    }

    const code = generateOTP();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
    otps.set(email, { code, expiresAt });

    // send email
    const html = otpEmailHTML({ name: users.get(email).name || '', code });
    const mailOptions = {
      from: FROM_EMAIL,
      to: email,
      subject: 'Verify your identity',
      html
    };

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      console.log(`(Simulated) OTP for ${email}: ${code}`);
      return res.json({ ok: true, simulated: true, message: 'SMTP not configured; OTP logged on server console.' });
    }

    await transporter.sendMail(mailOptions);
    return res.json({ ok: true, message: 'OTP sent' });
  } catch (err) {
    console.error('send-otp error:', err);
    return res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// Verify OTP and create session token
app.post('/api/verify-otp', (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

  const entry = otps.get(email);
  if (!entry) return res.status(400).json({ error: 'No OTP requested for this email' });
  if (Date.now() > entry.expiresAt) {
    otps.delete(email);
    return res.status(400).json({ error: 'OTP expired' });
  }
  if (entry.code !== String(code).trim()) return res.status(400).json({ error: 'Invalid OTP code' });

  // all good -> create token
  otps.delete(email);
  const token = genToken();
  sessions.set(token, email);

  return res.json({ ok: true, token });
});

// Protected profile endpoint
app.get('/api/profile', (req, res) => {
  const auth = req.headers.authorization || '';
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'Missing token' });
  const token = parts[1];
  const email = sessions.get(token);
  if (!email) return res.status(401).json({ error: 'Invalid token' });
  const user = users.get(email) || { email, name: '' };
  return res.json({ ok: true, user });
});

// Logout
app.post('/api/logout', (req, res) => {
  const auth = req.headers.authorization || '';
  const parts = auth.split(' ');
  if (parts.length === 2 && parts[0] === 'Bearer') {
    sessions.delete(parts[1]);
  }
  return res.json({ ok: true });
});

// Static (if any) - in this simple app we only serve index.html at root
app.use(express.static(path.join(__dirname)));

// Start server
app.listen(APP_PORT, () => {
  console.log(`Server running on http://localhost:${APP_PORT}`);
});
