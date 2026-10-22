/**
 * Auth Model
 * Encapsulates SQLite queries and transactions for authentication, registration gates, and account self-registration.
 *
 * Architecture Role: Model (Data Access Layer)
 * Interacts With:
 *   - Controllers: controllers/authController.js
 *   - Routes: routes/auth.js
 * Database Tables: users, user_roles, students, enrollments, teachers, teacher_assignments, departments, academic_years, system_settings, faculty_registration_requests
 */

const { query, withTransaction } = require('../config/db');

class AuthModel {
  /**
   * Fetches active/current academic year.
   * @calledBy AuthController.getRegistrationCohorts(), getStudentRegistrationStatus(), registerStudent() (controllers/authController.js)
   * @route GET /api/v1/auth/student/registration/cohorts, GET /api/v1/auth/student/registration/status, POST /api/v1/auth/student/register (routes/auth.js)
   * @returns {Promise<Object>} Academic year object { id, label }
   */
  static async getActiveAcademicYear() {
    const rows = await query(`SELECT id, label FROM academic_years WHERE is_current = 1 LIMIT 1`);
    return rows[0] || { id: 1, label: '2026-27' };
  }

  /**
   * Fetches a specific system setting value by key.
   * @calledBy AuthController.registerStudent(), registerFaculty() (controllers/authController.js)
   * @route POST /api/v1/auth/student/register, POST /api/v1/auth/faculty/register (routes/auth.js)
   * @param {string} key - Setting key name
   * @returns {Promise<string|null>} Setting value or null
   */
  static async getSetting(key) {
    const rows = await query(`SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1`, [key]);
    return rows[0]?.setting_value || null;
  }

  /**
   * Fetches active settings matching a SQL LIKE pattern.
   * @calledBy AuthController.getRegistrationCohorts() (controllers/authController.js)
   * @route GET /api/v1/auth/student/registration/cohorts (routes/auth.js)
   * @param {string} pattern - LIKE pattern string
   * @returns {Promise<Array>} List of setting records
   */
  static async getSettingsMatching(pattern) {
    return await query(
      `SELECT setting_key, setting_value FROM system_settings
       WHERE setting_key LIKE ? AND setting_value = '1'`,
      [pattern]
    );
  }

  /**
   * Fetches multiple settings in an array of keys.
   * @calledBy AuthController.getStudentRegistrationStatus(), registerStudent() (controllers/authController.js)
   * @route GET /api/v1/auth/student/registration/status, POST /api/v1/auth/student/register (routes/auth.js)
   * @param {Array<string>} keys - Setting keys
   * @returns {Promise<Array>} Matching setting records
   */
  static async getSettingsIn(keys) {
    return await query(
      `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (${keys.map(() => '?').join(',')})`,
      keys
    );
  }

  /**
   * Retrieves all active academic departments.
   * @calledBy AuthController.getDepartments() (controllers/authController.js)
   * @route GET /api/v1/auth/departments (routes/auth.js)
   * @returns {Promise<Array>} List of active departments
   */
  static async getActiveDepartments() {
    return await query(
      `SELECT id, name, code, degree_duration_years, active_term
       FROM departments
       WHERE is_active = 1
       ORDER BY id ASC`
    );
  }

  /**
   * Retrieves department record along with active HOD user status.
   * @calledBy AuthController.getRegistrationCohorts(), getStudentRegistrationStatus(), registerStudent(), registerFaculty() (controllers/authController.js)
   * @route GET /api/v1/auth/student/registration/cohorts, GET /api/v1/auth/student/registration/status, POST /api/v1/auth/student/register, POST /api/v1/auth/faculty/register (routes/auth.js)
   * @param {number} deptId - Department primary key
   * @returns {Promise<Object|null>} Department record or null
   */
  static async getDepartmentById(deptId) {
    const rows = await query(
      `SELECT d.id, d.name, d.code, d.degree_duration_years, d.hod_user_id, u.status as hod_status
       FROM departments d
       LEFT JOIN users u ON d.hod_user_id = u.id
       WHERE d.id = ? AND d.is_active = 1`,
      [deptId]
    );
    return rows[0] || null;
  }

  /**
   * Counts active faculty assignments in a department.
   * @calledBy AuthController.getStudentRegistrationStatus(), registerStudent() (controllers/authController.js)
   * @route GET /api/v1/auth/student/registration/status, POST /api/v1/auth/student/register (routes/auth.js)
   * @param {number} deptId - Department primary key
   * @returns {Promise<number>} Teacher count
   */
  static async countDepartmentTeachers(deptId) {
    const rows = await query(
      `SELECT COUNT(*) as cnt FROM teacher_assignments ta JOIN teachers t ON ta.teacher_id = t.id WHERE ta.department_id = ? AND ta.is_active = 1`,
      [deptId]
    );
    return rows[0]?.cnt || 0;
  }

  /**
   * Aggregates public self-registration gate statuses across institution departments.
   * @calledBy AuthController.getRegistrationGates() (controllers/authController.js)
   * @route GET /api/v1/auth/registration-gates (routes/auth.js)
   * @returns {Promise<Object>} Gates summary payload
   */
  static async getRegistrationGatesData() {
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

    return {
      admin: {
        hod_registration_open: hodOpen,
        common_faculty_registration_open: commonOpen,
        hod_closed_reason: hodOpen ? null : 'Institutional Administration has not opened HOD registration.',
        common_faculty_closed_reason: commonOpen ? null : 'Institutional Administration has not opened Common Faculty registration.'
      },
      departments: deptGates
    };
  }

