/**
 * Authentication Routes (/api/v1/auth/*)
 * - Faculty login (Gmail + temp/permanent password)
 * - Student login (enrollment_no + password)
 * - Student self-registration (public, no auth required)
 * - First-time password change (teacher + student activation)
 * - Token refresh & logout
 * - Google OAuth: link account & one-click login
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const bcrypt = require('bcrypt');
const validate = require('../middleware/validate');
const authService = require('../services/authService');
const otpService = require('../services/otpService');
const { authLimiter } = require('../middleware/rateLimiter');
const auth = require('../middleware/auth');
const { query, withTransaction } = require('../config/db');

// ─────────────────────────────────────────────────────────
// FACULTY LOGIN  (Gmail / Mobile Number + password)
// POST /api/v1/auth/faculty/login
// ─────────────────────────────────────────────────────────
router.post('/faculty/login', authLimiter, [
  body('password').notEmpty().withMessage('Password is required'),
  validate
], async (req, res) => {
  const credential = (req.body.email || req.body.phone || req.body.username || req.body.identifier || req.body.credential || '').trim();
  if (!credential) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Gmail address or Mobile number is required' } });
  }
  try {
    const clientInfo = { ip: req.ip, userAgent: req.get('User-Agent') };
    const result = await authService.facultyLogin(credential, req.body.password, clientInfo);

    if (result.refresh_token) {
      res.cookie('refreshToken', result.refresh_token, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict', maxAge: 7 * 24 * 60 * 60 * 1000
      });
    }
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// STUDENT LOGIN  (Strictly Gmail or Mobile Number + password)
// POST /api/v1/auth/student/login
// ─────────────────────────────────────────────────────────
router.post('/student/login', authLimiter, [
  body('password').notEmpty().withMessage('Password is required'),
  validate
], async (req, res) => {
  const credential = (req.body.email || req.body.phone || req.body.credential || req.body.identifier || req.body.username || req.body.enrollment_no || req.body.official_enrollment_no || req.body.registration_no || '').trim();
  if (!credential) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Gmail address or Mobile number is required' } });
  }
  try {
    const clientInfo = { ip: req.ip, userAgent: req.get('User-Agent') };
    const result = await authService.studentLogin(credential, req.body.password, clientInfo);

    if (result.refresh_token) {
      res.cookie('refreshToken', result.refresh_token, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict', maxAge: 7 * 24 * 60 * 60 * 1000
      });
    }
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// UNIFIED LOGIN  (auto-detect role via Gmail or Mobile Number)
// POST /api/v1/auth/login
// ─────────────────────────────────────────────────────────
router.post('/login', authLimiter, [
  body('password').notEmpty().withMessage('Password is required'),
  validate
], async (req, res) => {
  const credential = (req.body.email || req.body.phone || req.body.credential || req.body.identifier || req.body.username || req.body.enrollment_no || '').trim();
  if (!credential) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Gmail address or Mobile number is required' } });
  }
  try {
    const clientInfo = { ip: req.ip, userAgent: req.get('User-Agent') };
    let result;
    try {
      result = await authService.facultyLogin(credential, req.body.password, clientInfo);
    } catch (err) {
      // If enrollment login error, forward directly
      if (err.code === 'ENROLLMENT_LOGIN_DISABLED') throw err;
      result = await authService.studentLogin(credential, req.body.password, clientInfo);
    }
    if (result.refresh_token) {
      res.cookie('refreshToken', result.refresh_token, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict', maxAge: 7 * 24 * 60 * 60 * 1000
      });
    }
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// DISPATCH OTP  (WhatsApp / SMS / Email)
// POST /api/v1/auth/otp/send
// ─────────────────────────────────────────────────────────
router.post('/otp/send', authLimiter, [
  body('identifier').trim().notEmpty().withMessage('Gmail address or Mobile number is required'),
  body('purpose').isIn(['REGISTRATION', 'LOGIN', 'PASSWORD_RESET']).withMessage('Valid purpose (REGISTRATION, LOGIN, PASSWORD_RESET) is required'),
  validate
], async (req, res) => {
  try {
    const result = await otpService.generateOtp(req.body.identifier, req.body.purpose);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// VERIFY OTP
// POST /api/v1/auth/otp/verify
// ─────────────────────────────────────────────────────────
router.post('/otp/verify', authLimiter, [
  body('identifier').trim().notEmpty().withMessage('Identifier is required'),
  body('otp_code').trim().notEmpty().withMessage('6-digit OTP code is required'),
  body('purpose').isIn(['REGISTRATION', 'LOGIN', 'PASSWORD_RESET']).withMessage('Valid purpose is required'),
  validate
], async (req, res) => {
  try {
    const result = await otpService.verifyOtp(req.body.identifier, req.body.otp_code, req.body.purpose);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// PASSWORDLESS LOGIN VIA OTP
// POST /api/v1/auth/login-otp
// ─────────────────────────────────────────────────────────
router.post('/login-otp', authLimiter, [
  body('otp_code').trim().notEmpty().withMessage('6-digit OTP code is required'),
  validate
], async (req, res) => {
  const credential = (req.body.identifier || req.body.email || req.body.phone || req.body.credential || '').trim();
  if (!credential) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Gmail address or Mobile number is required' } });
  }
  try {
    const clientInfo = { ip: req.ip, userAgent: req.get('User-Agent') };
    const result = await authService.loginWithOtp(credential, req.body.otp_code, clientInfo);

    if (result.refresh_token) {
      res.cookie('refreshToken', result.refresh_token, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict', maxAge: 7 * 24 * 60 * 60 * 1000
      });
    }
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// FORGOT PASSWORD RESET VIA OTP
// POST /api/v1/auth/reset-password-otp
// ─────────────────────────────────────────────────────────
router.post('/reset-password-otp', authLimiter, [
  body('verification_token').trim().notEmpty().withMessage('Verification token is required'),
  body('new_password').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
  validate
], async (req, res) => {
  const credential = (req.body.identifier || req.body.email || req.body.phone || req.body.credential || '').trim();
  if (!credential) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Gmail address or Mobile number is required' } });
  }
  try {
    const clientInfo = { ip: req.ip, userAgent: req.get('User-Agent') };
    const result = await authService.resetPasswordWithOtp(credential, req.body.verification_token, req.body.new_password, clientInfo);

    if (result.refresh_token) {
      res.cookie('refreshToken', result.refresh_token, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict', maxAge: 7 * 24 * 60 * 60 * 1000
      });
    }
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// CHANGE PASSWORD (first-time activation for teacher & student)
// POST /api/v1/auth/change-password
// Requires: Bearer <activation_token> OR regular access token (for profile change)
// ─────────────────────────────────────────────────────────
router.post('/change-password', auth, [
  body('new_password').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
  body('current_password').optional().trim(),
  validate
], async (req, res) => {
  try {
    const result = await authService.changePassword(req.user.id, req.body.new_password, req.body.current_password);
    // Issue fresh tokens after activation
    if (result.access_token) {
      res.cookie('refreshToken', result.refresh_token, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict', maxAge: 7 * 24 * 60 * 60 * 1000
      });
    }
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// GOOGLE: GET OAUTH CONFIG & REAL GOOGLE ACCOUNTS URL
// GET /api/v1/auth/google/config
// GET /api/v1/auth/google/url
// ─────────────────────────────────────────────────────────
router.get('/google/config', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  res.status(200).json({
    success: true,
    data: {
      is_configured: !!clientId,
      client_id: clientId,
      callback_url: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/v1/auth/google/callback'
    }
  });
});

router.get('/google/url', (req, res) => {
  const mode = req.query.mode || 'LOGIN';
  const userId = req.query.user_id || null;
  const authUrl = authService.getGoogleAuthUrl(mode, userId);

  if (!authUrl) {
    return res.status(200).json({
      success: false,
      configured: false,
      message: 'GOOGLE_CLIENT_ID is not configured in backend .env'
    });
  }

  res.status(200).json({
    success: true,
    configured: true,
    data: { url: authUrl }
  });
});

// ─────────────────────────────────────────────────────────
// GOOGLE: OAUTH 2.0 CALLBACK (Redirect target from accounts.google.com)
// GET /api/v1/auth/google/callback
// ─────────────────────────────────────────────────────────
router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>Google Sign-In Cancelled</title></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8f9fa;">
        <div style="background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 400px; text-align: center;">
          <h2 style="color: #ea4335; margin-top: 0;">Sign-In Cancelled</h2>
          <p style="color: #5f6368; font-size: 0.9rem;">${error}</p>
          <button onclick="window.close()" style="background: #1a73e8; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">Close Window</button>
        </div>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'GOOGLE_AUTH_ERROR', message: ${JSON.stringify(error)} }, '*');
            setTimeout(() => window.close(), 1500);
          }
        </script>
      </body>
      </html>
    `);
  }

  if (!code) {
    return res.status(400).send('Authorization code missing');
  }

  try {
    const clientInfo = { ip: req.ip, userAgent: req.get('User-Agent') };
    const result = await authService.handleGoogleCallback(code, state, clientInfo);

    if (result.refresh_token) {
      res.cookie('refreshToken', result.refresh_token, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict', maxAge: 7 * 24 * 60 * 60 * 1000
      });
    }

    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Google Sign-In Success</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8f9fa;">
        <div style="background: white; padding: 2.5rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 420px; text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 0.5rem;">🎉</div>
          <h2 style="color: #1e8e3e; margin: 0.25rem 0 0.5rem 0;">Google Sign-In Verified!</h2>
          <p style="color: #5f6368; font-size: 0.95rem; margin: 0 0 1.25rem 0;">Redirecting you to your portal...</p>
          <div style="display: inline-block; width: 24px; height: 24px; border: 3px solid #e0e0e0; border-top-color: #1a73e8; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        </div>
        <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
        <script>
          const payload = ${JSON.stringify(result)};
          if (window.opener) {
            window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS', payload }, '*');
            setTimeout(() => {
              try { window.close(); } catch (_) {}
            }, 600);
          } else {
            if (payload.action === 'STUDENT_REGISTER') {
              window.location.href = '/login/student-register.html?google_email=' + encodeURIComponent(payload.google_email) + '&google_name=' + encodeURIComponent(payload.google_name || '') + '&google_sub=' + encodeURIComponent(payload.google_sub || '');
            } else if (payload.action === 'PENDING_APPROVAL') {
              window.location.href = '/login/student.html?google_pending=1&email=' + encodeURIComponent(payload.google_email || '');
            } else if (payload.action === 'NOT_REGISTERED') {
              window.location.href = '/login/student-register.html?google_email=' + encodeURIComponent(payload.google_email) + '&google_name=' + encodeURIComponent(payload.google_name || '') + '&google_sub=' + encodeURIComponent(payload.google_sub || '');
            } else if (payload.access_token) {
              localStorage.setItem('access_token', payload.access_token);
              localStorage.setItem('user', JSON.stringify(payload.user));
              if (payload.user && payload.user.roles && payload.user.roles.includes('STUDENT')) {
                window.location.href = '/student/attendance.html';
              } else if (payload.user && payload.user.roles && payload.user.roles.includes('SYSTEM_ADMIN')) {
                window.location.href = '/admin/dashboard.html';
              } else {
                window.location.href = '/faculty/dashboard.html';
              }
            } else {
              window.location.href = '/faculty/profile.html?google_linked=1';
            }
          }
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    const errorMsg = err.message || 'Google authentication failed';
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Google Sign-In Error</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8f9fa;">
        <div style="background: white; padding: 2.5rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 440px; text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 0.5rem;">⚠️</div>
          <h2 style="color: #d93025; margin: 0.25rem 0 0.5rem 0;">Sign-In Failed</h2>
          <p style="color: #5f6368; font-size: 0.95rem; line-height: 1.4; margin: 0 0 1.5rem 0;">${errorMsg}</p>
          <div style="display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;">
            <a href="/login/student-register.html" style="background: #1a73e8; color: white; border: none; padding: 0.65rem 1.2rem; border-radius: 6px; cursor: pointer; text-decoration: none; font-size: 0.9rem; font-weight: 500;">← Student Register</a>
            <a href="/login/student.html" style="background: #34a853; color: white; border: none; padding: 0.65rem 1.2rem; border-radius: 6px; cursor: pointer; text-decoration: none; font-size: 0.9rem; font-weight: 500;">Student Login</a>
            <a href="/login/faculty.html" style="background: #5f6368; color: white; border: none; padding: 0.65rem 1.2rem; border-radius: 6px; cursor: pointer; text-decoration: none; font-size: 0.9rem; font-weight: 500;">Faculty Login</a>
          </div>
        </div>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'GOOGLE_AUTH_ERROR', message: ${JSON.stringify(errorMsg)} }, '*');
            setTimeout(() => window.close(), 3000);
          }
        </script>
      </body>
      </html>
    `);
  }
});

// Helper to save credentials into backend/.env file from UI
router.post('/google/save-credentials', [
  body('client_id').trim().notEmpty().withMessage('Client ID is required'),
  validate
], async (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '../../.env');

  try {
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const newClientId = req.body.client_id.trim();
    const newClientSecret = (req.body.client_secret || '').trim();

    if (content.includes('GOOGLE_CLIENT_ID=')) {
      content = content.replace(/GOOGLE_CLIENT_ID=.*(\r?\n|$)/, `GOOGLE_CLIENT_ID=${newClientId}\$1`);
    } else {
      content += `\nGOOGLE_CLIENT_ID=${newClientId}\n`;
    }

    if (newClientSecret) {
      if (content.includes('GOOGLE_CLIENT_SECRET=')) {
        content = content.replace(/GOOGLE_CLIENT_SECRET=.*(\r?\n|$)/, `GOOGLE_CLIENT_SECRET=${newClientSecret}\$1`);
      } else {
        content += `GOOGLE_CLIENT_SECRET=${newClientSecret}\n`;
      }
    }

    fs.writeFileSync(envPath, content, 'utf8');
    process.env.GOOGLE_CLIENT_ID = newClientId;
    if (newClientSecret) process.env.GOOGLE_CLIENT_SECRET = newClientSecret;

    res.json({
      success: true,
      message: 'Google Cloud credentials saved to .env successfully!'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'SAVE_FAILED', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// GOOGLE: LINK ACCOUNT (teacher must be logged in)
// POST /api/v1/auth/google/link
// Body: { id_token: "<Google OAuth ID token from client>" }
// Rule: google payload email MUST match users.email stored in DB
// ─────────────────────────────────────────────────────────
router.post('/google/link', auth, [
  body('id_token').notEmpty().withMessage('Google ID token required'),
  validate
], async (req, res) => {
  try {
    const result = await authService.linkGoogleAccount(req.user.id, req.body.id_token);
    res.status(200).json({ success: true, data: result, message: 'Google account linked. You can now sign in with one click.' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// GOOGLE: ONE-CLICK LOGIN
// POST /api/v1/auth/google
// Body: { id_token: "<Google OAuth ID token from client>" }
// ─────────────────────────────────────────────────────────
router.post('/google', authLimiter, [
  body('id_token').notEmpty().withMessage('Google ID token required'),
  validate
], async (req, res) => {
  try {
    const clientInfo = { ip: req.ip, userAgent: req.get('User-Agent') };
    const result = await authService.googleLogin(req.body.id_token, clientInfo);

    if (result.refresh_token) {
      res.cookie('refreshToken', result.refresh_token, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict', maxAge: 7 * 24 * 60 * 60 * 1000
      });
    }
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// TOKEN REFRESH
// POST /api/v1/auth/refresh
// ─────────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.refreshToken || req.body.refresh_token || req.headers['x-refresh-token'];
  if (!refreshToken) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Refresh token missing' } });
  }
  try {
    const clientInfo = { ip: req.ip, userAgent: req.get('User-Agent') };
    const result = await authService.refreshTokens(refreshToken, clientInfo);
    res.cookie('refreshToken', result.refresh_token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict', maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.status(200).json({ success: true, data: { access_token: result.access_token } });
  } catch (err) {
    res.status(err.status || 401).json({ success: false, error: { code: err.code || 'UNAUTHORIZED', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// LOGOUT
// POST /api/v1/auth/logout
// ─────────────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  const refreshToken = req.cookies?.refreshToken || req.body.refresh_token;
  if (refreshToken) await authService.logout(refreshToken);
  res.clearCookie('refreshToken');
  res.status(200).json({ success: true, message: 'Logged out successfully' });
});

// Student activation (legacy — kept for backwards compat)
router.post('/student/activate', auth, [
  body('new_password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  validate
], async (req, res) => {
  try {
    const result = await authService.changePassword(req.user.id, req.body.new_password);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// STUDENT SELF-REGISTRATION — PUBLIC ENDPOINTS (no auth)
// ─────────────────────────────────────────────────────────

/**
 * GET /api/v1/auth/student/registration/cohorts
 * Returns cohorts where Class Teacher has opened self-registration.
 * Public — no auth required.
 */
