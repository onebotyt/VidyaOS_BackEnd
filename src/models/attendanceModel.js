/**
 * Attendance Model
 * Encapsulates SQLite queries for attendance sessions, registers, roster snapshots, and ESP32 sync.
 */

const { query } = require('../config/db');

class AttendanceModel {
  /**
   * Retrieves active academic year ID from database.
   * 
   * @calledBy AttendanceController.createSession() (controllers/attendanceController.js)
   * @route POST /api/v1/attendance/sessions (routes/attendance.js)
   * @returns {Promise<number|null>} Academic year ID
   */
  static async getCurrentAcademicYearId() {
    const ay = await query(`SELECT id FROM academic_years WHERE is_current = TRUE LIMIT 1`);
    return ay[0]?.id || null;
  }

  /**
   * Retrieves attendance register details by ID.
   * 
   * @calledBy AttendanceController.createSession() (controllers/attendanceController.js)
   * @calledBy AttendanceController.getEsp32DayScans() (controllers/attendanceController.js)
   * @calledBy AttendanceController.confirmDayAttendance() (controllers/attendanceController.js)
   * @route POST /api/v1/attendance/sessions, GET/POST /api/v1/attendance/registers/:id/* (routes/attendance.js)
   * @param {number|string} registerId Register ID
   * @returns {Promise<Object|null>} Register row or null
   */
  static async getRegisterById(registerId) {
    const rows = await query(`SELECT * FROM attendance_registers WHERE id = ?`, [registerId]);
    return rows[0] || null;
  }

  /**
   * Resolves default subject ID for a department when unspecified.
   * 
   * @calledBy AttendanceController.createSession() (controllers/attendanceController.js)
   * @route POST /api/v1/attendance/sessions (routes/attendance.js)
   * @param {number} deptId Department ID
   * @returns {Promise<number>} Subject ID
   */
  static async getDefaultSubjectId(deptId) {
    const subRows = await query(`SELECT id FROM subjects WHERE department_id = ? LIMIT 1`, [deptId || 1]);
    return subRows[0]?.id || (await query(`SELECT id FROM subjects LIMIT 1`))[0]?.id || 1;
  }

  /**
   * Finds existing active register for teacher and subject.
   * 
   * @calledBy AttendanceController.createSession() (controllers/attendanceController.js)
   * @route POST /api/v1/attendance/sessions (routes/attendance.js)
   * @param {number} teacherId Teacher ID
   * @param {number} subjectId Subject ID
   * @returns {Promise<Object|null>} Register row or null
   */
  static async findExistingRegister(teacherId, subjectId) {
    const rows = await query(
      `SELECT id FROM attendance_registers WHERE teacher_id = ? AND subject_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1`,
      [teacherId, subjectId]
    );
    return rows[0] || null;
  }

