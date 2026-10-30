/**
 * Admin Model
 * Encapsulates SQLite queries and transactions for institutional master data administration:
 * departments, academic years, HODs, hardware terminals, system settings,
 * attendance corrections, hierarchy, student rosters, and registration anti-spam gates.
 * Provides bidirectional code traceability upward to AdminController and routes/admin.js.
 */

const { query, withTransaction } = require('../config/db');
const bcrypt = require('bcrypt');

class AdminModel {
  /**
   * Aggregate high-level institutional statistics across students, teachers, HODs, departments, devices, and sessions
   * @calledBy AdminController.getStats() (controllers/adminController.js)
   * @route GET /api/v1/admin/stats (routes/admin.js)
   * @returns {Promise<Object>} Aggregated dashboard KPIs
   */
  static async getStats() {
    const [allTimeStudents] = await query(`SELECT COUNT(*) as total FROM students`);
    const [activeStudents] = await query(
      `SELECT COUNT(DISTINCT s.id) as total FROM students s JOIN users u ON s.user_id = u.id WHERE u.status = 'ACTIVE'`
    );
    const [teachersCount] = await query(`SELECT COUNT(*) as total FROM teachers`);
    const [hodsCount] = await query(
      `SELECT COUNT(DISTINCT teacher_id) as total FROM teacher_assignments WHERE assignment_type = 'HOD' AND is_active = 1`
    );
    const [deptsCount] = await query(`SELECT COUNT(*) as total FROM departments WHERE is_active = 1`);
    const [devicesCount] = await query(`SELECT COUNT(*) as total FROM devices WHERE is_active = 1`);
    const [todaySessions] = await query(
      `SELECT COUNT(*) as total FROM attendance_sessions WHERE session_date = DATE('now')`
    );
    const [openSessions] = await query(
      `SELECT COUNT(*) as total FROM attendance_sessions WHERE state = 'OPEN'`
    );

    return {
      total_students: activeStudents?.total || allTimeStudents?.total || 0,
      total_teachers: teachersCount?.total || 0,
      total_enrolled_students: allTimeStudents?.total || 0,
      total_hods: hodsCount?.total || 0,
      total_departments: deptsCount?.total || 0,
      total_branches: deptsCount?.total || 0,
      total_devices: devicesCount?.total || 0,
      today_sessions: todaySessions?.total || 0,
      open_sessions: openSessions?.total || 0
    };
  }

  /**
   * Retrieve all departments with associated HOD user info, student counts, and active teacher counts
   * @calledBy AdminController.getDepartments(), AdminController.getBranches() (controllers/adminController.js)
   * @route GET /api/v1/admin/departments, GET /api/v1/admin/branches (routes/admin.js)
   * @returns {Promise<Array<Object>>} Department listings with roster statistics
   */
  static async getDepartments() {
    return await query(
      `SELECT d.id, d.name, d.code, d.is_active, d.is_archived, d.created_at, d.degree_duration_years,
              d.name as branch_name, d.code as branch_code,
              u.id as hod_user_id, u.username as hod_gmail, u.email as hod_email,
              t.id as hod_teacher_id, t.full_name as hod_name, t.phone as hod_phone,
              (SELECT COUNT(*) FROM students s 
               JOIN enrollments e ON e.student_id = s.id 
               WHERE e.department_id = d.id AND e.status = 'ENROLLED') as student_count,
              (SELECT COUNT(DISTINCT ta.teacher_id) FROM teacher_assignments ta 
               WHERE ta.department_id = d.id AND ta.is_active = 1) as teacher_count
       FROM departments d
       LEFT JOIN users u ON d.hod_user_id = u.id
       LEFT JOIN teachers t ON t.user_id = u.id
       ORDER BY d.code, d.name`
    );
  }

  /**
   * Retrieve department record by primary key ID
   * @calledBy AdminController.archiveDepartment(), AdminController.deleteDepartment(), AdminController.createHod(), AdminController.reassignHodDepartment(), AdminController.assignExistingTeacherHod() (controllers/adminController.js)
   * @route POST /api/v1/admin/departments/:id/archive, DELETE /api/v1/admin/departments/:id, POST /api/v1/admin/hods, PUT /api/v1/admin/hods/:teacher_id/department, POST /api/v1/admin/hods/assign-existing (routes/admin.js)
   * @param {number} id Department primary key
   * @returns {Promise<Object|null>} Department record or null
   */
  static async getDepartmentById(id) {
    const rows = await query('SELECT * FROM departments WHERE id = ?', [id]);
    return rows[0] || null;
  }

  /**
   * Create a new academic department in the institutional structure
   * @calledBy AdminController.createDepartment() (controllers/adminController.js)
   * @route POST /api/v1/admin/departments (routes/admin.js)
   * @param {Object} params Department attributes
   * @param {string} params.name Department name
   * @param {string} params.code Department unique code
   * @param {number} [params.degreeDurationYears] Degree duration in years (default 3)
   * @returns {Promise<number>} Inserted department ID
   */
  static async createDepartment({ name, code, degreeDurationYears }) {
    const result = await query(
      `INSERT INTO departments (name, code, is_active, degree_duration_years) VALUES (?, ?, 1, ?)`,
      [name.trim(), code.toUpperCase().trim(), degreeDurationYears || 3]
    );
    return result[0]?.insertId ?? result.lastInsertRowid;
  }

