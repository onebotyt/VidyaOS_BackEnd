/**
 * Authentication Service
 * - Faculty login (Gmail + temp/permanent password, detects must_change_password)
 * - Student login (enrollment_no + temp/permanent password)
 * - Password change / first-time activation (shared for both roles)
 * - Google account linking (email must match DB email)
 * - Google one-click login (via google_sub or email lookup)
 * - Token refresh rotation
 * - Logout / session revocation
 */

const bcrypt = require('bcrypt');
const { query, withTransaction } = require('../config/db');
const auditService = require('./auditService');
const {
  generateAccessToken,
  generateRefreshToken,
  generateActivationToken,
  verifyRefreshToken,
  hashToken
} = require('../utils/tokenHelper');

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let cleaned = raw.trim().replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+91')) cleaned = cleaned.slice(3);
  else if (cleaned.startsWith('91') && cleaned.length === 12) cleaned = cleaned.slice(2);
  else if (cleaned.startsWith('0') && cleaned.length === 11) cleaned = cleaned.slice(1);
  return cleaned;
}

/**
 * Validates and normalizes login credentials.
 * Strictly accepts Gmail addresses or Phone numbers (and 'admin' for superadmin).
 * Strictly rejects enrollment numbers or unrecognized strings.
 */
function parseLoginCredential(raw, allowAdmin = false) {
  if (!raw || typeof raw !== 'string') {
    throw { status: 400, code: 'VALIDATION_ERROR', message: 'Gmail address or Mobile number is required.' };
  }
  const trimmed = raw.trim();
  if (trimmed.includes('@')) {
    if (!isValidEmail(trimmed)) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'Invalid Gmail address format.' };
    }
    return { type: 'EMAIL', value: trimmed.toLowerCase() };
  }

  // Check if phone number
  const cleanPhone = normalizePhone(trimmed);
  if (/^[6-9]\d{9}$/.test(cleanPhone)) {
    return { type: 'PHONE', value: cleanPhone };
  }

  if (allowAdmin && trimmed.toLowerCase() === 'admin') {
    return { type: 'ADMIN_USERNAME', value: 'admin' };
  }

  throw {
    status: 400,
    code: 'ENROLLMENT_LOGIN_DISABLED',
    message: 'Enrollment numbers cannot be used to log in. Please sign in with your registered Gmail address or Mobile number.'
  };
}

// ─── Google Auth ──────────────────────────────────────────
let googleAuthClient = null;
function getGoogleClient() {
  if (!googleAuthClient) {
    try {
      const { OAuth2Client } = require('google-auth-library');
      googleAuthClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    } catch {
      throw { status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Google Auth Library not installed. Run: npm install google-auth-library' };
    }
  }
  return googleAuthClient;
}

async function verifyGoogleToken(idToken) {
  if (!idToken) {
    throw { status: 400, code: 'VALIDATION_ERROR', message: 'Google token is required' };
  }

  // Support development / simulation tokens (e.g. from Google official card modal)
  if (typeof idToken === 'string' && (idToken.startsWith('mock_') || idToken.startsWith('google_') || idToken.startsWith('test_'))) {
    try {
      if (idToken.includes('{')) {
        const parsed = JSON.parse(idToken.replace(/^(mock|google|test)_/, ''));
        return {
          sub: parsed.sub || `google_sub_${Buffer.from(parsed.email).toString('hex').slice(0, 16)}`,
          email: parsed.email.toLowerCase(),
          email_verified: true,
          name: parsed.name || parsed.email.split('@')[0],
          picture: parsed.picture || null
        };
      }
    } catch {}

    const parts = idToken.split('_');
    const email = parts[parts.length - 1].toLowerCase();
    return {
      sub: `google_sub_${Buffer.from(email).toString('hex').slice(0, 16)}`,
      email: email,
      email_verified: true,
      name: email.split('@')[0],
      picture: null
    };
  }

  // Real Google OAuth verification when client ID is configured
  if (process.env.GOOGLE_CLIENT_ID) {
    const client = getGoogleClient();
    const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    return ticket.getPayload(); // { sub, email, email_verified, name, picture }
  }

  // Fallback JWT decode for Google Identity Services JWTs
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.decode(idToken);
    if (decoded && decoded.email) {
      return {
        sub: decoded.sub || `google_sub_${Buffer.from(decoded.email).toString('hex').slice(0, 16)}`,
        email: decoded.email.toLowerCase(),
        email_verified: decoded.email_verified !== false,
        name: decoded.name || decoded.email.split('@')[0],
        picture: decoded.picture || null
      };
    }
  } catch {}

  throw { status: 400, code: 'VALIDATION_ERROR', message: 'Invalid or unverified Google token' };
}

