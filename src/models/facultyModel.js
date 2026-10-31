/**
 * Faculty Model
 * Encapsulates SQLite queries and transactions for faculty dashboard, registers,
 * digital pen marking, internal evaluation sheets, cohorts, and common faculty requests.
 *
 * Architecture Role: Model (Data Access Layer)
 * Interacts With:
 *   - Controllers: controllers/facultyController.js
 *   - Routes: routes/faculty.js
 * Database Tables: attendance_registers, attendance_sessions, register_attendance, attendance_session_students, teachers, subjects, departments, academic_years, teaching_groups, teaching_group_members, students, enrollments, users, exams, assignments, assessments, assessment_submissions, teacher_assignments, system_settings, faculty_registration_requests, audit_logs
 */

const { query, withTransaction } = require('../config/db');

class FacultyModel {
  /**
   * Aggregates summary statistics for faculty dashboard (active registers, today's classes, pending approvals).
   * @calledBy FacultyController.getDashboard() (controllers/facultyController.js)
   * @route GET /api/v1/faculty/dashboard (routes/faculty.js)
   * @param {number} teacherId - Teacher primary key
   * @param {string} today - Date string (YYYY-MM-DD)
   * @returns {Promise<Object>} Dashboard overview numbers
   */
  static async getDashboardSummary(teacherId, today) {
    const [myRegisters] = await query(
      `SELECT COUNT(*) as total FROM attendance_registers WHERE teacher_id = ? AND is_active = 1`,
      [teacherId || 0]
    );

    const todaySessions = teacherId ? await query(
      `SELECT asess.id, asess.state, asess.label, ar.name as register_name
       FROM attendance_sessions asess
       JOIN attendance_registers ar ON ar.id = asess.register_id
       WHERE ar.teacher_id = ? AND asess.session_date = ?`,
      [teacherId, today]
    ) : [];

    let pendingRegistrations = 0;
    if (teacherId) {
      const [pr] = await query(
        `SELECT COUNT(*) as cnt FROM students s
         JOIN users u ON s.user_id = u.id
         JOIN enrollments e ON e.student_id = s.id
         WHERE u.status = 'PENDING' AND e.department_id IN (SELECT department_id FROM teachers WHERE id = ?)`,
        [teacherId]
      );
      pendingRegistrations = pr?.cnt || 0;
    }

    return {
      total_registers: myRegisters?.total || 0,
      today_sessions: todaySessions,
      pending_registrations: pendingRegistrations
    };
  }

  /**
   * Retrieves active registers owned by teacher (or all official registers if system admin).
   * @calledBy FacultyController.getRegisters() (controllers/facultyController.js)
   * @route GET /api/v1/faculty/registers (routes/faculty.js)
   * @param {number|null} teacherId - Teacher primary key
   * @returns {Promise<Array>} List of attendance registers
   */
  static async getRegisters(teacherId) {
    if (!teacherId) {
      return await query(
        `SELECT ar.*, s.name as subject_name, s.code as subject_code,
                d.name as department_name, d.name as branch_name,
                ay.label as academic_year_label, t.full_name as teacher_name,
                COUNT(asess.id) as total_sessions,
                COUNT(CASE WHEN asess.state = 'FINALIZED' THEN 1 END) as finalized_sessions
         FROM attendance_registers ar
         LEFT JOIN subjects s ON ar.subject_id = s.id
         LEFT JOIN departments d ON ar.department_id = d.id
         LEFT JOIN academic_years ay ON ar.academic_year_id = ay.id
         JOIN teachers t ON ar.teacher_id = t.id
         LEFT JOIN attendance_sessions asess ON asess.register_id = ar.id
         WHERE ar.is_official = 1
         GROUP BY ar.id, s.name, s.code, d.name, ay.label, t.full_name ORDER BY ar.created_at DESC`
      );
    }

    return await query(
      `SELECT ar.*, s.name as subject_name, s.code as subject_code,
              d.name as department_name, d.name as branch_name,
              ay.label as academic_year_label,
              COUNT(asess.id) as total_sessions,
              COUNT(CASE WHEN asess.state = 'FINALIZED' THEN 1 END) as finalized_sessions
       FROM attendance_registers ar
       LEFT JOIN subjects s ON ar.subject_id = s.id
       LEFT JOIN departments d ON ar.department_id = d.id
       LEFT JOIN academic_years ay ON ar.academic_year_id = ay.id
       LEFT JOIN attendance_sessions asess ON asess.register_id = ar.id
       WHERE ar.teacher_id = ? AND ar.is_active = 1
       GROUP BY ar.id, s.name, s.code, d.name, ay.label ORDER BY ar.is_official DESC, ar.created_at DESC`,
      [teacherId]
    );
  }

  /**
   * Retrieves unique students enrolled across all teaching groups / registers of the teacher.
   * @calledBy FacultyController.getMyStudents() (controllers/facultyController.js)
   * @route GET /api/v1/faculty/my-students (routes/faculty.js)
   * @param {number} teacherId - Teacher primary key
   * @returns {Promise<Array>} Unique student list with aggregate attendance rates
   */
  static async getMyStudents(teacherId) {
    let studentRows = [];
    if (teacherId) {
      studentRows = await query(
        `SELECT DISTINCT st.id as student_id, st.full_name, st.official_enrollment_no, st.registration_no,
                COALESCE(st.class_roll_no, e.class_roll_no) as class_roll_no,
                u.email, u.phone,
                e.year, e.semester,
                d.name as department_name,
                tg.id as group_id, tg.name as group_name, tg.subject_name
         FROM teaching_groups tg
         JOIN teaching_group_members tgm ON tgm.group_id = tg.id AND tgm.status IN ('ENROLLED', 'ACTIVE')
         JOIN students st ON tgm.student_id = st.id
         JOIN users u ON st.user_id = u.id
         LEFT JOIN enrollments e ON e.student_id = st.id AND e.status = 'ENROLLED'
         LEFT JOIN departments d ON e.department_id = d.id
         WHERE tg.teacher_id = ? AND tg.status = 'ACTIVE'
         ORDER BY class_roll_no ASC, st.full_name ASC`,
        [teacherId]
      );
    }

    if (!studentRows.length && teacherId) {
      studentRows = await query(
        `SELECT DISTINCT st.id as student_id, st.full_name, st.official_enrollment_no, st.registration_no,
                COALESCE(st.class_roll_no, e.class_roll_no) as class_roll_no,
                u.email, u.phone,
                e.year, e.semester,
                d.name as department_name,
                ar.id as group_id, ar.name as group_name, s.name as subject_name
         FROM attendance_registers ar
         LEFT JOIN subjects s ON ar.subject_id = s.id
         JOIN enrollments e ON e.department_id = ar.department_id AND e.year = ar.year AND e.semester = ar.semester AND e.status = 'ENROLLED'
         JOIN students st ON e.student_id = st.id
         JOIN users u ON st.user_id = u.id
         LEFT JOIN departments d ON e.department_id = d.id
         WHERE ar.teacher_id = ? AND ar.is_active = 1
         ORDER BY class_roll_no ASC, st.full_name ASC`,
        [teacherId]
      );
    }

    const studentMap = new Map();
    for (const r of studentRows) {
      if (!studentMap.has(r.student_id)) {
        studentMap.set(r.student_id, {
          student_id: r.student_id,
          full_name: r.full_name,
          official_enrollment_no: r.official_enrollment_no || '—',
          registration_no: r.registration_no || '—',
          class_roll_no: r.class_roll_no,
          email: r.email || '—',
          phone: r.phone || '—',
          year: r.year,
          semester: r.semester,
          department_name: r.department_name,
          classes: []
        });
      }
      const item = studentMap.get(r.student_id);
      if (r.group_name && !item.classes.includes(r.group_name)) {
        item.classes.push(r.group_name);
      }
    }

    const students = Array.from(studentMap.values());
    if (students.length > 0 && teacherId) {
      const studentIds = students.map(s => s.student_id);
      const attStats = await query(
        `SELECT ra.student_id,
                COUNT(ra.id) as total_sessions,
                SUM(CASE WHEN ra.attendance_status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) as attended_sessions
         FROM register_attendance ra
         JOIN attendance_sessions asess ON asess.id = ra.session_id AND asess.state = 'FINALIZED'
         JOIN attendance_registers ar ON ar.id = asess.register_id
         WHERE ar.teacher_id = ? AND ra.student_id IN (${studentIds.map(() => '?').join(',')})
         GROUP BY ra.student_id`,
        [teacherId, ...studentIds]
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
        st.below_threshold = st.is_defaulter;
      }
    }

    return students;
  }