  /**
   * Update department details, degree duration, or active status
   * @calledBy AdminController.updateDepartment() (controllers/adminController.js)
   * @route PUT /api/v1/admin/departments/:id (routes/admin.js)
   * @param {number} id Department ID
   * @param {Object} fields Fields to update
   * @returns {Promise<boolean>} True if updated, false if no fields provided
   */
  static async updateDepartment(id, { name, code, degreeDurationYears, isActive }) {
    const sets = [], params = [];
    if (name !== undefined) { sets.push('name = ?'); params.push(name.trim()); }
    if (code !== undefined) { sets.push('code = ?'); params.push(code.toUpperCase().trim()); }
    if (degreeDurationYears !== undefined) { sets.push('degree_duration_years = ?'); params.push(degreeDurationYears); }
    if (isActive !== undefined) { sets.push('is_active = ?'); params.push(isActive ? 1 : 0); }
    if (!sets.length) return false;

    params.push(id);
    await query(`UPDATE departments SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
    return true;
  }

  /**
   * Mark department as archived and deactivate all related attendance registers in a transaction
   * @calledBy AdminController.archiveDepartment() (controllers/adminController.js)
   * @route POST /api/v1/admin/departments/:id/archive (routes/admin.js)
   * @param {number} deptId Department ID
   * @returns {Promise<void>}
   */
  static async archiveDepartment(deptId) {
    return await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE departments SET is_archived = 1, is_active = 0, archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [deptId]
      );
      await conn.execute(
        `UPDATE attendance_registers SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE department_id = ?`,
        [deptId]
      );
    });
  }

  /**
   * Hard delete department and cascade-clean all associated assignments, assessments, and attendance records
   * @calledBy AdminController.deleteDepartment() (controllers/adminController.js)
   * @route DELETE /api/v1/admin/departments/:id (routes/admin.js)
   * @param {number} deptId Department ID
   * @returns {Promise<void>}
   */
  static async deleteDepartment(deptId) {
    return await withTransaction(async (conn) => {
      await conn.execute('UPDATE teachers SET department_id = NULL WHERE department_id = ?', [deptId]);
      await conn.execute('UPDATE departments SET hod_user_id = NULL WHERE id = ?', [deptId]);
      await conn.execute('DELETE FROM teacher_assignments WHERE department_id = ?', [deptId]);
      await conn.execute('DELETE FROM assessment_submissions WHERE assessment_id IN (SELECT id FROM assessments WHERE department_id = ?)', [deptId]);
      await conn.execute('DELETE FROM assessments WHERE department_id = ?', [deptId]);
      await conn.execute('DELETE FROM register_attendance WHERE session_id IN (SELECT id FROM attendance_sessions WHERE department_id = ?)', [deptId]);
      await conn.execute('DELETE FROM attendance_session_students WHERE session_id IN (SELECT id FROM attendance_sessions WHERE department_id = ?)', [deptId]);
      await conn.execute('DELETE FROM attendance_sessions WHERE department_id = ?', [deptId]);
      await conn.execute('DELETE FROM attendance_registers WHERE department_id = ?', [deptId]);
      await conn.execute('DELETE FROM enrollments WHERE department_id = ?', [deptId]);
      await conn.execute('DELETE FROM departments WHERE id = ?', [deptId]);
    });
  }

  /**
   * List all academic years in chronological order
   * @calledBy AdminController.getAcademicYears(), AdminController.createAcademicYear(), AdminController.createHod(), AdminController.createDevice(), AdminController.approveHodRegistration() (controllers/adminController.js)
   * @route GET /api/v1/admin/academic-years (routes/admin.js)
   * @returns {Promise<Array<Object>>} Academic years list
   */
  static async getAcademicYears() {
    return await query(`SELECT * FROM academic_years ORDER BY start_date DESC`);
  }

  /**
   * Create a new institutional academic year definition
   * @calledBy AdminController.createAcademicYear() (controllers/adminController.js)
   * @route POST /api/v1/admin/academic-years (routes/admin.js)
   * @param {Object} params Academic year dates and label
   * @returns {Promise<number>} Inserted academic year ID
   */
  static async createAcademicYear({ label, startDate, endDate }) {
    const result = await query(
      `INSERT INTO academic_years (label, start_date, end_date, is_current) VALUES (?, ?, ?, 0)`,
      [label, startDate, endDate]
    );
    return result[0]?.insertId ?? result.lastInsertRowid;
  }

  /**
   * Update academic year label or date boundaries
   * @calledBy AdminController.updateAcademicYear() (controllers/adminController.js)
   * @route PUT /api/v1/admin/academic-years/:id (routes/admin.js)
   * @param {number} id Academic year ID
   * @param {Object} fields Fields to update
   * @returns {Promise<boolean>} True if updated
   */
  static async updateAcademicYear(id, { label, startDate, endDate }) {
    const sets = [], params = [];
    if (label !== undefined) { sets.push('label = ?'); params.push(label); }
    if (startDate !== undefined) { sets.push('start_date = ?'); params.push(startDate); }
    if (endDate !== undefined) { sets.push('end_date = ?'); params.push(endDate); }
    if (!sets.length) return false;
    params.push(id);
    await query(`UPDATE academic_years SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
    return true;
  }

  /**
   * Atomically mark specified academic year as current and unmark all others
   * @calledBy AdminController.setCurrentAcademicYear() (controllers/adminController.js)
   * @route PUT /api/v1/admin/academic-years/:id/set-current (routes/admin.js)
   * @param {number} id Academic year ID
   * @returns {Promise<void>}
   */
  static async setCurrentAcademicYear(id) {
    return await withTransaction(async (conn) => {
      await conn.execute(`UPDATE academic_years SET is_current = 0`);
      await conn.execute(`UPDATE academic_years SET is_current = 1 WHERE id = ?`, [id]);
    });
  }

  /**
   * Retrieve active Head of Department (HOD) assignments across departments
   * @calledBy AdminController.getHods() (controllers/adminController.js)
   * @route GET /api/v1/admin/hods (routes/admin.js)
   * @returns {Promise<Array<Object>>} HOD teacher assignments and departmental info
   */
  static async getHODs() {
    return await query(
      `SELECT t.id as teacher_id, t.full_name, t.employee_id, t.phone,
              u.id as user_id, u.username as gmail, u.email, u.status, u.must_change_password,
              CASE WHEN u.google_sub IS NOT NULL THEN 1 ELSE 0 END as google_linked,
              d.id as department_id, d.name as department_name, d.code as department_code,
              ta.id as hod_assignment_id, ta.is_active as hod_is_active,
              t.created_at
       FROM teacher_assignments ta
       JOIN teachers t ON ta.teacher_id = t.id
       JOIN users u ON t.user_id = u.id
       LEFT JOIN departments d ON ta.department_id = d.id
       WHERE ta.assignment_type = 'HOD' AND ta.is_active = 1
       ORDER BY d.name, t.full_name`
    );
  }

  /**
   * Check if user account already exists by username or email
   * @calledBy AdminController.createHod() (controllers/adminController.js)
   * @route POST /api/v1/admin/hods (routes/admin.js)
   * @param {string} email Email address
   * @returns {Promise<Object|null>} User record or null
   */
  static async findExistingUser(email) {
    const rows = await query(`SELECT id FROM users WHERE username = ? OR email = ?`, [email, email]);
    return rows[0] || null;
  }

  /**
   * Look up teacher record by linked user ID
   * @calledBy AdminController.createHod() (controllers/adminController.js)
   * @route POST /api/v1/admin/hods (routes/admin.js)
   * @param {number} userId User ID
   * @returns {Promise<Object|null>} Teacher record or null
   */
  static async findTeacherByUserId(userId) {
    const rows = await query(`SELECT id FROM teachers WHERE user_id = ?`, [userId]);
    return rows[0] || null;
  }

  /**
   * Create user account, teacher profile, and assign HOD role in an atomic transaction
   * @calledBy AdminController.createHod() (controllers/adminController.js)
   * @route POST /api/v1/admin/hods (routes/admin.js)
   * @param {Object} params User and teacher parameters
   * @returns {Promise<Object>} Created HOD account details
   */
  static async createHODTransaction({ gmail, passwordHash, departmentId, employeeId, fullName, phone, ayId, adminUserId, tempPassword }) {
    return await withTransaction(async (conn) => {
      const [uRes] = await conn.execute(
        `INSERT INTO users (username, email, password_hash, temp_password_hash, must_change_password, status)
         VALUES (?, ?, ?, ?, 0, 'ACTIVE')`,
        [gmail, gmail, passwordHash, passwordHash]
      );
      const userId = uRes.insertId ?? uRes.lastInsertRowid;

      await conn.execute(`INSERT INTO user_roles (user_id, role) VALUES (?, 'TEACHER')`, [userId]);

      const [tRes] = await conn.execute(
        `INSERT INTO teachers (user_id, department_id, employee_id, full_name, phone) VALUES (?, ?, ?, ?, ?)`,
        [userId, departmentId, employeeId || null, fullName, phone || null]
      );
      const teacherId = tRes.insertId ?? tRes.lastInsertRowid;

      await conn.execute(
        `UPDATE teacher_assignments SET is_active = 0, updated_at = CURRENT_TIMESTAMP
         WHERE department_id = ? AND assignment_type = 'HOD' AND is_active = 1`,
        [departmentId]
      );

      await conn.execute(
        `INSERT INTO teacher_assignments (teacher_id, assignment_type, session_type_scope, department_id, year, semester, academic_year_id, assigned_by)
         VALUES (?, 'HOD', 'THEORY', ?, 1, 1, ?, ?)`,
        [teacherId, departmentId, ayId, adminUserId]
      );

      await conn.execute(
        `UPDATE departments SET hod_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [userId, departmentId]
      );

      return { teacher_id: teacherId, user_id: userId, full_name: fullName, gmail, department_id: departmentId, temporary_password: tempPassword };
    });
  }

  /**
   * Reassign a faculty member as HOD to a specified department in an atomic transaction
   * @calledBy AdminController.createHod(), AdminController.reassignHodDepartment(), AdminController.assignExistingTeacherHod() (controllers/adminController.js)
   * @route POST /api/v1/admin/hods, PUT /api/v1/admin/hods/:teacher_id/department, POST /api/v1/admin/hods/assign-existing (routes/admin.js)
   * @param {Object} params Reassignment parameters
   * @returns {Promise<void>}
   */
  static async reassignHOD({ teacherId, targetDeptId, ayId, adminUserId }) {
    const tRows = await query(`SELECT user_id FROM teachers WHERE id = ?`, [teacherId]);
    if (!tRows.length) return null;
    const userId = tRows[0].user_id;

    return await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE teacher_assignments SET is_active = 0, updated_at = CURRENT_TIMESTAMP
         WHERE teacher_id = ? AND assignment_type = 'HOD' AND is_active = 1`,
        [teacherId]
      );
      await conn.execute(
        `UPDATE departments SET hod_user_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE hod_user_id = ?`,
        [userId]
      );
      await conn.execute(
        `UPDATE teacher_assignments SET is_active = 0, updated_at = CURRENT_TIMESTAMP
         WHERE department_id = ? AND assignment_type = 'HOD' AND is_active = 1`,
        [targetDeptId]
      );
      await conn.execute(
        `INSERT INTO teacher_assignments (teacher_id, assignment_type, session_type_scope, department_id, year, semester, academic_year_id, assigned_by)
         VALUES (?, 'HOD', 'THEORY', ?, 1, 1, ?, ?)`,
        [teacherId, targetDeptId, ayId, adminUserId]
      );
      await conn.execute(
        `UPDATE departments SET hod_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [userId, targetDeptId]
      );
      await conn.execute(
        `UPDATE teachers SET department_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [targetDeptId, teacherId]
      );
    });
  }

  /**
   * Set a new bcrypt hashed password for a teacher's underlying user account
   * @calledBy AdminController.resetHodPassword() (controllers/adminController.js)
   * @route POST /api/v1/admin/hods/:teacher_id/reset-password (routes/admin.js)
   * @param {number} teacherId Teacher primary key
   * @param {string} passwordHash New bcrypt password hash
   * @returns {Promise<boolean>} True if updated, false if teacher not found
   */
  static async resetTeacherPassword(teacherId, passwordHash) {
    const tRows = await query(`SELECT user_id FROM teachers WHERE id = ?`, [teacherId]);
    if (!tRows.length) return false;
    await query(`UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [passwordHash, tRows[0].user_id]);
    return true;
  }

  /**
   * Search faculty members across name, email, and employee ID
   * @calledBy AdminController.searchFaculty() (controllers/adminController.js)
   * @route GET /api/v1/admin/faculty/search (routes/admin.js)
   * @param {string} [search] Search query term
   * @returns {Promise<Array<Object>>} Matching faculty records
   */
  static async searchFaculty(search) {
    let whereClause = `WHERE 1=1`;
    const params = [];
    if (search && search.trim()) {
      whereClause += ` AND (t.full_name LIKE ? OR u.email LIKE ? OR t.employee_id LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }
    return await query(
      `SELECT t.id as teacher_id, t.full_name, t.employee_id, t.phone,
              u.id as user_id, u.email, u.status,
              d.id as department_id, d.name as department_name, d.code as department_code,
              CASE WHEN ta.id IS NOT NULL THEN 1 ELSE 0 END as is_current_hod
       FROM teachers t
       JOIN users u ON t.user_id = u.id
       LEFT JOIN departments d ON t.department_id = d.id
       LEFT JOIN teacher_assignments ta ON ta.teacher_id = t.id AND ta.assignment_type = 'HOD' AND ta.is_active = 1
       ${whereClause}
       ORDER BY t.full_name ASC LIMIT 50`,
      params
    );
  }

  /**
   * Unassign teacher from HOD role while preserving teacher account
   * @calledBy AdminController.removeHod() (controllers/adminController.js)
   * @route DELETE /api/v1/admin/hods/:teacher_id (routes/admin.js)
   * @param {number} teacherId Teacher ID
   * @returns {Promise<boolean>} True if removed, false if not found
   */
  static async removeHOD(teacherId) {
    const tRows = await query(`SELECT user_id FROM teachers WHERE id = ?`, [teacherId]);
    if (!tRows.length) return false;
    const userId = tRows[0].user_id;

    await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE teacher_assignments SET is_active = 0, updated_at = CURRENT_TIMESTAMP
         WHERE teacher_id = ? AND assignment_type = 'HOD'`,
        [teacherId]
      );
      await conn.execute(
        `UPDATE departments SET hod_user_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE hod_user_id = ?`,
        [userId]
      );
    });
    return true;
  }

  /**
   * Retrieve list of all IoT attendance devices with department and academic year linkage
   * @calledBy AdminController.getDevices() (controllers/adminController.js)
   * @route GET /api/v1/admin/devices (routes/admin.js)
   * @returns {Promise<Array<Object>>} Device records
   */
  static async getDevices() {
    return await query(
      `SELECT dv.*, d.name as department_name, d.name as branch_name, d.code as branch_code, ay.label as academic_year_label
       FROM devices dv
       JOIN departments d ON dv.department_id = d.id
       JOIN academic_years ay ON dv.academic_year_id = ay.id
       ORDER BY dv.name`
    );
  }

  /**
   * Register a new IoT terminal hardware device in the institution
   * @calledBy AdminController.createDevice() (controllers/adminController.js)
   * @route POST /api/v1/admin/devices (routes/admin.js)
   * @param {Object} params Device registration parameters
   * @returns {Promise<number>} Inserted device ID
   */
  static async createDevice({ deviceUid, name, departmentId, year, semester, ayId, secretHash }) {
    const result = await query(
      `INSERT INTO devices (device_uid, name, department_id, year, semester, academic_year_id, secret_hash) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [deviceUid, name, departmentId, year, semester, ayId, secretHash]
    );
    return result[0]?.insertId ?? result.lastInsertRowid;
  }

  /**
   * Retrieve institutional system configuration key-value settings
   * @calledBy AdminController.getSettings() (controllers/adminController.js)
   * @route GET /api/v1/admin/settings (routes/admin.js)
   * @returns {Promise<Object>} Formatted key-value map and raw rows
   */
  static async getSettings() {
    const rows = await query(`SELECT setting_key, setting_value, description FROM system_settings ORDER BY setting_key`);
    const settings = {};
    rows.forEach(r => { settings[r.setting_key] = r.setting_value; });
    return { settings, raw: rows, map: settings };
  }

  /**
   * Upsert system settings key-value pairs with audit tracking
   * @calledBy AdminController.updateSettings() (controllers/adminController.js)
   * @route PUT /api/v1/admin/settings (routes/admin.js)
   * @param {Array<[string, any]>} entries Array of [key, value] tuples
   * @param {number} userId User ID making the update
   * @returns {Promise<void>}
   */
  static async updateSettings(entries, userId) {
    for (const [key, value] of entries) {
      await query(
        `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
        [key, String(value), userId || 1]
      );
    }
  }

  /**
   * Compile institutional analytics report data: KPIs, trends, cohort summaries, and scan logs
   * @calledBy AdminController.getDepartmentReports(), AdminController.exportDepartmentReports() (controllers/adminController.js)
   * @route GET /api/v1/admin/reports/department, GET /api/v1/admin/reports/attendance, GET/POST /api/v1/admin/reports/export (routes/admin.js)
   * @param {Object} filterParams Department, cohort, and date filters
   * @returns {Promise<Object>} Aggregated analytics and scan records
   */
  static async getDepartmentReportsData({ department_id, branch_id, year, semester, date_preset, date_from, date_to }) {
    let department = { id: null, name: 'All Departments', code: 'ALL' };
    const whereClauses = [];
    const params = [];

    if (department_id) {
      const deptRows = await query(`SELECT id, name, code FROM departments WHERE id = ?`, [department_id]);
      if (deptRows.length) {
        department = deptRows[0];
        whereClauses.push(`d.id = ?`);
        params.push(department_id);
      }
    }

    if (branch_id && !department_id) {
      whereClauses.push(`d.id = ?`);
      params.push(branch_id);
    }
    if (year) {
      whereClauses.push(`COALESCE(e.year, dev.year) = ?`);
      params.push(year);
    }
    if (semester) {
      whereClauses.push(`COALESCE(e.semester, dev.semester) = ?`);
      params.push(semester);
    }

    if (date_preset === 'today') {
      whereClauses.push(`DATE(ep.scan_time) = CURRENT_DATE`);
    } else if (date_preset === '7days') {
      whereClauses.push(`DATE(ep.scan_time) >= DATE(datetime('now', '-7 days'))`);
    } else if (date_preset === '30days') {
      whereClauses.push(`DATE(ep.scan_time) >= DATE(datetime('now', '-30 days'))`);
    } else if (date_from && date_to) {
      whereClauses.push(`DATE(ep.scan_time) BETWEEN ? AND ?`);
      params.push(date_from, date_to);
    }

    const whereSql = whereClauses.length ? whereClauses.join(' AND ') : '1=1';

    const kpiRows = await query(
      `SELECT 
         COUNT(ep.id) as total_scans,
         COUNT(DISTINCT ep.student_id) as unique_students,
         COUNT(DISTINCT dev.id) as active_terminals,
         SUM(CASE WHEN DATE(ep.scan_time) = CURRENT_DATE THEN 1 ELSE 0 END) as today_scans
       FROM esp32_presence ep
       JOIN devices dev ON ep.device_id = dev.id
       JOIN departments d ON dev.department_id = d.id
       LEFT JOIN students st ON ep.student_id = st.id
       LEFT JOIN enrollments e ON e.student_id = st.id
       WHERE ${whereSql}`,
      params
    );

    const kpis = {
      total_scans: Number(kpiRows[0]?.total_scans) || 0,
      unique_students: Number(kpiRows[0]?.unique_students) || 0,
      active_terminals: Number(kpiRows[0]?.active_terminals) || 0,
      today_scans: Number(kpiRows[0]?.today_scans) || 0
    };

    const trendRows = await query(
      `SELECT 
         DATE(ep.scan_time) as date,
         COUNT(ep.id) as scan_count,
         COUNT(DISTINCT ep.student_id) as unique_students
       FROM esp32_presence ep
       JOIN devices dev ON ep.device_id = dev.id
       JOIN departments d ON dev.department_id = d.id
       LEFT JOIN students st ON ep.student_id = st.id
       LEFT JOIN enrollments e ON e.student_id = st.id
       WHERE ${whereSql}
       GROUP BY DATE(ep.scan_time)
       ORDER BY date ASC
       LIMIT 30`,
      params
    );

    const cohortRows = await query(
      `SELECT 
         d.name as branch_name,
         d.code as branch_code,
         COALESCE(e.year, dev.year) as cohort_year,
         COALESCE(e.semester, dev.semester) as cohort_semester,
         COUNT(ep.id) as scan_count
       FROM esp32_presence ep
       JOIN devices dev ON ep.device_id = dev.id
       JOIN departments d ON dev.department_id = d.id
       LEFT JOIN students st ON ep.student_id = st.id
       LEFT JOIN enrollments e ON e.student_id = st.id
       WHERE ${whereSql}
       GROUP BY d.id, COALESCE(e.year, dev.year), COALESCE(e.semester, dev.semester)
       ORDER BY scan_count DESC`,
      params
    );

    const records = await query(
      `SELECT 
         ep.id as scan_id,
         ep.event_id,
         ep.scan_time,
         st.id as student_id,
         st.full_name as student_name,
         st.official_enrollment_no,
         e.class_roll_no,
         d.name as department_name,
         d.code as department_code,
         d.name as branch_name,
         d.code as branch_code,
         COALESCE(e.year, dev.year) as year,
         COALESCE(e.semester, dev.semester) as semester,
         dev.id as device_id,
         dev.device_uid,
         dev.name as device_name,
         'PRESENT' as status
       FROM esp32_presence ep
       JOIN students st ON ep.student_id = st.id
       LEFT JOIN enrollments e ON e.student_id = st.id
       JOIN devices dev ON ep.device_id = dev.id
       JOIN departments d ON dev.department_id = d.id
       WHERE ${whereSql}
       ORDER BY ep.scan_time DESC
       LIMIT 300`,
      params
    );

    let cohortWhere = ["e.status = 'ENROLLED'"];
    let cohortParams = [];
    if (department_id) {
      cohortWhere.push('d.id = ?');
      cohortParams.push(department_id);
    } else if (branch_id) {
      cohortWhere.push('d.id = ?');
      cohortParams.push(branch_id);
    }
    if (year) {
      cohortWhere.push('e.year = ?');
      cohortParams.push(year);
    }
    if (semester) {
      cohortWhere.push('e.semester = ?');
      cohortParams.push(semester);
    }

    const cohortList = await query(
      `SELECT 
         d.id as department_id,
         d.name as department_name,
         d.code as department_code,
         d.id as branch_id,
         d.name as branch_name,
         d.code as branch_code,
         e.year,
         e.semester,
         COUNT(DISTINCT e.student_id) as enrolled_students
       FROM enrollments e
       JOIN departments d ON e.department_id = d.id
       WHERE ${cohortWhere.join(' AND ')}
       GROUP BY d.id, e.year, e.semester
       ORDER BY d.name, e.year, e.semester`,
      cohortParams
    );

    const scanStatsRows = await query(
      `SELECT 
         d.id as department_id,
         d.name as department_name,
         d.code as department_code,
         d.id as branch_id,
         d.name as branch_name,
         d.code as branch_code,
         COALESCE(e.year, dev.year) as year,
         COALESCE(e.semester, dev.semester) as semester,
         COUNT(DISTINCT ep.student_id) as present_students,
         COUNT(ep.id) as total_scans,
         COUNT(DISTINCT dev.id) as active_terminals,
         GROUP_CONCAT(DISTINCT dev.device_uid) as terminal_uids,
         MAX(ep.scan_time) as last_scan_time
       FROM esp32_presence ep
       JOIN devices dev ON ep.device_id = dev.id
       JOIN departments d ON dev.department_id = d.id
       LEFT JOIN students st ON ep.student_id = st.id
       LEFT JOIN enrollments e ON e.student_id = st.id
       WHERE ${whereSql}
       GROUP BY d.id, COALESCE(e.year, dev.year), COALESCE(e.semester, dev.semester)`,
      params
    );

    const scanStatsMap = new Map();
    scanStatsRows.forEach(row => {
      const key = `${row.department_id}_${row.year}_${row.semester}`;
      scanStatsMap.set(key, row);
    });

    const cohort_summary = cohortList.map(c => {
      const key = `${c.department_id}_${c.year}_${c.semester}`;
      const stats = scanStatsMap.get(key) || {};
      const enrolled = Number(c.enrolled_students) || 0;
      const present = Number(stats.present_students) || 0;
      const totalScans = Number(stats.total_scans) || 0;
      const attendancePct = enrolled > 0 ? Math.round((present / enrolled) * 1000) / 10 : 0;
      const activeTerminals = Number(stats.active_terminals) || 0;
      const terminalUids = stats.terminal_uids ? stats.terminal_uids.split(',').filter(Boolean) : [];

      return {
        department_id: c.department_id,
        department_name: c.department_name,
        department_code: c.department_code,
        branch_id: c.branch_id,
        branch_name: c.branch_name,
        branch_code: c.branch_code,
        year: c.year,
        semester: c.semester,
        enrolled_students: enrolled,
        present_students: present,
        attendance_percentage: attendancePct,
        total_scans: totalScans,
        active_terminals: activeTerminals,
        terminal_uids: terminalUids,
        last_scan_time: stats.last_scan_time || null,
        status: attendancePct >= 75 ? 'HEALTHY' : (attendancePct >= 50 ? 'AVERAGE' : 'DEFICIENT')
      };
    });

    const seenCohortKeys = new Set(cohortList.map(c => `${c.department_id}_${c.year}_${c.semester}`));
    scanStatsRows.forEach(s => {
      const key = `${s.department_id}_${s.year}_${s.semester}`;
      if (!seenCohortKeys.has(key)) {
        const present = Number(s.present_students) || 0;
        cohort_summary.push({
          department_id: s.department_id,
          department_name: s.department_name || department.name,
          department_code: s.department_code || department.code,
          branch_id: s.department_id,
          branch_name: s.department_name || department.name,
          branch_code: s.department_code || department.code,
          year: s.year,
          semester: s.semester,
          enrolled_students: present,
          present_students: present,
          attendance_percentage: 100,
          total_scans: Number(s.total_scans) || 0,
          active_terminals: Number(s.active_terminals) || 0,
          terminal_uids: s.terminal_uids ? s.terminal_uids.split(',').filter(Boolean) : [],
          last_scan_time: s.last_scan_time || null,
          status: 'HEALTHY'
        });
      }
    });

    return {
      department,
      kpis,
      daily_trend: trendRows.map(r => ({
        date: r.date,
        scan_count: Number(r.scan_count) || 0,
        unique_students: Number(r.unique_students) || 0
      })),
      cohort_distribution: cohortRows.map(r => ({
        name: `${r.branch_code} Y${r.cohort_year} S${r.cohort_semester}`,
        branch_name: r.branch_name,
        branch_code: r.branch_code,
        year: r.cohort_year,
        semester: r.cohort_semester,
        scan_count: Number(r.scan_count) || 0
      })),
      cohort_summary,
      records
    };
  }

  /**
   * Retrieve student demographic statistics, biometric coverage, and cohort breakdowns
   * @calledBy AdminController.getStudentAnalytics() (controllers/adminController.js)
   * @route GET /api/v1/admin/students/analytics (routes/admin.js)
   * @param {number|null} deptId Department filter
   * @returns {Promise<Object>} Demographic metrics and distributions
   */
  static async getStudentAnalytics(deptId) {
    let filterSql = '';
    const filterParams = [];
    if (deptId) {
      filterSql = 'WHERE e.department_id = ?';
      filterParams.push(deptId);
    }

    const overviewRows = await query(
      `SELECT 
         COUNT(DISTINCT s.id) as total_students,
         COUNT(DISTINCT CASE WHEN u.status = 'ACTIVE' THEN s.id END) as active_students,
         COUNT(DISTINCT CASE WHEN u.status = 'PROVISIONED' THEN s.id END) as provisioned_students,
         COUNT(DISTINCT CASE WHEN u.google_sub IS NOT NULL THEN s.id END) as google_linked_students,
         COUNT(DISTINCT fs.student_id) as biometric_enrolled_students
       FROM students s
       JOIN users u ON s.user_id = u.id
       JOIN enrollments e ON e.student_id = s.id
       LEFT JOIN fingerprint_slots fs ON fs.student_id = s.id AND fs.is_active = 1
       ${filterSql}`,
      filterParams
    );

    const totalStudents = overviewRows[0]?.total_students || 0;
    const biometricEnrolled = overviewRows[0]?.biometric_enrolled_students || 0;
    const activeStudents = overviewRows[0]?.active_students || 0;
    const provisionedStudents = overviewRows[0]?.provisioned_students || 0;
    const googleLinked = overviewRows[0]?.google_linked_students || 0;

    let deptBreakdownSql = `
      SELECT 
        d.id as department_id,
        d.name as department_name,
        d.code as department_code,
        COUNT(DISTINCT s.id) as student_count,
        COUNT(DISTINCT fs.student_id) as biometric_count,
        COUNT(DISTINCT CASE WHEN u.status = 'ACTIVE' THEN s.id END) as active_count,
        COUNT(DISTINCT CASE WHEN u.google_sub IS NOT NULL THEN s.id END) as google_count
      FROM departments d
      LEFT JOIN enrollments e ON e.department_id = d.id
      LEFT JOIN students s ON e.student_id = s.id
      LEFT JOIN users u ON s.user_id = u.id
      LEFT JOIN fingerprint_slots fs ON fs.student_id = s.id AND fs.is_active = 1
      WHERE d.is_active = 1
    `;
    const deptParams = [];
    if (deptId) {
      deptBreakdownSql += ' AND d.id = ?';
      deptParams.push(deptId);
    }
    deptBreakdownSql += ' GROUP BY d.id ORDER BY d.name';
    const departmentBreakdown = await query(deptBreakdownSql, deptParams);

    const cohortBreakdown = await query(
      `SELECT 
         d.id as department_id,
         d.name as department_name,
         d.code as department_code,
         d.id as branch_id,
         d.name as branch_name,
         d.code as branch_code,
         e.year,
         e.semester,
         COUNT(DISTINCT s.id) as student_count,
         COUNT(DISTINCT fs.student_id) as biometric_count,
         (
           SELECT t.full_name FROM teacher_assignments ta
           JOIN teachers t ON ta.teacher_id = t.id
           WHERE ta.department_id = d.id 
             AND ta.year = e.year 
             AND ta.semester = e.semester 
             AND ta.assignment_type = 'CLASS_TEACHER' 
             AND ta.is_active = 1 
           LIMIT 1
         ) as class_teacher_name
       FROM enrollments e
       JOIN departments d ON e.department_id = d.id
       JOIN students s ON e.student_id = s.id
       LEFT JOIN fingerprint_slots fs ON fs.student_id = s.id AND fs.is_active = 1
       ${filterSql}
       GROUP BY d.id, e.year, e.semester
       ORDER BY d.name, e.year, e.semester`,
      filterParams
    );

    const yearDistribution = await query(
      `SELECT e.year, COUNT(DISTINCT s.id) as count
       FROM enrollments e
       JOIN students s ON e.student_id = s.id
       ${filterSql}
       GROUP BY e.year
       ORDER BY e.year`,
      filterParams
    );

    return {
      total_students: totalStudents,
      active_students: activeStudents,
      provisioned_students: provisionedStudents,
      google_linked_students: googleLinked,
      biometric_enrolled_students: biometricEnrolled,
      biometric_coverage_pct: totalStudents > 0 ? Math.round((biometricEnrolled / totalStudents) * 100) : 0,
      cohorts_count: cohortBreakdown.length,
      department_breakdown: departmentBreakdown,
      cohort_breakdown: cohortBreakdown,
      year_distribution: yearDistribution
    };
  }

  /**
   * Paginated student roster listing with department and biometric details
   * @calledBy AdminController.getStudentRoster() (controllers/adminController.js)
   * @route GET /api/v1/admin/students/roster (routes/admin.js)
   * @param {Object} params Filter and pagination options
   * @returns {Promise<Object>} Total count and student array
   */
  static async getStudentRoster({ effDeptId, search, limit = 150, offset = 0 }) {
    let filter = '';
    const params = [];

    if (effDeptId) {
      filter += ' AND e.department_id = ?';
      params.push(parseInt(effDeptId, 10));
    }
    if (search) {
      filter += ' AND (s.full_name LIKE ? OR s.official_enrollment_no LIKE ? OR s.registration_no LIKE ? OR u.email LIKE ?)';
      const sTerm = `%${search.trim()}%`;
      params.push(sTerm, sTerm, sTerm, sTerm);
    }

    const countRow = await query(
      `SELECT COUNT(DISTINCT s.id) as total
       FROM students s
       JOIN users u ON s.user_id = u.id
       JOIN enrollments e ON e.student_id = s.id
       WHERE 1=1 ${filter}`,
      params
    );

    const queryParams = [...params, parseInt(limit, 10), parseInt(offset, 10)];
    const rows = await query(
      `SELECT 
         s.id as student_id,
         u.id as user_id,
         s.official_enrollment_no,
         s.registration_no,
         s.full_name,
         COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no,
         d.id as department_id,
         d.name as department_name,
         d.code as department_code,
         d.id as branch_id,
         d.name as branch_name,
         d.code as branch_code,
         e.year,
         e.semester,
         u.email,
         u.status as user_status,
         CASE WHEN u.google_sub IS NOT NULL THEN 1 ELSE 0 END as google_linked,
         fs.slot_id as biometric_slot_id,
         dev.name as device_name
       FROM students s
       JOIN users u ON s.user_id = u.id
       JOIN enrollments e ON e.student_id = s.id
       JOIN departments d ON e.department_id = d.id
       LEFT JOIN fingerprint_slots fs ON fs.student_id = s.id AND fs.is_active = 1
       LEFT JOIN devices dev ON fs.device_id = dev.id
       WHERE 1=1 ${filter}
       ORDER BY d.name, e.year, e.semester, e.class_roll_no ASC
       LIMIT ? OFFSET ?`,
      queryParams
    );

    return {
      total: countRow[0]?.total || 0,
      students: rows
    };
  }

  /**
   * Correct an attendance record post-finalization and record audit trail in a transaction
   * @calledBy AdminController.applyAttendanceCorrection() (controllers/adminController.js)
   * @route POST /api/v1/admin/attendance/corrections (routes/admin.js)
   * @param {Object} params Correction parameters
   * @returns {Promise<Object|null>} Old record snapshot, new status, and reason
   */
  static async applyAttendanceCorrection({ registerRecordId, newStatus, reason, adminUserId }) {
    const recRows = await query(
      `SELECT ra.*, s.session_date, s.register_id, ar.name as register_name
       FROM register_attendance ra
       JOIN attendance_sessions s ON ra.session_id = s.id
       JOIN attendance_registers ar ON s.register_id = ar.id
       WHERE ra.id = ?`,
      [registerRecordId]
    );
    if (!recRows.length) return null;
    const oldRec = recRows[0];

    await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE register_attendance 
         SET attendance_status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [newStatus, registerRecordId]
      );

      await conn.execute(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address)
         VALUES (?, 'ATTENDANCE_CORRECTED', 'register_attendance', ?, ?, ?, 'system')`,
        [
          adminUserId,
          registerRecordId,
          JSON.stringify({ status: oldRec.attendance_status, session_id: oldRec.session_id, student_id: oldRec.student_id }),
          JSON.stringify({ status: newStatus, reason })
        ]
      );
    });

    return { oldRecord: oldRec, newStatus, reason };
  }