  /**
   * Creates a new official attendance register ledger.
   * 
   * @calledBy AttendanceController.createSession() (controllers/attendanceController.js)
   * @route POST /api/v1/attendance/sessions (routes/attendance.js)
   * @param {Object} params Register parameters
   * @returns {Promise<number>} Inserted register ID
   */
  static async createRegister({ teacherId, name, subjectId, departmentId, year, semester, academicYearId, sessionType }) {
    const res = await query(
      `INSERT INTO attendance_registers 
       (teacher_id, name, subject_id, department_id, year, semester, academic_year_id, session_type_scope, is_official)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [teacherId, name, subjectId, departmentId, year, semester, academicYearId, sessionType || 'THEORY']
    );
    return res[0]?.insertId ?? res.lastInsertRowid;
  }

  /**
   * Retrieves subject name by ID.
   * 
   * @calledBy AttendanceController.createSession() (controllers/attendanceController.js)
   * @route POST /api/v1/attendance/sessions (routes/attendance.js)
   * @param {number} subjectId Subject ID
   * @returns {Promise<string|null>} Subject name
   */
  static async getSubjectName(subjectId) {
    const rows = await query(`SELECT name FROM subjects WHERE id = ?`, [subjectId]);
    return rows[0]?.name || null;
  }

  /**
   * Retrieves academic year text label by ID.
   * 
   * @calledBy AttendanceController.createSession() (controllers/attendanceController.js)
   * @route POST /api/v1/attendance/sessions (routes/attendance.js)
   * @param {number} ayId Academic year ID
   * @returns {Promise<string|null>} Academic year label
   */
  static async getAcademicYearLabel(ayId) {
    const rows = await query(`SELECT label FROM academic_years WHERE id = ?`, [ayId]);
    return rows[0]?.label || null;
  }

  /**
   * Lists attendance sessions filtered by user role, state, and subject.
   * 
   * @calledBy AttendanceController.listSessions() (controllers/attendanceController.js)
   * @route GET /api/v1/attendance/sessions (routes/attendance.js)
   * @param {Object} filter { user, state, subject_id }
   * @returns {Promise<Array<Object>>} Sessions list
   */
  static async listSessions({ user, state, subject_id }) {
    let filter = '';
    const params = [];

    if (user.roles?.includes('STUDENT')) {
      filter += ` AND ass.student_id = ?`;
      params.push(user.student_id);
    } else if (user.teacher_id && !user.roles?.includes('SYSTEM_ADMIN')) {
      filter += ` AND s.teacher_id = ?`;
      params.push(user.teacher_id);
    }

    if (state) {
      filter += ` AND s.state = ?`;
      params.push(state);
    }
    if (subject_id) {
      filter += ` AND s.subject_id = ?`;
      params.push(subject_id);
    }

    return await query(
      `SELECT DISTINCT s.id, s.session_type, s.label, s.start_time, s.end_time, s.state, s.auto_close_at,
              sub.name as subject_name, sub.code as subject_code,
              t.full_name as teacher_name,
              d.name as department_name, d.name as branch_name, s.year, s.semester
       FROM attendance_sessions s
       JOIN subjects sub ON s.subject_id = sub.id
       JOIN teachers t ON s.teacher_id = t.id
       JOIN departments d ON s.department_id = d.id
       LEFT JOIN attendance_session_students ass ON ass.session_id = s.id
       WHERE 1=1 ${filter}
       ORDER BY s.start_time DESC
       LIMIT 50`,
      params
    );
  }

  /**
   * Retrieves single session record with joined subject, faculty, department details.
   * 
   * @calledBy AttendanceController.getSessionDetails() (controllers/attendanceController.js)
   * @route GET /api/v1/attendance/sessions/:id (routes/attendance.js)
   * @param {number|string} sessionId Session ID
   * @returns {Promise<Object|null>} Session row or null
   */
  static async getSessionWithCohort(sessionId) {
    const rows = await query(
      `SELECT s.*, sub.name as subject_name, sub.code as subject_code, t.full_name as teacher_name,
              d.name as department_name, d.name as branch_name
       FROM attendance_sessions s
       JOIN subjects sub ON s.subject_id = sub.id
       JOIN teachers t ON s.teacher_id = t.id
       JOIN departments d ON s.department_id = d.id
       WHERE s.id = ?`,
      [sessionId]
    );
    return rows[0] || null;
  }

  /**
   * Retrieves student session roster with marked attendance status and ESP32 presence correlation.
   * 
   * @calledBy AttendanceController.getSessionDetails() (controllers/attendanceController.js)
   * @route GET /api/v1/attendance/sessions/:id (routes/attendance.js)
   * @param {number|string} sessionId Session ID
   * @param {Object} session Session metadata
   * @returns {Promise<Array<Object>>} Roster with attendance records
   */
  static async getSessionRosterWithMarking(sessionId, session) {
    return await query(
      `SELECT ass.student_id, ass.class_roll_no, ass.included,
              s.official_enrollment_no, s.full_name,
              ra.attendance_status, ra.source as marked_source, ra.teacher_notes,
              CASE WHEN ep.id IS NOT NULL THEN TRUE ELSE FALSE END as esp32_presence_detected
       FROM attendance_session_students ass
       JOIN students s ON ass.student_id = s.id
       LEFT JOIN register_attendance ra ON ra.session_id = ass.session_id AND ra.student_id = ass.student_id
       LEFT JOIN esp32_presence ep ON ep.student_id = ass.student_id 
            AND ep.scan_time BETWEEN datetime(?, '-15 minute') AND datetime(COALESCE(?, ?), '+15 minute')
       WHERE ass.session_id = ?
       ORDER BY ass.class_roll_no ASC`,
      [session.start_time, session.end_time, session.auto_close_at, sessionId]
    );
  }

  /**
   * Computes cumulative summary metrics (total sessions, total present, total records) for a register.
   * 
   * @calledBy AttendanceController.getRegisterSummary() (controllers/attendanceController.js)
   * @route GET /api/v1/attendance/registers/:id/summary (routes/attendance.js)
   * @param {number} registerId Register ID
   * @returns {Promise<Object>} Aggregate counts
   */
  static async getRegisterSummary(registerId) {
    const rows = await query(
      `SELECT COUNT(DISTINCT s.id) as total_sessions,
              COUNT(CASE WHEN ra.attendance_status IN ('PRESENT', 'LATE') THEN 1 END) as total_present,
              COUNT(ra.id) as total_records
       FROM attendance_sessions s
       LEFT JOIN register_attendance ra ON ra.session_id = s.id
       WHERE s.register_id = ? AND s.state != 'DRAFT'`,
      [registerId]
    );
    return rows[0] || {};
  }

  /**
   * Resolves hardware terminal assigned to the register's department cohort.
   * 
   * @calledBy AttendanceController.getEsp32DayScans() (controllers/attendanceController.js)
   * @route GET /api/v1/attendance/registers/:id/esp32-day-scans (routes/attendance.js)
   * @param {number} deptId Department ID
   * @param {number} year Cohort year
   * @param {number} semester Cohort semester
   * @returns {Promise<Object|null>} Device row or null
   */
  static async getDeviceForCohort(deptId, year, semester) {
    let devRows = [];
    if (deptId) {
      devRows = await query(
        `SELECT id, device_uid, name, department_id, year, semester, is_active, last_heartbeat_at
         FROM devices 
         WHERE department_id = ? AND is_active = 1
         ORDER BY (year = ? AND semester = ?) DESC, id ASC LIMIT 1`,
        [deptId, year || 0, semester || 0]
      );
    }
    if (!devRows.length) {
      devRows = await query(`SELECT id, device_uid, name, is_active, last_heartbeat_at FROM devices WHERE is_active = 1 LIMIT 1`);
    }
    return devRows[0] || null;
  }

  /**
   * Retrieves biometric scans recorded on a given date for cohort students.
   * 
   * @calledBy AttendanceController.getEsp32DayScans() (controllers/attendanceController.js)
   * @route GET /api/v1/attendance/registers/:id/esp32-day-scans (routes/attendance.js)
   * @param {Object} reg Register row
   * @param {string} date Date YYYY-MM-DD
   * @returns {Promise<Array<Object>>} Scans list
   */
  static async getEsp32DayScans(reg, date) {
    if (reg.group_id) {
      return await query(
        `SELECT ep.id as scan_id, ep.scan_time, ep.device_id,
                s.id as student_id, s.full_name, s.official_enrollment_no, s.registration_no,
                COALESCE(s.class_roll_no, e.class_roll_no, 0) as class_roll_no,
                d.name as device_name
         FROM esp32_presence ep
         JOIN students s ON ep.student_id = s.id
         JOIN teaching_group_members tgm ON tgm.student_id = s.id AND tgm.group_id = ? AND tgm.status = 'ENROLLED'
         LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
         LEFT JOIN devices d ON ep.device_id = d.id
         WHERE DATE(ep.scan_time) = ?
         GROUP BY s.id
         ORDER BY COALESCE(s.class_roll_no, e.class_roll_no, 0) ASC`,
        [reg.group_id, date]
      );
    } else if (reg.department_id) {
      return await query(
        `SELECT ep.id as scan_id, ep.scan_time, ep.device_id,
                s.id as student_id, s.full_name, s.official_enrollment_no, s.registration_no,
                COALESCE(s.class_roll_no, e.class_roll_no, 0) as class_roll_no,
                d.name as device_name
         FROM esp32_presence ep
         JOIN students s ON ep.student_id = s.id
         JOIN enrollments e ON e.student_id = s.id 
              AND e.department_id = ? AND e.year = ? AND e.semester = ? AND e.academic_year_id = ? AND e.status = 'ENROLLED'
         LEFT JOIN devices d ON ep.device_id = d.id
         WHERE DATE(ep.scan_time) = ?
         GROUP BY s.id
         ORDER BY COALESCE(s.class_roll_no, e.class_roll_no, 0) ASC`,
        [reg.department_id, reg.year, reg.semester, reg.academic_year_id, date]
      );
    } else {
      return await query(
        `SELECT ep.id as scan_id, ep.scan_time, ep.device_id,
                s.id as student_id, s.full_name, s.official_enrollment_no,
                1 as class_roll_no,
                d.name as device_name
         FROM esp32_presence ep
         JOIN students s ON ep.student_id = s.id
         LEFT JOIN devices d ON ep.device_id = d.id
         WHERE DATE(ep.scan_time) = ?
         GROUP BY s.id
         ORDER BY s.full_name ASC`,
        [date]
      );
    }
  }

  /**
   * Finds existing finalized day session or creates a new one for ledger reconciliation.
   * 
   * @calledBy AttendanceController.confirmDayAttendance() (controllers/attendanceController.js)
   * @route POST /api/v1/attendance/registers/:id/confirm-day-attendance (routes/attendance.js)
   * @param {number|string} registerId Register ID
   * @param {string} date Session date
   * @param {number} teacherId Teacher ID
   * @param {Object} reg Register details
   * @param {string} sessionType Session type
   * @returns {Promise<Object>} Session row
   */
  static async findOrCreateDaySession(registerId, date, teacherId, reg, sessionType) {
    let sessionRows = await query(
      `SELECT * FROM attendance_sessions WHERE register_id = ? AND session_date = ? LIMIT 1`,
      [registerId, date]
    );

    if (sessionRows.length) {
      return sessionRows[0];
    }

    const sessCnt = (await query(`SELECT COUNT(*) as cnt FROM attendance_sessions WHERE register_id = ?`, [registerId]))[0]?.cnt || 0;
    const sType = sessionType || reg.session_type_scope || 'THEORY';
    const label = `Class ${sessCnt + 1}`;
    const insRes = await query(
      `INSERT INTO attendance_sessions
       (register_id, teacher_id, subject_id, department_id, year, semester, academic_year_id, session_type, label, session_date, start_time, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FINALIZED')`,
      [registerId, teacherId, reg.subject_id, reg.department_id, reg.year, reg.semester, reg.academic_year_id, sType, label, date, `${date} 09:00:00`]
    );
    const sessId = insRes[0]?.insertId ?? insRes.lastInsertRowid;
    const created = await query(`SELECT * FROM attendance_sessions WHERE id = ?`, [sessId]);
    return created[0];
  }

  /**
   * Retrieves enrolled student roster for an attendance register.
   * 
   * @calledBy AttendanceController.confirmDayAttendance() (controllers/attendanceController.js)
   * @route POST /api/v1/attendance/registers/:id/confirm-day-attendance (routes/attendance.js)
   * @param {Object} reg Register row
   * @returns {Promise<Array<Object>>} Enrolled students
   */
  static async getEnrolledStudentsForRegister(reg) {
    if (reg.group_id) {
      return await query(
        `SELECT s.id as student_id, e.id as enrollment_id, COALESCE(s.class_roll_no, e.class_roll_no, 0) as class_roll_no
         FROM teaching_group_members tgm
         JOIN students s ON tgm.student_id = s.id
         LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
         WHERE tgm.group_id = ? AND tgm.status = 'ENROLLED'
         ORDER BY COALESCE(s.class_roll_no, e.class_roll_no, 0) ASC`,
        [reg.group_id]
      );
    } else if (reg.department_id) {
      return await query(
        `SELECT s.id as student_id, e.id as enrollment_id, e.class_roll_no
         FROM enrollments e JOIN students s ON e.student_id = s.id
         WHERE e.department_id = ? AND e.year = ? AND e.semester = ? AND e.academic_year_id = ? AND e.status = 'ENROLLED'
         ORDER BY e.class_roll_no ASC`,
        [reg.department_id, reg.year, reg.semester, reg.academic_year_id]
      );
    }
    return [];
  }

  /**
   * Snapshots student roster into attendance_session_students ledger table.
   * 
   * @calledBy AttendanceController.confirmDayAttendance() (controllers/attendanceController.js)
   * @route POST /api/v1/attendance/registers/:id/confirm-day-attendance (routes/attendance.js)
   * @param {number} sessionId Session ID
   * @param {Array<Object>} students Enrolled student records
   */
  static async snapshotRoster(sessionId, students) {
    for (const st of students) {
      await query(
        `INSERT OR IGNORE INTO attendance_session_students (session_id, student_id, enrollment_id, class_roll_no, included) VALUES (?, ?, ?, ?, 1)`,
        [sessionId, st.student_id, st.enrollment_id || 0, st.class_roll_no || 0]
      );
    }
  }

  /**
   * Writes PRESENT / ABSENT day attendance statuses to register_attendance.
   * 
   * @calledBy AttendanceController.confirmDayAttendance() (controllers/attendanceController.js)
   * @route POST /api/v1/attendance/registers/:id/confirm-day-attendance (routes/attendance.js)
   * @param {number} sessionId Session ID
   * @param {Array<Object>} enrolled Enrolled students
   * @param {Array<number>} studentIds Present student IDs
   * @param {number} userId User ID marking attendance
   */
  static async recordDayAttendance(sessionId, enrolled, studentIds, userId) {
    const confirmedSet = new Set((studentIds || []).map(Number));
    for (const st of enrolled) {
      const isConfirmed = confirmedSet.has(st.student_id);
      const status = isConfirmed ? 'PRESENT' : 'ABSENT';
      const src = isConfirmed ? 'ESP32_SYNC' : 'MANUAL';

      await query(
        `INSERT INTO register_attendance (session_id, student_id, attendance_status, source, marked_by, teacher_notes)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, student_id) DO UPDATE SET
           attendance_status = excluded.attendance_status,
           source = excluded.source,
           marked_by = excluded.marked_by,
           teacher_notes = excluded.teacher_notes`,
        [sessionId, st.student_id, status, src, userId, isConfirmed ? 'ESP32 Biometric Verified' : 'Marked Absent']
      );
    }
  }

  /**
   * Marks day session finalized and sets end time.
   * 
   * @calledBy AttendanceController.confirmDayAttendance() (controllers/attendanceController.js)
   * @route POST /api/v1/attendance/registers/:id/confirm-day-attendance (routes/attendance.js)
   * @param {number} sessionId Session ID
   * @param {string} date Date YYYY-MM-DD
   */
  static async finalizeDaySession(sessionId, date) {
    await query(`UPDATE attendance_sessions SET state = 'FINALIZED', end_time = ? WHERE id = ?`, [`${date} 10:00:00`, sessionId]);
  }

  /**
   * Retrieves session teacher and department HOD user ID for correction authority authorization.
   * 
   * @calledBy AttendanceController.correctAttendance() (controllers/attendanceController.js)
   * @route POST /api/v1/attendance/sessions/:id/correct (routes/attendance.js)
   * @param {number|string} sessionId Session ID
   * @returns {Promise<Object|null>} Auth details or null
   */
  static async getSessionAuthCheck(sessionId) {
    const rows = await query(
      `SELECT s.teacher_id, s.department_id, d.hod_user_id 
       FROM attendance_sessions s
       LEFT JOIN departments d ON s.department_id = d.id
       WHERE s.id = ?`,
      [sessionId]
    );
    return rows[0] || null;
  }
}

module.exports = AttendanceModel;