  /**
   * Retrieves register record by ID.
   * @calledBy FacultyController.getRegisterDetail(), markCell(), updateStudentStatus(), createSession(), getInternalEvaluation(), exportInternalEvaluationExcel(), exportInternalEvaluationExcelCustom(), exportUnitTestsSummaryExcel() (controllers/facultyController.js)
   * @route GET /api/v1/faculty/registers/:id (routes/faculty.js)
   * @param {number} registerId - Register primary key
   * @returns {Promise<Object|null>} Register object or null
   */
  static async getRegisterById(registerId) {
    const rows = await query(
      `SELECT ar.*, s.name as subject_name, s.code as subject_code,
              d.name as department_name, d.name as branch_name,
              ay.label as academic_year_label
       FROM attendance_registers ar
       LEFT JOIN subjects s ON ar.subject_id = s.id
       LEFT JOIN departments d ON ar.department_id = d.id
       LEFT JOIN academic_years ay ON ar.academic_year_id = ay.id
       WHERE ar.id = ?`,
      [registerId]
    );
    return rows[0] || null;
  }

  /**
   * Checks if an attendance session exists for today on this register.
   * @calledBy FacultyController.getRegisterDetail() (controllers/facultyController.js)
   * @param {number} registerId - Register ID
   * @param {string} today - Date string
   * @returns {Promise<Object|null>} Session info or null
   */
  static async findTodaySession(registerId, today) {
    const rows = await query(
      `SELECT id, state FROM attendance_sessions WHERE register_id = ? AND session_date = ?`,
      [registerId, today]
    );
    return rows[0] || null;
  }

  /**
   * Automatically initializes today's class session in DRAFT state with enrolled students roster.
   * @calledBy FacultyController.getRegisterDetail() (controllers/facultyController.js)
   * @param {Object} register - Register entity
   * @param {string} today - Date string
   * @returns {Promise<void>}
   */
  static async autoCreateTodaySession(register, today) {
    const countRow = await query(`SELECT COUNT(*) as cnt FROM attendance_sessions WHERE register_id = ?`, [register.id]);
    const sessionLabel = `Class ${(countRow[0]?.cnt || 0) + 1}`;

    await query(
      `INSERT INTO attendance_sessions 
       (register_id, teacher_id, subject_id, department_id, year, semester, academic_year_id, session_type, label, session_date, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')`,
      [register.id, register.teacher_id, register.subject_id, register.department_id,
      register.year, register.semester, register.academic_year_id,
      register.session_type_scope === 'PRACTICAL' ? 'PRACTICAL' : 'THEORY',
        sessionLabel, today]
    );

    const newSession = (await query(`SELECT id FROM attendance_sessions WHERE register_id = ? AND session_date = ?`, [register.id, today]))[0];
    if (newSession && (register.group_id || register.department_id)) {
      let enrolled;
      if (register.group_id) {
        enrolled = await query(
          `SELECT s.id as student_id, e.id as enrollment_id, COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no
           FROM teaching_group_members tgm JOIN students s ON tgm.student_id = s.id
           LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
           WHERE tgm.group_id = ? AND (tgm.status = 'ACTIVE' OR tgm.status = 'ENROLLED')
           ORDER BY COALESCE(s.class_roll_no, e.class_roll_no) ASC`,
          [register.group_id]
        );
      } else {
        enrolled = await query(
          `SELECT s.id as student_id, e.id as enrollment_id, COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no
           FROM enrollments e JOIN students s ON e.student_id = s.id
           WHERE e.department_id = ? AND e.year = ? AND e.semester = ?
             AND e.academic_year_id = ? AND e.status = 'ENROLLED'
           ORDER BY COALESCE(s.class_roll_no, e.class_roll_no) ASC`,
          [register.department_id, register.year, register.semester, register.academic_year_id]
        );
      }
      for (const student of enrolled) {
        try {
          await query(
            `INSERT OR IGNORE INTO attendance_session_students (session_id, student_id, enrollment_id, class_roll_no) VALUES (?, ?, ?, ?)`,
            [newSession.id, student.student_id, student.enrollment_id, student.class_roll_no]
          );
        } catch { /* skip duplicates */ }
      }
    }
  }

  /**
   * Manually creates a new attendance session for a register with enrolled student roster.
   * @calledBy FacultyController.createSession() (controllers/facultyController.js)
   * @param {Object} opts
   * @returns {Promise<number>} New session ID
   */
  static async createSessionManual({ registerId, reg, periodNumber, sessionType, label, sessionDate, startTime, endTime }) {
    const sType = (sessionType === 'PRACTICAL' || reg.session_type_scope === 'PRACTICAL') ? 'PRACTICAL' : 'THEORY';
    const pNum = periodNumber || 1;
    const sLabel = label || `${sType === 'PRACTICAL' ? 'Practical Lab' : 'Theory Class'} (Period ${pNum})`;
    const sDate = sessionDate || new Date().toISOString().slice(0, 10);

    let effSubjectId = reg.subject_id;
    if (!effSubjectId) {
      if (reg.group_id) {
        const grpRows = await query(`SELECT subject_name, subject_code FROM teaching_groups WHERE id = ?`, [reg.group_id]);
        if (grpRows && grpRows[0]) {
          const sRows = await query(
            `SELECT id FROM subjects WHERE (name = ? OR code = ?) LIMIT 1`,
            [grpRows[0].subject_name, grpRows[0].subject_code]
          );
          if (sRows && sRows[0]) effSubjectId = sRows[0].id;
        }
      }
      if (!effSubjectId) {
        const anySub = await query(`SELECT id FROM subjects WHERE department_id = ? LIMIT 1`, [reg.department_id || 1]);
        effSubjectId = (anySub && anySub[0]) ? anySub[0].id : 1;
      }
      try {
        await query(`UPDATE attendance_registers SET subject_id = ? WHERE id = ?`, [effSubjectId, registerId]);
      } catch (_) { }
    }

    const insertRes = await query(
      `INSERT INTO attendance_sessions 
       (register_id, teacher_id, subject_id, department_id, year, semester, academic_year_id, session_type, label, session_date, period_number, start_time, end_time, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')`,
      [
        reg.id, reg.teacher_id, effSubjectId, reg.department_id,
        reg.year, reg.semester, reg.academic_year_id,
        sType, sLabel, sDate, pNum, startTime || null, endTime || null
      ]
    );

    const newSessionId = insertRes.insertId || insertRes[0]?.insertId;

    if (newSessionId && (reg.group_id || reg.department_id)) {
      let enrolled;
      if (reg.group_id) {
        enrolled = await query(
          `SELECT s.id as student_id, e.id as enrollment_id, COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no
           FROM teaching_group_members tgm JOIN students s ON tgm.student_id = s.id
           LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
           WHERE tgm.group_id = ? AND (tgm.status = 'ACTIVE' OR tgm.status = 'ENROLLED')
           ORDER BY COALESCE(s.class_roll_no, e.class_roll_no) ASC`,
          [reg.group_id]
        );
      } else {
        enrolled = await query(
          `SELECT s.id as student_id, e.id as enrollment_id, COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no
           FROM enrollments e JOIN students s ON e.student_id = s.id
           WHERE e.department_id = ? AND e.year = ? AND e.semester = ?
             AND e.academic_year_id = ? AND e.status = 'ENROLLED'
           ORDER BY COALESCE(s.class_roll_no, e.class_roll_no) ASC`,
          [reg.department_id, reg.year, reg.semester, reg.academic_year_id]
        );
      }
      for (const student of (enrolled || [])) {
        try {
          await query(
            `INSERT OR IGNORE INTO attendance_session_students (session_id, student_id, enrollment_id, class_roll_no) VALUES (?, ?, ?, ?)`,
            [newSessionId, student.student_id, student.enrollment_id, student.class_roll_no]
          );
        } catch { /* skip duplicates */ }
      }
    }

    return newSessionId;
  }