router.get('/student/registration/cohorts', async (req, res) => {
  try {
    // Find all system_settings keys matching cohort_reg_*  = '1'
    const settings = await query(
      `SELECT setting_key, setting_value FROM system_settings
       WHERE setting_key LIKE 'cohort_reg_%' AND setting_value = '1'`
    );

    if (!settings || settings.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // Parse setting_key format: cohort_reg_{dept}_{branch}_{year}_{sem}_{ayId}
    const cohorts = [];
    for (const s of settings) {
      const parts = s.setting_key.replace('cohort_reg_', '').split('_');
      if (parts.length < 5) continue;
      const [deptId, branchId, year, semester, ayId] = parts.map(Number);

      const info = await query(
        `SELECT d.id as department_id, d.name as department_name, d.code as department_code,
                d.id as branch_id, d.name as branch_name, d.code as branch_code,
                ay.id as academic_year_id, ay.label as academic_year_label
         FROM departments d
         JOIN academic_years ay ON ay.id = ?
         WHERE d.id = ?`,
        [ayId, deptId]
      );

      if (info && info.length > 0) {
        cohorts.push({
          ...info[0],
          year: Number(year),
          semester: Number(semester)
        });
      }
    }

    res.json({ success: true, data: cohorts });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * GET /api/v1/auth/departments
 * Public list of active institutional departments for student and faculty registration.
 */
router.get('/departments', async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, name, code, degree_duration_years, active_term
       FROM departments
       WHERE is_active = 1
       ORDER BY id ASC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * GET /api/v1/auth/registration-gates
 * Public endpoint: Returns anti-spam registration gate status for HOD, Common Faculty, and each department.
 */
router.get('/registration-gates', async (req, res) => {
  try {
    const adminSettings = await query(
      `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('admin_reg_hod_open', 'admin_reg_common_faculty_open')`
    );
    const hodOpen = adminSettings.some(s => s.setting_key === 'admin_reg_hod_open' && s.setting_value === '1');
    const commonOpen = adminSettings.some(s => s.setting_key === 'admin_reg_common_faculty_open' && s.setting_value === '1');

    const departments = await query(
      `SELECT d.id, d.name, d.code, d.degree_duration_years, d.active_term, d.hod_user_id,
              t.full_name as hod_name, u.status as hod_status,
              (SELECT COUNT(*) FROM teacher_assignments ta JOIN teachers t2 ON ta.teacher_id = t2.id WHERE ta.department_id = d.id AND ta.is_active = 1) as teacher_count
       FROM departments d
       LEFT JOIN users u ON d.hod_user_id = u.id
       LEFT JOIN teachers t ON d.hod_user_id = t.user_id
       WHERE d.is_active = 1
       ORDER BY d.id ASC`
    );

    const facultyRegSettings = await query(
      `SELECT setting_key, setting_value FROM system_settings WHERE setting_key LIKE 'faculty_reg_dept_%'`
    );
    const studentRegSettings = await query(
      `SELECT setting_key, setting_value FROM system_settings WHERE (setting_key LIKE 'cohort_reg_%' OR setting_key LIKE 'cohort_reg_dept_%') AND setting_value = '1'`
    );

    const deptGates = departments.map(d => {
      const isHodActive = Boolean(d.hod_user_id && d.hod_status === 'ACTIVE');
      const facultyCount = (d.teacher_count || 0) + (isHodActive ? 1 : 0);
      const facKey = `faculty_reg_dept_${d.id}`;
      const isFacultyOpen = isHodActive && facultyRegSettings.some(s => s.setting_key === facKey && s.setting_value === '1');

      let facultyClosedReason = null;
      if (!isHodActive) {
        facultyClosedReason = `No active Head of Department (HOD) is currently appointed for ${d.name} to open registration.`;
      } else if (!isFacultyOpen) {
        facultyClosedReason = `The ${d.name} Head of Department has not opened faculty registration at this time.`;
      }

      // Check student registration
      const hasStudentOpen = studentRegSettings.some(s => 
        s.setting_key.startsWith(`cohort_reg_${d.id}_`) || s.setting_key === `cohort_reg_dept_${d.id}`
      );
      let studentClosedReason = null;
      if (facultyCount === 0) {
        studentClosedReason = `No faculty accounts exist yet for ${d.name}. Department faculty must be established and open registration before students can apply.`;
      } else if (!hasStudentOpen) {
        studentClosedReason = `Department faculty has not opened student registration for ${d.name} at this time.`;
      }

      return {
        id: d.id,
        name: d.name,
        code: d.code,
        degree_duration_years: d.degree_duration_years || 3,
        hod_active: isHodActive,
        hod_name: isHodActive ? d.hod_name : null,
        faculty_count: facultyCount,
        faculty_registration_open: isFacultyOpen,
        faculty_closed_reason: facultyClosedReason,
        student_registration_open: facultyCount > 0 && hasStudentOpen,
        student_closed_reason: studentClosedReason
      };
    });

    res.json({
      success: true,
      data: {
        admin: {
          hod_registration_open: hodOpen,
          common_faculty_registration_open: commonOpen,
          hod_closed_reason: hodOpen ? null : 'Institutional Administration has not opened HOD registration.',
          common_faculty_closed_reason: commonOpen ? null : 'Institutional Administration has not opened Common Faculty registration.'
        },
        departments: deptGates
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * GET /api/v1/auth/student/registration/status
 * Public endpoint: Checks if student registration is currently open for a specific branch and semester.
 */
router.get('/student/registration/status', async (req, res) => {
  const { department_id, branch_id, semester } = req.query;
  const effDeptId = Number(department_id || branch_id);
  const semNum = Number(semester);

  if (!effDeptId || !semNum) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'department_id and semester are required' } });
  }

  try {
    const deptRows = await query(
      `SELECT d.id, d.name, d.code, d.degree_duration_years, d.hod_user_id, u.status as hod_status
       FROM departments d
       LEFT JOIN users u ON d.hod_user_id = u.id
       WHERE d.id = ? AND d.is_active = 1`,
      [effDeptId]
    );
    if (!deptRows || deptRows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Branch / department not found' } });
    }
    const targetDept = deptRows[0];
    const isHodActive = Boolean(targetDept.hod_user_id && targetDept.hod_status === 'ACTIVE');

    // Count teachers
    const teacherCountRow = await query(
      `SELECT COUNT(*) as cnt FROM teacher_assignments ta JOIN teachers t ON ta.teacher_id = t.id WHERE ta.department_id = ? AND ta.is_active = 1`,
      [effDeptId]
    );
    const totalFaculty = (teacherCountRow[0]?.cnt || 0) + (isHodActive ? 1 : 0);

    if (totalFaculty === 0) {
      return res.json({
        success: true,
        data: {
          is_open: false,
          faculty_exists: false,
          reason: `Registration is closed for ${targetDept.name}. No faculty accounts exist yet for this branch. Department faculty must be established and open registration before students can apply.`
        }
      });
    }

    const effYear = Math.min(4, Math.ceil(semNum / 2));
    const ayRows = await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`);
    const ayId = ayRows[0]?.id || 1;

    const cohortKey = `cohort_reg_${effDeptId}_${effDeptId}_${effYear}_${semNum}_${ayId}`;
    const branchKey = `cohort_reg_dept_${effDeptId}`;

    const regSettings = await query(
      `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?, ?)`,
      [cohortKey, branchKey]
    );
    const isCohortOpen = regSettings.some(s => s.setting_key === cohortKey && s.setting_value === '1');
    const isBranchOpen = regSettings.some(s => s.setting_key === branchKey && s.setting_value === '1');
    const isOpen = isCohortOpen || isBranchOpen;

    res.json({
      success: true,
      data: {
        is_open: isOpen,
        faculty_exists: true,
        reason: isOpen 
          ? `Registration is open for ${targetDept.name} Semester ${semNum}. Applications will be reviewed by Department Faculty.`
          : `Registration is closed for ${targetDept.name} Semester ${semNum}. Department faculty has not opened student registration for this cohort.`
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/auth/student/register
 * Student self-registration. Creates a PENDING user account awaiting Department Faculty approval.
 * Public — no auth required. Rate-limited.
 */
router.post('/student/register', authLimiter, [
  body('full_name').trim().notEmpty().withMessage('Full name is required'),
  body('official_enrollment_no').trim().notEmpty().withMessage('Enrollment number is required'),
  body('email').isEmail().withMessage('Valid Gmail address is required').normalizeEmail({ gmail_remove_dots: false }),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('phone').optional().trim(),
  body('parent_phone').optional().trim(),
  body('parent_name').optional().trim(),
  body('department_id').optional().isInt(),
  body('branch_id').optional().isInt(),
  body('year').optional().isInt({ min: 1, max: 4 }),
  body('semester').isInt({ min: 1, max: 8 }).withMessage('Semester must be between 1 and 8'),
  validate
], async (req, res) => {
  const { full_name, official_enrollment_no, registration_no, email, password, phone, parent_phone, parent_name, otp_verification_token, department_id, branch_id, year, semester, google_sub, google_id_token } = req.body;
  const effDeptId = department_id || branch_id;
  if (!effDeptId) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Department is required' } });
  }

  try {
    // 1. Find current academic year
    const ayRows = await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`);
    if (!ayRows || ayRows.length === 0) {
      return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'No active academic year configured. Contact admin.' } });
    }
    const ayId = ayRows[0].id;

    // 2. Check if global student self-registration is disabled
    const globalRegToggle = await query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'allow_student_self_registration' LIMIT 1`
    );
    if (globalRegToggle && globalRegToggle.length > 0 && globalRegToggle[0].setting_value === 'false') {
      return res.status(403).json({
        success: false,
        error: { code: 'REGISTRATION_DISABLED', message: 'Student self-registration is currently disabled by institution administration.' }
      });
    }

    // 2b. Verify target department exists and is active
    const deptRows = await query(
      `SELECT d.id, d.name, d.code, d.degree_duration_years, d.hod_user_id, u.status as hod_status
       FROM departments d
       LEFT JOIN users u ON d.hod_user_id = u.id
       WHERE d.id = ? AND d.is_active = 1`,
      [effDeptId]
    );
    if (!deptRows || deptRows.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Selected branch / department does not exist or is inactive' } });
    }
    const targetDept = deptRows[0];
    const maxSem = (targetDept.degree_duration_years || 3) * 2;
    if (Number(semester) < 1 || Number(semester) > maxSem) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: `Semester must be between 1 and ${maxSem} for ${targetDept.name}` } });
    }

    const effYear = year ? Number(year) : Math.min(4, Math.ceil(Number(semester) / 2));

    // 2c. ANTI-SPAM PROTECTION & REGISTRATION GATE:
    // Check if faculty exists for this branch AND if department faculty has opened registration.
    const isHodActive = Boolean(targetDept.hod_user_id && targetDept.hod_status === 'ACTIVE');
    const teacherCountRow = await query(
      `SELECT COUNT(*) as cnt FROM teacher_assignments ta JOIN teachers t ON ta.teacher_id = t.id WHERE ta.department_id = ? AND ta.is_active = 1`,
      [effDeptId]
    );
    const totalFaculty = (teacherCountRow[0]?.cnt || 0) + (isHodActive ? 1 : 0);

    if (totalFaculty === 0) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'REGISTRATION_CLOSED',
          message: `Registration is closed for ${targetDept.name}. No faculty accounts exist yet for this branch. Department faculty must be established and open registration before students can apply.`
        }
      });
    }

    // Check if registration is open for this cohort/branch
    const cohortKey = `cohort_reg_${effDeptId}_${effDeptId}_${effYear}_${semester}_${ayId}`;
    const branchKey = `cohort_reg_dept_${effDeptId}`;
    const regSettings = await query(
      `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?, ?)`,
      [cohortKey, branchKey]
    );
    const isCohortOpen = regSettings.some(s => s.setting_key === cohortKey && s.setting_value === '1');
    const isBranchOpen = regSettings.some(s => s.setting_key === branchKey && s.setting_value === '1');

    if (!isCohortOpen && !isBranchOpen) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'REGISTRATION_CLOSED',
          message: `Registration is closed for ${targetDept.name} Semester ${semester}. Department faculty has not opened student registration for this cohort.`
        }
      });
    }

    // 3. Check enrollment number is not already taken
    const existingEnroll = await query(
      `SELECT u.id FROM students s JOIN users u ON s.user_id = u.id WHERE s.official_enrollment_no = ?`,
      [official_enrollment_no.trim()]
    );
    if (existingEnroll && existingEnroll.length > 0) {
      return res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: 'An account with this enrollment number already exists.' }
      });
    }

    // 4. Check email is not already taken
    const existingEmail = await query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)`,
      [email, email]
    );
    if (existingEmail && existingEmail.length > 0) {
      return res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: 'An account with this Gmail address already exists.' }
      });
    }

    // 4b. Optional Phone verification & uniqueness check
    let cleanPhone = null;
    if (phone && phone.trim()) {
      cleanPhone = otpService.normalizeIdentifier(phone);
      if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Mobile number must be a valid 10-digit Indian number.' } });
      }
      const existingPhone = await query(`SELECT id FROM users WHERE phone = ?`, [cleanPhone]);
      if (existingPhone && existingPhone.length > 0) {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'An account with this Mobile number already exists.' } });
      }
    }

    // 4c. Mandatory OTP Verification Check (WhatsApp / Mobile)
    if (!otp_verification_token || !otp_verification_token.trim()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'OTP_REQUIRED',
          message: 'WhatsApp OTP verification is mandatory. Please verify your WhatsApp mobile number before submitting.'
        }
      });
    }

    let tokenData;
    try {
      tokenData = await otpService.consumeVerificationToken(otp_verification_token.trim(), 'REGISTRATION');
    } catch (otpErr) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_OTP_TOKEN',
          message: otpErr.message || 'Invalid or expired OTP verification token. Please request a new WhatsApp OTP code.'
        }
      });
    }

    const tokenIdentifier = (tokenData.identifier || '').toLowerCase();
    const matchesEmail = Boolean(email && tokenIdentifier === email.toLowerCase());
    const matchesPhone = Boolean(cleanPhone && tokenIdentifier === cleanPhone);

    if (!matchesEmail && !matchesPhone) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'OTP_IDENTIFIER_MISMATCH',
          message: 'The verified OTP does not match the submitted WhatsApp mobile number.'
        }
      });
    }

    const isPhoneVerified = matchesPhone ? 1 : 0;

    // 5. Hash the student's chosen password
    const passwordHash = await bcrypt.hash(password, 12);

    let resolvedGoogleSub = (google_sub && typeof google_sub === 'string') ? google_sub.trim() : null;
    if (!resolvedGoogleSub && google_id_token) {
      try {
        const gPayload = await authService.verifyGoogleToken(google_id_token);
        if (gPayload && gPayload.sub) {
          resolvedGoogleSub = gPayload.sub;
        }
      } catch (_) {}
    }

    let createdUserId = null;
    let createdStudentId = null;

    // 6. Create records in a transaction
    await withTransaction(async (conn) => {
      // Create user (PENDING status, student sets own password, optional google_sub)
      const [uRes] = await conn.execute(
        `INSERT INTO users (username, email, phone, password_hash, must_change_password, status, google_sub)
         VALUES (?, ?, ?, ?, 0, 'PENDING', ?)`,
        [email.toLowerCase(), email.toLowerCase(), cleanPhone, passwordHash, resolvedGoogleSub]
      );
      createdUserId = uRes.insertId;

      // Assign STUDENT role
      await conn.execute(`INSERT INTO user_roles (user_id, role) VALUES (?, 'STUDENT')`, [createdUserId]);

      // Create student profile with phone, parent details, and UBTER registration_no
      const [sRes] = await conn.execute(
        `INSERT INTO students (user_id, official_enrollment_no, registration_no, full_name, phone, parent_phone, parent_name, is_phone_verified, entry_mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'self_registered')`,
        [
          createdUserId,
          official_enrollment_no.trim(),
          (registration_no || '').trim() || null,
          full_name.trim(),
          cleanPhone,
          parent_phone ? parent_phone.trim() : null,
          parent_name ? parent_name.trim() : null,
          isPhoneVerified
        ]
      );
      createdStudentId = sRes.insertId;

      // Create pending enrollment (class_roll_no is NULL until teacher assigns it)
      await conn.execute(
        `INSERT INTO enrollments (student_id, department_id, year, semester, academic_year_id, class_roll_no, status)
         VALUES (?, ?, ?, ?, ?, NULL, 'PENDING')`,
        [createdStudentId, effDeptId, effYear, semester, ayId]
      );
    });

    res.status(201).json({
      success: true,
      message: `Registration submitted successfully! Your account belongs to ${targetDept.name} and is pending approval by your Department Faculty. You can log in once approved.`,
      data: {
        student_id: createdStudentId,
        user_id: createdUserId,
        department_id: effDeptId,
        department_name: targetDept.name,
        department_code: targetDept.code,
        year: effYear,
        semester: Number(semester),
        status: 'PENDING',
        message: 'Registration is pending approval by Department Faculty.'
      }
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Enrollment number or email already exists.' } });
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Faculty & HOD Self-Registration (Public)
 * POST /api/v1/auth/faculty/register
 * 
 * 3-Tier Approval Routing (redesign.md Sections 7-11):
 * - Case A (Department Faculty): Routed to that department HOD (DEPT_HOD)
 * - Case B (Common Faculty): Routed to Common Faculty Manager (COMMON_FACULTY_MANAGER)
 * - Case C (HOD): Routed to System Admin (ADMIN)
 */
router.post('/faculty/register', authLimiter, [
  body('full_name').trim().notEmpty().withMessage('Full name is required'),
  body('email').isEmail().withMessage('Valid Gmail address is required').normalizeEmail({ gmail_remove_dots: false }),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('account_type').isIn(['FACULTY', 'HOD']).withMessage('Account type must be FACULTY or HOD'),
  body('department_id').optional({ nullable: true }),
  body('phone').optional().trim(),
  body('employee_id').optional().trim(),
  validate
], async (req, res) => {
  const { full_name, email, password, account_type, department_id, phone, employee_id, otp_verification_token } = req.body;
  const rawDeptId = (department_id === 'COMMON' || department_id === '' || department_id === null || department_id === undefined) 
    ? null 
    : Number(department_id);

  try {
    // 1. Check existing users by email/username
    const existingUser = await query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)`,
      [email, email]
    );
    if (existingUser && existingUser.length > 0) {
      return res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: 'An account with this Gmail address already exists.' }
      });
    }

    // 2. Check pending registration requests
    const existingReq = await query(
      `SELECT id FROM faculty_registration_requests WHERE LOWER(email) = LOWER(?) AND status = 'PENDING'`,
      [email]
    );
    if (existingReq && existingReq.length > 0) {
      return res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: 'A registration request with this Gmail address is already pending approval.' }
      });
    }

    // 3. Resolve approval type & validate department
    let approvalType = 'DEPT_HOD';
    let targetDeptId = rawDeptId;

    if (account_type === 'HOD') {
      if (!targetDeptId) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Department selection is mandatory for HOD registration.' }
        });
      }
      approvalType = 'ADMIN';

      // ANTI-SPAM GATE: Admin must open HOD registration
      const adminHodSetting = await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'admin_reg_hod_open' LIMIT 1`);
      const isHodOpen = adminHodSetting && adminHodSetting.length > 0 && adminHodSetting[0].setting_value === '1';
      if (!isHodOpen) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'REGISTRATION_CLOSED',
            message: 'Registration is closed for Head of Department (HOD) appointments. Institutional Administration must open HOD registration before applications can be submitted.'
          }
        });
      }
    } else {
      // FACULTY
      if (!targetDeptId) {
        approvalType = 'COMMON_FACULTY_MANAGER';
        targetDeptId = null;

        // ANTI-SPAM GATE: Admin must open Common Faculty registration
        const adminCommonSetting = await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'admin_reg_common_faculty_open' LIMIT 1`);
        const isCommonOpen = adminCommonSetting && adminCommonSetting.length > 0 && adminCommonSetting[0].setting_value === '1';
        if (!isCommonOpen) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'REGISTRATION_CLOSED',
              message: 'Registration is closed for Common Faculty. Institutional Administration must open common faculty registration before applications can be submitted.'
            }
          });
        }
      } else {
        approvalType = 'DEPT_HOD';

        // ANTI-SPAM GATE: Department HOD must be active AND HOD must open faculty registration
        const deptHODCheck = await query(
          `SELECT d.id, d.name, d.hod_user_id, u.status as hod_status 
           FROM departments d 
           LEFT JOIN users u ON d.hod_user_id = u.id 
           WHERE d.id = ? AND d.is_active = 1`,
          [targetDeptId]
        );
        if (!deptHODCheck || deptHODCheck.length === 0) {
          return res.status(404).json({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Selected department does not exist or is inactive.' }
          });
        }
        const deptInfo = deptHODCheck[0];
        if (!deptInfo.hod_user_id || deptInfo.hod_status !== 'ACTIVE') {
          return res.status(403).json({
            success: false,
            error: {
              code: 'REGISTRATION_CLOSED',
              message: `Registration is closed for ${deptInfo.name}. No active Head of Department (HOD) is currently appointed for this branch to open registration.`
            }
          });
        }

        const facSettingKey = `faculty_reg_dept_${targetDeptId}`;
        const deptRegSetting = await query(
          `SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1`,
          [facSettingKey]
        );
        const isDeptFacultyOpen = deptRegSetting && deptRegSetting.length > 0 && deptRegSetting[0].setting_value === '1';
        if (!isDeptFacultyOpen) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'REGISTRATION_CLOSED',
              message: `Registration is closed for ${deptInfo.name}. The Department HOD has not opened faculty registration at this time.`
            }
          });
        }
      }
    }

    if (targetDeptId) {
      const deptCheck = await query(`SELECT id, name FROM departments WHERE id = ? AND is_active = 1`, [targetDeptId]);
      if (!deptCheck || deptCheck.length === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Selected department does not exist or is inactive.' }
        });
      }
    }

    // Optional Phone format check if provided
    let cleanPhone = null;
    if (phone && phone.trim()) {
      cleanPhone = otpService.normalizeIdentifier(phone);
      if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Mobile number must be a valid 10-digit Indian number.' } });
      }
    }

    // Mandatory OTP Verification Check (WhatsApp / Mobile)
    if (!otp_verification_token || !otp_verification_token.trim()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'OTP_REQUIRED',
          message: 'WhatsApp OTP verification is mandatory. Please verify your WhatsApp mobile number before submitting.'
        }
      });
    }

    let tokenData;
    try {
      tokenData = await otpService.consumeVerificationToken(otp_verification_token.trim(), 'REGISTRATION');
    } catch (otpErr) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_OTP_TOKEN',
          message: otpErr.message || 'Invalid or expired OTP verification token. Please request a new WhatsApp OTP code.'
        }
      });
    }

    const tokenIdentifier = (tokenData.identifier || '').toLowerCase();
    const matchesEmail = Boolean(email && tokenIdentifier === email.toLowerCase());
    const matchesPhone = Boolean(cleanPhone && tokenIdentifier === cleanPhone);

    if (!matchesEmail && !matchesPhone) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'OTP_IDENTIFIER_MISMATCH',
          message: 'The verified OTP does not match the submitted WhatsApp mobile number.'
        }
      });
    }

    // 4. Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // 5. Insert registration request
    const result = await query(
      `INSERT INTO faculty_registration_requests 
       (full_name, email, password_hash, phone, employee_id, account_type, department_id, approval_type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [full_name.trim(), email.toLowerCase(), passwordHash, cleanPhone || (phone ? phone.trim() : null), employee_id ? employee_id.trim() : null, account_type, targetDeptId, approvalType]
    );

    const requestId = result.insertId ?? result.lastInsertRowid;

    // 6. User-friendly message based on routing
    let reviewMsg = 'Your registration request has been submitted successfully.';
    if (approvalType === 'ADMIN') {
      reviewMsg = 'Your HOD appointment request has been submitted and is pending review by the System Administrator.';
    } else if (approvalType === 'COMMON_FACULTY_MANAGER') {
      reviewMsg = 'Your common faculty registration has been submitted and is pending review by the Common Faculty Manager.';
    } else {
      reviewMsg = 'Your faculty registration has been submitted and is pending review by your Department HOD.';
    }

    res.status(201).json({
      success: true,
      message: reviewMsg,
      data: {
        request_id: requestId,
        full_name,
        email,
        account_type,
        department_id: targetDeptId,
        approval_type: approvalType,
        status: 'PENDING'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;
