/**
 * HOD Model
 * Encapsulates SQLite queries and transactions for department administration:
 * teachers, subjects, course assignments, devices, student rosters, bulk imports,
 * semester promotions, department settings, faculty registrations, reports, and archives.
 * Provides bidirectional code traceability upward to HodController and routes/hod.js.
 */

const { query, withTransaction } = require('../config/db');
const bcrypt = require('bcrypt');

class HodModel {
  /**
   * Retrieve high-level departmental dashboard KPIs, active registers, attendance rates, and today's sessions
   * @calledBy HodController.getDashboard() (controllers/hodController.js)
   * @route GET /api/v1/hod/dashboard (routes/hod.js)
   * @param {number} deptId Department ID
   * @returns {Promise<Object>} Aggregated dashboard metrics
   */
  static async getDashboard(deptId) {
    const [teachersCount] = await query(`SELECT COUNT(*) as total FROM teachers WHERE department_id = ?`, [deptId]);
    const [subjectsCount] = await query(`SELECT COUNT(*) as total FROM subjects WHERE department_id = ? AND is_active = 1`, [deptId]);
    const [studentsCount] = await query(`SELECT COUNT(DISTINCT e.student_id) as total FROM enrollments e WHERE e.department_id = ?`, [deptId]);
    const [activeRegisters] = await query(`SELECT COUNT(*) as total FROM attendance_registers WHERE department_id = ? AND is_official = 1 AND is_active = 1`, [deptId]);

    const [avgAttendance] = await query(
      `SELECT ROUND(AVG(sub.pct), 1) as avg_pct FROM (
         SELECT 
           (SUM(CASE WHEN ra.attendance_status IN ('PRESENT','LATE') THEN 1 ELSE 0 END) * 100.0 /
            NULLIF(COUNT(ra.id), 0)) as pct
         FROM attendance_registers ar
         JOIN attendance_sessions s ON s.register_id = ar.id AND s.state = 'FINALIZED'
         JOIN register_attendance ra ON ra.session_id = s.id
         WHERE ar.department_id = ? AND ar.is_official = 1
       ) sub`, [deptId]
    );

    const [deptInfo] = await query(`SELECT name, code, degree_duration_years, active_term FROM departments WHERE id = ?`, [deptId]);

    const [devicesSummary] = await query(
      `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN is_active = 1 AND last_heartbeat_at >= datetime('now', '-10 minutes') THEN 1 ELSE 0 END) as online
       FROM devices WHERE department_id = ?`, [deptId]
    );

    const [pendingStudents] = await query(
      `SELECT COUNT(DISTINCT s.id) as total
       FROM students s
       JOIN users u ON s.user_id = u.id
       JOIN enrollments e ON e.student_id = s.id
       WHERE u.status = 'PENDING' AND e.department_id = ?`, [deptId]
    );

    const [pendingLeaves] = await query(
      `SELECT COUNT(*) as total
       FROM leave_applications la
       JOIN students s ON la.student_id = s.id
       JOIN enrollments e ON e.student_id = s.id
       WHERE la.status = 'PENDING' AND e.department_id = ?`, [deptId]
    );

    const [pendingFaculty] = await query(
      `SELECT COUNT(*) as total
       FROM faculty_registration_requests
       WHERE department_id = ? AND approval_type = 'DEPT_HOD' AND status = 'PENDING'`, [deptId]
    );

    const todaySessions = await query(
      `SELECT s.id, s.label, s.session_type, s.state, s.session_date,
              sub.name as subject_name, sub.code as subject_code,
              t.full_name as teacher_name
       FROM attendance_sessions s
       JOIN subjects sub ON s.subject_id = sub.id
       JOIN teachers t ON s.teacher_id = t.id
       WHERE s.department_id = ? AND s.session_date = DATE('now')
       ORDER BY s.id DESC`, [deptId]
    );

    const cohorts = await query(
      `SELECT e.year, e.semester,
              COUNT(DISTINCT e.student_id) as student_count,
              (SELECT t.full_name FROM teacher_assignments ta
               JOIN teachers t ON ta.teacher_id = t.id
               WHERE ta.department_id = ? AND ta.year = e.year AND ta.semester = e.semester
                 AND ta.assignment_type = 'CLASS_TEACHER' AND ta.is_active = 1 LIMIT 1) as class_teacher_name
       FROM enrollments e
       WHERE e.department_id = ? AND e.status = 'ENROLLED'
       GROUP BY e.year, e.semester
       ORDER BY e.year, e.semester`, [deptId, deptId]
    );

    return {
      department: deptInfo,
      counts: {
        teachers: teachersCount?.total || 0,
        subjects: subjectsCount?.total || 0,
        students: studentsCount?.total || 0,
        active_registers: activeRegisters?.total || 0,
        avg_attendance_pct: avgAttendance?.avg_pct || 0,
        devices_total: devicesSummary?.total || 0,
        devices_online: devicesSummary?.online || 0,
        pending_students: pendingStudents?.total || 0,
        pending_leaves: pendingLeaves?.total || 0,
        pending_faculty: pendingFaculty?.total || 0
      },
      today_sessions: todaySessions,
      cohorts
    };
  }

  /**
   * List all faculty members belonging to the department
   * @calledBy HodController.getTeachers() (controllers/hodController.js)
   * @route GET /api/v1/hod/teachers (routes/hod.js)
   * @param {number} deptId Department ID
   * @returns {Promise<Array<Object>>} Teacher records
   */
  static async getTeachers(deptId) {
    return await query(
      `SELECT t.id, t.user_id, t.full_name, t.employee_id, t.phone,
              u.email as gmail, u.username, u.status, u.must_change_password,
              CASE WHEN u.google_sub IS NOT NULL THEN 1 ELSE 0 END as google_linked,
              COUNT(DISTINCT ta.id) as active_assignments,
              t.created_at
       FROM teachers t
       JOIN users u ON t.user_id = u.id
       LEFT JOIN teacher_assignments ta ON ta.teacher_id = t.id AND ta.is_active = 1
       WHERE t.department_id = ?
       GROUP BY t.id
       ORDER BY t.full_name`, [deptId]
    );
  }

  /**
   * Check if user account already exists by username or email
   * @calledBy HodController.createTeacher() (controllers/hodController.js)
   * @route POST /api/v1/hod/teachers (routes/hod.js)
   * @param {string} email Email address
   * @returns {Promise<Object|null>} User record or null
   */
  static async findExistingUser(email) {
    const rows = await query(`SELECT id FROM users WHERE username = ? OR email = ?`, [email, email]);
    return rows[0] || null;
  }