  /**
   * Checks if an email address or username already exists.
   * @calledBy AuthController.registerStudent(), registerFaculty() (controllers/authController.js)
   * @route POST /api/v1/auth/student/register, POST /api/v1/auth/faculty/register (routes/auth.js)
   * @param {string} email - Email address
   * @param {string} username - Username
   * @returns {Promise<boolean>} True if user exists
   */
  static async findExistingUser(email, username) {
    const rows = await query(
      `SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(?) OR LOWER(TRIM(username)) = LOWER(?)`,
      [email, username]
    );
    return rows.length > 0;
  }

  /**
   * Checks if an official enrollment number already exists.
   * @calledBy AuthController.registerStudent() (controllers/authController.js)
   * @route POST /api/v1/auth/student/register (routes/auth.js)
   * @param {string} cleanEnroll - Trimmed enrollment number
   * @returns {Promise<boolean>} True if enrollment exists
   */
  static async findExistingEnrollment(cleanEnroll) {
    const rows = await query(
      `SELECT id FROM students WHERE LOWER(TRIM(official_enrollment_no)) = LOWER(?)
       UNION
       SELECT id FROM users WHERE LOWER(TRIM(username)) = LOWER(?)`,
      [cleanEnroll, cleanEnroll]
    );
    return rows.length > 0;
  }

  /**
   * Checks if a phone number is already registered to a user account.
   * @calledBy AuthController.registerStudent() (controllers/authController.js)
   * @route POST /api/v1/auth/student/register (routes/auth.js)
   * @param {string} phone - Normalized phone number
   * @returns {Promise<boolean>} True if phone exists
   */
  static async findExistingPhone(phone) {
    const rows = await query(`SELECT id FROM users WHERE phone = ?`, [phone]);
    return rows.length > 0;
  }

  /**
   * Executes atomic database transaction to register student account in PENDING status.
   * @calledBy AuthController.registerStudent() (controllers/authController.js)
   * @route POST /api/v1/auth/student/register (routes/auth.js)
   * @param {Object} params - Student registration attributes
   * @returns {Promise<Object>} Created user and student IDs
   */
  static async registerStudentTransaction({
    email,
    cleanPhone,
    passwordHash,
    resolvedGoogleSub,
    officialEnrollmentNo,
    registrationNo,
    fullName,
    parentPhone,
    parentName,
    effDeptId,
    effYear,
    semester,
    ayId
  }) {
    return await withTransaction(async (conn) => {
      const [uRes] = await conn.execute(
        `INSERT INTO users (username, email, phone, password_hash, must_change_password, status, google_sub)
         VALUES (?, ?, ?, ?, 0, 'PENDING', ?)`,
        [email.toLowerCase(), email.toLowerCase(), cleanPhone, passwordHash, resolvedGoogleSub]
      );
      const createdUserId = uRes.insertId;

      await conn.execute(`INSERT INTO user_roles (user_id, role) VALUES (?, 'STUDENT')`, [createdUserId]);

      const [sRes] = await conn.execute(
        `INSERT INTO students (user_id, official_enrollment_no, registration_no, full_name, phone, parent_phone, parent_name, is_phone_verified, entry_mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'self_registered')`,
        [
          createdUserId,
          officialEnrollmentNo.trim(),
          (registrationNo || '').trim() || null,
          fullName.trim(),
          cleanPhone,
          parentPhone ? parentPhone.trim() : null,
          parentName ? parentName.trim() : null
        ]
      );
      const createdStudentId = sRes.insertId;

      await conn.execute(
        `INSERT INTO enrollments (student_id, department_id, year, semester, academic_year_id, class_roll_no, status)
         VALUES (?, ?, ?, ?, ?, NULL, 'PENDING')`,
        [createdStudentId, effDeptId, effYear, semester, ayId]
      );

      return {
        userId: createdUserId,
        studentId: createdStudentId
      };
    });
  }

  /**
   * Checks if a pending faculty registration request exists for an email.
   * @calledBy AuthController.registerFaculty() (controllers/authController.js)
   * @route POST /api/v1/auth/faculty/register (routes/auth.js)
   * @param {string} email - Email address
   * @returns {Promise<boolean>} True if pending request exists
   */
  static async findPendingFacultyRequest(email) {
    const rows = await query(
      `SELECT id FROM faculty_registration_requests WHERE LOWER(email) = LOWER(?) AND status = 'PENDING'`,
      [email]
    );
    return rows.length > 0;
  }

  /**
   * Creates a pending faculty registration request record.
   * @calledBy AuthController.registerFaculty() (controllers/authController.js)
   * @route POST /api/v1/auth/faculty/register (routes/auth.js)
   * @param {Object} params - Request attributes
   * @returns {Promise<number>} Inserted request ID
   */
  static async createFacultyRequest({
    fullName,
    email,
    passwordHash,
    cleanPhone,
    phone,
    employeeId,
    accountType,
    targetDeptId,
    approvalType
  }) {
    const res = await query(
      `INSERT INTO faculty_registration_requests 
       (full_name, email, password_hash, phone, employee_id, account_type, department_id, approval_type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [
        fullName.trim(),
        email.toLowerCase(),
        passwordHash,
        cleanPhone || (phone ? phone.trim() : null),
        employeeId ? employeeId.trim() : null,
        accountType,
        targetDeptId,
        approvalType
      ]
    );
    return res.insertId ?? res.lastInsertRowid;
  }
}

module.exports = AuthModel;