  /**
   * Retrieve full institutional hierarchy tree: departments, assigned faculty, and enrolled student cohorts
   * @calledBy AdminController.getHierarchy() (controllers/adminController.js)
   * @route GET /api/v1/admin/hierarchy (routes/admin.js)
   * @returns {Promise<Array<Object>>} Department hierarchy tree
   */
  static async getHierarchy() {
    const departments = await query(
      `SELECT d.id, d.name, d.code, d.is_active, d.hod_user_id,
              u.email as hod_email, t.full_name as hod_name, t.phone as hod_phone
       FROM departments d
       LEFT JOIN users u ON d.hod_user_id = u.id
       LEFT JOIN teachers t ON d.hod_user_id = t.user_id
       ORDER BY d.code ASC`
    );

    const result = [];
    for (const dept of departments) {
      const teachers = await query(
        `SELECT DISTINCT t.id, t.full_name, t.phone, u.email,
                ta.assignment_type, ta.session_type_scope
         FROM teachers t
         JOIN users u ON t.user_id = u.id
         JOIN teacher_assignments ta ON ta.teacher_id = t.id AND ta.is_active = 1
         WHERE ta.department_id = ?
         ORDER BY t.full_name ASC`,
        [dept.id]
      );

      const studentCounts = await query(
        `SELECT e.year, e.semester, COUNT(DISTINCT s.id) as count
         FROM enrollments e
         JOIN students s ON e.student_id = s.id
         WHERE e.department_id = ? AND e.status = 'ENROLLED'
         GROUP BY e.year, e.semester
         ORDER BY e.year, e.semester`,
        [dept.id]
      );

      result.push({
        ...dept,
        teachers,
        cohorts: studentCounts
      });
    }
    return result;
  }