  /**
   * Deletes an attendance session and clears all associated records.
   * @param {Object} params
   * @param {number} params.registerId
   * @param {number} params.sessionId
   */
  static async deleteSession({ registerId, sessionId }) {
    const sess = await query(`SELECT id, session_date, period_number FROM attendance_sessions WHERE id = ? AND register_id = ?`, [sessionId, registerId]);
    if (!sess || !sess[0]) {
      throw new Error('Session not found under this register');
    }

    try { await query(`DELETE FROM student_self_attendance WHERE session_id = ?`, [sessionId]); } catch (_) { }
    try { await query(`DELETE FROM attendance_corrections WHERE session_id = ?`, [sessionId]); } catch (_) { }
    try { await query(`DELETE FROM attendance_session_students WHERE session_id = ?`, [sessionId]); } catch (_) { }
    try { await query(`DELETE FROM register_attendance WHERE session_id = ?`, [sessionId]); } catch (_) { }
    await query(`DELETE FROM attendance_sessions WHERE id = ?`, [sessionId]);

    return true;
  }

  /**
   * Retrieves all sessions with roster headcounts for a register.
   * @calledBy FacultyController.getRegisterDetail() (controllers/facultyController.js)
   * @param {number} registerId - Register primary key
   * @returns {Promise<Array>} List of attendance sessions
   */
  static async getRegisterSessions(registerId) {
    return await query(
      `SELECT asess.id, asess.session_date, asess.period_number, asess.label, asess.state, asess.session_type,
              asess.start_time, asess.end_time, asess.auto_close_at,
              COUNT(ass.id) as roster_count,
              SUM(CASE WHEN ra.attendance_status = 'PRESENT' THEN 1 ELSE 0 END) as present_count,
              SUM(CASE WHEN ra.attendance_status = 'ABSENT' THEN 1 ELSE 0 END) as absent_count,
              SUM(CASE WHEN ra.attendance_status = 'LATE' THEN 1 ELSE 0 END) as late_count
       FROM attendance_sessions asess
       LEFT JOIN attendance_session_students ass ON ass.session_id = asess.id AND ass.included = 1
       LEFT JOIN register_attendance ra ON ra.session_id = asess.id AND ra.student_id = ass.student_id
       WHERE asess.register_id = ?
       GROUP BY asess.id
       ORDER BY asess.session_date DESC, asess.period_number ASC, asess.id ASC`,
      [registerId]
    );
  }

  /**
   * Retrieves distinct months recorded in attendance sessions for dropdown filtering.
   * @calledBy FacultyController.getRegisterDetail() (controllers/facultyController.js)
   * @param {number} registerId - Register ID
   * @returns {Promise<Array<string>>} YYYY-MM strings
   */
  static async getDistinctMonths(registerId) {
    const rows = await query(
      `SELECT DISTINCT substr(session_date, 1, 7) as mo FROM attendance_sessions WHERE register_id = ? ORDER BY mo ASC`,
      [registerId]
    );
    return rows.map(r => r.mo);
  }

  /**
   * Retrieves exams scheduled within a target month for the register's subject/cohort.
   * @calledBy FacultyController.getRegisterDetail() (controllers/facultyController.js)
   * @param {Object} register - Register entity
   * @param {string} targetMonth - YYYY-MM
   * @returns {Promise<Array>} List of exams
   */
  static async getExamsForMonth(register, targetMonth) {
    if (!register.department_id) return [];
    return await query(
      `SELECT id, title as name, due_date as exam_date, max_marks FROM assessments
       WHERE type = 'EXAM' AND (subject_id = ? OR (department_id = ? AND year = ? AND semester = ?))
         AND due_date LIKE ? ORDER BY due_date ASC`,
      [register.subject_id, register.department_id, register.year, register.semester, `${targetMonth}%`]
    );
  }

  /**
   * Retrieves assignments scheduled within a target month for the register's subject/cohort.
   * @calledBy FacultyController.getRegisterDetail() (controllers/facultyController.js)
   * @param {Object} register - Register entity
   * @param {string} targetMonth - YYYY-MM
   * @returns {Promise<Array>} List of assignments
   */
  static async getAssignmentsForMonth(register, targetMonth) {
    if (!register.department_id) return [];
    return await query(
      `SELECT id, title, due_date, max_marks FROM assessments
       WHERE type = 'ASSIGNMENT' AND (subject_id = ? OR (department_id = ? AND year = ? AND semester = ?))
         AND due_date LIKE ? ORDER BY due_date ASC`,
      [register.subject_id, register.department_id, register.year, register.semester, `${targetMonth}%`]
    );
  }

  /**
   * Retrieves enrolled student roster for an attendance register.
   * @calledBy FacultyController.getRegisterDetail() (controllers/facultyController.js)
   * @param {Object} register - Register entity
   * @returns {Promise<Array>} List of enrolled students
   */
  static async getRegisterStudents(register) {
    if (register.group_id) {
      return await query(
        `SELECT st.id as student_id, st.official_enrollment_no, st.registration_no, st.full_name,
                COALESCE(st.class_roll_no, e.class_roll_no) as class_roll_no,
                COALESCE(e.status, 'ENROLLED') as enrollment_status
         FROM teaching_group_members tgm
         JOIN students st ON tgm.student_id = st.id
         LEFT JOIN enrollments e ON e.student_id = st.id AND e.status = 'ENROLLED'
         WHERE tgm.group_id = ? AND (tgm.status = 'ACTIVE' OR tgm.status = 'ENROLLED')
         ORDER BY COALESCE(st.class_roll_no, e.class_roll_no) ASC`,
        [register.group_id]
      );
    }
    return await query(
      `SELECT st.id as student_id, st.official_enrollment_no, st.registration_no, st.full_name,
              COALESCE(st.class_roll_no, e.class_roll_no) as class_roll_no,
              COALESCE(e.status, 'ENROLLED') as enrollment_status
       FROM enrollments e JOIN students st ON e.student_id = st.id
       WHERE e.department_id = ? AND e.year = ? AND e.semester = ? AND e.academic_year_id = ?
       ORDER BY COALESCE(st.class_roll_no, e.class_roll_no) ASC`,
      [register.department_id, register.year, register.semester, register.academic_year_id]
    );
  }

