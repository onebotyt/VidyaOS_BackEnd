/**
 * JWT Authentication Middleware
 */

const { verifyAccessToken } = require('../utils/tokenHelper');
const { query } = require('../config/db');

async function auth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication token missing or invalid format'
        }
      });
    }

    const token = authHeader.split(' ')[1];
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

    // If teacher, fetch profile ID
    if (user.roles.includes('TEACHER')) {
      const teachers = await query(`SELECT id, employee_id, full_name FROM teachers WHERE user_id = ?`, [user.id]);
      if (teachers.length > 0) {
        user.teacher_id = teachers[0].id;
        user.employee_id = teachers[0].employee_id;
        user.full_name = teachers[0].full_name;
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