  /**
   * Create a new teacher user account and departmental faculty profile in a transaction
   * @calledBy HodController.createTeacher() (controllers/hodController.js)
   * @route POST /api/v1/hod/teachers (routes/hod.js)
   * @param {Object} params Teacher attributes
   * @returns {Promise<Object>} Created teacher info
   */
  static async createTeacher({ fullName, email, passwordHash, departmentId, phone, employeeId }) {
    const gmail = email.toLowerCase().trim();
    return await withTransaction(async (conn) => {
      const [uRes] = await conn.execute(
        `INSERT INTO users (username, email, password_hash, temp_password_hash, must_change_password, status)
         VALUES (?, ?, ?, ?, 0, 'ACTIVE')`,
        [gmail, gmail, passwordHash, passwordHash]
      );
      const userId = uRes.insertId ?? uRes.lastInsertRowid;

      await conn.execute(`INSERT INTO user_roles (user_id, role) VALUES (?, 'TEACHER')`, [userId]);

      const [tRes] = await conn.execute(
        `INSERT INTO teachers (user_id, department_id, employee_id, full_name, phone)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, departmentId, employeeId ? employeeId.trim() : null, fullName.trim(), phone ? phone.trim() : null]
      );
      const teacherId = tRes.insertId ?? tRes.lastInsertRowid;

      return { teacher_id: teacherId, user_id: userId, full_name: fullName.trim(), gmail };
    });
  }

  /**
   * Retrieve teacher details and active course assignments by ID within department
   * @calledBy HodController.getTeacherById() (controllers/hodController.js)
   * @route GET /api/v1/hod/teachers/:id (routes/hod.js)
   * @param {number} id Teacher ID
   * @param {number} deptId Department ID
   * @returns {Promise<Object|null>} Teacher details with assignments
   */
  static async getTeacherById(id, deptId) {
    const teacherRows = await query(
      `SELECT t.id, t.employee_id, t.full_name, t.phone, t.department_id,
              u.id as user_id, u.username as gmail, u.email, u.status, u.must_change_password,
              CASE WHEN u.google_sub IS NOT NULL THEN 1 ELSE 0 END as google_linked,
              t.created_at
       FROM teachers t JOIN users u ON t.user_id = u.id
       WHERE t.id = ? AND t.department_id = ?`,
      [id, deptId]
    );
    if (!teacherRows.length) return null;

    const assignments = await query(
      `SELECT ta.*, s.name as subject_name, s.code as subject_code,
              d.name as department_name, ay.label as academic_year_label,
              ar.id as register_id, ar.name as register_name
       FROM teacher_assignments ta
       LEFT JOIN subjects s ON ta.subject_id = s.id
       JOIN departments d ON ta.department_id = d.id
       JOIN academic_years ay ON ta.academic_year_id = ay.id
       LEFT JOIN attendance_registers ar ON ar.assignment_id = ta.id
       WHERE ta.teacher_id = ? AND ta.is_active = 1
       ORDER BY ta.assignment_type, ta.created_at DESC`,
      [id]
    );

    return { ...teacherRows[0], assignments };
  }

  /**
   * Update teacher name, phone, or employee ID
   * @calledBy HodController.updateTeacher() (controllers/hodController.js)
   * @route PUT /api/v1/hod/teachers/:id (routes/hod.js)
   * @param {number} id Teacher ID
   * @param {number} deptId Department ID
   * @param {Object} fields Fields to update
   * @returns {Promise<boolean>}
   */
  static async updateTeacher(id, deptId, { fullName, phone, employeeId }) {
    const sets = [], params = [];
    if (fullName) { sets.push('full_name = ?'); params.push(fullName.trim()); }
    if (phone !== undefined) { sets.push('phone = ?'); params.push(phone ? phone.trim() : null); }
    if (employeeId !== undefined) { sets.push('employee_id = ?'); params.push(employeeId ? employeeId.trim() : null); }
    if (!sets.length) return false;

    params.push(id, deptId);
    await query(`UPDATE teachers SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND department_id = ?`, params);
    return true;
  }

  /**
   * Reset teacher account password and invalidate active login sessions
   * @calledBy HodController.resetTeacherPassword() (controllers/hodController.js)
   * @route POST /api/v1/hod/teachers/:id/reset-password (routes/hod.js)
   * @param {number} userId User ID
   * @param {string} passwordHash New password bcrypt hash
   * @returns {Promise<boolean>}
   */
  static async resetTeacherPassword(userId, passwordHash) {
    await query(
      `UPDATE users SET password_hash = ?, temp_password_hash = ?, must_change_password = 0,
       status = 'ACTIVE', google_sub = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [passwordHash, passwordHash, userId]
    );
    await query(`UPDATE user_sessions SET is_revoked = 1 WHERE user_id = ?`, [userId]);
    return true;
  }

  /**
   * Delete teacher profile, account, roles, sessions, and course assignments in a transaction
   * @calledBy HodController.deleteTeacher() (controllers/hodController.js)
   * @route DELETE /api/v1/hod/teachers/:id (routes/hod.js)
   * @param {number} id Teacher ID
   * @param {number} deptId Department ID
   * @param {number} userId User ID
   * @returns {Promise<boolean>}
   */
  static async deleteTeacher(id, deptId, userId) {
    await withTransaction(async (conn) => {
      // 1. Clean up registers and child attendance records
      await conn.execute(`DELETE FROM register_attendance WHERE register_id IN (SELECT id FROM attendance_registers WHERE teacher_id = ?)`, [id]);
      await conn.execute(`DELETE FROM attendance_sessions WHERE register_id IN (SELECT id FROM attendance_registers WHERE teacher_id = ?)`, [id]);
      await conn.execute(`DELETE FROM attendance_registers WHERE teacher_id = ?`, [id]);
      await conn.execute(`DELETE FROM teacher_assignments WHERE teacher_id = ?`, [id]);
      try { await conn.execute(`UPDATE teaching_groups SET teacher_id = NULL WHERE teacher_id = ?`, [id]); } catch (_) {}
      try { await conn.execute(`UPDATE departments SET hod_user_id = NULL WHERE hod_user_id = ?`, [userId]); } catch (_) {}

      // 2. Delete teacher row
      await conn.execute(`DELETE FROM teachers WHERE id = ?`, [id]);

      // 3. Clean up user credentials, sessions and roles
      if (userId) {
        await conn.execute(`DELETE FROM user_roles WHERE user_id = ?`, [userId]);
        await conn.execute(`DELETE FROM user_sessions WHERE user_id = ?`, [userId]);
        await conn.execute(`DELETE FROM notifications WHERE user_id = ?`, [userId]);
        try { await conn.execute(`UPDATE audit_logs SET user_id = NULL WHERE user_id = ?`, [userId]); } catch (_) {}
        await conn.execute(`DELETE FROM users WHERE id = ?`, [userId]);
      }
    });
    return true;
  }

  /**
   * Retrieve department faculty roster with active teaching workloads and assigned subjects
   * @calledBy HodController.getFacultyRoster() (controllers/hodController.js)
   * @route GET /api/v1/hod/faculty-roster (routes/hod.js)
   * @param {number} deptId Department ID
   * @returns {Promise<Array<Object>>} Faculty roster with teaching load
   */
  static async getFacultyRoster(deptId) {
    const teachers = await query(
      `SELECT t.id, t.employee_id, t.full_name, t.phone,
              u.email, u.status, u.username as gmail,
              (SELECT COUNT(*) FROM teacher_assignments ta WHERE ta.teacher_id = t.id AND ta.is_active = 1) as assignment_count,
              (SELECT COUNT(*) FROM teaching_groups tg WHERE tg.teacher_id = t.id AND tg.status = 'ACTIVE') as active_groups_count
       FROM teachers t
       JOIN users u ON t.user_id = u.id
       WHERE t.department_id = ?
       ORDER BY t.full_name ASC`,
      [deptId]
    );

    const teacherIds = teachers.map(t => t.id);
    let assignedSubjects = [];
    if (teacherIds.length) {
      assignedSubjects = await query(
        `SELECT ta.teacher_id, s.name as subject_name, s.code as subject_code, ta.session_type_scope,
                ta.year, ta.semester
         FROM teacher_assignments ta
         JOIN subjects s ON ta.subject_id = s.id
         WHERE ta.teacher_id IN (${teacherIds.map(() => '?').join(',')}) AND ta.is_active = 1`,
        teacherIds
      );
    }

    return teachers.map(t => {
      const subs = assignedSubjects.filter(s => s.teacher_id === t.id);
      return {
        ...t,
        teaching_load: (t.assignment_count || 0) + (t.active_groups_count || 0),
        subjects: subs
      };
    });
  }

  /**
   * Retrieve departmental student roster with cumulative attendance percentages and threshold compliance
   * @calledBy HodController.getStudentsRoster() (controllers/hodController.js)
   * @route GET /api/v1/hod/students-roster (routes/hod.js)
   * @param {number} deptId Department ID
   * @returns {Promise<Array<Object>>} Student roster with attendance stats
   */
  static async getStudentsRoster(deptId) {
    const students = await query(
      `SELECT st.id as student_id, st.full_name, u.email, st.official_enrollment_no, st.registration_no,
              COALESCE(st.class_roll_no, e.class_roll_no) as class_roll_no,
              e.year, e.semester, e.status as enrollment_status,
              d.name as department_name, d.code as department_code
       FROM students st
       JOIN users u ON st.user_id = u.id
       JOIN enrollments e ON e.student_id = st.id
       JOIN departments d ON e.department_id = d.id
       WHERE e.department_id = ? AND e.status != 'WITHDRAWN'
       ORDER BY e.year, e.semester, COALESCE(st.class_roll_no, e.class_roll_no) ASC`,
      [deptId]
    );

    if (students.length) {
      const studentIds = students.map(s => s.student_id);
      const attStats = await query(
        `SELECT ra.student_id,
                COUNT(ra.id) as total_sessions,
                SUM(CASE WHEN ra.attendance_status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) as attended_sessions
         FROM register_attendance ra
         JOIN attendance_sessions asess ON asess.id = ra.session_id AND asess.state = 'FINALIZED'
         JOIN attendance_registers ar ON ar.id = asess.register_id
         WHERE ar.department_id = ? AND ra.student_id IN (${studentIds.map(() => '?').join(',')})
         GROUP BY ra.student_id`,
        [deptId, ...studentIds]
      );
      const statMap = new Map(attStats.map(s => [s.student_id, s]));

      for (const st of students) {
        const stat = statMap.get(st.student_id) || { total_sessions: 0, attended_sessions: 0 };
        st.total_sessions = stat.total_sessions || 0;
        st.attended_sessions = stat.attended_sessions || 0;
        st.attendance_pct = st.total_sessions > 0
          ? Math.round((st.attended_sessions / st.total_sessions) * 100)
          : 100;
        st.is_defaulter = st.attendance_pct < 75 && st.total_sessions > 0;
        st.below_threshold = st.attendance_pct < 75 && st.total_sessions > 0;
      }
    }

    return students;
  }

  /**
   * List all attendance classes/registers in department with teacher and session stats
   * @calledBy HodController.getDepartmentClasses() (controllers/hodController.js)
   * @route GET /api/v1/hod/department-classes (routes/hod.js)
   * @param {number} deptId Department ID
   * @returns {Promise<Array<Object>>} Department classes listing
   */
  static async getDepartmentClasses(deptId) {
    return await query(
      `SELECT ar.id as register_id, ar.name as register_name, ar.year, ar.semester,
              ar.session_type_scope, ar.is_official,
              s.name as subject_name, s.code as subject_code,
              t.id as teacher_id, t.full_name as teacher_name, u.email as teacher_email,
              (SELECT COUNT(*) FROM attendance_sessions s2 WHERE s2.register_id = ar.id AND s2.state = 'FINALIZED') as finalized_sessions,
              (SELECT ROUND(AVG(CASE WHEN ra.attendance_status IN ('PRESENT', 'LATE') THEN 100.0 ELSE 0.0 END), 1)
               FROM register_attendance ra
               JOIN attendance_sessions s3 ON s3.id = ra.session_id AND s3.state = 'FINALIZED'
               WHERE s3.register_id = ar.id) as avg_attendance_pct,
              (SELECT COUNT(DISTINCT e.student_id) FROM enrollments e WHERE e.department_id = ar.department_id AND e.year = ar.year AND e.semester = ar.semester AND e.status = 'ENROLLED') as total_enrolled
       FROM attendance_registers ar
       LEFT JOIN subjects s ON ar.subject_id = s.id
       LEFT JOIN teachers t ON ar.teacher_id = t.id
       LEFT JOIN users u ON t.user_id = u.id
       WHERE ar.department_id = ? AND ar.is_active = 1
       ORDER BY ar.year, ar.semester, ar.name ASC`,
      [deptId]
    );
  }

  /**
   * Retrieve detailed attendance matrix or summary ledger for a department class register
   * @calledBy HodController.getDepartmentClassAttendance() (controllers/hodController.js)
   * @route GET /api/v1/hod/department-classes/:registerId/attendance (routes/hod.js)
   * @param {number} deptId Department ID
   * @param {number} registerId Attendance register ID
   * @param {string|null} [targetMonth] Optional target month (YYYY-MM)
   * @returns {Promise<Object|null>} Ledger matrix or summary
   */
  static async getDepartmentClassAttendance(deptId, registerId, targetMonth = null) {
    const regRows = await query(`SELECT * FROM attendance_registers WHERE id = ? AND department_id = ?`, [registerId, deptId]);
    if (!regRows.length) return null;
    const reg = regRows[0];

    let students = [];
    if (reg.group_id) {
      students = await query(
        `SELECT st.id as student_id, st.full_name, st.official_enrollment_no, st.registration_no,
                COALESCE(st.class_roll_no, e.class_roll_no) as class_roll_no
         FROM teaching_group_members tgm
         JOIN students st ON tgm.student_id = st.id
         LEFT JOIN enrollments e ON e.student_id = st.id AND e.status = 'ENROLLED'
         WHERE tgm.group_id = ? AND tgm.status IN ('ENROLLED', 'ACTIVE')
         ORDER BY COALESCE(st.class_roll_no, e.class_roll_no) ASC`,
        [reg.group_id]
      );
    } else {
      students = await query(
        `SELECT st.id as student_id, st.full_name, st.official_enrollment_no, st.registration_no,
                COALESCE(st.class_roll_no, e.class_roll_no) as class_roll_no
         FROM enrollments e
         JOIN students st ON e.student_id = st.id
         WHERE e.department_id = ? AND e.year = ? AND e.semester = ? AND e.status = 'ENROLLED'
         ORDER BY COALESCE(st.class_roll_no, e.class_roll_no) ASC`,
        [reg.department_id, reg.year, reg.semester]
      );
    }

    if (targetMonth) {
      const sessions = await query(
        `SELECT id, session_date, period_number, label, session_type, state
         FROM attendance_sessions
         WHERE register_id = ? AND session_date LIKE ?
         ORDER BY session_date ASC, period_number ASC`,
        [registerId, `${targetMonth}%`]
      );

      const attendanceRows = await query(
        `SELECT ra.student_id, ra.attendance_status, s.id as session_id, s.session_date, s.period_number
         FROM register_attendance ra
         JOIN attendance_sessions s ON ra.session_id = s.id
         WHERE s.register_id = ? AND s.state = 'FINALIZED'`,
        [registerId]
      );

      const attMap = new Map();
      attendanceRows.forEach(row => {
        if (!attMap.has(row.student_id)) attMap.set(row.student_id, new Map());
        attMap.get(row.student_id).set(row.session_id, row.attendance_status);
      });

      const studentLedger = students.map(st => {
        const marks = {};
        let attended = 0, total = 0;
        const sMap = attMap.get(st.student_id) || new Map();

        sessions.forEach(sess => {
          const status = sMap.get(sess.id) || null;
          marks[sess.id] = status;
          if (status === 'PRESENT' || status === 'LATE') attended++;
          if (status) total++;
        });

        const pct = total > 0 ? Math.round((attended / total) * 100) : 100;
        return {
          ...st,
          marks,
          total_sessions: total,
          attended_sessions: attended,
          attendance_pct: pct,
          is_defaulter: pct < 75 && total > 0,
          below_threshold: pct < 75 && total > 0
        };
      });

      return {
        register_id: reg.id,
        register_name: reg.name,
        month: targetMonth,
        sessions,
        students: studentLedger
      };
    }

    const totalSessions = (await query(
      `SELECT COUNT(*) as cnt FROM attendance_sessions WHERE register_id = ? AND state = 'FINALIZED'`,
      [registerId]
    ))[0]?.cnt || 0;

    const studentIds = students.map(s => s.student_id);
    let attMarks = [];
    if (studentIds.length && totalSessions > 0) {
      attMarks = await query(
        `SELECT ra.student_id,
                COUNT(ra.id) as sessions_recorded,
                SUM(CASE WHEN ra.attendance_status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) as attended
         FROM register_attendance ra
         JOIN attendance_sessions asess ON asess.id = ra.session_id AND asess.state = 'FINALIZED'
         WHERE asess.register_id = ? AND ra.student_id IN (${studentIds.map(() => '?').join(',')})
         GROUP BY ra.student_id`,
        [registerId, ...studentIds]
      );
    }
    const markMap = new Map(attMarks.map(m => [m.student_id, m]));

    const roster = students.map(st => {
      const m = markMap.get(st.student_id) || { attended: 0, sessions_recorded: 0 };
      const attended = m.attended || 0;
      const pct = totalSessions > 0 ? Math.round((attended / totalSessions) * 100) : 100;
      return {
        ...st,
        total_sessions: totalSessions,
        attended_sessions: attended,
        absent_sessions: Math.max(0, totalSessions - attended),
        attendance_percentage: pct,
        is_defaulter: pct < 75 && totalSessions > 0,
        below_threshold: pct < 75 && totalSessions > 0
      };
    });

    return {
      register_id: reg.id,
      register_name: reg.name,
      total_sessions: totalSessions,
      students: roster
    };
  }

  /**
   * List all curriculum subjects configured in the department
   * @calledBy HodController.getSubjects() (controllers/hodController.js)
   * @route GET /api/v1/hod/subjects (routes/hod.js)
   * @param {number} deptId Department ID
   * @returns {Promise<Array<Object>>} Subjects list
   */
  static async getSubjects(deptId) {
    return await query(
      `SELECT s.*, 
              d.name as department_name, d.code as department_code,
              d.name as branch_name, d.code as branch_code,
              COUNT(DISTINCT ta.id) as teacher_assignments_count
       FROM subjects s
       JOIN departments d ON s.department_id = d.id
       LEFT JOIN teacher_assignments ta ON ta.subject_id = s.id AND ta.is_active = 1
       WHERE s.department_id = ? AND s.is_active = 1
       GROUP BY s.id
       ORDER BY s.year, s.semester, s.code`, [deptId]
    );
  }

  /**
   * Create a new curriculum subject in the department
   * @calledBy HodController.createSubject() (controllers/hodController.js)
   * @route POST /api/v1/hod/subjects (routes/hod.js)
   * @param {Object} params Subject attributes
   * @returns {Promise<number>} Inserted subject ID
   */
  static async createSubject({ departmentId, year, semester, name, code, hasPractical, syllabusScheme }) {
    const result = await query(
      `INSERT INTO subjects (department_id, year, semester, name, code, has_practical, syllabus_scheme, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [departmentId, year, semester, name.trim(), code.toUpperCase().trim(), hasPractical ? 1 : 0, syllabusScheme || '2026-27']
    );
    return result[0]?.insertId ?? result.lastInsertRowid;
  }

  /**
   * Update subject details, semester, scheme, or active status
   * @calledBy HodController.updateSubject() (controllers/hodController.js)
   * @route PUT /api/v1/hod/subjects/:id (routes/hod.js)
   * @param {number} id Subject ID
   * @param {number} deptId Department ID
   * @param {Object} fields Fields to update
   * @returns {Promise<boolean>}
   */
  static async updateSubject(id, deptId, { year, semester, name, code, hasPractical, syllabusScheme, isActive }) {
    const sets = [], params = [];
    if (year !== undefined) { sets.push('year = ?'); params.push(year); }
    if (semester !== undefined) { sets.push('semester = ?'); params.push(semester); }
    if (name) { sets.push('name = ?'); params.push(name.trim()); }
    if (code) { sets.push('code = ?'); params.push(code.toUpperCase().trim()); }
    if (hasPractical !== undefined) { sets.push('has_practical = ?'); params.push(hasPractical ? 1 : 0); }
    if (syllabusScheme) { sets.push('syllabus_scheme = ?'); params.push(syllabusScheme.trim()); }
    if (isActive !== undefined) { sets.push('is_active = ?'); params.push(isActive ? 1 : 0); }
    if (!sets.length) return false;

    params.push(id, deptId);
    await query(`UPDATE subjects SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND department_id = ?`, params);
    return true;
  }

  /**
   * Deactivate a curriculum subject in the department
   * @calledBy HodController.deleteSubject() (controllers/hodController.js)
   * @route DELETE /api/v1/hod/subjects/:id (routes/hod.js)
   * @param {number} id Subject ID
   * @param {number} deptId Department ID
   * @returns {Promise<boolean>}
   */
  static async deleteSubject(id, deptId) {
    const result = await query(
      `UPDATE subjects SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND department_id = ?`,
      [id, deptId]
    );
    return (result[0]?.affectedRows ?? result.changes) > 0;
  }

  /**
   * Retrieve active teacher course and class teacher assignments in the department
   * @calledBy HodController.getAssignments() (controllers/hodController.js)
   * @route GET /api/v1/hod/assignments (routes/hod.js)
   * @param {number} deptId Department ID
   * @returns {Promise<Array<Object>>} Teacher assignments
   */
  static async getTeacherAssignments(deptId) {
    return await query(
      `SELECT ta.*, 
              t.full_name as teacher_name, t.employee_id, t.phone as teacher_phone,
              s.name as subject_name, s.code as subject_code, s.has_practical,
              ay.label as academic_year_label
       FROM teacher_assignments ta
       JOIN teachers t ON ta.teacher_id = t.id
       LEFT JOIN subjects s ON ta.subject_id = s.id
       JOIN academic_years ay ON ta.academic_year_id = ay.id
       WHERE ta.department_id = ? AND ta.is_active = 1
       ORDER BY ta.assignment_type, ta.year, ta.semester`, [deptId]
    );
  }

  /**
   * Assign a teacher to a subject and auto-generate the official attendance register in a transaction
   * @calledBy HodController.createSubjectTeacherAssignment() (controllers/hodController.js)
   * @route POST /api/v1/hod/assignments/subject-teacher (routes/hod.js)
   * @param {Object} params Assignment parameters
   * @returns {Promise<{assignment_id: number, register_id: number}>}
   */
  static async createSubjectTeacherAssignment({ teacherId, subjectId, departmentId, year, semester, ayId, sessionTypeScope, assignedBy }) {
    const scope = sessionTypeScope || 'ALL';
    return await withTransaction(async (conn) => {
      const [ins] = await conn.execute(
        `INSERT INTO teacher_assignments
         (teacher_id, assignment_type, session_type_scope, department_id, subject_id, year, semester, academic_year_id, assigned_by)
         VALUES (?, 'SUBJECT_TEACHER', ?, ?, ?, ?, ?, ?, ?)`,
        [teacherId, scope, departmentId, subjectId, year, semester, ayId, assignedBy]
      );
      const assignmentId = ins.insertId ?? ins.lastInsertRowid;

      const subRows = await query(`SELECT name, code FROM subjects WHERE id = ?`, [subjectId]);
      const sub = subRows[0] || { name: 'Course', code: 'SUB' };
      const regName = `${sub.name} (${scope})`;

      const [regIns] = await conn.execute(
        `INSERT INTO attendance_registers
         (name, assignment_id, teacher_id, subject_id, department_id, year, semester, academic_year_id, session_type_scope, is_official, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
        [regName, assignmentId, teacherId, subjectId, departmentId, year, semester, ayId, scope]
      );
      const registerId = regIns.insertId ?? regIns.lastInsertRowid;

      return { assignment_id: assignmentId, register_id: registerId };
    });
  }

  /**
   * Appoint a Class Teacher for a cohort, deactivating prior assignments in a transaction
   * @calledBy HodController.createClassTeacherAssignment() (controllers/hodController.js)
   * @route POST /api/v1/hod/assignments/class-teacher (routes/hod.js)
   * @param {Object} params Class teacher parameters
   * @returns {Promise<number>} Inserted assignment ID
   */
  static async createClassTeacherAssignment({ teacherId, departmentId, year, semester, ayId, assignedBy }) {
    return await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE teacher_assignments SET is_active = 0, updated_at = CURRENT_TIMESTAMP
         WHERE department_id = ? AND year = ? AND semester = ? AND assignment_type = 'CLASS_TEACHER' AND is_active = 1`,
        [departmentId, year, semester]
      );

      const [ins] = await conn.execute(
        `INSERT INTO teacher_assignments
         (teacher_id, assignment_type, department_id, year, semester, academic_year_id, assigned_by)
         VALUES (?, 'CLASS_TEACHER', ?, ?, ?, ?, ?)`,
        [teacherId, departmentId, year, semester, ayId, assignedBy]
      );
      return ins.insertId ?? ins.lastInsertRowid;
    });
  }

  /**
   * Deactivate a teacher assignment and archive the linked official attendance register
   * @calledBy HodController.deleteAssignment() (controllers/hodController.js)
   * @route DELETE /api/v1/hod/assignments/:id (routes/hod.js)
   * @param {number} id Assignment ID
   * @param {number} deptId Department ID
   * @returns {Promise<boolean>}
   */
  static async deleteAssignment(id, deptId) {
    const rows = await query(`SELECT * FROM teacher_assignments WHERE id = ? AND department_id = ?`, [id, deptId]);
    if (!rows.length) return false;

    await withTransaction(async (conn) => {
      await conn.execute(`UPDATE teacher_assignments SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
      await conn.execute(`UPDATE attendance_registers SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE assignment_id = ?`, [id]);
    });
    return true;
  }

  /**
   * Compile departmental analytics report data: KPIs, trends, cohort summaries, and scan logs
   * @calledBy HodController.getReports() (controllers/hodController.js)
   * @route GET /api/v1/hod/reports (routes/hod.js)
   * @param {number} deptId Department ID
   * @param {Object} filters Query filter parameters
   * @returns {Promise<Object>} Aggregated analytics data
   */
  static async getReports(deptId, { branch_id, year, semester, date_preset, date_from, date_to, search }) {
    const whereClauses = [`d.id = ?`];
    const params = [deptId];

    if (branch_id) {
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

    if (search && search.trim()) {
      whereClauses.push(`(st.full_name LIKE ? OR st.official_enrollment_no LIKE ? OR dev.device_uid LIKE ?)`);
      const s = `%${search.trim()}%`;
      params.push(s, s, s);
    }

    const whereSql = whereClauses.join(' AND ');

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

    let cohortWhere = ["e.status = 'ENROLLED'", 'e.department_id = ?'];
    let cohortParams = [deptId];
    if (year) { cohortWhere.push('e.year = ?'); cohortParams.push(year); }
    if (semester) { cohortWhere.push('e.semester = ?'); cohortParams.push(semester); }

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
       ORDER BY e.year, e.semester`,
      cohortParams
    );

    const scanStatsRows = await query(
      `SELECT 
         d.id as department_id,
         d.id as branch_id,
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
      const key = `${row.year}_${row.semester}`;
      scanStatsMap.set(key, row);
    });

    const cohort_summary = cohortList.map(c => {
      const key = `${c.year}_${c.semester}`;
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

    return {
      kpis,
      daily_trend: trendRows.map(r => ({
        date: r.date,
        scan_count: Number(r.scan_count) || 0,
        unique_students: Number(r.unique_students) || 0
      })),
      cohort_distribution: cohortRows.map(r => ({
        branch_name: r.branch_name,
        branch_code: r.branch_code,
        year: r.cohort_year,
        semester: r.cohort_semester,
        scan_count: Number(r.scan_count) || 0
      })),
      records,
      cohort_summary
    };
  }

  /**
   * List all IoT devices registered to the department
   * @calledBy HodController.getDevices() (controllers/hodController.js)
   * @route GET /api/v1/hod/devices (routes/hod.js)
   * @param {number} deptId Department ID
   * @returns {Promise<Array<Object>>} Department devices
   */
  static async getDevices(deptId) {
    return await query(
      `SELECT d.id, d.device_uid, d.name, d.is_active, d.last_heartbeat_at,
              d.year, d.semester, d.created_at,
              ay.label as academic_year_label
       FROM devices d
       LEFT JOIN academic_years ay ON d.academic_year_id = ay.id
       WHERE d.department_id = ?
       ORDER BY d.created_at DESC`,
      [deptId]
    );
  }

  /**
   * Register a new IoT terminal device assigned to the department
   * @calledBy HodController.createDevice() (controllers/hodController.js)
   * @route POST /api/v1/hod/devices (routes/hod.js)
   * @param {Object} params Device parameters
   * @returns {Promise<number>} Inserted device ID
   */
  static async createDevice({ deviceUid, name, departmentId, year, semester, ayId, secretHash }) {
    const result = await query(
      `INSERT INTO devices (device_uid, name, department_id, year, semester, academic_year_id, secret_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [deviceUid, name, departmentId, year, semester, ayId, secretHash]
    );
    return result[0]?.insertId ?? result.lastInsertRowid;
  }

  /**
   * Toggle device active/inactive state
   * @calledBy HodController.toggleDevice() (controllers/hodController.js)
   * @route PATCH /api/v1/hod/devices/:id/toggle (routes/hod.js)
   * @param {number} id Device ID
   * @param {number} deptId Department ID
   * @returns {Promise<boolean|null>} New active state or null if not found
   */
  static async toggleDevice(id, deptId) {
    const rows = await query(`SELECT is_active FROM devices WHERE id = ? AND department_id = ?`, [id, deptId]);
    if (!rows.length) return null;
    const nextState = rows[0].is_active ? 0 : 1;
    await query(`UPDATE devices SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [nextState, id]);
    return nextState === 1;
  }

  /**
   * Delete an IoT device from the department
   * @calledBy HodController.deleteDevice() (controllers/hodController.js)
   * @route DELETE /api/v1/hod/devices/:id (routes/hod.js)
   * @param {number} id Device ID
   * @param {number} deptId Department ID
   * @returns {Promise<boolean>}
   */
  static async deleteDevice(id, deptId) {
    const result = await query(`DELETE FROM devices WHERE id = ? AND department_id = ?`, [id, deptId]);
    return (result[0]?.affectedRows ?? result.changes) > 0;
  }

  /**
   * Re-index class roll numbers alphabetically by student name for a cohort
   * @calledBy HodController.reindexRoll(), HodModel.createStudent(), HodModel.bulkCreateStudents(), HodModel.deleteStudent(), HodModel.executePromotion()
   * @route POST /api/v1/hod/students/reindex-roll (routes/hod.js)
   * @param {number} deptId Department ID
   * @param {number} year Cohort year
   * @param {number} semester Cohort semester
   * @param {number} academicYearId Academic year ID
   * @param {Object} [conn] Optional active database transaction connection
   * @returns {Promise<number>} Number of reindexed students
   */
  static async reindexCohortRollNumbers(deptId, year, semester, academicYearId, conn = null) {
    const q = conn ? (sql, params) => conn.execute(sql, params) : query;
    
    const rows = await q(
      `SELECT e.id, s.id as student_id, s.full_name 
       FROM enrollments e
       JOIN students s ON e.student_id = s.id
       WHERE e.department_id = ? AND e.year = ? AND e.semester = ? AND e.academic_year_id = ? AND e.status = 'ENROLLED'
       ORDER BY s.full_name COLLATE NOCASE ASC, s.official_enrollment_no ASC`,
      [deptId, year, semester, academicYearId]
    );
    
    const enrollments = Array.isArray(rows[0]) && Array.isArray(rows) && rows[0].id === undefined ? rows[0] : rows;
    if (!enrollments || !enrollments.length) return 0;

    for (let i = 0; i < enrollments.length; i++) {
      const tempNeg = -((enrollments[i].id * 1000) + i + 1);
      await q(`UPDATE enrollments SET class_roll_no = ? WHERE id = ?`, [tempNeg, enrollments[i].id]);
    }

    for (let i = 0; i < enrollments.length; i++) {
      const newRoll = i + 1;
      await q(`UPDATE enrollments SET class_roll_no = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [newRoll, enrollments[i].id]);
      await q(`UPDATE students SET class_roll_no = ? WHERE id = ?`, [newRoll, enrollments[i].student_id]);
      await q(
        `UPDATE student_department_enrollments SET class_roll_no = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND department_id = ? AND status = 'ACTIVE'`,
        [newRoll, enrollments[i].student_id, deptId]
      );
    }
    return enrollments.length;
  }

  /**
   * Paginated student listing in department filtered by cohort, year, and search
   * @calledBy HodController.getStudents() (controllers/hodController.js)
   * @route GET /api/v1/hod/students (routes/hod.js)
   * @param {number} deptId Department ID
   * @param {Object} filters Query and pagination filters
   * @returns {Promise<{total: number, students: Array<Object>}>}
   */
  static async getStudents(deptId, { year, semester, search, status, academic_year_id, branch_id, limit = 100, offset = 0 }) {
    let whereClause = `WHERE e.department_id = ?`;
    const params = [deptId];

    if (academic_year_id) { whereClause += ` AND e.academic_year_id = ?`; params.push(academic_year_id); }
    if (branch_id) { whereClause += ` AND e.department_id = ?`; params.push(branch_id); }
    if (year) { whereClause += ` AND e.year = ?`; params.push(parseInt(year, 10)); }
    if (semester) { whereClause += ` AND e.semester = ?`; params.push(parseInt(semester, 10)); }
    if (status) {
      whereClause += ` AND e.status = ?`;
      params.push(status);
    } else {
      whereClause += ` AND e.status != 'WITHDRAWN'`;
    }

    if (search) {
      whereClause += ` AND (st.full_name LIKE ? OR st.official_enrollment_no LIKE ? OR st.registration_no LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    const countRow = await query(
      `SELECT COUNT(DISTINCT st.id) as total
       FROM enrollments e
       JOIN students st ON e.student_id = st.id
       ${whereClause}`,
      params
    );

    const students = await query(
      `SELECT st.id, st.user_id, st.official_enrollment_no, st.official_enrollment_no as enrollment_no, st.registration_no, st.full_name,
              COALESCE(st.class_roll_no, e.class_roll_no) as class_roll_no,
              st.admission_year, st.is_lateral_entry,
              e.year, e.semester, e.status as enrollment_status,
              u.email as gmail, u.email, u.phone, u.status as user_status
       FROM enrollments e
       JOIN students st ON e.student_id = st.id
       JOIN users u ON st.user_id = u.id
       ${whereClause}
       ORDER BY e.year, e.semester, COALESCE(st.class_roll_no, e.class_roll_no) ASC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit, 10), parseInt(offset, 10)]
    );

    return { total: countRow[0]?.total || 0, students };
  }

  /**
   * Enroll a new student, create provisioned user account, and reindex roll numbers in a transaction
   * @calledBy HodController.createStudent() (controllers/hodController.js)
   * @route POST /api/v1/hod/students (routes/hod.js)
   * @param {Object} params Student enrollment parameters
   * @returns {Promise<Object>} Created student record
   */
  static async createStudent({ deptId, ayId, officialEnrollmentNo, registrationNo, fullName, email, year, semester, isLateralEntry, initialPassword }) {
    const cleanEnroll = officialEnrollmentNo.trim();
    const cleanName = fullName.trim();
    const tempPassword = (initialPassword && initialPassword.trim()) ? initialPassword.trim() : 'Password@123';
    const tempPasswordHash = await bcrypt.hash(tempPassword, 12);

    return await withTransaction(async (conn) => {
      const [uRes] = await conn.execute(
        `INSERT INTO users (username, email, temp_password_hash, must_change_password, status)
         VALUES (?, ?, ?, 1, 'PROVISIONED')`,
        [cleanEnroll, email?.trim() || null, tempPasswordHash]
      );
      const userId = uRes.insertId ?? uRes.lastInsertRowid;

      await conn.execute(`INSERT INTO user_roles (user_id, role) VALUES (?, 'STUDENT')`, [userId]);

      const [sRes] = await conn.execute(
        `INSERT INTO students (user_id, official_enrollment_no, registration_no, full_name, entry_mode, is_lateral_entry, admission_year)
         VALUES (?, ?, ?, ?, 'hod_provisioned', ?, ?)`,
        [userId, cleanEnroll, (registrationNo || '').trim() || null, cleanName, isLateralEntry ? 1 : 0, new Date().getFullYear()]
      );
      const studentId = sRes.insertId ?? sRes.lastInsertRowid;

      const tempRoll = -((userId * 1000) + 1);
      const [eRes] = await conn.execute(
        `INSERT INTO enrollments (student_id, department_id, year, semester, academic_year_id, class_roll_no, status)
         VALUES (?, ?, ?, ?, ?, ?, 'ENROLLED')`,
        [studentId, deptId, year, semester, ayId, tempRoll]
      );

      await HodModel.reindexCohortRollNumbers(deptId, year, semester, ayId, conn);

      const [assignedRow] = await conn.execute('SELECT class_roll_no FROM enrollments WHERE id = ?', [eRes.insertId ?? eRes.lastInsertRowid]);
      const classRollNo = (Array.isArray(assignedRow) ? assignedRow[0] : assignedRow)?.class_roll_no;

      return {
        student_id: studentId,
        official_enrollment_no: cleanEnroll,
        enrollment_no: cleanEnroll,
        registration_no: (registrationNo || '').trim() || null,
        full_name: cleanName,
        class_roll_no: classRollNo,
        temp_password: tempPassword,
        year,
        semester
      };
    });
  }

  /**
   * Bulk import and enroll students for a cohort in a single transaction with automatic roll indexing
   * @calledBy HodController.bulkCreateStudents() (controllers/hodController.js)
   * @route POST /api/v1/hod/students/bulk (routes/hod.js)
   * @param {Object} params Bulk parameters
   * @returns {Promise<{created_count: number, created: Array, errors: Array}>}
   */
  static async bulkCreateStudents({ deptId, year, semester, students, ayId }) {
    const createdList = [];
    const errors = [];

    await withTransaction(async (conn) => {
      for (const st of students) {
        const enrollNo = (st.official_enrollment_no || '').trim();
        const name = (st.full_name || '').trim();
        if (!enrollNo || !name) {
          errors.push('Skipped record: missing enrollment number or name');
          continue;
        }

        const [existing] = await conn.execute(
          `SELECT id FROM users WHERE LOWER(TRIM(username)) = LOWER(?)
           UNION
           SELECT id FROM students WHERE LOWER(TRIM(official_enrollment_no)) = LOWER(?)`,
          [enrollNo, enrollNo]
        );
        if (existing && existing.length > 0) {
          errors.push(`Enrollment "${enrollNo}" already exists in the system`);
          continue;
        }

        if (st.email && st.email.trim()) {
          const cleanEmail = st.email.trim();
          const [existingEmail] = await conn.execute(
            `SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(?) OR LOWER(TRIM(username)) = LOWER(?)`,
            [cleanEmail, cleanEmail]
          );
          if (existingEmail && existingEmail.length > 0) {
            errors.push(`Email "${cleanEmail}" already exists`);
            continue;
          }
        }

        const tempPass = (st.initial_password && st.initial_password.trim()) ? st.initial_password.trim() : 'Password@123';
        const passHash = await bcrypt.hash(tempPass, 12);

        const [uRes] = await conn.execute(
          `INSERT INTO users (username, email, temp_password_hash, must_change_password, status)
           VALUES (?, ?, ?, 1, 'PROVISIONED')`,
          [enrollNo, st.email?.trim() || null, passHash]
        );
        const userId = uRes.insertId ?? uRes.lastInsertRowid;

        await conn.execute(`INSERT INTO user_roles (user_id, role) VALUES (?, 'STUDENT')`, [userId]);

        const [sRes] = await conn.execute(
          `INSERT INTO students (user_id, official_enrollment_no, registration_no, full_name, entry_mode, is_lateral_entry, admission_year)
           VALUES (?, ?, ?, ?, 'hod_provisioned', ?, ?)`,
          [userId, enrollNo, (st.registration_no || '').trim() || null, name, st.is_lateral_entry ? 1 : 0, new Date().getFullYear()]
        );
        const studentId = sRes.insertId ?? sRes.lastInsertRowid;

        const tempRoll = -((userId * 1000) + 1);
        await conn.execute(
          `INSERT INTO enrollments (student_id, department_id, year, semester, academic_year_id, class_roll_no, status)
           VALUES (?, ?, ?, ?, ?, ?, 'ENROLLED')`,
          [studentId, deptId, year, semester, ayId, tempRoll]
        );

        createdList.push({ student_id: studentId, official_enrollment_no: enrollNo, full_name: name });
      }

      await HodModel.reindexCohortRollNumbers(deptId, year, semester, ayId, conn);
    });

    return { created_count: createdList.length, created: createdList, errors };
  }

  /**
   * Delete student record, user account, attendance records, and reindex roll numbers in a transaction
   * @calledBy HodController.deleteStudent() (controllers/hodController.js)
   * @route DELETE /api/v1/hod/students/:id (routes/hod.js)
   * @param {number} id Student ID
   * @param {number} deptId Department ID
   * @returns {Promise<boolean>}
   */
  static async deleteStudent(id, deptId) {
    let sRows = await query(
      `SELECT s.id, s.user_id, e.year, e.semester, e.academic_year_id, e.department_id FROM students s
       LEFT JOIN enrollments e ON e.student_id = s.id
       WHERE s.id = ? ${deptId ? 'AND (e.department_id = ? OR e.department_id IS NULL)' : ''}`,
      deptId ? [id, deptId] : [id]
    );
    if (!sRows.length) {
      sRows = await query(`SELECT id, user_id FROM students WHERE id = ?`, [id]);
      if (!sRows.length) return false;
    }
    const { user_id: userId, year, semester, academic_year_id: ayId } = sRows[0];
    const actualDeptId = sRows[0].department_id || deptId;

    await withTransaction(async (conn) => {
      // 1. Clean up all child foreign key constraints on student_id
      await conn.execute(`DELETE FROM assessment_submissions WHERE student_id = ?`, [id]);
      await conn.execute(`DELETE FROM register_attendance WHERE student_id = ?`, [id]);
      await conn.execute(`DELETE FROM attendance_session_students WHERE student_id = ?`, [id]);
      await conn.execute(`DELETE FROM student_self_attendance WHERE student_id = ?`, [id]);
      await conn.execute(`DELETE FROM esp32_presence WHERE student_id = ?`, [id]);
      await conn.execute(`DELETE FROM fingerprint_slots WHERE student_id = ?`, [id]);
      await conn.execute(`DELETE FROM iot_attendance_events WHERE student_id = ?`, [id]);
      await conn.execute(`DELETE FROM attendance_corrections WHERE student_id = ?`, [id]);
      await conn.execute(`DELETE FROM teaching_group_members WHERE student_id = ?`, [id]);
      await conn.execute(`DELETE FROM leave_applications WHERE student_id = ?`, [id]);
      await conn.execute(`DELETE FROM student_department_enrollments WHERE student_id = ?`, [id]);
      await conn.execute(`DELETE FROM enrollments WHERE student_id = ?`, [id]);

      try {
        await conn.execute(`UPDATE faculty_media_assets SET student_id = NULL WHERE student_id = ?`, [id]);
      } catch (_) {}

      // 2. Delete the student record
      await conn.execute(`DELETE FROM students WHERE id = ?`, [id]);

      // 3. Clean up user credentials, sessions, roles and activities
      if (userId) {
        await conn.execute(`DELETE FROM user_roles WHERE user_id = ?`, [userId]);
        await conn.execute(`DELETE FROM user_sessions WHERE user_id = ?`, [userId]);
        await conn.execute(`DELETE FROM notifications WHERE user_id = ?`, [userId]);
        await conn.execute(`DELETE FROM classroom_post_comments WHERE author_id = ?`, [userId]);
        await conn.execute(`DELETE FROM classroom_posts WHERE author_id = ?`, [userId]);
        try {
          await conn.execute(`UPDATE audit_logs SET user_id = NULL WHERE user_id = ?`, [userId]);
        } catch (_) {}
        await conn.execute(`DELETE FROM users WHERE id = ?`, [userId]);
      }

      // 4. Reindex cohort roll numbers without gaps
      if (actualDeptId && year && semester && ayId) {
        await HodModel.reindexCohortRollNumbers(actualDeptId, year, semester, ayId, conn);
      }
    });
    return true;
  }

  /**
   * Reset student account password
   * @calledBy HodController.resetStudentPassword() (controllers/hodController.js)
   * @route POST /api/v1/hod/students/:id/reset-password (routes/hod.js)
   * @param {number} userId User ID
   * @param {string} passwordHash Password bcrypt hash
   * @returns {Promise<boolean>}
   */
  static async resetStudentPassword(userId, passwordHash) {
    await query(`UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [passwordHash, userId]);
    return true;
  }

  /**
   * Calculate preview of students eligible for semester promotion or demotion reversal
   * @calledBy HodController.getPromotionPreview() (controllers/hodController.js)
   * @route GET /api/v1/hod/promotion/preview (routes/hod.js)
   * @param {number} deptId Department ID
   * @param {'promote'|'demote'} action Action type
   * @returns {Promise<Object>} Promotion/demotion preview breakdown
   */
  static async getPromotionPreview(deptId, action) {
    const deptRow = (await query('SELECT degree_duration_years, active_term, code, name FROM departments WHERE id = ?', [deptId]))[0];
    const durationYears = deptRow?.degree_duration_years || 3;
    const activeTerm = deptRow?.active_term || 'ODD';
    const maxSem = durationYears * 2;

    const ayRow = (await query('SELECT id, label FROM academic_years WHERE is_current = 1 LIMIT 1'))[0];
    if (!ayRow) return { error: 'No active academic year found' };
    const ayId = ayRow.id;

    if (action === 'demote') {
      const enrollments = await query(
        `SELECT e.id, e.student_id, e.year, e.semester, e.class_roll_no, e.status, s.full_name, s.official_enrollment_no, s.is_lateral_entry
         FROM enrollments e
         JOIN students s ON e.student_id = s.id
         WHERE e.department_id = ? AND e.academic_year_id = ? AND e.status IN ('ENROLLED', 'COMPLETED', 'DETAINED')
         ORDER BY e.status, e.year DESC, e.semester DESC, e.class_roll_no`,
        [deptId, ayId]
      );

      const cohortsMap = {};
      let eligibleCount = 0;

      enrollments.forEach(st => {
        let key, currentYear, currentSem, targetYear, targetSem, canDemote = true, note = '';

        if (st.status === 'COMPLETED') {
          key = 'COMPLETED_ALUMNI';
          currentYear = durationYears;
          currentSem = maxSem;
          targetYear = durationYears;
          targetSem = maxSem;
          note = 'Revert from Graduated to Active Final Semester';
          eligibleCount++;
        } else if (st.status === 'DETAINED') {
          key = `DETAINED_Y${st.year}_S${st.semester}`;
          currentYear = st.year;
          currentSem = st.semester;
          targetYear = st.year;
          targetSem = st.semester;
          note = 'Reactivate Detained Student in Current Semester';
          eligibleCount++;
        } else if (st.semester > 1) {
          key = `Y${st.year}_S${st.semester}`;
          currentYear = st.year;
          currentSem = st.semester;
          targetSem = st.semester - 1;
          targetYear = Math.floor((targetSem - 1) / 2) + 1;
          note = `Demote: Year ${currentYear} Sem ${currentSem} → Year ${targetYear} Sem ${targetSem}`;
          eligibleCount++;
        } else {
          key = `BASE_Y1_S1`;
          currentYear = 1;
          currentSem = 1;
          targetYear = 1;
          targetSem = 1;
          canDemote = false;
          note = 'Already at base Semester 1 (Cannot demote further)';
        }

        if (!cohortsMap[key]) {
          cohortsMap[key] = {
            current_year: currentYear,
            current_sem: currentSem,
            current_status: st.status,
            target_year: targetYear,
            target_sem: targetSem,
            can_demote: canDemote,
            note: note,
            students: []
          };
        }

        cohortsMap[key].students.push({
          id: st.id,
          student_id: st.student_id,
          official_enrollment_no: st.official_enrollment_no,
          full_name: st.full_name,
          class_roll_no: st.class_roll_no,
          status: st.status,
          can_demote: canDemote,
          is_lateral_entry: !!st.is_lateral_entry
        });
      });

      return {
        action: 'demote',
        department_name: deptRow.name,
        department_code: deptRow.code,
        degree_duration_years: durationYears,
        academic_year_label: ayRow.label,
        total_students: enrollments.length,
        eligible_count: eligibleCount,
        cohorts: Object.values(cohortsMap)
      };
    }

    const enrollments = await query(
      `SELECT e.id, e.student_id, e.year, e.semester, e.class_roll_no, s.full_name, s.official_enrollment_no, s.is_lateral_entry
       FROM enrollments e
       JOIN students s ON e.student_id = s.id
       WHERE e.department_id = ? AND e.academic_year_id = ? AND e.status = 'ENROLLED'
       ORDER BY e.year, e.semester, e.class_roll_no`,
      [deptId, ayId]
    );

    const isMidYear = activeTerm === 'ODD';
    const cohortsMap = {};

    enrollments.forEach(st => {
      const sem = st.semester;
      const yr = st.year;
      const key = `Y${yr}_S${sem}`;

      if (!cohortsMap[key]) {
        let targetYear = yr;
        let targetSem = sem + 1;
        let isGraduating = false;

        if (sem >= maxSem) {
          isGraduating = true;
          targetYear = 'GRADUATED';
          targetSem = 'ALUMNI';
        } else if (sem % 2 === 1) {
          targetYear = yr;
          targetSem = sem + 1;
        } else {
          targetYear = yr + 1;
          targetSem = sem + 1;
        }

        cohortsMap[key] = {
          current_year: yr,
          current_sem: sem,
          target_year: targetYear,
          target_sem: targetSem,
          is_graduating: isGraduating,
          students: []
        };
      }

      cohortsMap[key].students.push({
        id: st.id,
        student_id: st.student_id,
        official_enrollment_no: st.official_enrollment_no,
        full_name: st.full_name,
        class_roll_no: st.class_roll_no,
        is_lateral_entry: !!st.is_lateral_entry
      });
    });

    const cohorts = Object.values(cohortsMap);
    const graduatingCount = cohorts.filter(c => c.is_graduating).reduce((sum, c) => sum + c.students.length, 0);
    const continuingCount = enrollments.length - graduatingCount;

    return {
      action: 'promote',
      department_name: deptRow.name,
      department_code: deptRow.code,
      degree_duration_years: durationYears,
      current_active_term: activeTerm,
      target_term: activeTerm === 'ODD' ? 'EVEN' : 'ODD',
      academic_year_label: ayRow.label,
      is_mid_year: isMidYear,
      total_students: enrollments.length,
      graduating_count: graduatingCount,
      continuing_count: continuingCount,
      cohorts
    };
  }

  /**
   * Execute atomic batch semester promotion or demotion reversal with automatic roll reindexing
   * @calledBy HodController.executePromotion() (controllers/hodController.js)
   * @route POST /api/v1/hod/promotion/execute (routes/hod.js)
   * @param {number} deptId Department ID
   * @param {Object} options Promotion parameters
   * @returns {Promise<Object>} Execution summary
   */
  static async executePromotion(deptId, { action, exceptions, promoted_student_ids, selected_student_ids }) {
    const deptRow = (await query('SELECT degree_duration_years, active_term, code FROM departments WHERE id = ?', [deptId]))[0];
    const durationYears = deptRow?.degree_duration_years || 3;
    const maxSem = durationYears * 2;

    const ayRow = (await query('SELECT id, label FROM academic_years WHERE is_current = 1 LIMIT 1'))[0];
    if (!ayRow) throw new Error('No active academic year found');
    const ayId = ayRow.id;

    if (action === 'demote') {
      const enrollments = await query(
        `SELECT e.id, e.student_id, e.year, e.semester, e.status, s.user_id 
         FROM enrollments e
         JOIN students s ON e.student_id = s.id
         WHERE e.department_id = ? AND e.academic_year_id = ? AND e.status IN ('ENROLLED', 'COMPLETED', 'DETAINED')`,
        [deptId, ayId]
      );

      let skippedIds;
      if (Array.isArray(selected_student_ids)) {
        const selSet = new Set(selected_student_ids.map(Number));
        skippedIds = new Set(enrollments.filter(e => !selSet.has(Number(e.student_id))).map(e => Number(e.student_id)));
      } else {
        skippedIds = new Set((exceptions || []).map(Number));
      }
      let demotedCount = 0;
      const cohortsToReindex = new Set();

      await withTransaction(async (conn) => {
        await conn.execute(
          `UPDATE enrollments SET class_roll_no = -(id * 1000) WHERE department_id = ? AND academic_year_id = ? AND status = 'ENROLLED'`,
          [deptId, ayId]
        );

        for (const en of enrollments) {
          if (skippedIds.has(en.student_id)) continue;

          if (en.status === 'COMPLETED') {
            await conn.execute(`UPDATE enrollments SET status = 'ENROLLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [en.id]);
            await conn.execute(`UPDATE users SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [en.user_id]);
            await conn.execute(`UPDATE students SET graduation_year = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [en.student_id]);
            await conn.execute(
              `UPDATE student_department_enrollments SET status = 'ACTIVE', end_date = NULL, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND department_id = ?`,
              [en.student_id, deptId]
            );
            cohortsToReindex.add(`${durationYears}_${maxSem}`);
            demotedCount++;
          } else if (en.status === 'DETAINED') {
            await conn.execute(`UPDATE enrollments SET status = 'ENROLLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [en.id]);
            await conn.execute(
              `UPDATE student_department_enrollments SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND department_id = ?`,
              [en.student_id, deptId]
            );
            cohortsToReindex.add(`${en.year}_${en.semester}`);
            demotedCount++;
          } else if (en.semester > 1) {
            const targetSem = en.semester - 1;
            const targetYr = Math.floor((targetSem - 1) / 2) + 1;
            await conn.execute(
              `UPDATE enrollments SET year = ?, semester = ?, status = 'ENROLLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
              [targetYr, targetSem, en.id]
            );
            await conn.execute(
              `UPDATE student_department_enrollments SET year = ?, semester = ?, status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND department_id = ? AND status = 'ACTIVE'`,
              [targetYr, targetSem, en.student_id, deptId]
            );
            cohortsToReindex.add(`${targetYr}_${targetSem}`);
            demotedCount++;
          }
        }

        for (const cKey of cohortsToReindex) {
          const [yStr, sStr] = cKey.split('_');
          await HodModel.reindexCohortRollNumbers(deptId, parseInt(yStr, 10), parseInt(sStr, 10), ayId, conn);
        }
      });

      return {
        action: 'demote',
        demoted_count: demotedCount,
        department_code: deptRow.code
      };
    }

    const enrollments = await query(
      `SELECT e.id, e.student_id, e.year, e.semester, s.user_id 
       FROM enrollments e
       JOIN students s ON e.student_id = s.id
       WHERE e.department_id = ? AND e.academic_year_id = ? AND e.status = 'ENROLLED'`,
      [deptId, ayId]
    );

    let detainedIds;
    if (Array.isArray(promoted_student_ids)) {
      const passSet = new Set(promoted_student_ids.map(Number));
      detainedIds = new Set(enrollments.filter(e => !passSet.has(Number(e.student_id))).map(e => Number(e.student_id)));
    } else if (Array.isArray(selected_student_ids)) {
      const passSet = new Set(selected_student_ids.map(Number));
      detainedIds = new Set(enrollments.filter(e => !passSet.has(Number(e.student_id))).map(e => Number(e.student_id)));
    } else {
      detainedIds = new Set((exceptions || []).map(Number));
    }

    let promotedCount = 0;
    let graduatedCount = 0;
    let detainedCount = 0;

    const promotedStudents = [];
    const graduatedStudents = [];
    const detainedStudents = [];
    const cohortsToReindex = new Set();

    await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE enrollments SET class_roll_no = -(id * 1000) WHERE department_id = ? AND academic_year_id = ? AND status = 'ENROLLED'`,
        [deptId, ayId]
      );

      for (const en of enrollments) {
        if (detainedIds.has(en.student_id)) {
          await conn.execute(`UPDATE enrollments SET status = 'DETAINED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [en.id]);
          await conn.execute(
            `UPDATE student_department_enrollments SET status = 'DETAINED', updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND department_id = ? AND status = 'ACTIVE'`,
            [en.student_id, deptId]
          );
          detainedCount++;
          detainedStudents.push({ student_id: en.student_id, user_id: en.user_id, sem: en.semester });
          continue;
        }

        if (en.semester >= maxSem) {
          const gradYear = new Date().getFullYear();
          await conn.execute(`UPDATE enrollments SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [en.id]);
          await conn.execute(`UPDATE users SET status = 'ALUMNI', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [en.user_id]);
          await conn.execute(`UPDATE students SET graduation_year = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [gradYear, en.student_id]);
          await conn.execute(`UPDATE fingerprint_slots SET is_active = 0 WHERE student_id = ?`, [en.student_id]);
          await conn.execute(
            `UPDATE student_department_enrollments SET status = 'GRADUATED', end_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND department_id = ? AND status = 'ACTIVE'`,
            [en.student_id, deptId]
          );
          graduatedCount++;
          graduatedStudents.push({ student_id: en.student_id, user_id: en.user_id });
        } else if (en.semester % 2 === 1) {
          const nextSem = en.semester + 1;
          await conn.execute(`UPDATE enrollments SET semester = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [nextSem, en.id]);
          await conn.execute(
            `UPDATE student_department_enrollments SET status = 'COMPLETED', end_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND department_id = ? AND status = 'ACTIVE'`,
            [en.student_id, deptId]
          );
          await conn.execute(
            `INSERT INTO student_department_enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status) VALUES (?, ?, ?, ?, ?, ?, CURRENT_DATE, 'ACTIVE')`,
            [en.student_id, deptId, ayId, en.year, nextSem, en.class_roll_no || null]
          );
          cohortsToReindex.add(`${en.year}_${nextSem}`);
          promotedCount++;
          promotedStudents.push({ student_id: en.student_id, user_id: en.user_id, nextYr: en.year, nextSem });
        } else {
          const nextYr = en.year + 1;
          const nextSem = en.semester + 1;
          await conn.execute(`UPDATE enrollments SET year = ?, semester = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [nextYr, nextSem, en.id]);
          await conn.execute(
            `UPDATE student_department_enrollments SET status = 'COMPLETED', end_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND department_id = ? AND status = 'ACTIVE'`,
            [en.student_id, deptId]
          );
          await conn.execute(
            `INSERT INTO student_department_enrollments (student_id, department_id, academic_year_id, year, semester, class_roll_no, start_date, status) VALUES (?, ?, ?, ?, ?, ?, CURRENT_DATE, 'ACTIVE')`,
            [en.student_id, deptId, ayId, nextYr, nextSem, en.class_roll_no || null]
          );
          cohortsToReindex.add(`${nextYr}_${nextSem}`);
          promotedCount++;
          promotedStudents.push({ student_id: en.student_id, user_id: en.user_id, nextYr, nextSem });
        }
      }

      for (const cKey of cohortsToReindex) {
        const [yStr, sStr] = cKey.split('_');
        await HodModel.reindexCohortRollNumbers(deptId, parseInt(yStr, 10), parseInt(sStr, 10), ayId, conn);
      }
    });

    return {
      action: 'promote',
      promoted_count: promotedCount,
      graduated_count: graduatedCount,
      detained_count: detainedCount,
      department_code: deptRow.code,
      promotedStudents,
      graduatedStudents,
      detainedStudents
    };
  }

  /**
   * Retrieve department hierarchy tree for UI dropdown menus (branches, subjects, teachers, academic years)
   * @calledBy HodController.getHierarchy() (controllers/hodController.js)
   * @route GET /api/v1/hod/hierarchy (routes/hod.js)
   * @param {number} deptId Department ID
   * @param {string} departmentName Department name
   * @returns {Promise<Object>} Hierarchy bundle
   */
  static async getHierarchy(deptId, departmentName) {
    const [branches, subjects, teachers, academicYears, deptInfo] = await Promise.all([
      query(
        `SELECT d.id, d.id as department_id, d.name, d.code, d.name as department_name, d.code as department_code 
         FROM departments d 
         WHERE (${deptId ? 'd.id = ?' : '1=1'}) AND d.is_active = 1 
         ORDER BY d.name`,
        deptId ? [deptId] : []
      ),
      query(
        `SELECT s.*, d.name as branch_name, d.code as branch_code, d.name as department_name 
         FROM subjects s 
         JOIN departments d ON s.department_id = d.id 
         WHERE (${deptId ? 's.department_id = ?' : '1=1'}) AND s.is_active = 1 
         ORDER BY s.year, s.semester, s.code`,
        deptId ? [deptId] : []
      ),
      query(
        `SELECT t.id, t.full_name, t.employee_id, u.username as gmail 
         FROM teachers t 
         JOIN users u ON t.user_id = u.id 
         WHERE t.department_id = ? 
         ORDER BY t.full_name`,
        [deptId]
      ),
      query(`SELECT * FROM academic_years ORDER BY start_date DESC`),
      query(`SELECT degree_duration_years, active_term FROM departments WHERE id = ?`, [deptId])
    ]);

    const defaultBranch = branches.find(b => b.department_id === deptId) || branches[0];
    const user_branch_id = defaultBranch ? defaultBranch.id : null;
    const deptMeta = deptInfo[0] || {};
    const currentAy = academicYears.find(ay => ay.is_current === 1) || academicYears[0];
    const defaultTerm = currentAy?.label || 'Active Session';

    return {
      department_id: deptId,
      department_name: departmentName,
      department_code: defaultBranch ? defaultBranch.department_code : null,
      user_branch_id,
      degree_duration_years: deptMeta.degree_duration_years || 3,
      active_term: deptMeta.active_term || defaultTerm,
      branches,
      subjects,
      teachers,
      academicYears
    };
  }

  /**
   * List distinct graduation years for alumni students in department
   * @calledBy HodController.getArchiveBatches() (controllers/hodController.js)
   * @route GET /api/v1/hod/archive/batches (routes/hod.js)
   * @param {number} deptId Department ID
   * @returns {Promise<Array<number>>} Graduation batch years
   */
  static async getArchiveBatches(deptId) {
    const rows = await query(
      `SELECT DISTINCT s.graduation_year 
       FROM students s
       JOIN enrollments e ON s.id = e.student_id
       WHERE e.department_id = ? AND (e.status = 'COMPLETED' OR s.graduation_year IS NOT NULL)
       ORDER BY s.graduation_year DESC`,
      [deptId]
    );
    return rows.map(r => r.graduation_year).filter(Boolean);
  }

  /**
   * Retrieve archived alumni students with lifetime attendance stats and KPI metrics
   * @calledBy HodController.getArchive() (controllers/hodController.js)
   * @route GET /api/v1/hod/archive (routes/hod.js)
   * @param {number} deptId Department ID
   * @param {Object} filters Query filter options
   * @returns {Promise<{students: Array, kpis: Object}>}
   */
  static async getArchive(deptId, { batch_year, search }) {
    let filter = `e.department_id = ? AND (e.status = 'COMPLETED' OR u.status = 'ALUMNI')`;
    const params = [deptId];

    if (batch_year) {
      filter += ` AND (s.graduation_year = ? OR strftime('%Y', e.updated_at) = ?)`;
      params.push(parseInt(batch_year, 10), String(batch_year));
    }

    if (search) {
      filter += ` AND (s.full_name LIKE ? OR s.official_enrollment_no LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    const students = await query(
      `SELECT s.id as student_id, s.user_id, s.official_enrollment_no, s.full_name,
              s.admission_year, COALESCE(s.graduation_year, CAST(strftime('%Y', e.updated_at) AS INTEGER)) as graduation_year,
              s.entry_mode, s.is_lateral_entry,
              e.id as enrollment_id, e.year as final_year, e.semester as final_semester, e.class_roll_no as final_class_roll_no,
              e.status as enrollment_status, u.email, u.status as user_status,
              d.name as department_name, d.code as department_code,
              (CASE WHEN s.fingerprint_template IS NOT NULL THEN 1 ELSE 0 END) as has_fingerprint,
              COALESCE(att.total_sessions, 0) as total_sessions,
              COALESCE(att.attended_sessions, 0) as attended_sessions,
              COALESCE(att.attendance_percentage, 0) as attendance_percentage
       FROM students s
       JOIN users u ON s.user_id = u.id
       JOIN enrollments e ON s.id = e.student_id
       JOIN departments d ON e.department_id = d.id
       LEFT JOIN (
         SELECT ra.student_id,
                COUNT(ra.id) as total_sessions,
                SUM(CASE WHEN ra.attendance_status = 'PRESENT' THEN 1 ELSE 0 END) as attended_sessions,
                ROUND(SUM(CASE WHEN ra.attendance_status = 'PRESENT' THEN 1.0 ELSE 0.0 END) * 100.0 / MAX(COUNT(ra.id), 1), 1) as attendance_percentage
          FROM register_attendance ra
          GROUP BY ra.student_id
        ) att ON att.student_id = s.id
        WHERE ${filter}
        ORDER BY s.graduation_year DESC, s.full_name ASC`,
       params
     );

    const totalGraduated = students.length;
    const batches = [...new Set(students.map(s => s.graduation_year).filter(Boolean))];
    const avgAttendance = totalGraduated > 0
      ? Math.round((students.reduce((sum, s) => sum + Number(s.attendance_percentage || 0), 0) / totalGraduated) * 10) / 10
      : 0;

    return {
      students,
      kpis: {
        total_graduated: totalGraduated,
        batches_count: batches.length,
        batches,
        avg_attendance: avgAttendance
      }
    };
  }

  /**
   * Retrieve pending faculty registration requests awaiting HOD approval
   * @calledBy HodController.getPendingFacultyRegistrations() (controllers/hodController.js)
   * @route GET /api/v1/hod/registrations/pending-faculty, GET /api/v1/hod/faculty-registrations/pending (routes/hod.js)
   * @param {number|null} deptId Department filter
   * @returns {Promise<Array<Object>>} Pending requests
   */
  static async getPendingFacultyRegistrations(deptId) {
    let sql = `
      SELECT frr.id, frr.full_name, frr.email, frr.phone, frr.employee_id,
             frr.account_type, frr.department_id, frr.created_at,
             d.name as department_name, d.code as department_code
      FROM faculty_registration_requests frr
      JOIN departments d ON frr.department_id = d.id
      WHERE frr.approval_type = 'DEPT_HOD' AND frr.status = 'PENDING'
    `;
    const params = [];
    if (deptId) {
      sql += ` AND frr.department_id = ?`;
      params.push(deptId);
    }
    sql += ` ORDER BY frr.created_at DESC`;

    return await query(sql, params);
  }

  /**
   * Approve a pending faculty self-registration, creating user account, teacher record, and audit log
   * @calledBy HodController.approveFacultyRegistration() (controllers/hodController.js)
   * @route POST /api/v1/hod/registrations/faculty/:id/approve, POST /api/v1/hod/faculty-registrations/:id/approve (routes/hod.js)
   * @param {number} reqId Registration request ID
   * @param {number} reviewerId Reviewer user ID
   * @param {number|null} targetDeptId Target department ID
   * @param {boolean} isSystemAdmin Whether reviewer is admin
   * @returns {Promise<Object|null>}
   */
  static async approveFacultyRegistration(reqId, reviewerId, targetDeptId, isSystemAdmin) {
    let sql = `SELECT * FROM faculty_registration_requests WHERE id = ? AND approval_type = 'DEPT_HOD' AND status = 'PENDING'`;
    const params = [reqId];
    if (targetDeptId && !isSystemAdmin) {
      sql += ` AND department_id = ?`;
      params.push(targetDeptId);
    }
    const reqRows = await query(sql, params);
    if (!reqRows || reqRows.length === 0) return null;
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

      await conn.execute(
        `UPDATE faculty_registration_requests 
         SET status = 'APPROVED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [reviewerId, reqId]
      );

      await conn.execute(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
         VALUES (?, 'FACULTY_APPROVED', 'teachers', ?, ?, CURRENT_TIMESTAMP)`,
        [reviewerId, String(createdTeacherId), JSON.stringify({ department_id: r.department_id, email: r.email, approved_from_request: reqId })]
      );

      return {
        request_id: reqId,
        user_id: createdUserId,
        teacher_id: createdTeacherId,
        department_id: r.department_id,
        status: 'APPROVED',
        full_name: r.full_name
      };
    });
  }

  /**
   * Reject a pending faculty self-registration with recorded reason
   * @calledBy HodController.rejectFacultyRegistration() (controllers/hodController.js)
   * @route POST /api/v1/hod/registrations/faculty/:id/reject, POST /api/v1/hod/faculty-registrations/:id/reject (routes/hod.js)
   * @param {number} reqId Request ID
   * @param {number} reviewerId Reviewer user ID
   * @param {number|null} targetDeptId Target department ID
   * @param {boolean} isSystemAdmin Whether reviewer is admin
   * @param {string} [reason] Rejection reason
   * @returns {Promise<Object|null>}
   */
  static async rejectFacultyRegistration(reqId, reviewerId, targetDeptId, isSystemAdmin, reason) {
    let sql = `SELECT * FROM faculty_registration_requests WHERE id = ? AND approval_type = 'DEPT_HOD' AND status = 'PENDING'`;
    const params = [reqId];
    if (targetDeptId && !isSystemAdmin) {
      sql += ` AND department_id = ?`;
      params.push(targetDeptId);
    }
    const reqRows = await query(sql, params);
    if (!reqRows || reqRows.length === 0) return null;

    await query(
      `UPDATE faculty_registration_requests
       SET status = 'REJECTED', rejection_reason = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [reason || 'Rejected by Department HOD', reviewerId, reqId]
    );

    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
       VALUES (?, 'FACULTY_REJECTED', 'faculty_registration_requests', ?, ?, CURRENT_TIMESTAMP)`,
      [reviewerId, String(reqId), JSON.stringify({ reason: reason || 'Rejected by Department HOD', email: reqRows[0].email })]
    );

    return { request_id: reqId, status: 'REJECTED' };
  }

  /**
   * Check whether faculty self-registration gate is open for department
   * @calledBy HodController.getFacultyRegistrationStatus() (controllers/hodController.js)
   * @route GET /api/v1/hod/faculty-registration-status (routes/hod.js)
   * @param {number} deptId Department ID
   * @returns {Promise<boolean>}
   */
  static async getFacultyRegistrationStatus(deptId) {
    const settingKey = `faculty_reg_dept_${deptId}`;
    const setting = await query(`SELECT setting_value FROM system_settings WHERE setting_key = ?`, [settingKey]);
    return setting.length > 0 && setting[0].setting_value === '1';
  }

  /**
   * Toggle departmental faculty self-registration gate with audit trail
   * @calledBy HodController.toggleFacultyRegistration() (controllers/hodController.js)
   * @route POST /api/v1/hod/faculty-registration-toggle (routes/hod.js)
   * @param {number} deptId Department ID
   * @param {boolean} isOpen Gate open status
   * @param {number} userId User ID
   * @returns {Promise<void>}
   */
  static async toggleFacultyRegistration(deptId, isOpen, userId) {
    const settingKey = `faculty_reg_dept_${deptId}`;
    await query(
      `INSERT INTO system_settings (setting_key, setting_value, description, updated_by, updated_at)
       VALUES (?, ?, 'Department Faculty Self-Registration Open/Closed', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(setting_key)
       DO UPDATE SET setting_value = excluded.setting_value, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
      [settingKey, isOpen ? '1' : '0', userId]
    );

    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
       VALUES (?, 'FACULTY_REGISTRATION_TOGGLED', 'departments', ?, ?, CURRENT_TIMESTAMP)`,
      [userId, String(deptId), JSON.stringify({ is_open: isOpen, department_id: deptId })]
    );
  }
}

module.exports = HodModel;