  /**
   * Retrieve admin user account profile details
   * @calledBy AdminController.getProfile() (controllers/adminController.js)
   * @route GET /api/v1/admin/profile (routes/admin.js)
   * @param {number} userId User ID
   * @returns {Promise<Object|null>} Admin profile row
   */
  static async getAdminProfile(userId) {
    const rows = await query(
      `SELECT u.id, u.username, u.email, u.status, u.created_at,
              CASE WHEN u.google_sub IS NOT NULL THEN 1 ELSE 0 END as google_linked
       FROM users u WHERE u.id = ?`,
      [userId]
    );
    return rows[0] || null;
  }

  /**
   * Update admin user email or password hash
   * @calledBy AdminController.updateProfile() (controllers/adminController.js)
   * @route PUT /api/v1/admin/profile (routes/admin.js)
   * @param {number} userId User ID
   * @param {Object} fields Email and password update fields
   * @returns {Promise<void>}
   */
  static async updateAdminProfile(userId, { email, current_password, new_password }) {
    if (email !== undefined) {
      const userRow = (await query(`SELECT email FROM users WHERE id = ?`, [userId]))[0];
      if (email.toLowerCase() !== userRow?.email?.toLowerCase()) {
        await query(
          `UPDATE users SET email = ?, username = ?, google_sub = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [email.toLowerCase(), email.toLowerCase(), userId]
        );
      }
    }
    if (new_password) {
      await query(`UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [new_password, userId]);
    }
  }

  /**
   * Retrieve pending HOD self-registration requests awaiting administrative adjudication
   * @calledBy AdminController.getPendingHods() (controllers/adminController.js)
   * @route GET /api/v1/admin/registrations/pending-hods (routes/admin.js)
   * @returns {Promise<Array<Object>>} Pending HOD requests
   */
  static async getPendingHODRegistrations() {
    return await query(
      `SELECT frr.id, frr.full_name, frr.email, frr.phone, frr.employee_id,
              frr.department_id, d.name as department_name, d.code as department_code,
              frr.account_type, frr.approval_type, frr.created_at
       FROM faculty_registration_requests frr
       LEFT JOIN departments d ON frr.department_id = d.id
       WHERE frr.approval_type = 'ADMIN' AND frr.status = 'PENDING'
       ORDER BY frr.created_at DESC`
    );
  }

  /**
   * Atomically approve a pending HOD registration, creating user, teacher profile, and HOD assignment
   * @calledBy AdminController.approveHodRegistration() (controllers/adminController.js)
   * @route POST /api/v1/admin/registrations/hods/:id/approve (routes/admin.js)
   * @param {number} reqId Registration request ID
   * @param {number} reviewerId Admin user ID performing approval
   * @param {number} ayId Academic year ID
   * @returns {Promise<Object|null>} Approved teacher account details or null
   */
  static async approveHODRegistration(reqId, reviewerId, ayId) {
    const reqRows = await query(
      `SELECT * FROM faculty_registration_requests WHERE id = ? AND approval_type = 'ADMIN' AND status = 'PENDING'`,
      [reqId]
    );
    if (!reqRows.length) return null;
    const r = reqRows[0];

    return await withTransaction(async (conn) => {
      const [uRes] = await conn.execute(
        `INSERT INTO users (username, email, password_hash, must_change_password, status)
         VALUES (?, ?, ?, 0, 'ACTIVE')`,
        [r.email.toLowerCase(), r.email.toLowerCase(), r.password_hash]
      );
      const createdUserId = uRes.insertId ?? uRes.lastInsertRowid;

      await conn.execute(`INSERT INTO user_roles (user_id, role) VALUES (?, 'TEACHER')`, [createdUserId]);

      const [tRes] = await conn.execute(
        `INSERT INTO teachers (user_id, department_id, employee_id, full_name, phone)
         VALUES (?, ?, ?, ?, ?)`,
        [createdUserId, r.department_id, r.employee_id || null, r.full_name, r.phone || null]
      );
      const createdTeacherId = tRes.insertId ?? tRes.lastInsertRowid;

      if (r.department_id) {
        await conn.execute(
          `UPDATE teacher_assignments SET is_active = 0, updated_at = CURRENT_TIMESTAMP
           WHERE department_id = ? AND assignment_type = 'HOD' AND is_active = 1`,
          [r.department_id]
        );

        await conn.execute(
          `INSERT INTO teacher_assignments (teacher_id, assignment_type, session_type_scope, department_id, year, semester, academic_year_id, assigned_by)
           VALUES (?, 'HOD', 'THEORY', ?, 1, 1, ?, ?)`,
          [createdTeacherId, r.department_id, ayId, reviewerId]
        );

        await conn.execute(
          `UPDATE departments SET hod_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [createdUserId, r.department_id]
        );
      }

      await conn.execute(
        `UPDATE faculty_registration_requests 
         SET status = 'APPROVED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [reviewerId, reqId]
      );

      await conn.execute(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
         VALUES (?, 'HOD_APPROVED', 'teachers', ?, ?, CURRENT_TIMESTAMP)`,
        [reviewerId, String(createdTeacherId), JSON.stringify({ email: r.email, department_id: r.department_id, approved_from_request: reqId })]
      );

      return { request_id: reqId, user_id: createdUserId, teacher_id: createdTeacherId, department_id: r.department_id, full_name: r.full_name };
    });
  }

  /**
   * Reject a pending HOD registration with recorded reason and audit log
   * @calledBy AdminController.rejectHodRegistration() (controllers/adminController.js)
   * @route POST /api/v1/admin/registrations/hods/:id/reject (routes/admin.js)
   * @param {number} reqId Registration request ID
   * @param {number} reviewerId Admin user ID
   * @param {string} [reason] Rejection explanation
   * @returns {Promise<boolean>} True if rejected, false if request not found
   */
  static async rejectHODRegistration(reqId, reviewerId, reason) {
    const reqRows = await query(
      `SELECT * FROM faculty_registration_requests WHERE id = ? AND approval_type = 'ADMIN' AND status = 'PENDING'`,
      [reqId]
    );
    if (!reqRows.length) return false;

    await query(
      `UPDATE faculty_registration_requests
       SET status = 'REJECTED', rejection_reason = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [reason || 'Rejected by Institutional Administration', reviewerId, reqId]
    );

    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
       VALUES (?, 'HOD_REJECTED', 'faculty_registration_requests', ?, ?, CURRENT_TIMESTAMP)`,
      [reviewerId, String(reqId), JSON.stringify({ reason: reason || 'Rejected by Admin', email: reqRows[0].email })]
    );

    return true;
  }

  /**
   * Retrieve the currently designated Common Faculty Manager assignment
   * @calledBy AdminController.getCommonFacultyManager() (controllers/adminController.js)
   * @route GET /api/v1/admin/common-faculty-manager (routes/admin.js)
   * @returns {Promise<Object|null>} Active Common Faculty Manager record or null
   */
  static async getCommonFacultyManager() {
    const rows = await query(
      `SELECT cfm.id as assignment_id, cfm.is_active, cfm.assigned_at,
              t.id as teacher_id, t.full_name, t.employee_id, t.phone,
              u.id as user_id, u.email as gmail,
              d.name as department_name, d.code as department_code
       FROM common_faculty_manager_assignments cfm
       JOIN teachers t ON cfm.teacher_id = t.id
       JOIN users u ON t.user_id = u.id
       LEFT JOIN departments d ON t.department_id = d.id
       WHERE cfm.is_active = 1
       ORDER BY cfm.assigned_at DESC LIMIT 1`
    );
    return rows[0] || null;
  }

  /**
   * Atomically assign a faculty member as the institutional Common Faculty Manager
   * @calledBy AdminController.assignCommonFacultyManager() (controllers/adminController.js)
   * @route POST /api/v1/admin/common-faculty-manager (routes/admin.js)
   * @param {number} teacherId Teacher ID
   * @param {number} adminUserId Admin user ID
   * @returns {Promise<Object|null>} Assignment result or null
   */
  static async assignCommonFacultyManager(teacherId, adminUserId) {
    const tRows = await query(`SELECT t.id, t.user_id, t.full_name FROM teachers t WHERE t.id = ?`, [teacherId]);
    if (!tRows.length) return null;
    const teacher = tRows[0];

    return await withTransaction(async (conn) => {
      const prevManagers = await query(
        `SELECT t.user_id FROM common_faculty_manager_assignments cfm
         JOIN teachers t ON cfm.teacher_id = t.id WHERE cfm.is_active = 1`
      );
      for (const pm of prevManagers) {
        await conn.execute(
          `DELETE FROM user_roles WHERE user_id = ? AND role = 'COMMON_FACULTY_MANAGER'`,
          [pm.user_id]
        );
      }

      await conn.execute(
        `UPDATE common_faculty_manager_assignments 
         SET is_active = 0, deactivated_at = CURRENT_TIMESTAMP 
         WHERE is_active = 1`
      );

      const [res] = await conn.execute(
        `INSERT INTO common_faculty_manager_assignments (teacher_id, assigned_by, is_active)
         VALUES (?, ?, 1)`,
        [teacherId, adminUserId]
      );
      const assignmentId = res.insertId ?? res.lastInsertRowid;

      await conn.execute(
        `INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'COMMON_FACULTY_MANAGER')`,
        [teacher.user_id]
      );

      await conn.execute(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
         VALUES (?, 'COMMON_FACULTY_MANAGER_ASSIGNED', 'teachers', ?, ?, CURRENT_TIMESTAMP)`,
        [adminUserId, String(teacherId), JSON.stringify({ teacher_id: teacherId, full_name: teacher.full_name })]
      );

      return { assignment_id: assignmentId, teacher_id: teacherId, full_name: teacher.full_name };
    });
  }