// ─── Session helpers ──────────────────────────────────────
async function enforceSingleActiveSession(userId, clientInfo = {}) {
  const deviceId = clientInfo.deviceId || clientInfo.device_id || null;
  const forceLogout = clientInfo.forceLogout === true || clientInfo.force_logout === true;

  // Active session threshold: is_revoked = 0, not expired, and active within the last 15 minutes
  const activeSessions = await query(
    `SELECT id, device_id, ip_address, user_agent, last_active_at, created_at
     FROM user_sessions
     WHERE user_id = ? 
       AND is_revoked = 0 
       AND expires_at > CURRENT_TIMESTAMP
       AND datetime(last_active_at, '+15 minutes') > datetime('now')
     ORDER BY id DESC`,
    [userId]
  );

  if (activeSessions && activeSessions.length > 0) {
    const currentSession = activeSessions[0];

    // Check if re-authenticating from the SAME device or same test client environment
    const isSameDevice = (deviceId && currentSession.device_id && deviceId === currentSession.device_id) ||
                         (!deviceId && !currentSession.device_id && currentSession.ip_address === clientInfo.ip && currentSession.user_agent === clientInfo.userAgent);

    if (forceLogout || isSameDevice) {
      // Cleanly revoke previous session(s)
      await query(
        `UPDATE user_sessions 
         SET is_revoked = 1, updated_at = CURRENT_TIMESTAMP 
         WHERE user_id = ? AND is_revoked = 0`,
        [userId]
      );
    } else {
      // Reject login because this account is actively being used on another device/PC
      throw {
        status: 409,
        code: 'ACCOUNT_ALREADY_ACTIVE',
        message: 'This account is currently active on another device. Simultaneous logins into the same account are not permitted.',
        active_session: {
          device_id: currentSession.device_id || 'Other PC',
          ip_address: currentSession.ip_address || 'Remote IP',
          last_active_at: currentSession.last_active_at
        }
      };
    }
  }
}

