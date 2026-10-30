/**
 * Auth Controller
 * Coordinates authentication, tokens, cookie management, OAuth workflows, and self-registration.
 *
 * Architecture Role: Controller (HTTP Coordination Layer)
 * Interacts With:
 *   - Models: models/authModel.js
 *   - Routes: routes/auth.js
 *   - Services: services/authService.js
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const AuthModel = require('../models/authModel');
const authService = require('../services/authService');
const { normalizePhone } = require('../utils/formatters');

function getClientInfo(req) {
  return {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    deviceId: req.body?.device_id || req.get('X-Device-Id') || null,
    forceLogout: req.body?.force_logout === true || req.body?.forceLogout === true
  };
}

class AuthController {
  /**
   * Handles faculty/admin credential login and sets secure refresh token cookie.
   * @route POST /api/v1/auth/faculty/login (routes/auth.js)
   * @access Public (Rate limited)
   * @usesService authService.facultyLogin() (services/authService.js)
   */
  static async facultyLogin(req, res) {
    const credential = (req.body.email || req.body.phone || req.body.username || req.body.identifier || req.body.credential || '').trim();
    if (!credential) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Gmail address or Mobile number is required' } });
    }
    try {
      const clientInfo = getClientInfo(req);
      const result = await authService.facultyLogin(credential, req.body.password, clientInfo);

      if (result.refresh_token) {
        res.cookie('refreshToken', result.refresh_token, {
          httpOnly: true, secure: process.env.NODE_ENV === 'production',
          sameSite: 'Strict', maxAge: 7 * 24 * 60 * 60 * 1000
        });
      }
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        error: {
          code: err.code || 'INTERNAL_SERVER_ERROR',
          message: err.message,
          active_session: err.active_session || undefined
        }
      });
    }
  }

  /**
   * Retrieves profile details and assigned roles for currently authenticated user.
   * @route GET /api/v1/auth/me (routes/auth.js)
   * @access Authenticated
   * @usesService authService.getMe() (services/authService.js)
   */
  static async getMe(req, res) {
    try {
      const result = await authService.getMe(req.user.id);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Handles student credential login and sets secure refresh token cookie.
   * @route POST /api/v1/auth/student/login (routes/auth.js)
   * @access Public (Rate limited)
   * @usesService authService.studentLogin() (services/authService.js)
   */
  static async studentLogin(req, res) {
    const credential = (req.body.email || req.body.phone || req.body.credential || req.body.identifier || req.body.username || req.body.enrollment_no || req.body.official_enrollment_no || req.body.registration_no || '').trim();
    if (!credential) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Gmail address or Mobile number is required' } });
    }
    try {
      const clientInfo = getClientInfo(req);
      const result = await authService.studentLogin(credential, req.body.password, clientInfo);

      if (result.refresh_token) {
        res.cookie('refreshToken', result.refresh_token, {
          httpOnly: true, secure: process.env.NODE_ENV === 'production',
          sameSite: 'Strict', maxAge: 7 * 24 * 60 * 60 * 1000
        });
      }
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        error: {
          code: err.code || 'INTERNAL_SERVER_ERROR',
          message: err.message,
          active_session: err.active_session || undefined
        }
      });
    }
  }

  /**
   * Universal login handler supporting faculty, admin, and student credentials.
   * @route POST /api/v1/auth/login (routes/auth.js)
   * @access Public (Rate limited)
   * @usesService authService.facultyLogin() (services/authService.js)
   * @usesService authService.studentLogin() (services/authService.js)
   */
  static async login(req, res) {
    const credential = (req.body.email || req.body.phone || req.body.credential || req.body.identifier || req.body.username || req.body.enrollment_no || '').trim();
    if (!credential) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Gmail address or Mobile number is required' } });
    }
    try {
      const clientInfo = getClientInfo(req);
      let result;
      try {
        result = await authService.facultyLogin(credential, req.body.password, clientInfo);
      } catch (err) {
        if (err.code === 'ENROLLMENT_LOGIN_DISABLED') throw err;
        if (err.code === 'ACCOUNT_ALREADY_ACTIVE') throw err;
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
      res.status(err.status || 500).json({
        success: false,
        error: {
          code: err.code || 'INTERNAL_SERVER_ERROR',
          message: err.message,
          active_session: err.active_session || undefined
        }
      });
    }
  }

  /**
   * Updates password for authenticated user and issues new JWT session token.
   * @route POST /api/v1/auth/change-password (routes/auth.js)
   * @access Authenticated
   * @usesService authService.changePassword() (services/authService.js)
   */
  static async changePassword(req, res) {
    try {
      const result = await authService.changePassword(req.user.id, req.body.new_password, req.body.current_password);
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
  }

  /**
   * Returns Google OAuth configuration status and public client ID.
   * @route GET /api/v1/auth/google/config (routes/auth.js)
   * @access Public
   */
  static getGoogleConfig(req, res) {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    res.status(200).json({
      success: true,
      data: {
        is_configured: !!clientId,
        client_id: clientId,
        callback_url: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/v1/auth/google/callback'
      }
    });
  }

  /**
   * Generates authorization redirect URL for Google OAuth flow.
   * @route GET /api/v1/auth/google/url (routes/auth.js)
   * @access Public
   * @usesService authService.getGoogleAuthUrl() (services/authService.js)
   */
  static getGoogleUrl(req, res) {
    const mode = req.query.mode || 'LOGIN';
    const userId = req.query.user_id || null;
    let frontendOrigin = req.query.origin || null;
    if (!frontendOrigin && req.get('referer')) {
      try { frontendOrigin = new URL(req.get('referer')).origin; } catch (_) {}
    }
    if (!frontendOrigin) {
      frontendOrigin = process.env.FRONTEND_URL || (req.get('host') && req.get('host').includes('onrender.com') ? 'https://vidyaos-pink.vercel.app' : '');
    }

    const authUrl = authService.getGoogleAuthUrl(mode, userId, frontendOrigin);
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
  }

  /**
   * Handles Google OAuth callback redirect, exchanging code for tokens and directing to portal.
   * @route GET /api/v1/auth/google/callback (routes/auth.js)
   * @access Public
   * @usesService authService.handleGoogleCallback() (services/authService.js)
   */
  static async handleGoogleCallback(req, res) {
    const { code, state, error } = req.query;

    let stateParsed = {};
    if (state) {
      try {
        stateParsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
      } catch {
        try { stateParsed = JSON.parse(Buffer.from(state, 'base64').toString('utf8')); } catch {}
      }
    }

    const defaultFrontend = process.env.FRONTEND_URL || (req.get('host') && req.get('host').includes('onrender.com') ? 'https://vidyaos-pink.vercel.app' : '');
    const frontendBase = stateParsed.frontendOrigin || defaultFrontend;

    if (error) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><title>Google Sign-In Cancelled</title></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8f9fa;">
          <div style="background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 400px; text-align: center;">
            <h2 style="color: #ea4335; margin-top: 0;">Sign-In Cancelled</h2>
            <p style="color: #5f6368; font-size: 0.9rem;">${error}</p>
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
              <a href="${frontendBase || ''}/login/faculty.html" style="background: #1a73e8; color: white; text-decoration: none; padding: 0.5rem 1rem; border-radius: 4px;">Return to Login</a>
              <button onclick="window.close()" style="background: #e0e0e0; color: #333; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">Close</button>
            </div>
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
      result.frontendOrigin = frontendBase;

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
              const origin = payload.frontendOrigin || (window.location.origin.includes('onrender.com') ? 'https://vidyaos-pink.vercel.app' : window.location.origin);
              if (payload.action === 'STUDENT_REGISTER') {
                window.location.href = origin + '/login/register.html?role=student&google_email=' + encodeURIComponent(payload.google_email) + '&google_name=' + encodeURIComponent(payload.google_name || '') + '&google_sub=' + encodeURIComponent(payload.google_sub || '');
              } else if (payload.action === 'PENDING_APPROVAL') {
                window.location.href = origin + '/login/index.html?role=student&google_pending=1&email=' + encodeURIComponent(payload.google_email || '');
              } else if (payload.action === 'NOT_REGISTERED') {
                window.location.href = origin + '/login/register.html?role=student&google_email=' + encodeURIComponent(payload.google_email) + '&google_name=' + encodeURIComponent(payload.google_name || '') + '&google_sub=' + encodeURIComponent(payload.google_sub || '');
              } else if (payload.access_token) {
                let target = '/faculty/dashboard.html';
                if (payload.user && payload.user.roles && payload.user.roles.includes('STUDENT')) {
                  target = '/student/dashboard.html';
                } else if (payload.user && payload.user.roles && payload.user.roles.includes('SYSTEM_ADMIN')) {
                  target = '/admin/dashboard.html';
                }
                window.location.href = origin + target + '?token=' + encodeURIComponent(payload.access_token) + '&user=' + encodeURIComponent(JSON.stringify(payload.user));
              } else {
                window.location.href = origin + '/faculty/profile.html?google_linked=1';
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
              <a href="${frontendBase || ''}/login/register.html?role=student" style="background: #1a73e8; color: white; border: none; padding: 0.65rem 1.2rem; border-radius: 6px; cursor: pointer; text-decoration: none; font-size: 0.9rem; font-weight: 500;">← Student Register</a>
              <a href="${frontendBase || ''}/login/index.html?role=student" style="background: #34a853; color: white; border: none; padding: 0.65rem 1.2rem; border-radius: 6px; cursor: pointer; text-decoration: none; font-size: 0.9rem; font-weight: 500;">Student Login</a>
              <a href="${frontendBase || ''}/login/index.html?role=faculty" style="background: #5f6368; color: white; border: none; padding: 0.65rem 1.2rem; border-radius: 6px; cursor: pointer; text-decoration: none; font-size: 0.9rem; font-weight: 500;">Faculty Login</a>
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
  }

  /**
   * Saves Google Cloud OAuth Client ID and Secret to .env file.
   * @route POST /api/v1/auth/google/save-credentials (routes/auth.js)
   * @access System Administration
   */
  static async saveGoogleCredentials(req, res) {
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
  }

  /**
   * Links Google account to authenticated user.
   * @route POST /api/v1/auth/google/link (routes/auth.js)
   * @access Authenticated
   * @usesService authService.linkGoogleAccount() (services/authService.js)
   */
  static async linkGoogleAccount(req, res) {
    try {
      const result = await authService.linkGoogleAccount(req.user.id, req.body.id_token);
      res.status(200).json({ success: true, data: result, message: 'Google account linked. You can now sign in with one click.' });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Logs in user via Google ID token.
   * @route POST /api/v1/auth/google (routes/auth.js)
   * @access Public (Rate limited)
   * @usesService authService.googleLogin() (services/authService.js)
   */
  static async googleLogin(req, res) {
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
  }

  /**
   * Refreshes expired access token using valid refresh token.
   * @route POST /api/v1/auth/refresh (routes/auth.js)
   * @access Public (Requires refresh token in cookie/body)
   * @usesService authService.refreshTokens() (services/authService.js)
   */
  static async refreshToken(req, res) {
    const refreshToken = req.cookies?.refreshToken || req.body?.refresh_token || req.body?.refreshToken || req.headers['x-refresh-token'];
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
  }

  /**
   * Logs out user, revoking refresh token and clearing cookie.
   * @route POST /api/v1/auth/logout (routes/auth.js)
   * @access Public
   * @usesService authService.logout() (services/authService.js)
   */
  static async logout(req, res) {
    try {
      const refreshToken = req.cookies?.refreshToken || req.body?.refresh_token;
      let sessionId = req.body?.session_id;
      let userId = null;

      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const { verifyAccessToken } = require('../utils/tokenHelper');
          const decoded = verifyAccessToken(authHeader.split(' ')[1]);
          if (decoded) {
            userId = decoded.user_id;
            sessionId = sessionId || decoded.session_id;
          }
        } catch (_) {}
      }

      await authService.logout({ refreshToken, sessionId, userId });
      res.clearCookie('refreshToken', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Strict', path: '/' });
      res.clearCookie('refreshToken', { path: '/' });
      res.clearCookie('refreshToken');
      res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (err) {
      res.status(200).json({ success: true, message: 'Logged out' });
    }
  }

  /**
   * Heartbeat ping to verify active user session.
   * @route GET /api/v1/auth/heartbeat (routes/auth.js)
   * @access Authenticated
   */
  static heartbeat(req, res) {
    res.status(200).json({
      success: true,
      active: true,
      user_id: req.user.id,
      session_id: req.user.session_id || null,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Activates student account by changing provisional password.
   * @route POST /api/v1/auth/student/activate (routes/auth.js)
   * @access Authenticated
   * @usesService authService.changePassword() (services/authService.js)
   */
  static async activateStudent(req, res) {
    try {
      const result = await authService.changePassword(req.user.id, req.body.new_password);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves open registration cohorts available for student self-registration.
   * @route GET /api/v1/auth/student/registration/cohorts (routes/auth.js)
   * @access Public
   * @usesModel AuthModel.getSettingsMatching() (models/authModel.js)
   * @usesModel AuthModel.getActiveAcademicYear() (models/authModel.js)
   * @usesModel AuthModel.getDepartmentById() (models/authModel.js)
   */
  static async getRegistrationCohorts(req, res) {
    try {
      const settings = await AuthModel.getSettingsMatching('cohort_reg_%');
      if (!settings || settings.length === 0) {
        return res.json({ success: true, data: [] });
      }

      const cohorts = [];
      const seenCohorts = new Set();
      const ay = await AuthModel.getActiveAcademicYear();

      for (const s of settings) {
        if (s.setting_key.startsWith('cohort_reg_dept_')) {
          const dId = parseInt(s.setting_key.replace('cohort_reg_dept_', ''), 10);
          const d = await AuthModel.getDepartmentById(dId);
          if (d) {
            const dur = d.degree_duration_years || 3;
            for (let sm = 1; sm <= dur * 2; sm++) {
              const yr = Math.min(dur, Math.ceil(sm / 2));
              const cKey = `${d.id}_${yr}_${sm}`;
              if (!seenCohorts.has(cKey)) {
                seenCohorts.add(cKey);
                cohorts.push({
                  department_id: d.id,
                  department_name: d.name,
                  department_code: d.code,
                  branch_id: d.id,
                  branch_name: d.name,
                  branch_code: d.code,
                  academic_year_id: ay.id,
                  academic_year_label: ay.label,
                  year: yr,
                  semester: sm
                });
              }
            }
          }
          continue;
        }

        const parts = s.setting_key.replace('cohort_reg_', '').split('_');
        if (parts.length < 5) continue;
        const [deptId, branchId, year, semester, ayId] = parts.map(Number);
        const cKey = `${deptId}_${year}_${semester}`;
        if (seenCohorts.has(cKey)) continue;

        const d = await AuthModel.getDepartmentById(deptId);
        if (d) {
          seenCohorts.add(cKey);
          cohorts.push({
            department_id: d.id,
            department_name: d.name,
            department_code: d.code,
            branch_id: d.id,
            branch_name: d.name,
            branch_code: d.code,
            academic_year_id: ay.id,
            academic_year_label: ay.label,
            year: Number(year),
            semester: Number(semester)
          });
        }
      }

      res.json({ success: true, data: cohorts });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves active academic departments.
   * @route GET /api/v1/auth/departments (routes/auth.js)
   * @access Public
   * @usesModel AuthModel.getActiveDepartments() (models/authModel.js)
   */
  static async getDepartments(req, res) {
    try {
      const rows = await AuthModel.getActiveDepartments();
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves registration gate statuses for all departments and admin tiers.
   * @route GET /api/v1/auth/registration-gates (routes/auth.js)
   * @access Public
   * @usesModel AuthModel.getRegistrationGatesData() (models/authModel.js)
   */
  static async getRegistrationGates(req, res) {
    try {
      const data = await AuthModel.getRegistrationGatesData();
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Checks whether student registration is currently open for a specific department and semester.
   * @route GET /api/v1/auth/student/registration/status (routes/auth.js)
   * @access Public
   * @usesModel AuthModel.getDepartmentById() (models/authModel.js)
   * @usesModel AuthModel.countDepartmentTeachers() (models/authModel.js)
   * @usesModel AuthModel.getActiveAcademicYear() (models/authModel.js)
   * @usesModel AuthModel.getSettingsIn() (models/authModel.js)
   */
  static async getStudentRegistrationStatus(req, res) {
    const { department_id, branch_id, semester } = req.query;
    const effDeptId = Number(department_id || branch_id);
    const semNum = Number(semester);

    if (!effDeptId || !semNum) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'department_id and semester are required' } });
    }

    try {
      const targetDept = await AuthModel.getDepartmentById(effDeptId);
      if (!targetDept) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Branch / department not found' } });
      }

      const isHodActive = Boolean(targetDept.hod_user_id && targetDept.hod_status === 'ACTIVE');
      const teacherCount = await AuthModel.countDepartmentTeachers(effDeptId);
      const totalFaculty = teacherCount + (isHodActive ? 1 : 0);

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
      const ay = await AuthModel.getActiveAcademicYear();

      const cohortKey = `cohort_reg_${effDeptId}_${effDeptId}_${effYear}_${semNum}_${ay.id}`;
      const branchKey = `cohort_reg_dept_${effDeptId}`;

      const regSettings = await AuthModel.getSettingsIn([cohortKey, branchKey]);
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
  }

  /**
   * Submits a student self-registration application in PENDING status.
   * @route POST /api/v1/auth/student/register (routes/auth.js)
   * @access Public (Rate limited)
   * @usesModel AuthModel.getActiveAcademicYear() (models/authModel.js)
   * @usesModel AuthModel.getSetting() (models/authModel.js)
   * @usesModel AuthModel.getDepartmentById() (models/authModel.js)
   * @usesModel AuthModel.countDepartmentTeachers() (models/authModel.js)
   * @usesModel AuthModel.getSettingsIn() (models/authModel.js)
   * @usesModel AuthModel.findExistingEnrollment() (models/authModel.js)
   * @usesModel AuthModel.findExistingUser() (models/authModel.js)
   * @usesModel AuthModel.findExistingPhone() (models/authModel.js)
   * @usesModel AuthModel.registerStudentTransaction() (models/authModel.js)
   * @usesService authService.verifyGoogleToken() (services/authService.js)
   */
  static async registerStudent(req, res) {
    const { full_name, official_enrollment_no, registration_no, email, password, phone, parent_phone, parent_name, department_id, branch_id, year, semester, google_sub, google_id_token } = req.body;
    const effDeptId = department_id || branch_id;
    if (!effDeptId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Department is required' } });
    }

    try {
      const ay = await AuthModel.getActiveAcademicYear();
      const globalRegToggle = await AuthModel.getSetting('allow_student_self_registration');
      if (globalRegToggle === 'false') {
        return res.status(403).json({
          success: false,
          error: { code: 'REGISTRATION_DISABLED', message: 'Student self-registration is currently disabled by institution administration.' }
        });
      }

      const targetDept = await AuthModel.getDepartmentById(effDeptId);
      if (!targetDept) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Selected branch / department does not exist or is inactive' } });
      }

      const maxSem = (targetDept.degree_duration_years || 3) * 2;
      if (Number(semester) < 1 || Number(semester) > maxSem) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: `Semester must be between 1 and ${maxSem} for ${targetDept.name}` } });
      }

      const effYear = year ? Number(year) : Math.min(4, Math.ceil(Number(semester) / 2));
      const isHodActive = Boolean(targetDept.hod_user_id && targetDept.hod_status === 'ACTIVE');
      const teacherCount = await AuthModel.countDepartmentTeachers(effDeptId);
      const totalFaculty = teacherCount + (isHodActive ? 1 : 0);

      if (totalFaculty === 0) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'REGISTRATION_CLOSED',
            message: `Registration is closed for ${targetDept.name}. No faculty accounts exist yet for this branch. Department faculty must be established and open registration before students can apply.`
          }
        });
      }

      const cohortKey = `cohort_reg_${effDeptId}_${effDeptId}_${effYear}_${semester}_${ay.id}`;
      const branchKey = `cohort_reg_dept_${effDeptId}`;
      const regSettings = await AuthModel.getSettingsIn([cohortKey, branchKey]);
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

      const cleanEnroll = official_enrollment_no.trim();
      const existingEnroll = await AuthModel.findExistingEnrollment(cleanEnroll);
      if (existingEnroll) {
        return res.status(409).json({
          success: false,
          error: { code: 'CONFLICT', message: `Official Enrollment Number "${cleanEnroll}" already exists in the system. Enrollment numbers are uniquely assigned once upon admission.` }
        });
      }

      const cleanEmail = email.trim();
      const existingEmail = await AuthModel.findExistingUser(cleanEmail, cleanEmail);
      if (existingEmail) {
        return res.status(409).json({
          success: false,
          error: { code: 'CONFLICT', message: `An account with this email address ("${cleanEmail}") already exists.` }
        });
      }

      let cleanPhone = null;
      if (phone && phone.trim()) {
        cleanPhone = normalizePhone(phone);
        if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
          return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Mobile number must be a valid 10-digit Indian number.' } });
        }
        const existingPhone = await AuthModel.findExistingPhone(cleanPhone);
        if (existingPhone) {
          return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'An account with this Mobile number already exists.' } });
        }
      }

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

      const result = await AuthModel.registerStudentTransaction({
        email: cleanEmail,
        cleanPhone,
        passwordHash,
        resolvedGoogleSub,
        officialEnrollmentNo: official_enrollment_no,
        registrationNo: registration_no,
        fullName: full_name,
        parentPhone: parent_phone,
        parentName: parent_name,
        effDeptId,
        effYear,
        semester,
        ayId: ay.id
      });

      res.status(201).json({
        success: true,
        message: `Registration submitted successfully! Your account belongs to ${targetDept.name} and is pending approval by your Department Faculty. You can log in once approved.`,
        data: {
          student_id: result.studentId,
          user_id: result.userId,
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
      if (err.code === 'ER_DUP_ENTRY' || err.code === 'SQLITE_CONSTRAINT') {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Enrollment number or email already exists.' } });
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Submits a faculty or HOD registration request pending administrative approval.
   * @route POST /api/v1/auth/faculty/register (routes/auth.js)
   * @access Public (Rate limited)
   * @usesModel AuthModel.findExistingUser() (models/authModel.js)
   * @usesModel AuthModel.findPendingFacultyRequest() (models/authModel.js)
   * @usesModel AuthModel.getSetting() (models/authModel.js)
   * @usesModel AuthModel.getDepartmentById() (models/authModel.js)
   * @usesModel AuthModel.createFacultyRequest() (models/authModel.js)
   */
  static async registerFaculty(req, res) {
    const { full_name, email, password, account_type, department_id, phone, employee_id } = req.body;
    const rawDeptId = (department_id === 'COMMON' || department_id === '' || department_id === null || department_id === undefined) 
      ? null 
      : Number(department_id);

    try {
      const existingUser = await AuthModel.findExistingUser(email, email);
      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: { code: 'CONFLICT', message: 'An account with this Gmail address already exists.' }
        });
      }

      const existingReq = await AuthModel.findPendingFacultyRequest(email);
      if (existingReq) {
        return res.status(409).json({
          success: false,
          error: { code: 'CONFLICT', message: 'A registration request with this Gmail address is already pending approval.' }
        });
      }

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

        const isHodOpen = (await AuthModel.getSetting('admin_reg_hod_open')) === '1';
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
        if (!targetDeptId) {
          approvalType = 'COMMON_FACULTY_MANAGER';
          targetDeptId = null;

          const isCommonOpen = (await AuthModel.getSetting('admin_reg_common_faculty_open')) === '1';
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
          const deptInfo = await AuthModel.getDepartmentById(targetDeptId);
          if (!deptInfo) {
            return res.status(404).json({
              success: false,
              error: { code: 'NOT_FOUND', message: 'Selected department does not exist or is inactive.' }
            });
          }

          if (!deptInfo.hod_user_id || deptInfo.hod_status !== 'ACTIVE') {
            return res.status(403).json({
              success: false,
              error: {
                code: 'REGISTRATION_CLOSED',
                message: `Registration is closed for ${deptInfo.name}. No active Head of Department (HOD) is currently appointed for this branch to open registration.`
              }
            });
          }

          const isDeptFacultyOpen = (await AuthModel.getSetting(`faculty_reg_dept_${targetDeptId}`)) === '1';
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
        const deptCheck = await AuthModel.getDepartmentById(targetDeptId);
        if (!deptCheck) {
          return res.status(404).json({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Selected department does not exist or is inactive.' }
          });
        }
      }

      let cleanPhone = null;
      if (phone && phone.trim()) {
        cleanPhone = normalizePhone(phone);
        if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
          return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Mobile number must be a valid 10-digit Indian number.' } });
        }
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const requestId = await AuthModel.createFacultyRequest({
        fullName: full_name,
        email,
        passwordHash,
        cleanPhone,
        phone,
        employeeId: employee_id,
        accountType: account_type,
        targetDeptId,
        approvalType
      });

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
  }
}

module.exports = AuthController;