  /**
   * Retrieves configured attendance threshold percentage.
   * @calledBy FacultyController.getRegisterDetail() (controllers/facultyController.js)
   * @returns {Promise<number>} Statutory threshold percentage (e.g. 75.0)
   */
  static async getAttendanceThreshold() {
    const rows = await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'attendance_threshold'`);
    return parseFloat(rows[0]?.setting_value || '75');
  }

  /**
   * Retrieves all finalized attendance cell records for a register.
   * @calledBy FacultyController.getRegisterDetail() (controllers/facultyController.js)
   * @param {number} registerId - Register ID
   * @returns {Promise<Array>} List of student attendance records
   */
  static async getAttendanceRowsForRegister(registerId) {
    return await query(
      `SELECT ra.student_id, ra.attendance_status, s.id as session_id, s.session_date, s.period_number, s.label
       FROM register_attendance ra
       JOIN attendance_sessions s ON s.id = ra.session_id
       WHERE s.register_id = ? AND s.state = 'FINALIZED'`,
      [registerId]
    );
  }

  /**
   * Finds or creates a finalized class session for digital pen direct cell editing.
   * @calledBy FacultyController.markCell() (controllers/facultyController.js)
   * @param {Object} params - Session search attributes
   * @returns {Promise<Object>} Session object { id }
   */
  static async findOrCreateMarkSession({ registerId, date, periodNumber, reg }) {
    let sess = (await query(`SELECT id FROM attendance_sessions WHERE register_id = ? AND session_date = ? AND period_number = ? LIMIT 1`, [registerId, date, periodNumber]))[0];
    if (!sess) {
      sess = (await query(`SELECT id FROM attendance_sessions WHERE register_id = ? AND session_date = ? LIMIT 1`, [registerId, date]))[0];
    }
    if (!sess) {
      const cnt = (await query(`SELECT COUNT(*) as c FROM attendance_sessions WHERE register_id = ?`, [registerId]))[0]?.c || 0;
      const ins = await query(
        `INSERT INTO attendance_sessions
         (register_id, teacher_id, subject_id, department_id, year, semester, academic_year_id, session_type, label, session_date, period_number, start_time, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FINALIZED')`,
        [registerId, reg.teacher_id, reg.subject_id, reg.department_id, reg.year, reg.semester, reg.academic_year_id, reg.session_type_scope || 'THEORY', `Class ${cnt + 1} (P${periodNumber})`, date, periodNumber, `${date} 09:00:00`]
      );
      const sessId = ins.insertId ?? ins.lastInsertRowid;
      sess = { id: sessId };

      if (reg.group_id || reg.department_id) {
        let enrolled;
        if (reg.group_id) {
          enrolled = await query(
            `SELECT s.id as student_id, e.id as enrollment_id, COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no
             FROM teaching_group_members tgm JOIN students s ON tgm.student_id = s.id
             LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
             WHERE tgm.group_id = ? AND (tgm.status = 'ACTIVE' OR tgm.status = 'ENROLLED')
             ORDER BY COALESCE(s.class_roll_no, e.class_roll_no) ASC`,
            [reg.group_id]
          );
        } else {
          enrolled = await query(
            `SELECT s.id as student_id, e.id as enrollment_id, e.class_roll_no
             FROM enrollments e JOIN students s ON e.student_id = s.id
             WHERE e.department_id = ? AND e.year = ? AND e.semester = ? AND e.academic_year_id = ?
             ORDER BY e.class_roll_no ASC`,
            [reg.department_id, reg.year, reg.semester, reg.academic_year_id]
          );
        }
        for (const st of enrolled) {
          await query(
            `INSERT OR IGNORE INTO attendance_session_students (session_id, student_id, enrollment_id, class_roll_no, included) VALUES (?, ?, ?, ?, 1)`,
            [sess.id, st.student_id, st.enrollment_id, st.class_roll_no]
          );
        }
      }
    } else {
      await query(`UPDATE attendance_sessions SET state = 'FINALIZED' WHERE id = ?`, [sess.id]);
    }
    return sess;
  }

  /**
   * Updates or clears attendance mark for a student in a session.
   * @calledBy FacultyController.markCell() (controllers/facultyController.js)
   * @param {Object} params - Mark attributes
   * @returns {Promise<Object>} Aggregate present and absent counts for the session
   */
  static async markCellAttendance({ sessionId, studentId, status, userId }) {
    if (status === 'CLEAR') {
      await query(`DELETE FROM register_attendance WHERE session_id = ? AND student_id = ?`, [sessionId, studentId]);
    } else {
      await query(
        `INSERT INTO register_attendance (session_id, student_id, attendance_status, source, marked_by, teacher_notes)
         VALUES (?, ?, ?, 'MANUAL', ?, 'Direct Pen Edit')
         ON CONFLICT(session_id, student_id) DO UPDATE SET
           attendance_status = excluded.attendance_status,
           source = excluded.source,
           marked_by = excluded.marked_by,
           teacher_notes = excluded.teacher_notes,
           updated_at = CURRENT_TIMESTAMP`,
        [sessionId, studentId, status, userId]
      );
    }

    const counts = (await query(
      `SELECT 
         SUM(CASE WHEN attendance_status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) as present,
         SUM(CASE WHEN attendance_status = 'ABSENT' THEN 1 ELSE 0 END) as absent
       FROM register_attendance WHERE session_id = ?`,
      [sessionId]
    ))[0] || { present: 0, absent: 0 };

    return {
      present: counts.present || 0,
      absent: counts.absent || 0
    };
  }

  /**
   * Updates student enrollment status in cohort.
   * @calledBy FacultyController.updateStudentStatus() (controllers/facultyController.js)
   * @param {number} studentId - Student primary key
   * @param {Object} reg - Register entity
   * @param {string} status - New enrollment status (ENROLLED, TRANSFERRED, DROPPED)
   * @returns {Promise<void>}
   */
  static async updateStudentEnrollmentStatus(studentId, reg, status) {
    await query(
      `UPDATE enrollments SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE student_id = ? AND department_id = ? AND year = ? AND semester = ?`,
      [status, studentId, reg.department_id, reg.year, reg.semester]
    );
  }

  /**
   * Creates a new personal attendance register for faculty.
   * @calledBy FacultyController.createPersonalRegister() (controllers/facultyController.js)
   * @param {Object} params - Register attributes
   * @returns {Promise<number>} Inserted register ID
   */
  static async createPersonalRegister({ name, teacherId, subjectId, departmentId, year, semester, ayId, sessionTypeScope }) {
    const res = await query(
      `INSERT INTO attendance_registers 
       (name, teacher_id, subject_id, department_id, year, semester, academic_year_id, session_type_scope, is_official, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
      [name, teacherId, subjectId || null, departmentId || null, year || null, semester || null, ayId, sessionTypeScope || 'ALL']
    );
    return res.insertId ?? res.lastInsertRowid;
  }


  /**
   * Retrieves active academic cohorts assigned to teacher.
   * @calledBy FacultyController.getCohorts() (controllers/facultyController.js)
   * @route GET /api/v1/faculty/cohorts (routes/faculty.js)
   * @param {number} teacherId - Teacher ID
   * @returns {Promise<Array>} List of cohort objects
   */
  static async getTeacherCohorts(teacherId) {
    if (!teacherId) {
      return await query(
        `SELECT DISTINCT d.id as department_id, d.name as department_name, d.code as department_code,
                d.id as branch_id, d.name as branch_name, d.code as branch_code,
                e.year, e.semester, ay.id as academic_year_id, ay.label as academic_year_label
         FROM enrollments e JOIN departments d ON e.department_id = d.id
         JOIN academic_years ay ON e.academic_year_id = ay.id
         WHERE e.status = 'ENROLLED' ORDER BY d.code, e.year, e.semester`
      );
    }

    const assignedRows = await query(
      `SELECT DISTINCT ta.id as assignment_id, ta.assignment_type, ta.session_type_scope,
              d.id as department_id, d.name as department_name, d.code as department_code,
              d.id as branch_id, d.name as branch_name, d.code as branch_code,
              ta.year, ta.semester, ay.id as academic_year_id, ay.label as academic_year_label
       FROM teacher_assignments ta
       JOIN departments d ON ta.department_id = d.id
       JOIN academic_years ay ON ta.academic_year_id = ay.id
       WHERE ta.teacher_id = ? AND ta.is_active = 1
       ORDER BY ta.assignment_type, d.code, ta.year, ta.semester`,
      [teacherId]
    );

    const tRows = await query(`SELECT department_id FROM teachers WHERE id = ?`, [teacherId]);
    const deptId = tRows[0]?.department_id;

    let mergedRows = [...assignedRows];
    const existingKeys = new Set(assignedRows.map(r => `${r.department_id}_${r.year}_${r.semester}`));

    if (deptId) {
      const deptCohorts = await query(
        `SELECT DISTINCT NULL as assignment_id, 'DEPARTMENT_FACULTY' as assignment_type, NULL as session_type_scope,
                d.id as department_id, d.name as department_name, d.code as department_code,
                d.id as branch_id, d.name as branch_name, d.code as branch_code,
                e.year, e.semester, ay.id as academic_year_id, ay.label as academic_year_label
         FROM enrollments e
         JOIN departments d ON e.department_id = d.id
         JOIN academic_years ay ON e.academic_year_id = ay.id
         WHERE e.department_id = ? AND e.status IN ('ENROLLED', 'PENDING')
         ORDER BY d.code, e.year, e.semester`,
        [deptId]
      );

      for (const dc of deptCohorts) {
        const key = `${dc.department_id}_${dc.year}_${dc.semester}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          mergedRows.push(dc);
        }
      }
    }

    return mergedRows;
  }

  /**
   * Retrieves active subjects assigned to teacher.
   * @calledBy FacultyController.getSubjects() (controllers/facultyController.js)
   * @route GET /api/v1/faculty/subjects (routes/faculty.js)
   * @param {number} teacherId - Teacher ID
   * @returns {Promise<Array>} List of assigned subjects
   */
  static async getTeacherSubjects(teacherId) {
    if (!teacherId) {
      return await query(
        `SELECT s.*, d.name as department_name, d.name as branch_name FROM subjects s
         JOIN departments d ON s.department_id = d.id
         WHERE s.is_active = 1 ORDER BY s.code`
      );
    }
    return await query(
      `SELECT DISTINCT s.id as subject_id, s.name as subject_name, s.code as subject_code, s.has_practical,
              ta.year, ta.semester, ta.department_id, ta.department_id as branch_id, ta.academic_year_id, ta.session_type_scope,
              d.name as department_name, d.name as branch_name,
              ar.id as register_id, ar.name as register_name
       FROM teacher_assignments ta JOIN subjects s ON ta.subject_id = s.id
       JOIN departments d ON ta.department_id = d.id
       LEFT JOIN attendance_registers ar ON ar.assignment_id = ta.id
       WHERE ta.teacher_id = ? AND ta.assignment_type = 'SUBJECT_TEACHER' AND ta.is_active = 1
       ORDER BY s.code`,
      [teacherId]
    );
  }

  /**
   * Retrieves enrolled students in a specific department/year/semester cohort.
   * @calledBy FacultyController.getCohortStudents() (controllers/facultyController.js)
   * @route GET /api/v1/faculty/cohorts/students (routes/faculty.js)
   * @param {number} effDeptId - Department ID
   * @param {number} year - Year
   * @param {number} semester - Semester
   * @param {number} ayId - Academic year ID
   * @returns {Promise<Array>} Enrolled student list
   */
  static async getCohortStudents(effDeptId, year, semester, ayId) {
    return await query(
      `SELECT s.id as student_id, s.official_enrollment_no, s.full_name,
              e.id as enrollment_id, e.class_roll_no, e.status as enrollment_status,
              u.email, u.status as user_status
       FROM enrollments e JOIN students s ON e.student_id = s.id JOIN users u ON s.user_id = u.id
       WHERE e.department_id = ? AND e.year = ? AND e.semester = ? AND e.academic_year_id = ? AND e.status = 'ENROLLED'
       ORDER BY e.class_roll_no ASC`,
      [effDeptId, year, semester, ayId]
    );
  }

  /**
   * Sets a system setting key/value pair.
   * @calledBy FacultyController.toggleCohortRegistration() (controllers/facultyController.js)
   * @param {string} key - Setting key
   * @param {any} val - Setting value
   * @returns {Promise<void>}
   */
  static async setSystemSetting(key, val) {
    await query(
      `INSERT INTO system_settings (setting_key, setting_value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP`,
      [key, String(val)]
    );
  }

  /**
   * Retrieves a system setting value.
   * @calledBy FacultyController.getCohortRegistrationStatus() (controllers/facultyController.js)
   * @param {string} key - Setting key
   * @returns {Promise<string|null>} Setting value or null
   */
  static async getSystemSetting(key) {
    const rows = await query(`SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1`, [key]);
    return rows[0]?.setting_value || null;
  }

  /**
   * Retrieves detailed profile for faculty user including assigned subjects and active registers.
   * @calledBy FacultyController.getProfile() (controllers/facultyController.js)
   * @route GET /api/v1/faculty/profile (routes/faculty.js)
   * @param {number} userId - User ID
   * @param {number|null} teacherId - Teacher ID
   * @returns {Promise<Object|null>} Profile payload or null
   */
  static async getFacultyProfile(userId, teacherId) {
    const userRows = await query(
      `SELECT u.id, u.username, u.email, u.status, u.must_change_password, u.created_at as account_created_at,
              CASE WHEN u.google_sub IS NOT NULL THEN 1 ELSE 0 END as google_linked,
              t.id as teacher_id, t.employee_id, t.full_name, t.phone,
              d.name as department_name, d.code as department_code,
              (SELECT COUNT(*) FROM attendance_registers ar WHERE ar.teacher_id = t.id AND ar.is_active = 1) as active_registers_count,
              (SELECT COUNT(DISTINCT e.student_id) FROM teacher_assignments ta 
               JOIN enrollments e ON e.department_id = ta.department_id AND e.year = ta.year AND e.semester = ta.semester 
               WHERE ta.teacher_id = t.id AND ta.is_active = 1) as total_students_count
       FROM users u 
       LEFT JOIN teachers t ON t.user_id = u.id 
       LEFT JOIN departments d ON t.department_id = d.id
       WHERE u.id = ?`,
      [userId]
    );
    if (!userRows.length) return null;

    const assignments = teacherId ? await query(
      `SELECT ta.id, ta.assignment_type, ta.session_type_scope, d.name as department_name, d.name as branch_name,
              s.name as subject_name, s.code as subject_code, ta.year, ta.semester, ay.label as academic_year_label
       FROM teacher_assignments ta
       JOIN departments d ON ta.department_id = d.id
       JOIN academic_years ay ON ta.academic_year_id = ay.id
       LEFT JOIN subjects s ON ta.subject_id = s.id
       WHERE ta.teacher_id = ? AND ta.is_active = 1 ORDER BY ta.assignment_type, ta.year, ta.semester`,
      [teacherId]
    ) : [];

    const registers = teacherId ? await query(
      `SELECT ar.id, ar.name, s.code as subject_code, s.name as subject_name, ar.session_type_scope, ar.is_official,
              d.name as department_name, ar.year, ar.semester
       FROM attendance_registers ar
       LEFT JOIN subjects s ON ar.subject_id = s.id
       LEFT JOIN departments d ON ar.department_id = d.id
       WHERE ar.teacher_id = ? AND ar.is_active = 1 ORDER BY ar.year, ar.semester`,
      [teacherId]
    ) : [];

    return {
      profile: userRows[0],
      assignments,
      registers
    };
  }

  /**
   * Retrieves classes taught by faculty member.
   * @calledBy FacultyController.getMyClasses() (controllers/facultyController.js)
   * @route GET /api/v1/faculty/my-classes (routes/faculty.js)
   * @param {number} teacherId - Teacher ID
   * @returns {Promise<Array>} List of classes
   */
  static async getMyClasses(teacherId) {
    if (!teacherId) return [];
    return await query(
      `SELECT ta.id as assignment_id, ta.subject_id, sub.name as subject_name, sub.code as subject_code,
              ta.department_id, d.name as department_name, ta.department_id as branch_id, d.name as branch_name,
              ta.year, ta.semester, ta.academic_year_id, ay.label as academic_year_label,
              ta.session_type_scope,
              (SELECT COUNT(*) FROM enrollments e WHERE e.department_id = ta.department_id
                AND e.year = ta.year AND e.semester = ta.semester AND e.academic_year_id = ta.academic_year_id AND e.status = 'ENROLLED') as student_count
       FROM teacher_assignments ta
       JOIN subjects sub ON sub.id = ta.subject_id
       JOIN departments d ON d.id = ta.department_id
       JOIN academic_years ay ON ay.id = ta.academic_year_id
       WHERE ta.teacher_id = ? AND ta.assignment_type = 'SUBJECT_TEACHER' AND ta.is_active = 1
       ORDER BY sub.name ASC`,
      [teacherId]
    );
  }

  /**
   * Aggregates internal evaluation mark sheet data (attendance percentage, assignment scores, exam marks).
   * @calledBy FacultyController.getInternalEvaluation(), exportInternalEvaluationExcel() (controllers/facultyController.js)
   * @route GET /api/v1/faculty/registers/:id/internal-evaluation (routes/faculty.js)
   * @param {number} registerId - Register ID
   * @param {Object} register - Register entity
   * @returns {Promise<Object>} Formatted evaluation sheet payload
   */
  static async getInternalEvaluationData(registerId, register) {
    if (!register) {
      register = (await this.getRegisterById(registerId)) || {};
    }
    const setRows = await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'institution_name'`);
    const institutionName = setRows[0]?.setting_value || 'Government Polytechnic Nainital';

    let enrolledStudents;
    if (register.group_id) {
      enrolledStudents = await query(
        `SELECT s.id as student_id, s.official_enrollment_no, s.registration_no, s.full_name,
                COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no
         FROM teaching_group_members tgm
         JOIN students s ON tgm.student_id = s.id
         LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
         WHERE tgm.group_id = ? AND (tgm.status = 'ACTIVE' OR tgm.status = 'ENROLLED')
         ORDER BY COALESCE(s.class_roll_no, e.class_roll_no) ASC`,
        [register.group_id]
      );
    } else {
      enrolledStudents = await query(
        `SELECT s.id as student_id, s.official_enrollment_no, s.registration_no, s.full_name, e.class_roll_no
         FROM enrollments e
         JOIN students s ON e.student_id = s.id
         WHERE e.department_id = ? AND e.year = ? AND e.semester = ?
           AND e.academic_year_id = ? AND e.status = 'ENROLLED'
         ORDER BY e.class_roll_no ASC`,
        [register.department_id, register.year, register.semester, register.academic_year_id]
      );
    }

    let assignments;
    let assignSubmissions;
    if (register.group_id) {
      assignments = await query(
        `SELECT id, title as name, max_marks
         FROM assessments
         WHERE group_id = ? AND type = 'ASSIGNMENT'
         ORDER BY id ASC`,
        [register.group_id]
      );
      assignSubmissions = await query(
        `SELECT sub.assessment_id, sub.student_id, sub.marks_obtained
         FROM assessment_submissions sub
         JOIN assessments a ON sub.assessment_id = a.id
         WHERE a.group_id = ? AND a.type = 'ASSIGNMENT'`,
        [register.group_id]
      );
    } else {
      assignments = await query(
        `SELECT id, title as name, max_marks
         FROM assessments
         WHERE department_id = ? AND year = ? AND semester = ? AND academic_year_id = ?
           AND (subject_id = ? OR subject_id IS NULL) AND type = 'ASSIGNMENT'
         ORDER BY id ASC`,
        [register.department_id, register.year, register.semester, register.academic_year_id, register.subject_id]
      );
      assignSubmissions = await query(
        `SELECT sub.assessment_id, sub.student_id, sub.marks_obtained
         FROM assessment_submissions sub
         JOIN assessments a ON sub.assessment_id = a.id
         WHERE a.department_id = ? AND a.year = ? AND a.semester = ? AND a.academic_year_id = ?
           AND (a.subject_id = ? OR a.subject_id IS NULL) AND a.type = 'ASSIGNMENT'`,
        [register.department_id, register.year, register.semester, register.academic_year_id, register.subject_id]
      );
    }

    const assignScoreMap = {};
    assignSubmissions.forEach(sub => {
      const key = `${sub.assessment_id}_${sub.student_id}`;
      assignScoreMap[key] = sub.marks_obtained;
    });

    let exams;
    let examSubmissions;
    if (register.group_id) {
      exams = await query(
        `SELECT id, title as name, max_marks, due_date as exam_date
         FROM assessments
         WHERE group_id = ? AND type = 'EXAM'
         ORDER BY id ASC`,
        [register.group_id]
      );
      examSubmissions = await query(
        `SELECT sub.assessment_id, sub.student_id, sub.marks_obtained, sub.feedback, sub.status
         FROM assessment_submissions sub
         JOIN assessments a ON sub.assessment_id = a.id
         WHERE a.group_id = ? AND a.type = 'EXAM'`,
        [register.group_id]
      );
    } else {
      exams = await query(
        `SELECT id, title as name, max_marks, due_date as exam_date
         FROM assessments
         WHERE department_id = ? AND year = ? AND semester = ? AND academic_year_id = ?
           AND subject_id = ? AND type = 'EXAM'
         ORDER BY id ASC`,
        [register.department_id, register.year, register.semester, register.academic_year_id, register.subject_id]
      );
      examSubmissions = await query(
        `SELECT sub.assessment_id, sub.student_id, sub.marks_obtained, sub.feedback, sub.status
         FROM assessment_submissions sub
         JOIN assessments a ON sub.assessment_id = a.id
         WHERE a.department_id = ? AND a.year = ? AND a.semester = ? AND a.academic_year_id = ?
           AND a.subject_id = ? AND a.type = 'EXAM'`,
        [register.department_id, register.year, register.semester, register.academic_year_id, register.subject_id]
      );
    }

    const examScoreMap = {};
    examSubmissions.forEach(sub => {
      const key = `${sub.assessment_id}_${sub.student_id}`;
      let isAbsent = sub.status === 'ABSENT';
      if (sub.feedback && typeof sub.feedback === 'string' && sub.feedback.startsWith('{')) {
        try {
          const parsed = JSON.parse(sub.feedback);
          if (parsed.is_absent !== undefined) isAbsent = Boolean(parsed.is_absent);
        } catch { /* ignore */ }
      }
      examScoreMap[key] = {
        marks: sub.marks_obtained,
        is_absent: isAbsent
      };
    });

    const attStats = await query(
      `SELECT ra.student_id,
              COUNT(ra.id) as total_sessions,
              SUM(CASE WHEN ra.attendance_status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) as present_sessions
       FROM register_attendance ra
       JOIN attendance_sessions asess ON ra.session_id = asess.id
       WHERE asess.register_id = ?
       GROUP BY ra.student_id`,
      [registerId]
    );

    const attMap = {};
    attStats.forEach(stat => {
      const pct = stat.total_sessions > 0 ? (stat.present_sessions / stat.total_sessions) * 100 : 100;
      attMap[stat.student_id] = Number(pct.toFixed(1));
    });

    const roster = enrolledStudents.map(st => {
      const aScores = assignments.map(a => {
        const val = assignScoreMap[`${a.id}_${st.student_id}`];
        return val !== undefined && val !== null ? Number(val) : '';
      });
      const eScores = exams.map(ex => {
        const item = examScoreMap[`${ex.id}_${st.student_id}`];
        return item || { marks: '', is_absent: false };
      });
      const attPct = attMap[st.student_id] !== undefined ? attMap[st.student_id] : 85;

      return {
        student_id: st.student_id,
        class_roll_no: st.class_roll_no,
        registration_no: st.registration_no,
        official_enrollment_no: st.official_enrollment_no,
        enrollment_no: st.official_enrollment_no,
        full_name: st.full_name,
        assignment_scores: aScores,
        exam_scores: eScores,
        attendance_percentage: attPct,
        presentation_score: 4
      };
    });

    return {
      institution_name: institutionName,
      session_label: `Internal Evaluation Sheet ${register.academic_year_label || '2026-27 (Odd Semester)'}`,
      department_name: register.department_name,
      department_code: register.department_code,
      subject_name: register.subject_name,
      semester: register.semester,
      assignments,
      exams,
      roster
    };
  }

  /**
   * Retrieves pending registration requests for common (interdisciplinary) faculty.
   * @calledBy FacultyController.getCommonPending() (controllers/facultyController.js)
   * @route GET /api/v1/faculty/common/pending (routes/faculty.js)
   * @returns {Promise<Array>} List of pending requests
   */
  static async getCommonPendingRequests() {
    return await query(
      `SELECT frr.id, frr.full_name, frr.email, frr.phone, frr.employee_id,
              frr.account_type, frr.created_at
       FROM faculty_registration_requests frr
       WHERE frr.approval_type = 'COMMON_FACULTY_MANAGER' AND frr.status = 'PENDING'
       ORDER BY frr.created_at DESC`
    );
  }

  /**
   * Approves common faculty registration request and creates teacher account with NULL department.
   * @calledBy FacultyController.approveCommon() (controllers/facultyController.js)
   * @route POST /api/v1/faculty/common/:id/approve (routes/faculty.js)
   * @param {number} reqId - Request ID
   * @param {number} reviewerId - User ID of reviewer
   * @returns {Promise<Object|null>} Approved faculty record or null
   */
  static async approveCommonFacultyRequest(reqId, reviewerId) {
    const reqRows = await query(
      `SELECT * FROM faculty_registration_requests WHERE id = ? AND approval_type = 'COMMON_FACULTY_MANAGER' AND status = 'PENDING'`,
      [reqId]
    );
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
         VALUES (?, NULL, ?, ?, ?)`,
        [createdUserId, r.employee_id || null, r.full_name, r.phone || null]
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
        [reviewerId, String(createdTeacherId), JSON.stringify({ common_faculty: true, email: r.email, approved_from_request: reqId })]
      );

      return {
        request_id: reqId,
        user_id: createdUserId,
        teacher_id: createdTeacherId,
        full_name: r.full_name,
        email: r.email
      };
    });
  }

  /**
   * Rejects common faculty registration request with recorded reason.
   * @calledBy FacultyController.rejectCommon() (controllers/facultyController.js)
   * @route POST /api/v1/faculty/common/:id/reject (routes/faculty.js)
   * @param {number} reqId - Request ID
   * @param {number} reviewerId - User ID of reviewer
   * @param {string|null} reason - Rejection reason
   * @returns {Promise<boolean>} True if successfully rejected
   */
  static async rejectCommonFacultyRequest(reqId, reviewerId, reason) {
    const reqRows = await query(
      `SELECT * FROM faculty_registration_requests WHERE id = ? AND approval_type = 'COMMON_FACULTY_MANAGER' AND status = 'PENDING'`,
      [reqId]
    );
    if (!reqRows || reqRows.length === 0) return false;

    await query(
      `UPDATE faculty_registration_requests
       SET status = 'REJECTED', rejection_reason = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [reason || 'Rejected by Common Faculty Manager', reviewerId, reqId]
    );

    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
       VALUES (?, 'FACULTY_REJECTED', 'faculty_registration_requests', ?, ?, CURRENT_TIMESTAMP)`,
      [reviewerId, String(reqId), JSON.stringify({ reason: reason || 'Rejected by Common Faculty Manager', email: reqRows[0].email })]
    );

    return true;
  }

  /**
   * Retrieves active common faculty members across the institution.
   * @calledBy FacultyController.getCommonMembers() (controllers/facultyController.js)
   * @route GET /api/v1/faculty/common/members (routes/faculty.js)
   * @returns {Promise<Array>} List of common faculty members
   */
  static async getCommonFacultyMembers() {
    return await query(
      `SELECT t.id as teacher_id, t.full_name, t.employee_id, t.phone,
              u.id as user_id, u.email as gmail, u.created_at,
              (SELECT COUNT(*) FROM teaching_groups tg WHERE tg.teacher_id = t.id AND tg.status = 'ACTIVE') as active_groups_count
       FROM teachers t
       JOIN users u ON t.user_id = u.id
       WHERE t.department_id IS NULL
       ORDER BY t.full_name ASC`
    );
  }

  /**
   * Retrieves structured attendance register data formatted for institutional export (Excel, PDF, Word).
   * Supports: overview_only, all_months, month, week, day scopes.
   * @param {number} registerId
   * @param {Object} options - { range, month, day, scope }
   * @returns {Promise<Object>} Formatted export payload
   */
  static async getRegisterAttendanceExportData(registerId, options = {}) {
    const register = (await this.getRegisterById(registerId)) || {};
    const range = options.range || 'all_months';
    const scope = options.scope || 'BOTH';

    // Institution & Session
    const instRow = (await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'institution_name'`))[0];
    const institutionName = instRow?.setting_value || 'Uttarakhand Government Institute of Polytechnic, Nainital';

    const ayRow = (await query(`SELECT label FROM academic_years WHERE is_current = 1 LIMIT 1`))[0];
    const sessionLabel = ayRow?.label || register.academic_year_label || '2026 Session';

    // Department details
    const deptName = register.department_name || register.branch_name || 'Information Technology';
    const deptCode = register.department_code || (deptName.includes(' ') ? deptName.split(' ').map(w => w[0]).join('').toUpperCase() : deptName);
    const subjectName = register.subject_name || 'Subject';
    const year = register.year || 3;
    const semester = register.semester || 5;

    // Students enrolled
    const rawStudents = await this.getRegisterStudents(register);
    const students = rawStudents.map((st, idx) => ({
      sr_no: idx + 1,
      student_id: st.student_id,
      roll_no: st.class_roll_no || '--',
      enrollment_no: st.official_enrollment_no || '--',
      registration_no: st.registration_no || '--',
      name: st.full_name || '--'
    }));

    // All finalized attendance records
    let sessFilter = `WHERE s.register_id = ? AND s.state = 'FINALIZED'`;
    const filterParams = [registerId];
    if (scope === 'THEORY' || scope === 'PRACTICAL') {
      sessFilter += ` AND (s.session_type = ? OR s.session_type IS NULL OR s.session_type = 'CUSTOM')`;
      filterParams.push(scope);
    }

    const attendanceRows = await query(
      `SELECT ra.student_id, ra.attendance_status, s.id as session_id, s.session_date, s.period_number, s.label, s.session_type
       FROM register_attendance ra
       JOIN attendance_sessions s ON s.id = ra.session_id
       ${sessFilter}
       ORDER BY s.session_date ASC, s.period_number ASC`,
      filterParams
    );

    // Map: student_id -> session_date -> list of statuses (or latest)
    // Also student_id -> month -> { present, absent, total }
    const studentMonthMap = new Map();
    const studentDayMap = new Map();

    students.forEach(st => {
      studentMonthMap.set(st.student_id, new Map());
      studentDayMap.set(st.student_id, new Map());
    });

    const recordedMonthsSet = new Set();
    const recordedDatesSet = new Set();

    attendanceRows.forEach(row => {
      const sId = row.student_id;
      const sDate = row.session_date; // YYYY-MM-DD
      const sMonth = sDate.slice(0, 7); // YYYY-MM

      recordedMonthsSet.add(sMonth);
      recordedDatesSet.add(sDate);

      if (studentDayMap.has(sId)) {
        const existing = studentDayMap.get(sId).get(sDate);
        if (row.attendance_status === 'PRESENT') {
          studentDayMap.get(sId).set(sDate, 'P');
        } else if (row.attendance_status === 'ABSENT' && existing !== 'P') {
          studentDayMap.get(sId).set(sDate, 'A');
        }
      }

      if (studentMonthMap.has(sId)) {
        const mObj = studentMonthMap.get(sId).get(sMonth) || { present: 0, absent: 0, total: 0 };
        if (row.attendance_status === 'PRESENT') {
          mObj.present++;
          mObj.total++;
        } else if (row.attendance_status === 'ABSENT') {
          mObj.absent++;
          mObj.total++;
        }
        studentMonthMap.get(sId).set(sMonth, mObj);
      }
    });

    let monthsList = Array.from(recordedMonthsSet).sort();
    if (monthsList.length === 0) {
      monthsList = [new Date().toISOString().slice(0, 7)];
    }

    // Standard Holidays map
    const STANDARD_HOLIDAYS_MAP = {
      '01-26': 'REPUBLIC DAY',
      '08-15': 'INDEPENDENCE DAY',
      '08-19': 'RAKSHA BANDHAN',
      '08-26': 'ID-E-MILAD',
      '10-02': 'MAHATMA GANDHI JAYANTI',
      '10-24': 'DUSSEHRA',
      '11-01': 'DIWALI VACATION',
      '11-02': 'GOVARDHAN PUJA',
      '11-15': 'GURU NANAK JAYANTI',
      '12-25': 'CHRISTMAS DAY'
    };

    // Build overview summary sheet data
    const overviewMonths = monthsList.map(m => {
      const [yr, mo] = m.split('-').map(Number);
      const dt = new Date(yr, mo - 1, 1);
      return {
        key: m,
        label: dt.toLocaleString('default', { month: 'short', year: 'numeric' })
      };
    });

    const overviewStudents = students.map(st => {
      const sId = st.student_id;
      let overallPresent = 0;
      let overallAbsent = 0;
      let overallTotal = 0;

      const monthBreakdown = {};
      overviewMonths.forEach(om => {
        const mData = studentMonthMap.get(sId)?.get(om.key) || { present: 0, absent: 0, total: 0 };
        monthBreakdown[om.key] = mData;
        overallPresent += mData.present;
        overallAbsent += mData.absent;
        overallTotal += mData.total;
      });

      const pct = overallTotal > 0 ? ((overallPresent / overallTotal) * 100).toFixed(1) : '0.0';

      return {
        sr_no: st.sr_no,
        roll_no: st.roll_no,
        enrollment_no: st.enrollment_no,
        registration_no: st.registration_no,
        name: st.name,
        month_breakdown: monthBreakdown,
        overall_present: overallPresent,
        overall_absent: overallAbsent,
        overall_total: overallTotal,
        percentage: pct
      };
    });

    // Helper to generate monthly matrix detail
    const buildMonthlyMatrix = (mStr) => {
      const [yr, mo] = mStr.split('-').map(Number);
      const daysCount = new Date(yr, mo, 0).getDate();
      const dtMonth = new Date(yr, mo - 1, 1);
      const monthLabel = dtMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

      const days = [];
      for (let d = 1; d <= daysCount; d++) {
        const dStr = String(d).padStart(2, '0');
        const dt = new Date(yr, mo - 1, d);
        const dayOfWeek = dt.getDay();
        const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek];
        const isSun = dayOfWeek === 0;
        const is2ndSat = dayOfWeek === 6 && d >= 8 && d <= 14;
        const mmdd = `${String(mo).padStart(2, '0')}-${dStr}`;
        const holiday = STANDARD_HOLIDAYS_MAP[mmdd] || (isSun ? 'SUNDAY' : (is2ndSat ? 'SECOND SATURDAY' : null));

        days.push({
          day: d,
          date: `${mStr}-${dStr}`,
          day_name: dayName,
          is_sunday: isSun,
          is_holiday: Boolean(holiday),
          holiday_label: holiday
        });
      }

      const roster = students.map(st => {
        const sId = st.student_id;
        const marks = {};
        let mPres = 0;
        let mAbs = 0;

        days.forEach(d => {
          const status = studentDayMap.get(sId)?.get(d.date) || (d.is_holiday ? '—' : '');
          marks[d.day] = status;
          if (status === 'P') mPres++;
          else if (status === 'A') mAbs++;
        });

        const mTot = mPres + mAbs;
        const mPct = mTot > 0 ? ((mPres / mTot) * 100).toFixed(1) : '0.0';

        return {
          sr_no: st.sr_no,
          roll_no: st.roll_no,
          enrollment_no: st.enrollment_no,
          registration_no: st.registration_no,
          name: st.name,
          marks,
          total_present: mPres,
          total_absent: mAbs,
          total_classes: mTot,
          percentage: mPct
        };
      });

      return {
        month_key: mStr,
        month_label: monthLabel,
        days_in_month: daysCount,
        days,
        students: roster
      };
    };

    // Build payload according to range
    const exportPayload = {
      institution_name: institutionName,
      session_label: sessionLabel,
      department_name: deptName,
      department_code: deptCode,
      subject_name: subjectName,
      year,
      semester,
      scope,
      range,
      overview_months: overviewMonths,
      overview_students: overviewStudents,
      monthly_sheets: []
    };

    if (range === 'overview_only') {
      // Only the overview sheet
      exportPayload.monthly_sheets = [];
    } else if (range === 'all_months') {
      // Complete semester: Overview + all recorded months
      exportPayload.monthly_sheets = monthsList.map(m => buildMonthlyMatrix(m));
    } else if (range === 'month') {
      // Selected month only
      const targetM = options.month || monthsList[0];
      exportPayload.monthly_sheets = [buildMonthlyMatrix(targetM)];
    } else if (range === 'week') {
      // Selected week: compute Monday-Saturday around target day
      const targetDay = options.day || new Date().toISOString().slice(0, 10);
      const tDate = new Date(targetDay);
      const dayOfWeek = tDate.getDay(); // 0 is Sunday
      const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monDate = new Date(tDate);
      monDate.setDate(tDate.getDate() + diffToMon);

      const weekDays = [];
      for (let i = 0; i < 6; i++) { // Mon to Sat
        const d = new Date(monDate);
        d.setDate(monDate.getDate() + i);
        const yStr = d.getFullYear();
        const mStr = String(d.getMonth() + 1).padStart(2, '0');
        const dtStr = String(d.getDate()).padStart(2, '0');
        const dateKey = `${yStr}-${mStr}-${dtStr}`;
        const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
        weekDays.push({
          day: i + 1,
          date: dateKey,
          day_name: `${dayName} (${dtStr}/${mStr})`,
          is_holiday: false
        });
      }

      const weekRoster = students.map(st => {
        const sId = st.student_id;
        const marks = {};
        let wPres = 0;
        let wAbs = 0;
        weekDays.forEach((wd, idx) => {
          const status = studentDayMap.get(sId)?.get(wd.date) || '';
          marks[idx + 1] = status;
          if (status === 'P') wPres++;
          else if (status === 'A') wAbs++;
        });
        const wTot = wPres + wAbs;
        return {
          sr_no: st.sr_no,
          roll_no: st.roll_no,
          enrollment_no: st.enrollment_no,
          registration_no: st.registration_no,
          name: st.name,
          marks,
          total_present: wPres,
          total_absent: wAbs,
          total_classes: wTot,
          percentage: wTot > 0 ? ((wPres / wTot) * 100).toFixed(1) : '0.0'
        };
      });

      exportPayload.monthly_sheets = [{
        month_key: 'Week',
        month_label: `Week of ${weekDays[0].date} to ${weekDays[5].date}`,
        days_in_month: 6,
        days: weekDays,
        students: weekRoster
      }];
    } else if (range === 'day') {
      const targetDate = options.day || new Date().toISOString().slice(0, 10);
      const dt = new Date(targetDate);
      const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()];
      const singleDay = [{
        day: 1,
        date: targetDate,
        day_name: `${dayName} (${targetDate})`,
        is_holiday: false
      }];

      const dayRoster = students.map(st => {
        const status = studentDayMap.get(st.student_id)?.get(targetDate) || '—';
        return {
          sr_no: st.sr_no,
          roll_no: st.roll_no,
          enrollment_no: st.enrollment_no,
          registration_no: st.registration_no,
          name: st.name,
          marks: { 1: status },
          total_present: status === 'P' ? 1 : 0,
          total_absent: status === 'A' ? 1 : 0,
          total_classes: (status === 'P' || status === 'A') ? 1 : 0,
          percentage: status === 'P' ? '100.0' : (status === 'A' ? '0.0' : '—')
        };
      });

      exportPayload.monthly_sheets = [{
        month_key: 'Day',
        month_label: `Daily Attendance — ${targetDate}`,
        days_in_month: 1,
        days: singleDay,
        students: dayRoster
      }];
    }

    return exportPayload;
  }
}

module.exports = FacultyModel;
