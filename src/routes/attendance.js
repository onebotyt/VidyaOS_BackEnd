/**
 * Attendance Core Routes (/api/v1/attendance/*)
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { query } = require('../config/db');
const attendanceService = require('../services/attendanceService');
const auditService = require('../services/auditService');

/**
 * Create Attendance Session (State: DRAFT)
 * POST /api/v1/attendance/sessions
 */
router.post(
  '/sessions',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('register_id').optional().isInt(),
    body('subject_id').optional().isInt(),
    body('department_id').optional().isInt(),
    body('branch_id').optional(),
    body('year').optional().isInt({ min: 1, max: 4 }),
    body('semester').optional().isInt({ min: 1, max: 8 }),
    validate
  ],
  async (req, res) => {
    try {
      let teacherId = req.user.teacher_id;
      if (!teacherId && !req.user.roles.includes('SYSTEM_ADMIN')) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Teacher profile required to start attendance session' }
        });
      }

      let ayId = req.body.academic_year_id;
      if (!ayId) {
        const ay = await query(`SELECT id FROM academic_years WHERE is_current = TRUE LIMIT 1`);
        ayId = ay[0]?.id;
      }

      let registerId = req.body.register_id;
      let subjectId = req.body.subject_id;
      let deptId = req.body.department_id;
      let year = req.body.year;
      let sem = req.body.semester;

      if (registerId) {
        const regRows = await query(`SELECT * FROM attendance_registers WHERE id = ?`, [registerId]);
        if (!regRows.length) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Attendance register not found' } });
        }
        const reg = regRows[0];
        if (!teacherId) teacherId = reg.teacher_id;
        subjectId = subjectId || reg.subject_id;
        deptId = deptId || reg.department_id;
        year = year || reg.year;
        sem = sem || reg.semester;
        ayId = ayId || reg.academic_year_id;

        if (!subjectId) {
          const subRows = await query(`SELECT id FROM subjects WHERE department_id = ? LIMIT 1`, [deptId || 1]);
          subjectId = subRows[0]?.id || (await query(`SELECT id FROM subjects LIMIT 1`))[0]?.id || 1;
        }
      } else {
        if (!subjectId || !deptId || !year || !sem) {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Either register_id or full cohort details (subject_id, department_id, year, semester) are required' }
          });
        }
        // Auto-find or create register for this teacher and subject
        const existing = await query(
          `SELECT id FROM attendance_registers WHERE teacher_id = ? AND subject_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1`,
          [teacherId, subjectId]
        );
        if (existing.length) {
          registerId = existing[0].id;
        } else {
          const sub = (await query(`SELECT name FROM subjects WHERE id = ?`, [subjectId]))[0];
          const ay = (await query(`SELECT label FROM academic_years WHERE id = ?`, [ayId]))[0];
          const regName = `${sub?.name || 'Subject'} — ${ay?.label || 'Academic Year'}`;
          const rRes = await query(
            `INSERT INTO attendance_registers 
             (teacher_id, name, subject_id, department_id, year, semester, academic_year_id, session_type_scope, is_official)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [teacherId, regName, subjectId, deptId, year, sem, ayId, req.body.session_type || 'THEORY']
          );
          registerId = rRes[0]?.insertId ?? rRes.lastInsertRowid;
        }
      }

      const session = await attendanceService.createSession({
        ...req.body,
        register_id: registerId,
        subject_id: subjectId,
        department_id: deptId,
        year,
        semester: sem,
        academic_year_id: ayId
      }, teacherId);

      res.status(201).json({ success: true, data: session });
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }
);

/**
 * List Attendance Sessions
 * GET /api/v1/attendance/sessions
 */
router.get('/sessions', auth, async (req, res) => {
  const { state, subject_id, from_date, to_date } = req.query;
  let filter = '';
  const params = [];

  // Students only see OPEN sessions for their cohort, or past sessions
  if (req.user.roles.includes('STUDENT')) {
    filter += ` AND ass.student_id = ?`;
    params.push(req.user.student_id);
  } else if (req.user.teacher_id && !req.user.roles.includes('SYSTEM_ADMIN')) {
    filter += ` AND s.teacher_id = ?`;
    params.push(req.user.teacher_id);
  }

  if (state) {
    filter += ` AND s.state = ?`;
    params.push(state);
  }
  if (subject_id) {
    filter += ` AND s.subject_id = ?`;
    params.push(subject_id);
  }

  try {
    const sessions = await query(
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

    res.status(200).json({ success: true, data: sessions });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Get Session Details with Frozen Roster and Official Register Status
 * GET /api/v1/attendance/sessions/:id
 */
router.get('/sessions/:id', auth, async (req, res) => {
  const sessionId = req.params.id;

  try {
    const sessionRows = await query(
      `SELECT s.*, sub.name as subject_name, sub.code as subject_code, t.full_name as teacher_name,
              d.name as department_name, d.name as branch_name
       FROM attendance_sessions s
       JOIN subjects sub ON s.subject_id = sub.id
       JOIN teachers t ON s.teacher_id = t.id
       JOIN departments d ON s.department_id = d.id
       WHERE s.id = ?`,
      [sessionId]
    );

    if (sessionRows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });
    }

    const session = sessionRows[0];

    // Fetch frozen roster with current marking from Stream 2
    const roster = await query(
      `SELECT ass.student_id, ass.class_roll_no, ass.included,
              s.official_enrollment_no, s.full_name,
              ra.attendance_status, ra.source as marked_source, ra.teacher_notes,
              CASE WHEN ep.id IS NOT NULL THEN TRUE ELSE FALSE END as esp32_presence_detected
       FROM attendance_session_students ass
       JOIN students s ON ass.student_id = s.id
       LEFT JOIN register_attendance ra ON ra.session_id = ass.session_id AND ra.student_id = ass.student_id
       LEFT JOIN esp32_presence ep ON ep.student_id = ass.student_id 
            AND ep.scan_time BETWEEN DATE_SUB(?, INTERVAL 15 MINUTE) AND DATE_ADD(COALESCE(?, ?), INTERVAL 15 MINUTE)
       WHERE ass.session_id = ?
       ORDER BY ass.class_roll_no ASC`,
      [session.start_time, session.end_time, session.auto_close_at, sessionId]
    );

    res.status(200).json({
      success: true,
      data: {
        session,
        roster
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Transition Session State (DRAFT -> OPEN -> CLOSED -> FINALIZED)
 * PUT /api/v1/attendance/sessions/:id/state
 */
router.put(
  '/sessions/:id/state',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('state').isIn(['DRAFT', 'OPEN', 'CLOSED', 'FINALIZED']).withMessage('Invalid state value'),
    validate
  ],
  async (req, res) => {
    try {
      const result = await attendanceService.transitionState(
        req.params.id,
        req.body.state,
        req.user.teacher_id
      );
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        error: {
          code: err.code || 'INTERNAL_SERVER_ERROR',
          message: err.message,
          details: err.details || null
        }
      });
    }
  }
);

/**
 * Generate 6-Digit PIN
 * POST /api/v1/attendance/sessions/:id/pin
 */
router.post('/sessions/:id/pin', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const result = await attendanceService.generatePin(req.params.id);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Generate Dynamic QR Code Token
 * POST /api/v1/attendance/sessions/:id/qr
 */
router.post('/sessions/:id/qr', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const result = await attendanceService.generateQr(req.params.id);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Student Submit Soft Self-Attendance
 * POST /api/v1/attendance/sessions/:id/self-attendance
 */
router.post('/sessions/:id/self-attendance', auth, requireRole('STUDENT'), async (req, res) => {
  try {
    const result = await attendanceService.submitSelfAttendance(
      req.params.id,
      req.user.student_id,
      req.body
    );
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message }
    });
  }
});

/**
 * Teacher Get Self-Attendance Requests
 * GET /api/v1/attendance/sessions/:id/self-attendance
 */
router.get('/sessions/:id/self-attendance', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const requests = await attendanceService.getSelfAttendanceRequests(req.params.id);
    res.status(200).json({ success: true, data: requests });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Teacher Adjudicate Self-Attendance Request
 * POST /api/v1/attendance/sessions/:id/self-attendance/:reqId/adjudicate
 */
router.post(
  '/sessions/:id/self-attendance/:reqId/adjudicate',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('action').isIn(['ACCEPT', 'REJECT']).withMessage("Action must be 'ACCEPT' or 'REJECT'"),
    validate
  ],
  async (req, res) => {
    try {
      const teacherId = req.user.teacher_id;
      if (!teacherId && !req.user.roles.includes('SYSTEM_ADMIN')) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Teacher profile required' } });
      }
      const result = await attendanceService.adjudicateSelfAttendance(
        req.params.id,
        req.params.reqId,
        req.body.action,
        teacherId || req.user.id
      );
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }
);

/**
 * 1-Click Synchronize Raw ESP32 Scans into Official Register
 * POST /api/v1/attendance/sessions/:id/sync-esp32
 */
router.post('/sessions/:id/sync-esp32', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const teacherId = req.user.teacher_id;
    if (!teacherId && !req.user.roles.includes('SYSTEM_ADMIN')) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Teacher profile required' } });
    }
    const result = await attendanceService.syncEsp32Scans(req.params.id, teacherId || req.user.id);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message }
    });
  }
});

/**
 * Bulk Save Official Register Marking (Stream 2)
 * POST /api/v1/attendance/sessions/:id/records
 */
router.post(
  '/sessions/:id/records',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('records').isArray({ min: 1 }).withMessage('Records array required'),
    validate
  ],
  async (req, res) => {
    try {
      const teacherId = req.user.teacher_id;
      if (!teacherId && !req.user.roles.includes('SYSTEM_ADMIN')) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Teacher profile required' } });
      }
      const result = await attendanceService.saveRegisterRecords(
        req.params.id,
        req.body.records,
        teacherId || req.user.id
      );
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }
);

/**
 * Get ESP32 scans strictly for a specific date for a register's cohort
 * GET /api/v1/attendance/registers/:id/esp32-day-scans?date=YYYY-MM-DD
 */
router.get('/registers/:id/esp32-day-scans', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const registerId = req.params.id;
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    // 1. Fetch register details
    const regRows = await query(`SELECT * FROM attendance_registers WHERE id = ?`, [registerId]);
    if (!regRows.length) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Register not found' } });
    }
    const reg = regRows[0];

    // 2. Fetch associated device for this cohort/department
    let device = null;
    let devRows = [];
    if (reg.department_id) {
      devRows = await query(
        `SELECT id, device_uid, name, department_id, year, semester, is_active, last_heartbeat_at
         FROM devices 
         WHERE department_id = ? AND is_active = 1
         ORDER BY (year = ? AND semester = ?) DESC, id ASC LIMIT 1`,
        [reg.department_id, reg.year || 0, reg.semester || 0]
      );
    }
    if (!devRows.length) {
      devRows = await query(`SELECT id, device_uid, name, is_active, last_heartbeat_at FROM devices WHERE is_active = 1 LIMIT 1`);
    }

    if (devRows.length) {
      const d = devRows[0];
      const hbStr = d.last_heartbeat_at ? (d.last_heartbeat_at.includes('Z') ? d.last_heartbeat_at : (d.last_heartbeat_at.replace(' ', 'T') + 'Z')) : null;
      const isOnline = d.is_active && hbStr && (Math.abs(Date.now() - new Date(hbStr).getTime()) < 120 * 60 * 1000);
      device = {
        id: d.id,
        device_uid: d.device_uid,
        name: d.name,
        is_online: Boolean(isOnline),
        last_heartbeat_at: d.last_heartbeat_at
      };
    }

    // 3. Query esp32_presence strictly for this date and enrolled students of this cohort / group
    let scans = [];
    if (reg.group_id) {
      scans = await query(
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
      scans = await query(
        `SELECT ep.id as scan_id, ep.scan_time, ep.device_id,
                s.id as student_id, s.full_name, s.official_enrollment_no, s.registration_no,
                COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no,
                d.name as device_name
         FROM esp32_presence ep
         JOIN students s ON ep.student_id = s.id
         JOIN enrollments e ON e.student_id = s.id 
              AND e.department_id = ? AND e.year = ? AND e.semester = ? AND e.academic_year_id = ? AND e.status = 'ENROLLED'
         LEFT JOIN devices d ON ep.device_id = d.id
         WHERE DATE(ep.scan_time) = ?
         GROUP BY s.id
         ORDER BY COALESCE(s.class_roll_no, e.class_roll_no) ASC`,
        [reg.department_id, reg.year, reg.semester, reg.academic_year_id, date]
      );
    } else {
      scans = await query(
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

    res.json({
      success: true,
      data: {
        register_id: Number(registerId),
        date,
        device,
        scans: scans.map(s => ({
          student_id: s.student_id,
          scan_id: s.scan_id,
          class_roll_no: s.class_roll_no,
          full_name: s.full_name,
          official_enrollment_no: s.official_enrollment_no,
          scan_time: s.scan_time,
          device_name: s.device_name || device?.name || 'ESP32 Terminal'
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Confirm and save attendance for a specific day from ESP32 scans into the register
 * POST /api/v1/attendance/registers/:id/confirm-day-attendance
 * Body: { date: 'YYYY-MM-DD', session_type: 'THEORY', student_ids: [1, 2, ...] }
 */
router.post('/registers/:id/confirm-day-attendance', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const registerId = req.params.id;
    const { date, session_type, student_ids = [] } = req.body;

    if (!date) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'date is required (YYYY-MM-DD)' } });
    }

    // 1. Fetch register
    const regRows = await query(`SELECT * FROM attendance_registers WHERE id = ?`, [registerId]);
    if (!regRows.length) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Register not found' } });
    }
    const reg = regRows[0];
    const teacherId = req.user.teacher_id || reg.teacher_id;

    // 2. Find or create session for that day
    let sessionRows = await query(
      `SELECT * FROM attendance_sessions WHERE register_id = ? AND session_date = ? LIMIT 1`,
      [registerId, date]
    );
    let session;

    if (sessionRows.length) {
      session = sessionRows[0];
    } else {
      const sessCnt = (await query(`SELECT COUNT(*) as cnt FROM attendance_sessions WHERE register_id = ?`, [registerId]))[0]?.cnt || 0;
      const sType = session_type || reg.session_type_scope || 'THEORY';
      const label = `Class ${sessCnt + 1}`;
      const insRes = await query(
        `INSERT INTO attendance_sessions
         (register_id, teacher_id, subject_id, department_id, year, semester, academic_year_id, session_type, label, session_date, start_time, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FINALIZED')`,
        [registerId, teacherId, reg.subject_id, reg.department_id, reg.year, reg.semester, reg.academic_year_id, sType, label, date, `${date} 09:00:00`]
      );
      const sessId = insRes[0]?.insertId ?? insRes.lastInsertRowid;
      session = (await query(`SELECT * FROM attendance_sessions WHERE id = ?`, [sessId]))[0];
    }

    // 3. Ensure roster snapshot exists in attendance_session_students
    let enrolled = [];
    if (reg.group_id) {
      enrolled = await query(
        `SELECT s.id as student_id, e.id as enrollment_id, COALESCE(s.class_roll_no, e.class_roll_no, 0) as class_roll_no
         FROM teaching_group_members tgm
         JOIN students s ON tgm.student_id = s.id
         LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
         WHERE tgm.group_id = ? AND tgm.status = 'ENROLLED'
         ORDER BY COALESCE(s.class_roll_no, e.class_roll_no, 0) ASC`,
        [reg.group_id]
      );
    } else if (reg.department_id) {
      enrolled = await query(
        `SELECT s.id as student_id, e.id as enrollment_id, e.class_roll_no
         FROM enrollments e JOIN students s ON e.student_id = s.id
         WHERE e.department_id = ? AND e.year = ? AND e.semester = ? AND e.academic_year_id = ? AND e.status = 'ENROLLED'
         ORDER BY e.class_roll_no ASC`,
        [reg.department_id, reg.year, reg.semester, reg.academic_year_id]
      );
    }

    for (const st of enrolled) {
      await query(
        `INSERT OR IGNORE INTO attendance_session_students (session_id, student_id, enrollment_id, class_roll_no, included) VALUES (?, ?, ?, ?, 1)`,
        [session.id, st.student_id, st.enrollment_id || 0, st.class_roll_no || 0]
      );
    }

      // 4. Record attendance: confirmed students as PRESENT, unconfirmed as ABSENT
      const confirmedSet = new Set((student_ids || []).map(Number));
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
          [session.id, st.student_id, status, src, req.user.id, isConfirmed ? 'ESP32 Biometric Verified' : 'Marked Absent']
        );
      }

    // Update session state to FINALIZED so it displays in grid & reports
    await query(`UPDATE attendance_sessions SET state = 'FINALIZED', end_time = ? WHERE id = ?`, [`${date} 10:00:00`, session.id]);

    // Audit logs for ESP sync execution and attendance finalization
    try {
      await auditService.logAudit({
        eventType: auditService.AUDIT_EVENTS.ESP_SYNC_EXECUTED,
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'TEACHER',
        targetType: 'attendance_sessions',
        targetId: session.id,
        details: { register_id: registerId, session_date: date, confirmed_count: student_ids.length },
        ipAddress: req.ip
      });

      await auditService.logAudit({
        eventType: auditService.AUDIT_EVENTS.ATTENDANCE_FINALIZED,
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'TEACHER',
        targetType: 'attendance_sessions',
        targetId: session.id,
        details: { register_id: registerId, session_date: date },
        ipAddress: req.ip
      });
    } catch (_) {}

    res.json({
      success: true,
      message: `Successfully confirmed attendance for ${student_ids.length} students on ${date}`,
      data: {
        session_id: session.id,
        register_id: Number(registerId),
        session_date: date,
        confirmed_count: student_ids.length
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Post-Finalization Attendance Correction (redesign.md Section 43)
 * POST /api/v1/attendance/sessions/:id/correct
 */
router.post(
  '/sessions/:id/correct',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('student_id').isInt().withMessage('Valid student ID required'),
    body('new_status').isIn(['PRESENT', 'ABSENT', 'LATE']).withMessage('Status must be PRESENT, ABSENT, or LATE'),
    body('reason').trim().isLength({ min: 3 }).withMessage('A descriptive reason (min 3 characters) is required'),
    validate
  ],
  async (req, res) => {
    try {
      const sessionId = req.params.id;
      const { student_id, new_status, reason } = req.body;

      // Check teacher authorization for this session
      if (!req.user.roles.includes('SYSTEM_ADMIN')) {
        const sessRows = await query(
          `SELECT s.teacher_id, s.department_id, d.hod_user_id 
           FROM attendance_sessions s
           LEFT JOIN departments d ON s.department_id = d.id
           WHERE s.id = ?`,
          [sessionId]
        );
        if (!sessRows.length) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Attendance session not found' } });
        }
        const s = sessRows[0];
        const isOwner = req.user.teacher_id && s.teacher_id === req.user.teacher_id;
        const isHod = s.hod_user_id === req.user.id;

        if (!isOwner && !isHod) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Only the session teacher, department HOD, or Administrator can correct attendance.' }
          });
        }
      }

      const result = await attendanceService.correctAttendanceRecord(
        sessionId,
        student_id,
        new_status,
        reason,
        req.user.id
      );

      res.status(200).json({
        success: true,
        data: result,
        message: 'Attendance record successfully corrected and audited.'
      });
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({
        success: false,
        error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }
);

/**
 * Get Correction History for a Session
 * GET /api/v1/attendance/sessions/:id/corrections
 */
router.get(
  '/sessions/:id/corrections',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  async (req, res) => {
    try {
      const history = await attendanceService.getSessionCorrections(req.params.id);
      res.status(200).json({ success: true, data: history });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

module.exports = router;
