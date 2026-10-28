/**
 * JWT Authentication Middleware
 */

const { verifyAccessToken } = require('../utils/tokenHelper');
const { query } = require('../config/db');

async function auth(req, res, next) {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication token missing or invalid format'
        }
      });
    }
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: err.name === 'TokenExpiredError' ? 'Authentication token expired' : 'Invalid authentication token'
        }
      });
    }

    // Verify session state if bound to user_sessions
    if (decoded.session_id) {
      const sessionRows = await query(
        `SELECT id, is_revoked, last_active_at FROM user_sessions WHERE id = ?`,
        [decoded.session_id]
      );
      if (sessionRows && sessionRows.length > 0) {
        const sess = sessionRows[0];
        const lastActiveTime = sess.last_active_at ? new Date(sess.last_active_at.includes('Z') ? sess.last_active_at : sess.last_active_at.replace(' ', 'T') + 'Z').getTime() : Date.now();
        const isIdleExpired = (Date.now() - lastActiveTime) > (24 * 60 * 60 * 1000);

        if (sess.is_revoked === 1 || isIdleExpired) {
          if (isIdleExpired && sess.is_revoked === 0) {
            query(`UPDATE user_sessions SET is_revoked = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [decoded.session_id]).catch(() => {});
          }
          return res.status(401).json({
            success: false,
            error: {
              code: 'SESSION_REVOKED',
              message: isIdleExpired
                ? 'Your session has expired due to 24 hours of inactivity. Please sign in again.'
                : 'Your session has ended because this account was logged in from another device or signed out.'
            }
          });
        }
        // Update heartbeat / last_active_at asynchronously
        query(`UPDATE user_sessions SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?`, [decoded.session_id]).catch(() => {});
      }
    }

    // Verify user exists and is active in database
    const users = await query(
      `SELECT u.id, u.username, u.email, u.status 
       FROM users u 
       WHERE u.id = ?`,
      [decoded.user_id]
    );

    if (!users || users.length === 0) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'User account no longer exists'
        }
      });
    }

    const user = users[0];
    if (user.status !== 'ACTIVE') {
      // Allow PROVISIONED users strictly for account activation / password change
      if (user.status === 'PROVISIONED' && decoded.purpose === 'PASSWORD_ACTIVATION') {
        // Allowed to proceed for password activation
      } else {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `User account is ${user.status}. Access denied.`
          }
        });
      }
    }

    // Fetch user roles
    const roles = await query(
      `SELECT role FROM user_roles WHERE user_id = ?`,
      [user.id]
    );
    user.roles = roles.map(r => r.role);

    // Resolve teacher profile ID if user is TEACHER, SYSTEM_ADMIN, HOD, or has a linked teacher profile
    const teachers = await query(`SELECT id, employee_id, full_name, department_id FROM teachers WHERE user_id = ?`, [user.id]);
    if (teachers.length > 0) {
      user.teacher_id = teachers[0].id;
      user.employee_id = teachers[0].employee_id;
      if (!user.full_name) user.full_name = teachers[0].full_name;
      if (!user.department_id) user.department_id = teachers[0].department_id;
    } else if (user.roles.includes('SYSTEM_ADMIN') || user.roles.includes('TEACHER')) {
      // Fallback for SYSTEM_ADMIN/TEACHER to the primary institutional teacher account for operational actions
      const firstTeacher = await query(`SELECT id, employee_id, full_name, department_id FROM teachers ORDER BY id ASC LIMIT 1`);
      if (firstTeacher.length > 0) {
        user.teacher_id = firstTeacher[0].id;
        user.employee_id = firstTeacher[0].employee_id;
        if (!user.full_name) user.full_name = firstTeacher[0].full_name;
        if (!user.department_id) user.department_id = firstTeacher[0].department_id;
      }
    }

    // Resolve HOD status
    if (user.teacher_id) {
      const hodAssignments = await query(
        `SELECT ta.department_id, d.name as department_name, d.code as department_code
         FROM teacher_assignments ta
         JOIN departments d ON ta.department_id = d.id
         WHERE ta.teacher_id = ? AND ta.assignment_type = 'HOD' AND ta.is_active = 1
         LIMIT 1`,
        [user.teacher_id]
      );
      if (hodAssignments.length > 0) {
        user.is_hod = true;
        user.hod_department_id = hodAssignments[0].department_id;
        user.hod_department_name = hodAssignments[0].department_name;
        user.hod_department_code = hodAssignments[0].department_code;
      } else {
        user.is_hod = false;
      }
    }

    // If student, fetch profile ID
    if (user.roles.includes('STUDENT')) {
      const students = await query(`SELECT id, official_enrollment_no, full_name FROM students WHERE user_id = ?`, [user.id]);
      if (students.length > 0) {
        user.student_id = students[0].id;
        user.official_enrollment_no = students[0].official_enrollment_no;
        user.full_name = students[0].full_name;
      }
    }

    user.session_id = decoded.session_id || null;
    req.user = user;
    next();
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Authentication processing error',
        details: err.message
      }
    });
  }
}

module.exports = auth;