  /**
   * Revoke active Common Faculty Manager assignment and remove corresponding role
   * @calledBy AdminController.removeCommonFacultyManager() (controllers/adminController.js)
   * @route DELETE /api/v1/admin/common-faculty-manager (routes/admin.js)
   * @param {number} adminUserId Admin user ID
   * @returns {Promise<void>}
   */
  static async removeCommonFacultyManager(adminUserId) {
    return await withTransaction(async (conn) => {
      const activeManagers = await query(
        `SELECT cfm.id, cfm.teacher_id, t.user_id, t.full_name
         FROM common_faculty_manager_assignments cfm
         JOIN teachers t ON cfm.teacher_id = t.id
         WHERE cfm.is_active = 1`
      );

      for (const m of activeManagers) {
        await conn.execute(
          `DELETE FROM user_roles WHERE user_id = ? AND role = 'COMMON_FACULTY_MANAGER'`,
          [m.user_id]
        );
      }

      await conn.execute(
        `UPDATE common_faculty_manager_assignments 
         SET is_active = 0, deactivated_at = CURRENT_TIMESTAMP 
         WHERE is_active = 1`
      );

      await conn.execute(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
         VALUES (?, 'COMMON_FACULTY_MANAGER_REVOKED', 'common_faculty_manager_assignments', 'ALL', '{}', CURRENT_TIMESTAMP)`,
        [adminUserId]
      );
    });
  }

  /**
   * Retrieve list of all active faculty teachers with department details
   * @calledBy AdminController.getAllTeachers() (controllers/adminController.js)
   * @route GET /api/v1/admin/teachers (routes/admin.js)
   * @returns {Promise<Array<Object>>} Teacher records
   */
  static async getAllTeachers() {
    return await query(
      `SELECT t.id as teacher_id, t.full_name, t.employee_id, t.phone,
              d.id as department_id, d.name as department_name, d.code as department_code,
              u.id as user_id, u.email as gmail, u.status
       FROM teachers t
       JOIN users u ON t.user_id = u.id
       LEFT JOIN departments d ON t.department_id = d.id
       WHERE u.status = 'ACTIVE'
       ORDER BY t.full_name ASC`
    );
  }

  /**
   * Check status of institutional self-registration gates for HOD and Common Faculty
   * @calledBy AdminController.getRegistrationGates() (controllers/adminController.js)
   * @route GET /api/v1/admin/registration-gates (routes/admin.js)
   * @returns {Promise<{hod_open: boolean, common_faculty_open: boolean}>}
   */
  static async getRegistrationGates() {
    const settings = await query(
      `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('admin_reg_hod_open', 'admin_reg_common_faculty_open')`
    );
    const hodOpen = settings.some(s => s.setting_key === 'admin_reg_hod_open' && s.setting_value === '1');
    const commonOpen = settings.some(s => s.setting_key === 'admin_reg_common_faculty_open' && s.setting_value === '1');
    return {
      hod_open: hodOpen,
      common_faculty_open: commonOpen
    };
  }

  /**
   * Toggle open/closed state of registration gate with audit logging
   * @calledBy AdminController.toggleRegistrationGate() (controllers/adminController.js)
   * @route POST /api/v1/admin/registration-gates/toggle (routes/admin.js)
   * @param {'HOD'|'COMMON_FACULTY'} target Gate target
   * @param {boolean} isOpen Whether gate is open
   * @param {number} userId Admin user ID
   * @returns {Promise<void>}
   */
  static async toggleRegistrationGate(target, isOpen, userId) {
    const settingKey = target === 'HOD' ? 'admin_reg_hod_open' : 'admin_reg_common_faculty_open';
    const desc = target === 'HOD' ? 'HOD Self-Registration Open/Closed' : 'Common Faculty Self-Registration Open/Closed';

    await query(
      `INSERT INTO system_settings (setting_key, setting_value, description, updated_by, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(setting_key)
       DO UPDATE SET setting_value = excluded.setting_value, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
      [settingKey, isOpen ? '1' : '0', desc, userId]
    );

    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
       VALUES (?, 'REGISTRATION_GATE_TOGGLED', 'system_settings', ?, ?, CURRENT_TIMESTAMP)`,
      [userId, settingKey, JSON.stringify({ target, is_open: isOpen })]
    );
  }

  /**
   * Retrieve list of all administrators
   */
  static async getAdministrators() {
    const rows = await query(`
      SELECT 
        u.id, 
        u.username, 
        u.email, 
        u.status, 
        u.created_at,
        t.full_name,
        t.employee_id,
        t.phone
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id AND ur.role = 'SYSTEM_ADMIN'
      LEFT JOIN teachers t ON t.user_id = u.id
      ORDER BY u.id ASC
    `);

    const envEmail = (process.env.ADMIN_EMAIL || process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();

    return rows.map(r => ({
      ...r,
      is_env_admin: Boolean(envEmail && r.email && r.email.toLowerCase() === envEmail)
    }));
  }

  /**
   * Create a new administrator account
   */
  static async createAdministrator({ email, password, full_name, phone, employee_id }) {
    const cleanEmail = email.trim().toLowerCase();
    const existing = await query(`SELECT id FROM users WHERE LOWER(email) = ?`, [cleanEmail]);

    if (existing && existing.length > 0) {
      const existingId = existing[0].id;
      const existingRoles = await query(`SELECT role FROM user_roles WHERE user_id = ? AND role = 'SYSTEM_ADMIN'`, [existingId]);
      if (existingRoles && existingRoles.length > 0) {
        throw new Error('An administrator account with this email already exists');
      }
      // Upgrade existing user to SYSTEM_ADMIN
      await query(`INSERT INTO user_roles (user_id, role) VALUES (?, 'SYSTEM_ADMIN')`, [existingId]);
      return { id: existingId, email: cleanEmail, full_name };
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const insertUser = await query(
      `INSERT INTO users (username, email, password_hash, must_change_password, status) VALUES (?, ?, ?, 0, 'ACTIVE')`,
      [cleanEmail, cleanEmail, passwordHash]
    );

    const newUserId = insertUser.insertId || insertUser.lastID || (
      await query(`SELECT id FROM users WHERE LOWER(email) = ?`, [cleanEmail])
    )[0]?.id;

    await query(`INSERT INTO user_roles (user_id, role) VALUES (?, 'SYSTEM_ADMIN')`, [newUserId]);

    const depts = await query(`SELECT id FROM departments ORDER BY id ASC LIMIT 1`);
    const deptId = (depts && depts.length > 0) ? depts[0].id : 1;
    const empId = employee_id || `ADMIN-${Math.floor(100 + Math.random() * 900)}`;

    await query(
      `INSERT INTO teachers (user_id, department_id, full_name, employee_id, phone) VALUES (?, ?, ?, ?, ?)`,
      [newUserId, deptId, full_name || 'Administrator', empId, phone || '']
    );

    return { id: newUserId, email: cleanEmail, full_name, employee_id: empId };
  }

  /**
   * Delete an administrator account
   */
  static async deleteAdministrator(adminId, currentUserId) {
    if (parseInt(adminId, 10) === parseInt(currentUserId, 10)) {
      throw new Error('You cannot delete your own active administrator account');
    }

    const adminCount = await query(`SELECT COUNT(*) as c FROM user_roles WHERE role = 'SYSTEM_ADMIN'`);
    if (adminCount[0]?.c <= 1) {
      throw new Error('Cannot delete the sole remaining administrator account');
    }

    // Remove SYSTEM_ADMIN role
    await query(`DELETE FROM user_roles WHERE user_id = ? AND role = 'SYSTEM_ADMIN'`, [adminId]);

    // If user has no other roles, delete teachers & user record
    const remainingRoles = await query(`SELECT role FROM user_roles WHERE user_id = ?`, [adminId]);
    if (!remainingRoles || remainingRoles.length === 0) {
      await query(`DELETE FROM teachers WHERE user_id = ?`, [adminId]);
      await query(`DELETE FROM users WHERE id = ?`, [adminId]);
    }

    return true;
  }
}

module.exports = AdminModel;