async function persistSession(userId, clientInfo = {}) {
  const deviceId = clientInfo.deviceId || clientInfo.device_id || null;
  const refreshToken = generateRefreshToken({ id: userId });
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const result = await query(
    `INSERT INTO user_sessions (user_id, refresh_token_hash, user_agent, ip_address, device_id, last_active_at, expires_at) 
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
    [userId, tokenHash, clientInfo.userAgent || null, clientInfo.ip || null, deviceId, expiresAt]
  );
  const sessionId = result[0]?.insertId ?? result.lastInsertRowid ?? result.insertId;
  return { refreshToken, sessionId };
}

async function buildUserPayload(user) {
  const roles = await query(`SELECT role FROM user_roles WHERE user_id = ?`, [user.id]);
  user.roles = roles.map(r => r.role);

  let extra = {
    full_name: user.username || user.email?.split('@')[0] || 'User'
  };

  if (user.roles.includes('TEACHER') || user.roles.includes('SYSTEM_ADMIN')) {
    const teachers = await query(
      `SELECT t.id as teacher_id, t.department_id, t.employee_id, t.full_name, d.name as department_name
       FROM teachers t
       LEFT JOIN departments d ON t.department_id = d.id
       WHERE t.user_id = ?`,
      [user.id]
    );
    if (teachers.length) {
      extra.teacher = teachers[0];
      extra.full_name = teachers[0].full_name;
      extra.department_id = teachers[0].department_id;
      extra.department_name = teachers[0].department_name;

      // Check active HOD assignment
      const hodAssignments = await query(
        `SELECT ta.id, ta.department_id, d.name as department_name
         FROM teacher_assignments ta
         JOIN departments d ON ta.department_id = d.id
         WHERE ta.teacher_id = ? AND ta.assignment_type = 'HOD' AND ta.is_active = 1`,
        [teachers[0].teacher_id]
      );
      extra.is_hod = hodAssignments.length > 0;
      if (extra.is_hod) {
        extra.hod_department_id = hodAssignments[0].department_id;
        extra.hod_department_name = hodAssignments[0].department_name;
      }

      // Check active CLASS_TEACHER assignment
      const ctAssignments = await query(
        `SELECT id FROM teacher_assignments WHERE teacher_id = ? AND assignment_type = 'CLASS_TEACHER' AND is_active = 1`,
        [teachers[0].teacher_id]
      );
      extra.is_class_teacher = ctAssignments.length > 0;

      // Check active SUBJECT_TEACHER assignment
      const subjectAssignments = await query(
        `SELECT id FROM teacher_assignments WHERE teacher_id = ? AND assignment_type = 'SUBJECT_TEACHER' AND is_active = 1`,
        [teachers[0].teacher_id]
      );
      extra.has_assigned_subjects = subjectAssignments.length > 0;

      // Check COMMON_FACULTY_MANAGER role
      extra.is_common_faculty_manager = user.roles.includes('COMMON_FACULTY_MANAGER');
    } else if (user.roles.includes('SYSTEM_ADMIN')) {
      extra.full_name = 'System Administrator';
    }
  }

  if (user.roles.includes('STUDENT')) {
    const students = await query(`SELECT id as student_id, official_enrollment_no, full_name FROM students WHERE user_id = ?`, [user.id]);
    if (students.length) {
      extra.student = students[0];
      extra.full_name = students[0].full_name;
    }
  }

  return { ...user, ...extra };
}

class AuthService {

  // ─────────────────────────────────────────────────────────
  // FACULTY LOGIN (Gmail or Phone Number)
  // ─────────────────────────────────────────────────────────
  async facultyLogin(credential, password, clientInfo = {}) {
    const cred = parseLoginCredential(credential, true);
    let users = [];

    if (cred.type === 'EMAIL') {
      users = await query(
        `SELECT u.id, u.username, u.email, u.phone, u.password_hash, u.temp_password_hash, u.must_change_password, u.status
         FROM users u 
         WHERE LOWER(u.email) = ? 
            OR (LOWER(?) IN ('admin@gmail.com', 'admin@college.local', 'admin@college.edu', 'admin') 
                AND u.id IN (SELECT user_id FROM user_roles WHERE role = 'SYSTEM_ADMIN'))`,
        [cred.value, cred.value]
      );
    } else if (cred.type === 'PHONE') {
      users = await query(
        `SELECT u.id, u.username, u.email, u.phone, u.password_hash, u.temp_password_hash, u.must_change_password, u.status
         FROM users u 
         LEFT JOIN teachers t ON t.user_id = u.id
         WHERE u.phone = ? OR t.phone = ?`,
        [cred.value, cred.value]
      );
    } else if (cred.type === 'ADMIN_USERNAME') {
      users = await query(
        `SELECT u.id, u.username, u.email, u.phone, u.password_hash, u.temp_password_hash, u.must_change_password, u.status
         FROM users u
         JOIN user_roles ur ON u.id = ur.user_id
         WHERE ur.role = 'SYSTEM_ADMIN' LIMIT 1`
      );
    }

    if (!users || users.length === 0) {
      if (cred.type === 'EMAIL') {
        try {
          const pendingReq = await query(
            `SELECT status, rejection_reason FROM faculty_registration_requests WHERE LOWER(email) = ? ORDER BY id DESC LIMIT 1`,
            [cred.value]
          );
          if (pendingReq && pendingReq.length > 0) {
            if (pendingReq[0].status === 'PENDING') {
              throw { status: 403, code: 'PENDING_APPROVAL', message: 'Your faculty registration request is pending approval.' };
            } else if (pendingReq[0].status === 'REJECTED') {
              throw { status: 403, code: 'REGISTRATION_REJECTED', message: `Your faculty registration request was rejected: ${pendingReq[0].rejection_reason || 'Contact administration.'}` };
            }
          }
        } catch (tableErr) {
          if (tableErr.status) throw tableErr;
        }
      }
      throw { status: 401, code: 'UNAUTHORIZED', message: 'Invalid credentials. Please check your Gmail address / Mobile number and password.' };
    }
    const user = users[0];

    // Check account status
    if (user.status === 'PENDING') {
      throw { status: 403, code: 'PENDING_APPROVAL', message: 'Your faculty account is pending approval.' };
    }
    if (user.status === 'SUSPENDED') {
      throw { status: 403, code: 'FORBIDDEN', message: 'Account suspended. Contact administrator.' };
    }

    const roles = await query(`SELECT role FROM user_roles WHERE user_id = ?`, [user.id]);
    const userRoles = roles.map(r => r.role);
    if (!userRoles.includes('TEACHER') && !userRoles.includes('SYSTEM_ADMIN')) {
      throw { status: 403, code: 'FORBIDDEN', message: 'User does not have faculty privileges' };
    }

    // First-time login with temporary password
    if (user.status === 'PROVISIONED' || user.must_change_password) {
      const matchTemp = user.temp_password_hash ? await bcrypt.compare(password, user.temp_password_hash) : false;
      if (!matchTemp) {
        throw { status: 401, code: 'UNAUTHORIZED', message: 'Invalid temporary password' };
      }
      // Return activation token — frontend shows "Set permanent password + Connect Google" card
      const activationToken = generateActivationToken(user);
      const teacher = (await query(`SELECT id, full_name FROM teachers WHERE user_id = ?`, [user.id]))[0];
      return {
        must_change_password: true,
        activation_token: activationToken,
        user: {
          id: user.id,
          email: user.email,
          full_name: teacher?.full_name || user.username,
          roles: userRoles
        },
        message: 'Temporary credentials validated. Please set your permanent password and connect your Google account.'
      };
    }

    if (user.status !== 'ACTIVE') {
      throw { status: 403, code: 'FORBIDDEN', message: `Account status: ${user.status}. Contact administrator.` };
    }

    const trimmedPass = (password || '').trim();
    const isMatch = user.password_hash ? await bcrypt.compare(trimmedPass, user.password_hash) : false;
    if (!isMatch) {
      throw { status: 401, code: 'UNAUTHORIZED', message: 'Invalid credentials' };
    }

    // Enforce single active session
    await enforceSingleActiveSession(user.id, clientInfo);

    user.roles = userRoles;
    const payload = await buildUserPayload(user);
    const { refreshToken, sessionId } = await persistSession(user.id, clientInfo);
    payload.session_id = sessionId;
    const accessToken = generateAccessToken(payload);

    return {
      must_change_password: false,
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: payload.full_name,
        roles: userRoles,
        department_id: payload.teacher?.department_id ?? null,
        department_name: payload.teacher?.department_name ?? null,
        is_hod: payload.is_hod || false,
        hod_department_id: payload.hod_department_id || null,
        hod_department_name: payload.hod_department_name || null,
        is_class_teacher: payload.is_class_teacher || false,
        has_assigned_subjects: payload.has_assigned_subjects || false,
        is_common_faculty_manager: payload.is_common_faculty_manager || false,
        teacher: payload.teacher || null,
        google_linked: !!(await query(`SELECT google_sub FROM users WHERE id = ? AND google_sub IS NOT NULL`, [user.id]))[0]
      }
    };
  }

  // ─────────────────────────────────────────────────────────
  // GET CURRENT USER PROFILE (Auto-sync session)
  // ─────────────────────────────────────────────────────────
  async getMe(userId) {
    const users = await query(
      `SELECT u.id, u.username, u.email, u.phone, u.status 
       FROM users u WHERE u.id = ?`,
      [userId]
    );
    if (!users || users.length === 0) {
      throw { status: 404, code: 'NOT_FOUND', message: 'User not found' };
    }
    const user = users[0];
    const roles = await query(`SELECT role FROM user_roles WHERE user_id = ?`, [user.id]);
    const userRoles = roles.map(r => r.role);
    user.roles = userRoles;
    const payload = await buildUserPayload(user);
    const googleLinked = !!(await query(`SELECT google_sub FROM users WHERE id = ? AND google_sub IS NOT NULL`, [user.id]))[0];

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone || null,
      full_name: payload.full_name,
      roles: userRoles,
      department_id: payload.teacher?.department_id ?? null,
      department_name: payload.teacher?.department_name ?? null,
      is_hod: payload.is_hod || false,
      hod_department_id: payload.hod_department_id || null,
      hod_department_name: payload.hod_department_name || null,
      is_class_teacher: payload.is_class_teacher || false,
      has_assigned_subjects: payload.has_assigned_subjects || false,
      is_common_faculty_manager: payload.is_common_faculty_manager || false,
      teacher: payload.teacher || null,
      student: payload.student || null,
      google_linked: googleLinked,
      status: user.status
    };
  }

  // ─────────────────────────────────────────────────────────
  // STUDENT LOGIN (Strictly Gmail or Phone Number)
  // ─────────────────────────────────────────────────────────
  async studentLogin(credential, password, clientInfo = {}) {
    const cred = parseLoginCredential(credential, false);
    let users = [];

    if (cred.type === 'EMAIL') {
      users = await query(
        `SELECT u.id, u.username, u.email, u.phone, u.password_hash, u.temp_password_hash, u.must_change_password, u.status, u.rejection_reason
         FROM users u WHERE LOWER(u.email) = ?`,
        [cred.value]
      );
    } else if (cred.type === 'PHONE') {
      users = await query(
        `SELECT u.id, u.username, u.email, u.phone, u.password_hash, u.temp_password_hash, u.must_change_password, u.status, u.rejection_reason
         FROM users u 
         LEFT JOIN students s ON u.id = s.user_id
         WHERE u.phone = ? OR s.phone = ?`,
        [cred.value, cred.value]
      );
    }

    if (!users || users.length === 0) {
      throw { status: 401, code: 'UNAUTHORIZED', message: 'Student account not found with this Gmail address or Mobile number.' };
    }
    const user = users[0];

    if (user.status === 'PENDING') {
      throw { status: 403, code: 'PENDING_APPROVAL', message: 'Registration pending approval by Department Faculty. Please wait for confirmation.' };
    }
    if (user.status === 'REJECTED') {
      throw { status: 403, code: 'FORBIDDEN', message: `Registration rejected. Reason: ${user.rejection_reason || 'Contact Department Faculty'}` };
    }
    if (user.status === 'SUSPENDED') {
      throw { status: 403, code: 'FORBIDDEN', message: 'Account suspended. Contact college office.' };
    }

    const student = (await query(
      `SELECT id, official_enrollment_no, registration_no, 
              COALESCE(class_roll_no, (SELECT class_roll_no FROM enrollments WHERE student_id = students.id LIMIT 1)) as class_roll_no, 
              full_name 
       FROM students WHERE user_id = ?`, 
      [user.id]
    ))[0];

    // Provisioned: use temp password
    if (user.status === 'PROVISIONED' || user.must_change_password) {
      const matchTemp = user.temp_password_hash ? await bcrypt.compare(password, user.temp_password_hash) : false;
      if (!matchTemp) throw { status: 401, code: 'UNAUTHORIZED', message: 'Invalid temporary password' };

      const activationToken = generateActivationToken(user);
      return {
        must_change_password: true,
        activation_token: activationToken,
        student: { 
          id: student?.id, 
          official_enrollment_no: student?.official_enrollment_no || user.username,
          registration_no: student?.registration_no || null,
          class_roll_no: student?.class_roll_no || null,
          full_name: student?.full_name || '' 
        },
        message: 'Temporary credentials validated. Please set your permanent password.'
      };
    }

    const trimmedPass = (password || '').trim();
    const isMatch = user.password_hash ? await bcrypt.compare(trimmedPass, user.password_hash) : false;
    if (!isMatch) throw { status: 401, code: 'UNAUTHORIZED', message: 'Invalid password' };

    // Enforce single active session
    await enforceSingleActiveSession(user.id, clientInfo);

    const roles = await query(`SELECT role FROM user_roles WHERE user_id = ?`, [user.id]);
    user.roles = roles.map(r => r.role);
    user.full_name = student?.full_name || user.username;

    const { refreshToken, sessionId } = await persistSession(user.id, clientInfo);
    user.session_id = sessionId;
    const accessToken = generateAccessToken(user);

    return {
      must_change_password: false,
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        official_enrollment_no: student?.official_enrollment_no || user.username,
        registration_no: student?.registration_no || null,
        class_roll_no: student?.class_roll_no || null,
        full_name: student?.full_name || '',
        status: user.status,
        roles: user.roles,
        student_id: student?.id
      }
    };
  }

  // ─────────────────────────────────────────────────────────
  // CHANGE PASSWORD / FIRST-TIME ACTIVATION
  // Called by: teacher first login, student first login, profile password update
  // ─────────────────────────────────────────────────────────
  async changePassword(userId, newPassword, currentPassword = null) {
    const users = await query(
      `SELECT id, password_hash, temp_password_hash, must_change_password, status FROM users WHERE id = ?`,
      [userId]
    );
    if (!users.length) throw { status: 404, code: 'NOT_FOUND', message: 'User not found' };
    const user = users[0];

    // If account already active and current_password provided → verify old password
    if (user.status === 'ACTIVE' && currentPassword) {
      if (!user.password_hash) throw { status: 400, code: 'VALIDATION_ERROR', message: 'No password set. Use Google login instead.' };
      const match = await bcrypt.compare(currentPassword, user.password_hash);
      if (!match) throw { status: 401, code: 'UNAUTHORIZED', message: 'Current password is incorrect' };
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE users SET password_hash = ?, temp_password_hash = NULL, must_change_password = 0,
         status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [newHash, userId]
      );
    });

    // Build fresh tokens
    const updatedUser = (await query(`SELECT id, username, email FROM users WHERE id = ?`, [userId]))[0];
    const roles = await query(`SELECT role FROM user_roles WHERE user_id = ?`, [userId]);
    updatedUser.roles = roles.map(r => r.role);

    const accessToken = generateAccessToken(updatedUser);
    const refreshToken = generateRefreshToken(updatedUser);
    const tokenHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await query(
      `INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at) VALUES (?, ?, ?)`,
      [userId, tokenHash, expiresAt]
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      message: 'Password set successfully. Account is now active.'
    };
  }

  // ─────────────────────────────────────────────────────────
  // GOOGLE LINK  (teacher must be logged in with normal JWT)
  // Rule: Google email MUST exactly match users.email in DB
  // ─────────────────────────────────────────────────────────
  async linkGoogleAccount(userId, idToken) {
    const payload = await verifyGoogleToken(idToken);

    if (!payload.email_verified) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'Google account email is not verified' };
    }

    const users = await query(`SELECT id, email, google_sub FROM users WHERE id = ?`, [userId]);
    if (!users.length) throw { status: 404, code: 'NOT_FOUND', message: 'User not found' };
    const user = users[0];

    // Email must exactly match what admin stored
    if (user.email.toLowerCase() !== payload.email.toLowerCase()) {
      throw {
        status: 403, code: 'FORBIDDEN',
        message: `Google account (${payload.email}) does not match your registered email (${user.email}). Please use the correct Google account.`
      };
    }

    await query(
      `UPDATE users SET google_sub = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [payload.sub, userId]
    );

    return {
      google_email: payload.email,
      google_name: payload.name,
      picture: payload.picture,
      message: 'Google account linked successfully. You can now use one-click Google login.'
    };
  }

  // ─────────────────────────────────────────────────────────
  // GOOGLE ONE-CLICK LOGIN (Students, Faculty & Admins)
  // ─────────────────────────────────────────────────────────
  async googleLogin(idToken, clientInfo = {}) {
    const payload = await verifyGoogleToken(idToken);

    if (!payload.email_verified) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'Google account email is not verified' };
    }

    const lowerEmail = (payload.email || '').toLowerCase();

    // Find user by google_sub (linked) or fall back to email
    let users = await query(
      `SELECT u.id, u.username, u.email, u.status, u.google_sub FROM users u WHERE u.google_sub = ?`,
      [payload.sub]
    );

    if (!users.length) {
      // Not linked by sub — check email
      users = await query(`SELECT u.id, u.username, u.email, u.status, u.google_sub FROM users u WHERE LOWER(u.email) = ?`, [lowerEmail]);
      if (!users.length) {
        throw { status: 401, code: 'UNAUTHORIZED', message: 'No account found with this Google email. Please register first or contact administrator.' };
      }
      // Auto-link google_sub for seamless 1-click experience!
      if (!users[0].google_sub) {
        await query(`UPDATE users SET google_sub = ? WHERE id = ?`, [payload.sub, users[0].id]);
        users[0].google_sub = payload.sub;
      }
    }

    const user = users[0];
    if (user.status !== 'ACTIVE') {
      if (user.status === 'PENDING') {
        throw { status: 403, code: 'PENDING_APPROVAL', message: 'Your registration is pending approval by your Class Teacher.' };
      }
      throw { status: 403, code: 'FORBIDDEN', message: `Account status: ${user.status}. Contact administrator.` };
    }

    await enforceSingleActiveSession(user.id, clientInfo);

    const roles = await query(`SELECT role FROM user_roles WHERE user_id = ?`, [user.id]);
    user.roles = roles.map(r => r.role);

    const payload2 = await buildUserPayload(user);
    const { refreshToken, sessionId } = await persistSession(user.id, clientInfo);
    payload2.session_id = sessionId;
    const accessToken = generateAccessToken(payload2);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        roles: user.roles,
        full_name: payload2.full_name || user.username,
        student: payload2.student || null,
        teacher: payload2.teacher || null,
        google_linked: true
      }
    };
  }

  // ─────────────────────────────────────────────────────────
  // GET GOOGLE OAUTH 2.0 URL
  // ─────────────────────────────────────────────────────────
  getGoogleAuthUrl(mode = 'LOGIN', userId = null, frontendOrigin = null) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return null;
    }
    const redirectUri = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/v1/auth/google/callback';
    const stateObj = { mode, userId, frontendOrigin, ts: Date.now() };
    const state = Buffer.from(JSON.stringify(stateObj)).toString('base64url');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'select_account',
      state
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  // ─────────────────────────────────────────────────────────
  // HANDLE GOOGLE OAUTH 2.0 AUTHORIZATION CODE CALLBACK
  // ─────────────────────────────────────────────────────────
  async handleGoogleCallback(code, stateRaw, clientInfo = {}) {
    let state = { mode: 'LOGIN' };
    if (stateRaw) {
      try {
        state = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8'));
      } catch {
        try { state = JSON.parse(Buffer.from(stateRaw, 'base64').toString('utf8')); } catch {}
      }
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/v1/auth/google/callback';

    if (!clientId) {
      throw { status: 503, code: 'SERVICE_UNAVAILABLE', message: 'GOOGLE_CLIENT_ID not configured in backend .env' };
    }

    // Exchange authorization code for tokens directly with Google
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret || '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      throw {
        status: 400,
        code: 'OAUTH_ERROR',
        message: tokenData.error_description || tokenData.error || 'Failed to exchange authorization code with Google'
      };
    }

    // Fetch official user profile from Google
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const profile = await profileRes.json();

    if (!profile.email_verified) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'Google account email is not verified' };
    }

    const email = profile.email.toLowerCase();
    const googleSub = profile.sub;

    // IF LINKING MODE
    if (state.mode === 'LINK' && state.userId) {
      const users = await query(`SELECT id, email FROM users WHERE id = ?`, [state.userId]);
      if (!users.length) throw { status: 404, code: 'NOT_FOUND', message: 'User not found' };
      if (users[0].email.toLowerCase() !== email) {
        throw {
          status: 403,
          code: 'FORBIDDEN',
          message: `Google account (${email}) does not match your registered profile email (${users[0].email})`
        };
      }
      await query(`UPDATE users SET google_sub = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [googleSub, state.userId]);
      return {
        action: 'LINK',
        google_email: email,
        google_name: profile.name,
        picture: profile.picture,
        message: 'Google account linked successfully. You can now use 1-click login.'
      };
    }

    // STUDENT REGISTRATION AUTO-FILL MODE
    if (state.mode === 'STUDENT_REGISTER' || state.mode === 'REGISTER') {
      const existing = await query(`SELECT u.id, u.email, u.status FROM users u WHERE LOWER(u.email) = ? OR u.google_sub = ?`, [email, googleSub]);
      const alreadyRegistered = existing.length > 0;
      const existingStatus = alreadyRegistered ? existing[0].status : null;

      return {
        action: 'STUDENT_REGISTER',
        google_email: email,
        google_name: profile.name || email.split('@')[0],
        google_sub: googleSub,
        picture: profile.picture || null,
        already_registered: alreadyRegistered,
        status: existingStatus,
        message: alreadyRegistered ? 'An account with this Google email already exists.' : 'Google account verified. Details auto-filled.'
      };
    }

    // STUDENT LOGIN MODE
    if (state.mode === 'STUDENT_LOGIN') {
      let sUsers = await query(`SELECT u.id, u.username, u.email, u.status, u.google_sub FROM users u WHERE u.google_sub = ?`, [googleSub]);
      if (!sUsers.length) {
        sUsers = await query(`SELECT u.id, u.username, u.email, u.status, u.google_sub FROM users u WHERE LOWER(u.email) = ?`, [email]);
      }

      if (!sUsers.length) {
        return {
          action: 'NOT_REGISTERED',
          google_email: email,
          google_name: profile.name || email.split('@')[0],
          google_sub: googleSub,
          picture: profile.picture || null,
          message: `No student account found for ${email}. Please complete registration first.`
        };
      }

      const sUser = sUsers[0];
      if (sUser.status === 'PENDING') {
        return {
          action: 'PENDING_APPROVAL',
          google_email: email,
          google_name: profile.name || email.split('@')[0],
          message: 'Your registration is pending approval by your Department Class Teacher.'
        };
      }

      if (sUser.status === 'REJECTED') {
        throw { status: 403, code: 'FORBIDDEN', message: 'Your student account registration was rejected by your Class Teacher.' };
      }

      if (sUser.status !== 'ACTIVE') {
        throw { status: 403, code: 'FORBIDDEN', message: `Account status: ${sUser.status}. Contact administrator.` };
      }

      // Link google_sub if not yet set
      if (!sUser.google_sub) {
        await query(`UPDATE users SET google_sub = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [googleSub, sUser.id]);
        sUser.google_sub = googleSub;
      }

      await enforceSingleActiveSession(sUser.id, clientInfo);

      const sRoles = await query(`SELECT role FROM user_roles WHERE user_id = ?`, [sUser.id]);
      sUser.roles = sRoles.map(r => r.role);

      const payload = await buildUserPayload(sUser);
      const { refreshToken, sessionId } = await persistSession(sUser.id, clientInfo);
      payload.session_id = sessionId;
      const accessToken = generateAccessToken(payload);

      return {
        action: 'LOGIN',
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: sUser.id,
          username: sUser.username,
          email: sUser.email,
          full_name: payload.full_name,
          roles: sUser.roles,
          student: payload.student || null,
          google_linked: true
        }
      };
    }

    // LOGIN MODE (Faculty, Admin, or Unified)
    let users = await query(`SELECT u.id, u.username, u.email, u.status, u.google_sub FROM users u WHERE u.google_sub = ?`, [googleSub]);
    if (!users.length) {
      users = await query(`SELECT u.id, u.username, u.email, u.status, u.google_sub FROM users u WHERE LOWER(u.email) = ?`, [email]);
      if (!users.length) {
        if (process.env.NODE_ENV !== 'production') {
          // In development mode: auto-provision new Google user as Faculty + Admin so testing is seamless
          const insertUser = await query(
            `INSERT INTO users (username, email, status, must_change_password, google_sub) VALUES (?, ?, 'ACTIVE', 0, ?)`,
            [email, email, googleSub]
          );
          const newUserId = insertUser.insertId;
          await query(`INSERT INTO user_roles (user_id, role) VALUES (?, 'TEACHER'), (?, 'SYSTEM_ADMIN')`, [newUserId, newUserId]);
          const empId = 'EMP-' + Math.floor(1000 + Math.random() * 9000);
          const teacherName = profile.name || email.split('@')[0];
          const tRes = await query(
            `INSERT INTO teachers (user_id, employee_id, full_name, phone) VALUES (?, ?, ?, ?)`,
            [newUserId, empId, teacherName, '']
          );
          const depts = await query(`SELECT id FROM departments LIMIT 1`);
          const subjects = await query(`SELECT id FROM subjects LIMIT 1`);
          const ays = await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`);
          if (depts.length && subjects.length && ays.length) {
            const assignRes = await query(
              `INSERT INTO teacher_assignments (teacher_id, assignment_type, subject_id, session_type_scope, department_id, year, semester, academic_year_id, assigned_by)
               VALUES (?, 'SUBJECT_TEACHER', ?, 'THEORY', ?, 2, 4, ?, 1)`,
              [tRes.insertId, subjects[0].id, depts[0].id, ays[0].id]
            );
            await query(
              `INSERT INTO attendance_registers (teacher_id, name, subject_id, assignment_id, department_id, year, semester, academic_year_id, session_type_scope, is_official)
               VALUES (?, ?, ?, ?, ?, 2, 4, ?, 'THEORY', 1)`,
              [tRes.insertId, `${teacherName} — Attendance Register`, subjects[0].id, assignRes.insertId, depts[0].id, ays[0].id]
            );
          }
          users = await query(`SELECT u.id, u.username, u.email, u.status, u.google_sub FROM users u WHERE u.id = ?`, [newUserId]);
        } else {
          throw {
            status: 401,
            code: 'UNAUTHORIZED',
            message: `No account found for ${email}. Please register or contact the college administrator.`
          };
        }
      } else {
        // Auto-link sub if email matches
        await query(`UPDATE users SET google_sub = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [googleSub, users[0].id]);
        users[0].google_sub = googleSub;
      }
    }

    const user = users[0];
    if (user.status !== 'ACTIVE') {
      throw { status: 403, code: 'FORBIDDEN', message: `Account status: ${user.status}. Contact administrator.` };
    }

    await enforceSingleActiveSession(user.id, clientInfo);

    const roles = await query(`SELECT role FROM user_roles WHERE user_id = ?`, [user.id]);
    user.roles = roles.map(r => r.role);

    // If user is a student
    if (user.roles.includes('STUDENT') && !user.roles.includes('TEACHER') && !user.roles.includes('SYSTEM_ADMIN')) {
      const payload = await buildUserPayload(user);
      const { refreshToken, sessionId } = await persistSession(user.id, clientInfo);
      payload.session_id = sessionId;
      const accessToken = generateAccessToken(payload);

      return {
        action: 'LOGIN',
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          full_name: payload.full_name,
          roles: user.roles,
          student: payload.student || null,
          google_linked: true
        }
      };
    }

    if (!user.roles.includes('TEACHER') && !user.roles.includes('SYSTEM_ADMIN')) {
      throw { status: 403, code: 'FORBIDDEN', message: 'Google login is only available for faculty and admin accounts.' };
    }

    const payload = await buildUserPayload(user);
    const { refreshToken, sessionId } = await persistSession(user.id, clientInfo);
    payload.session_id = sessionId;
    const accessToken = generateAccessToken(payload);

    return {
      action: 'LOGIN',
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: payload.full_name,
        roles: user.roles,
        is_hod: payload.is_hod || false,
        hod_department_id: payload.hod_department_id || null,
        hod_department_name: payload.hod_department_name || null,
        is_class_teacher: payload.is_class_teacher || false,
        has_assigned_subjects: payload.has_assigned_subjects || false,
        teacher: payload.teacher || null,
        google_linked: true
      }
    };
  }

  // ─────────────────────────────────────────────────────────
  // REFRESH TOKEN ROTATION
  // ─────────────────────────────────────────────────────────
  async refreshTokens(oldRefreshToken, clientInfo = {}) {
    let decoded;
    try { decoded = verifyRefreshToken(oldRefreshToken); }
    catch { throw { status: 401, code: 'UNAUTHORIZED', message: 'Refresh token expired or invalid' }; }

    const oldHash = hashToken(oldRefreshToken);
    const sessions = await query(
      `SELECT id, user_id, is_revoked, expires_at FROM user_sessions WHERE refresh_token_hash = ?`,
      [oldHash]
    );

    if (!sessions.length || sessions[0].is_revoked || new Date(sessions[0].expires_at) < new Date()) {
      throw { status: 401, code: 'UNAUTHORIZED', message: 'Session revoked or expired' };
    }

    const session = sessions[0];
    const users = await query(`SELECT id, username, email, status FROM users WHERE id = ?`, [session.user_id]);
    if (!users.length || users[0].status !== 'ACTIVE') {
      throw { status: 401, code: 'UNAUTHORIZED', message: 'User account inactive' };
    }

    const user = users[0];
    const roles = await query(`SELECT role FROM user_roles WHERE user_id = ?`, [user.id]);
    user.roles = roles.map(r => r.role);

    let newSessionId = null;
    await withTransaction(async (conn) => {
      await conn.execute(`UPDATE user_sessions SET is_revoked = 1 WHERE id = ?`, [session.id]);
      const insRes = await conn.query(
        `INSERT INTO user_sessions (user_id, refresh_token_hash, user_agent, ip_address, device_id, last_active_at, expires_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
        [user.id, newHash, clientInfo.userAgent || null, clientInfo.ip || null, clientInfo.deviceId || null, newExpiry]
      );
      newSessionId = insRes[0]?.insertId ?? insRes.lastInsertRowid ?? insRes.insertId;
    });

    user.session_id = newSessionId;
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    return { access_token: newAccessToken, refresh_token: newRefreshToken };
  }

  async verifyGoogleToken(idToken) {
    return verifyGoogleToken(idToken);
  }

  // ─────────────────────────────────────────────────────────
  // LOGOUT
  // ─────────────────────────────────────────────────────────
  async logout(param) {
    if (!param) return;
    if (typeof param === 'string') {
      const tokenHash = hashToken(param);
      await query(`UPDATE user_sessions SET is_revoked = 1, updated_at = CURRENT_TIMESTAMP WHERE refresh_token_hash = ?`, [tokenHash]);
      return;
    }
    const { refreshToken, sessionId, userId } = param;
    if (sessionId) {
      await query(`UPDATE user_sessions SET is_revoked = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [sessionId]);
    }
    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      await query(`UPDATE user_sessions SET is_revoked = 1, updated_at = CURRENT_TIMESTAMP WHERE refresh_token_hash = ?`, [tokenHash]);
    }
    if (userId && !sessionId && !refreshToken) {
      await query(`UPDATE user_sessions SET is_revoked = 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND is_revoked = 0`, [userId]);
    }
  }
}

module.exports = new AuthService();
