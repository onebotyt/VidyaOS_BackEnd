/**
 * Faculty Routes (/api/v1/faculty/*)
 * - Register list (official + personal)
 * - Register detail: grid view (physical register look) + session list
 * - Lazy today-session auto-creation when teacher opens a register
 * - Create personal register
 * - Faculty profile (GET + PUT)
 * - Cohort students roster + biometric status
 * - Pending self-registrations + cohort registration toggle
 */

const express = require('express');
const router = express.Router();
const { body, param, query: qv } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requireClassTeacher, requireDepartmentFaculty } = require('../middleware/requireScope');
const validate = require('../middleware/validate');
const { query, withTransaction } = require('../config/db');
const deviceService = require('../services/deviceService');
const excelExportService = require('../services/excelExportService');
const bcrypt = require('bcrypt');

router.use(auth, requireRole('TEACHER', 'SYSTEM_ADMIN'));

// ─────────────────────────────────────────────────────────
// FACULTY DASHBOARD SUMMARY
// GET /api/v1/faculty/dashboard
// ─────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const teacherId = req.user.teacher_id;
    const today = new Date().toISOString().slice(0, 10);

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

    res.json({ success: true, data: {
      total_registers: myRegisters?.total || 0,
      today_sessions: todaySessions,
      pending_registrations: pendingRegistrations
    }});
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// REGISTER LIST  (all registers for the logged-in teacher)
// GET /api/v1/faculty/registers
// ─────────────────────────────────────────────────────────
router.get('/registers', async (req, res) => {
  try {
    const teacherId = req.user.teacher_id;
    if (!teacherId) {
      // System admin: see all official registers
      const rows = await query(
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
         GROUP BY ar.id ORDER BY ar.created_at DESC`
      );
      return res.json({ success: true, data: rows });
    }

    const rows = await query(
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
       GROUP BY ar.id ORDER BY ar.is_official DESC, ar.created_at DESC`,
      [teacherId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// REGISTER DETAIL — opens register, auto-creates today's session
// GET /api/v1/faculty/registers/:id
// Returns: register info + grid data (students × dates) + session list
// ─────────────────────────────────────────────────────────
router.get('/registers/:id', [param('id').isInt(), validate], async (req, res) => {
  const registerId = req.params.id;
  const teacherId = req.user.teacher_id;

  try {
    // Fetch register
    const regRows = await query(
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
    if (!regRows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Register not found' } });

    const register = regRows[0];

    // Access check: teacher must own this register (SYSTEM_ADMIN or department HOD bypasses)
    const isAdmin = req.user.roles?.includes('SYSTEM_ADMIN');
    const isDeptHod = req.user.is_hod && req.user.hod_department_id === register.department_id;
    if (teacherId && register.teacher_id !== teacherId && !isAdmin && !isDeptHod) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You do not have access to this register' } });
    }

    // ── AUTO-CREATE TODAY'S SESSION (lazy creation) ──
    const today = new Date().toISOString().slice(0, 10);
    const existingToday = await query(
      `SELECT id, state FROM attendance_sessions WHERE register_id = ? AND session_date = ?`,
      [registerId, today]
    );

    if (!existingToday.length && register.is_active) {
      // Auto-create today's DRAFT session
      const sessionLabel = `Class ${await query(`SELECT COUNT(*) as cnt FROM attendance_sessions WHERE register_id = ?`, [registerId]).then(r => (r[0]?.cnt || 0) + 1)}`;
      await query(
        `INSERT INTO attendance_sessions 
         (register_id, teacher_id, subject_id, department_id, year, semester, academic_year_id, session_type, label, session_date, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')`,
        [registerId, register.teacher_id, register.subject_id, register.department_id,
         register.year, register.semester, register.academic_year_id,
         register.session_type_scope === 'PRACTICAL' ? 'PRACTICAL' : 'THEORY',
         sessionLabel, today]
      );
      // Freeze roster snapshot for today's session
      const newSession = (await query(`SELECT id FROM attendance_sessions WHERE register_id = ? AND session_date = ?`, [registerId, today]))[0];
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

    // ── FETCH ALL SESSIONS FOR THIS REGISTER ──
    const sessions = await query(
      `SELECT asess.id, asess.session_date, asess.label, asess.state, asess.session_type,
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
       ORDER BY asess.session_date DESC`,
      [registerId]
    );

    // ── 1. MONTH DISCOVERY & CALENDAR SETUP ──
    const distinctMonths = await query(
      `SELECT DISTINCT substr(session_date, 1, 7) as mo FROM attendance_sessions WHERE register_id = ? ORDER BY mo ASC`,
      [registerId]
    );
    const availableMonths = Array.from(new Set([
      ...distinctMonths.map(m => m.mo),
      new Date().toISOString().slice(0, 7)
    ])).filter(Boolean).sort();

    const targetMonth = req.query.month || (sessions[0]?.session_date ? sessions[0].session_date.slice(0, 7) : new Date().toISOString().slice(0, 7));

    // Standard institutional holidays (English names)
    const standardHolidays = {
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

    const [tYear, tMonth] = targetMonth.split('-').map(Number);
    const daysInMonth = new Date(tYear, tMonth, 0).getDate();
    const monthDays = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = String(d).padStart(2, '0');
      const dateStr = `${targetMonth}-${dayStr}`;
      const dt = new Date(tYear, tMonth - 1, d);
      const dayOfWeek = dt.getDay(); // 0 = Sun, 6 = Sat
      const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek];

      const isSunday = dayOfWeek === 0;
      const isSecondSaturday = dayOfWeek === 6 && d >= 8 && d <= 14;
      const mmdd = `${String(tMonth).padStart(2, '0')}-${dayStr}`;
      const holiday = standardHolidays[mmdd] || null;

      let nonInstructionalLabel = null;
      if (isSunday) nonInstructionalLabel = 'SUNDAY';
      else if (isSecondSaturday) nonInstructionalLabel = 'SECOND SATURDAY';
      else if (holiday) nonInstructionalLabel = holiday;

      monthDays.push({
        day: d,
        date: dateStr,
        day_name: dayName,
        day_of_week: dayOfWeek,
        is_sunday: isSunday,
        is_second_saturday: isSecondSaturday,
        is_holiday: Boolean(nonInstructionalLabel),
        holiday_label: nonInstructionalLabel,
        event_label: null
      });
    }

    // ── 2. FETCH EXAMS & ASSIGNMENTS FOR THIS MONTH'S TIMELINE ──
    const monthExams = register.department_id ? await query(
      `SELECT id, name, exam_date, max_marks FROM exams 
       WHERE (subject_id = ? OR (department_id = ? AND year = ? AND semester = ?))
         AND exam_date LIKE ? ORDER BY exam_date ASC`,
      [register.subject_id, register.department_id, register.year, register.semester, `${targetMonth}%`]
    ) : [];

    const monthAssignments = register.department_id ? await query(
      `SELECT id, title, due_date, max_marks FROM assignments
       WHERE (subject_id = ? OR (department_id = ? AND year = ? AND semester = ?))
         AND due_date LIKE ? ORDER BY due_date ASC`,
      [register.subject_id, register.department_id, register.year, register.semester, `${targetMonth}%`]
    ) : [];

    const academicEvents = [];
    for (const ex of monthExams) {
      const dayObj = monthDays.find(d => d.date === ex.exam_date);
      const label = ex.name.toUpperCase().includes('TEST') || ex.name.toUpperCase().includes('EXAM') ? ex.name.toUpperCase() : `TEST: ${ex.name.toUpperCase()}`;
      if (dayObj) {
        dayObj.event_label = label;
        dayObj.exam_id = ex.id;
      }
      academicEvents.push({ id: ex.id, type: 'EXAM', title: label, date: ex.exam_date, max_marks: ex.max_marks });
    }

    for (const asg of monthAssignments) {
      const asgDate = (asg.due_date || '').slice(0, 10);
      const dayObj = monthDays.find(d => d.date === asgDate);
      const label = asg.title.toUpperCase();
      if (dayObj) {
        dayObj.event_label = dayObj.event_label ? `${dayObj.event_label} / ASSIGNMENT` : label;
        dayObj.assignment_id = asg.id;
      }
      academicEvents.push({ id: asg.id, type: 'ASSIGNMENT', title: label, date: asgDate, max_marks: asg.max_marks });
    }

    // ── 3. ROSTER, MARKS & STATUTORY CUMULATIVE STATS ──
    const allFinalizedSessions = sessions.filter(s => s.state === 'FINALIZED');
    const monthFinalizedSessions = allFinalizedSessions.filter(s => s.session_date.startsWith(targetMonth));
    const prevFinalizedSessions = allFinalizedSessions.filter(s => s.session_date < `${targetMonth}-01`);

    let gridData = [];
    const dailyTotals = {};

    if (register.group_id || register.department_id) {
      let students;
      if (register.group_id) {
        students = await query(
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
      } else {
        students = await query(
          `SELECT st.id as student_id, st.official_enrollment_no, st.registration_no, st.full_name,
                  COALESCE(st.class_roll_no, e.class_roll_no) as class_roll_no,
                  COALESCE(e.status, 'ENROLLED') as enrollment_status
           FROM enrollments e JOIN students st ON e.student_id = st.id
           WHERE e.department_id = ? AND e.year = ? AND e.semester = ? AND e.academic_year_id = ?
           ORDER BY COALESCE(st.class_roll_no, e.class_roll_no) ASC`,
          [register.department_id, register.year, register.semester, register.academic_year_id]
        );
      }

      const threshold = parseFloat(
        (await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'attendance_threshold'`))[0]?.setting_value || '75'
      );

      // Bulk query all attendance marks for this register's finalized sessions
      const attendanceRows = await query(
        `SELECT ra.student_id, ra.attendance_status, s.session_date
         FROM register_attendance ra
         JOIN attendance_sessions s ON s.id = ra.session_id
         WHERE s.register_id = ? AND s.state = 'FINALIZED'`,
        [registerId]
      );

      const studentAttMap = new Map();
      for (const row of attendanceRows) {
        if (!studentAttMap.has(row.student_id)) {
          studentAttMap.set(row.student_id, new Map());
        }
        studentAttMap.get(row.student_id).set(row.session_date, row.attendance_status);
      }

      for (const st of students) {
        const marks = {};
        const datesMap = studentAttMap.get(st.student_id) || new Map();

        let monthAtt = 0, monthAbs = 0;
        for (const sess of monthFinalizedSessions) {
          const status = datesMap.get(sess.session_date);
          if (status) {
            marks[sess.session_date] = status;
            if (status === 'PRESENT' || status === 'LATE') monthAtt++;
            else if (status === 'ABSENT') monthAbs++;
          }
        }

        let prevAtt = 0, prevAbs = 0;
        for (const sess of prevFinalizedSessions) {
          const status = datesMap.get(sess.session_date);
          if (status === 'PRESENT' || status === 'LATE') prevAtt++;
          else if (status === 'ABSENT') prevAbs++;
        }

        const totalAtt = prevAtt + monthAtt;
        const totalAbs = prevAbs + monthAbs;
        const totalSess = totalAtt + totalAbs;
        const pct = totalSess > 0 ? parseFloat(((totalAtt / totalSess) * 100).toFixed(1)) : 100;

        gridData.push({
          student_id: st.student_id,
          class_roll_no: st.class_roll_no,
          registration_no: st.registration_no,
          full_name: st.full_name,
          official_enrollment_no: st.official_enrollment_no,
          enrollment_status: st.enrollment_status,
          attendance_marks: marks,
          month_attended: monthAtt,
          month_absent: monthAbs,
          prev_attended: prevAtt,
          prev_absent: prevAbs,
          total_attended: totalAtt,
          total_absent: totalAbs,
          total_sessions: totalSess,
          percentage: pct,
          is_defaulter: pct < threshold && totalSess > 0
        });
      }

      // Compute daily present & absent summary row
      for (const d of monthDays) {
        let pres = 0, abs = 0, hasData = false;
        for (const st of gridData) {
          const m = st.attendance_marks[d.date];
          if (m === 'PRESENT' || m === 'LATE') { pres++; hasData = true; }
          else if (m === 'ABSENT') { abs++; hasData = true; }
        }
        dailyTotals[d.date] = hasData ? { present: pres, absent: abs } : null;
      }
    }

    res.json({ success: true, data: {
      register,
      sessions,
      grid: {
        dates: allFinalizedSessions.map(s => s.session_date),
        students: gridData,
        month: targetMonth,
        available_months: availableMonths,
        month_days: monthDays,
        daily_totals: dailyTotals,
        academic_events: academicEvents
      }
    }});
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// QUICK DIGITAL PEN CELL MARKING
// PUT /api/v1/faculty/registers/:id/mark-cell
// Body: { date: 'YYYY-MM-DD', student_id: 1, status: 'PRESENT' | 'ABSENT' | 'LATE' | 'CLEAR' }
// ─────────────────────────────────────────────────────────
router.put('/registers/:id/mark-cell', [
  param('id').isInt(),
  body('date').isDate().withMessage('Valid date required (YYYY-MM-DD)'),
  body('student_id').isInt(),
  body('status').isIn(['PRESENT', 'ABSENT', 'LATE', 'CLEAR']),
  validate
], async (req, res) => {
  const registerId = req.params.id;
  const { date, student_id, status } = req.body;
  const teacherId = req.user.teacher_id;

  try {
    const regRows = await query(`SELECT * FROM attendance_registers WHERE id = ?`, [registerId]);
    if (!regRows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Register not found' } });
    const reg = regRows[0];

    const isAdmin = req.user.roles?.includes('SYSTEM_ADMIN');
    const isDeptHod = req.user.is_hod && req.user.hod_department_id === reg.department_id;
    if (teacherId && reg.teacher_id !== teacherId && !isAdmin && !isDeptHod) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    // 1. Find or create finalized session for this date
    let sess = (await query(`SELECT id FROM attendance_sessions WHERE register_id = ? AND session_date = ? LIMIT 1`, [registerId, date]))[0];
    if (!sess) {
      const cnt = (await query(`SELECT COUNT(*) as c FROM attendance_sessions WHERE register_id = ?`, [registerId]))[0]?.c || 0;
      const ins = await query(
        `INSERT INTO attendance_sessions
         (register_id, teacher_id, subject_id, department_id, year, semester, academic_year_id, session_type, label, session_date, start_time, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FINALIZED')`,
        [registerId, reg.teacher_id, reg.subject_id, reg.department_id, reg.year, reg.semester, reg.academic_year_id, reg.session_type_scope || 'THEORY', `Class ${cnt + 1}`, date, `${date} 09:00:00`]
      );
      const sessId = ins[0]?.insertId ?? ins.lastInsertRowid;
      sess = { id: sessId };

      // Snapshot students
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
      // Ensure session is finalized so it shows in ledger
      await query(`UPDATE attendance_sessions SET state = 'FINALIZED' WHERE id = ?`, [sess.id]);
    }

    // 2. Update mark
    if (status === 'CLEAR') {
      await query(`DELETE FROM register_attendance WHERE session_id = ? AND student_id = ?`, [sess.id, student_id]);
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
        [sess.id, student_id, status, req.user.id]
      );
    }

    // 3. Compute new daily counts for this date
    const dailyCounts = (await query(
      `SELECT 
         SUM(CASE WHEN attendance_status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) as present,
         SUM(CASE WHEN attendance_status = 'ABSENT' THEN 1 ELSE 0 END) as absent
       FROM register_attendance WHERE session_id = ?`,
      [sess.id]
    ))[0] || { present: 0, absent: 0 };

    res.json({
      success: true,
      data: {
        date,
        student_id,
        status: status === 'CLEAR' ? null : status,
        daily_totals: { present: dailyCounts.present || 0, absent: dailyCounts.absent || 0 }
      },
      message: 'Attendance mark updated'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// UPDATE STUDENT ENROLLMENT STATUS (e.g. Transferred / Dropped)
// PUT /api/v1/faculty/registers/:id/student-status
// Body: { student_id: 1, status: 'ENROLLED' | 'TRANSFERRED' | 'DROPPED' }
// ─────────────────────────────────────────────────────────
router.put('/registers/:id/student-status', [
  param('id').isInt(),
  body('student_id').isInt(),
  body('status').isIn(['ENROLLED', 'TRANSFERRED', 'DROPPED']),
  validate
], async (req, res) => {
  const registerId = req.params.id;
  const { student_id, status } = req.body;
  const teacherId = req.user.teacher_id;

  try {
    const regRows = await query(`SELECT * FROM attendance_registers WHERE id = ?`, [registerId]);
    if (!regRows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Register not found' } });
    const reg = regRows[0];

    const isAdmin = req.user.roles?.includes('SYSTEM_ADMIN');
    const isDeptHod = req.user.is_hod && req.user.hod_department_id === reg.department_id;
    if (teacherId && reg.teacher_id !== teacherId && !isAdmin && !isDeptHod) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    await query(
      `UPDATE enrollments SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE student_id = ? AND department_id = ? AND year = ? AND semester = ?`,
      [status, student_id, reg.department_id, reg.year, reg.semester]
    );

    res.json({ success: true, message: `Student status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// CREATE PERSONAL REGISTER (teacher's own, not in admin reports)
// POST /api/v1/faculty/registers
// ─────────────────────────────────────────────────────────
router.post('/registers', [
  body('name').trim().notEmpty().withMessage('Register name required'),
  body('subject_id').optional().isInt(),
  body('department_id').optional().isInt(),
  body('year').optional().isInt({ min: 1, max: 3 }),
  body('semester').optional().isInt({ min: 1, max: 6 }),
  body('session_type_scope').optional().isIn(['THEORY', 'PRACTICAL', 'ALL']),
  validate
], async (req, res) => {
  const teacherId = req.user.teacher_id;
  if (!teacherId) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Teacher profile required' } });

  const { name, subject_id, department_id, year, semester, session_type_scope, academic_year_id } = req.body;
  try {
    const ayId = academic_year_id || (await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`))[0]?.id;
    const result = await query(
      `INSERT INTO attendance_registers 
       (teacher_id, name, subject_id, department_id, year, semester, academic_year_id, session_type_scope, is_official)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [teacherId, name, subject_id || null, department_id || null, year || null, semester || null, ayId || null, session_type_scope || 'ALL']
    );
    const id = result[0]?.insertId ?? result.lastInsertRowid;
    res.status(201).json({ success: true, data: { id, name, is_official: 0 }, message: 'Personal register created (not visible to admin)' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// ADD SESSION TO REGISTER FOR A SPECIFIC DATE (manual date pick)
// POST /api/v1/faculty/registers/:id/sessions
// ─────────────────────────────────────────────────────────
router.post('/registers/:id/sessions', [
  param('id').isInt(),
  body('session_date').isDate().withMessage('session_date required (YYYY-MM-DD)'),
  body('label').optional().trim(),
  body('auto_close_minutes').optional().isInt({ min: 5 }),
  validate
], async (req, res) => {
  const registerId = req.params.id;
  const teacherId = req.user.teacher_id;

  try {
    const regRows = await query(`SELECT * FROM attendance_registers WHERE id = ?`, [registerId]);
    if (!regRows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Register not found' } });
    const register = regRows[0];
    if (teacherId && register.teacher_id !== teacherId) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    const existing = await query(
      `SELECT id FROM attendance_sessions WHERE register_id = ? AND session_date = ?`,
      [registerId, req.body.session_date]
    );
    if (existing.length) {
      return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: `A session already exists for ${req.body.session_date} in this register` } });
    }

    const cnt = (await query(`SELECT COUNT(*) as cnt FROM attendance_sessions WHERE register_id = ?`, [registerId]))[0]?.cnt || 0;
    const label = req.body.label || `Class ${cnt + 1}`;
    const autoCloseAt = req.body.auto_close_minutes
      ? new Date(Date.now() + req.body.auto_close_minutes * 60 * 1000).toISOString()
      : null;

    await query(
      `INSERT INTO attendance_sessions 
       (register_id, teacher_id, subject_id, department_id, year, semester, academic_year_id, session_type, label, session_date, auto_close_at, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')`,
      [registerId, register.teacher_id, register.subject_id, register.department_id,
       register.year, register.semester, register.academic_year_id,
       register.session_type_scope === 'PRACTICAL' ? 'PRACTICAL' : 'THEORY',
       label, req.body.session_date, autoCloseAt]
    );

    const newSession = (await query(`SELECT id FROM attendance_sessions WHERE register_id = ? AND session_date = ?`, [registerId, req.body.session_date]))[0];

    // Freeze roster snapshot
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
          `SELECT s.id as student_id, e.id as enrollment_id, e.class_roll_no
           FROM enrollments e JOIN students s ON e.student_id = s.id
           WHERE e.department_id = ? AND e.year = ? AND e.semester = ? AND e.academic_year_id = ? AND e.status = 'ENROLLED'`,
          [register.department_id, register.year, register.semester, register.academic_year_id]
        );
      }
      for (const student of enrolled) {
        await query(
          `INSERT OR IGNORE INTO attendance_session_students (session_id, student_id, enrollment_id, class_roll_no) VALUES (?, ?, ?, ?)`,
          [newSession.id, student.student_id, student.enrollment_id, student.class_roll_no]
        );
      }
    }

    res.status(201).json({ success: true, data: { session_id: newSession?.id, session_date: req.body.session_date, state: 'DRAFT' } });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// COHORT ASSIGNMENTS
// GET /api/v1/faculty/cohorts
// GET /api/v1/faculty/subjects
// ─────────────────────────────────────────────────────────
router.get('/cohorts', async (req, res) => {
  try {
    const teacherId = req.user.teacher_id;
    if (!teacherId) {
      const rows = await query(
        `SELECT DISTINCT d.id as department_id, d.name as department_name, d.code as department_code,
                d.id as branch_id, d.name as branch_name, d.code as branch_code,
                e.year, e.semester, ay.id as academic_year_id, ay.label as academic_year_label
         FROM enrollments e JOIN departments d ON e.department_id = d.id
         JOIN academic_years ay ON e.academic_year_id = ay.id
         WHERE e.status = 'ENROLLED' ORDER BY d.code, e.year, e.semester`
      );
      return res.json({ success: true, data: rows });
    }

    // 1. Explicit teacher assignments
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

    // 2. Department-level cohorts (redesign.md Sections 13, 14, 65 & Invariant 5:
    // Any authorized teacher belonging to a department can access and manage that department's student cohorts)
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

    res.json({ success: true, data: mergedRows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

router.get('/subjects', async (req, res) => {
  try {
    const teacherId = req.user.teacher_id;
    if (!teacherId) {
      const rows = await query(
        `SELECT s.*, d.name as department_name, d.name as branch_name FROM subjects s
         JOIN departments d ON s.department_id = d.id
         WHERE s.is_active = 1 ORDER BY s.code`
      );
      return res.json({ success: true, data: rows });
    }
    const rows = await query(
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
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// Cohort students roster
router.get('/cohorts/students', async (req, res) => {
  const { department_id, branch_id, year, semester, academic_year_id } = req.query;
  const effDeptId = department_id || branch_id;
  if (!effDeptId || !year || !semester) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Cohort parameters required' } });
  }
  try {
    const ayId = academic_year_id || (await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`))[0]?.id;
    const students = await query(
      `SELECT s.id as student_id, s.official_enrollment_no, s.full_name,
              e.id as enrollment_id, e.class_roll_no, e.status as enrollment_status,
              u.email, u.status as user_status
       FROM enrollments e JOIN students s ON e.student_id = s.id JOIN users u ON s.user_id = u.id
       WHERE e.department_id = ? AND e.year = ? AND e.semester = ? AND e.academic_year_id = ? AND e.status = 'ENROLLED'
       ORDER BY e.class_roll_no ASC`,
      [effDeptId, year, semester, ayId]
    );
    res.json({ success: true, data: students });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// Cohort biometric status
router.get('/cohorts/biometrics', async (req, res) => {
  const { department_id, branch_id, year, semester, academic_year_id } = req.query;
  const effDeptId = department_id || branch_id;
  if (!effDeptId || !year || !semester) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Cohort parameters required' } });
  }
  try {
    const ayId = academic_year_id || (await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`))[0]?.id;
    const result = await deviceService.getCohortBiometrics(effDeptId, effDeptId, year, semester, ayId);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// COHORT REGISTRATION TOGGLE & STATUS (Department Faculty)
// POST /api/v1/faculty/cohorts/registration-toggle
// GET  /api/v1/faculty/cohorts/registration-status
// ─────────────────────────────────────────────────────────
router.post('/cohorts/registration-toggle', requireDepartmentFaculty(), [
  body('department_id').optional().isInt(),
  body('branch_id').optional().isInt(),
  body('year').optional().isInt({ min: 1, max: 4 }),
  body('semester').optional().isInt({ min: 1, max: 8 }),
  body('registration_open').optional().isBoolean(),
  body('open').optional().isBoolean(),
  body('department_wide').optional().isBoolean(),
  body('all_cohorts').optional().isBoolean(),
  validate
], async (req, res) => {
  const { department_id, branch_id, year, semester, registration_open, open, academic_year_id, department_wide, all_cohorts } = req.body;
  const effDeptId = department_id || branch_id || req.department_id || req.user?.department_id;
  const isOpen = registration_open !== undefined ? registration_open : open;
  if (isOpen === undefined || !effDeptId) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'department_id and registration_open or open is required' } });
  }

  try {
    const isDeptWide = Boolean(department_wide || all_cohorts);
    const ayId = academic_year_id || (await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`))[0]?.id;

    if (isDeptWide) {
      const branchKey = `cohort_reg_dept_${effDeptId}`;
      await query(
        `INSERT INTO system_settings (setting_key, setting_value, description, updated_by, updated_at)
         VALUES (?, ?, 'Department-Wide Student Self-Registration Open/Closed', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(setting_key)
         DO UPDATE SET setting_value = excluded.setting_value, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
        [branchKey, isOpen ? '1' : '0', req.user.id]
      );

      // Also update or set cohort keys for active cohorts in this department
      const cohorts = await query(
        `SELECT DISTINCT year, semester FROM teacher_assignments WHERE department_id = ? AND is_active = 1
         UNION
         SELECT DISTINCT year, semester FROM enrollments WHERE department_id = ? AND status = 'ENROLLED'`,
        [effDeptId, effDeptId]
      );
      for (const c of cohorts) {
        const cKey = `cohort_reg_${effDeptId}_${effDeptId}_${c.year}_${c.semester}_${ayId}`;
        await query(
          `INSERT INTO system_settings (setting_key, setting_value, description, updated_by, updated_at)
           VALUES (?, ?, 'Cohort Self-Registration Open/Closed', ?, CURRENT_TIMESTAMP)
           ON CONFLICT(setting_key)
           DO UPDATE SET setting_value = excluded.setting_value, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
          [cKey, isOpen ? '1' : '0', req.user.id]
        );
      }

      return res.json({
        success: true,
        message: `Student self-registration is now ${isOpen ? 'OPEN' : 'CLOSED'} for all cohorts in this department`,
        data: { is_open: Boolean(isOpen), department_wide: true, department_id: effDeptId }
      });
    }

    if (!year || !semester) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'year and semester are required for cohort registration toggle' } });
    }

    const settingKey = `cohort_reg_${effDeptId}_${effDeptId}_${year}_${semester}_${ayId}`;
    await query(
      `INSERT INTO system_settings (setting_key, setting_value, description, updated_by, updated_at)
       VALUES (?, ?, 'Cohort Self-Registration Open/Closed', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(setting_key)
       DO UPDATE SET setting_value = excluded.setting_value, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
      [settingKey, isOpen ? '1' : '0', req.user.id]
    );

    if (!isOpen) {
      const branchKey = `cohort_reg_dept_${effDeptId}`;
      await query(
        `UPDATE system_settings SET setting_value = '0', updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?`,
        [branchKey]
      );
    }

    res.json({
      success: true,
      message: `Student self-registration is now ${isOpen ? 'OPEN' : 'CLOSED'} for this cohort`,
      data: { is_open: Boolean(isOpen), setting_key: settingKey, department_id: effDeptId, year, semester }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

router.get('/cohorts/registration-status', requireDepartmentFaculty(), async (req, res) => {
  const { department_id, branch_id, year, semester, academic_year_id } = req.query;
  const effDeptId = department_id || branch_id || req.department_id || req.user?.department_id;
  if (!effDeptId) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'department_id required' } });
  }
  try {
    const ayId = academic_year_id || (await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`))[0]?.id;
    const branchKey = `cohort_reg_dept_${effDeptId}`;
    const branchSetting = await query(`SELECT setting_value FROM system_settings WHERE setting_key = ?`, [branchKey]);
    const isDeptOpen = branchSetting.length > 0 && branchSetting[0].setting_value === '1';

    let isCohortOpen = false;
    let settingKey = branchKey;
    if (year && semester) {
      settingKey = `cohort_reg_${effDeptId}_${effDeptId}_${year}_${semester}_${ayId}`;
      const cohortSetting = await query(`SELECT setting_value FROM system_settings WHERE setting_key = ?`, [settingKey]);
      isCohortOpen = cohortSetting.length > 0 && cohortSetting[0].setting_value === '1';
    }

    const isOpen = isDeptOpen || isCohortOpen;
    res.json({
      success: true,
      data: {
        is_open: isOpen,
        is_dept_open: isDeptOpen,
        is_cohort_open: isCohortOpen,
        setting_key: settingKey,
        department_id: effDeptId
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// FACULTY PROFILE
// GET /api/v1/faculty/profile
// PUT /api/v1/faculty/profile
// ─────────────────────────────────────────────────────────
router.get('/profile', async (req, res) => {
  try {
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
      [req.user.id]
    );
    if (!userRows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Profile not found' } });

    const assignments = req.user.teacher_id ? await query(
      `SELECT ta.id, ta.assignment_type, ta.session_type_scope, d.name as department_name, d.name as branch_name,
              s.name as subject_name, s.code as subject_code, ta.year, ta.semester, ay.label as academic_year_label
       FROM teacher_assignments ta
       JOIN departments d ON ta.department_id = d.id
       JOIN academic_years ay ON ta.academic_year_id = ay.id
       LEFT JOIN subjects s ON ta.subject_id = s.id
       WHERE ta.teacher_id = ? AND ta.is_active = 1 ORDER BY ta.assignment_type, ta.year, ta.semester`,
      [req.user.teacher_id]
    ) : [];

    const registers = req.user.teacher_id ? await query(
      `SELECT ar.id, ar.name, s.code as subject_code, s.name as subject_name, ar.session_type_scope, ar.is_official,
              d.name as department_name, ar.year, ar.semester
       FROM attendance_registers ar
       LEFT JOIN subjects s ON ar.subject_id = s.id
       LEFT JOIN departments d ON ar.department_id = d.id
       WHERE ar.teacher_id = ? AND ar.is_active = 1 ORDER BY ar.year, ar.semester`,
      [req.user.teacher_id]
    ) : [];

    res.json({
      success: true,
      data: {
        ...userRows[0],
        roles: req.user.roles || ['TEACHER'],
        is_hod: Boolean(req.user.is_hod),
        is_class_teacher: Boolean(req.user.is_class_teacher),
        hod_department_name: req.user.hod_department_name || null,
        assignments,
        registers
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

router.put('/profile', [
  body('full_name').optional().trim().notEmpty(),
  body('phone').optional().trim(),
  body('email').optional().isEmail().withMessage('Valid email required'),
  body('current_password').optional().trim(),
  body('new_password').optional().isLength({ min: 8 }).withMessage('Password min 8 characters'),
  validate
], async (req, res) => {
  const { full_name, phone, email, current_password, new_password } = req.body;
  try {
    if (full_name !== undefined || phone !== undefined) {
      const sets = [], params = [];
      if (full_name) { sets.push('full_name = ?'); params.push(full_name); }
      if (phone !== undefined) { sets.push('phone = ?'); params.push(phone || null); }
      params.push(req.user.teacher_id);
      if (sets.length && req.user.teacher_id) {
        await query(`UPDATE teachers SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
      }
    }

    if (email !== undefined) {
      const userRow = (await query(`SELECT email FROM users WHERE id = ?`, [req.user.id]))[0];
      if (email.toLowerCase() !== userRow.email.toLowerCase()) {
        // Email changed: clear Google link (must re-link with new email)
        await query(
          `UPDATE users SET email = ?, google_sub = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [email.toLowerCase(), req.user.id]
        );
      }
    }

    if (new_password) {
      if (!current_password) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'current_password required to set new password' } });
      const { changePassword } = require('../services/authService');
      // Re-import won't work (circular), call it inline
      const userRow = (await query(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id]))[0];
      const match = await bcrypt.compare(current_password, userRow.password_hash || '');
      if (!match) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Current password is incorrect' } });
      const newHash = await bcrypt.hash(new_password, 12);
      await query(`UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [newHash, req.user.id]);
    }

    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// MY CLASSES (Simple Mode) — one row per subject the teacher takes,
// with the cohort details needed by Quick Attendance, Assignments,
// Timetable and Marks screens. Built for non-technical, one-tap use.
// GET /api/v1/faculty/my-classes
// ─────────────────────────────────────────────────────────
router.get('/my-classes', async (req, res) => {
  try {
    const teacherId = req.user.teacher_id;
    if (!teacherId) return res.json({ success: true, data: [] });

    const rows = await query(
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

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// INTERNAL EVALUATION / STUDENT PROGRESS MASTER
// GET /api/v1/faculty/registers/:id/internal-evaluation
// ─────────────────────────────────────────────────────────
router.get('/registers/:id/internal-evaluation', [param('id').isInt(), validate], async (req, res) => {
  const registerId = req.params.id;
  const teacherId = req.user.teacher_id;

  try {
    const regRows = await query(
      `SELECT ar.*, s.name as subject_name, s.code as subject_code,
              d.name as department_name, d.code as department_code,
              d.name as branch_name, d.code as branch_code,
              ay.label as academic_year_label
       FROM attendance_registers ar
       LEFT JOIN subjects s ON ar.subject_id = s.id
       LEFT JOIN departments d ON ar.department_id = d.id
       LEFT JOIN academic_years ay ON ar.academic_year_id = ay.id
       WHERE ar.id = ?`,
      [registerId]
    );
    if (!regRows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Register not found' } });
    const register = regRows[0];

    const isAdmin = req.user.roles?.includes('SYSTEM_ADMIN');
    const isDeptHod = req.user.is_hod && req.user.hod_department_id === register.department_id;
    if (teacherId && register.teacher_id !== teacherId && !isAdmin && !isDeptHod) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You do not have access to this register' } });
    }

    // Institution Name
    const setRows = await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'institution_name'`);
    const institutionName = setRows[0]?.setting_value || 'Government Polytechnic Nainital';

    // Enrolled students in this cohort or teaching group
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

    // Fetch all assignments for this register cohort or group
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

    // Fetch all exams for this register cohort or group
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
      let isAbsent = sub.status === 'ABSENT';
      if (sub.feedback && typeof sub.feedback === 'string' && sub.feedback.startsWith('{')) {
        try {
          const parsed = JSON.parse(sub.feedback);
          if (parsed.is_absent !== undefined) isAbsent = Boolean(parsed.is_absent);
        } catch { /* ignore */ }
      }
      const key = `${sub.assessment_id}_${sub.student_id}`;
      examScoreMap[key] = {
        marks: sub.marks_obtained,
        is_absent: isAbsent
      };
    });

    // Fetch attendance stats per student for this register
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

    // Build consolidated roster
    const roster = enrolledStudents.map(st => {
      const aScores = assignments.map(a => {
        const val = assignScoreMap[`${a.id}_${st.student_id}`];
        return val !== undefined && val !== null ? Number(val) : '';
      });

      const eScores = exams.map(ex => {
        const item = examScoreMap[`${ex.id}_${st.student_id}`];
        if (!item) return { marks: '', is_absent: false };
        return {
          marks: item.marks !== null && item.marks !== undefined ? item.marks : '',
          is_absent: item.is_absent
        };
      });

      const attPct = attMap[st.student_id] !== undefined ? attMap[st.student_id] : 85;

      return {
        student_id: st.student_id,
        class_roll_no: st.class_roll_no,
        registration_no: st.registration_no || null,
        official_enrollment_no: st.official_enrollment_no,
        full_name: st.full_name,
        assignment_scores: aScores,
        exam_scores: eScores,
        attendance_percentage: attPct,
        presentation_score: 4
      };
    });

    const currentAyRow = (await query(`SELECT label FROM academic_years WHERE is_current = 1 LIMIT 1`))[0];
    const sessionLabelFromTable = currentAyRow?.label || register.academic_year_label || '2026-27 (Winter)';

    res.json({
      success: true,
      data: {
        register,
        institution_name: institutionName,
        session_label: `Internal Evaluation Sheet ${sessionLabelFromTable}`,
        academic_session: sessionLabelFromTable,
        assignments,
        exams,
        roster
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// EXPORT INTERNAL EVALUATION SHEET TO EXCEL (.xlsx)
// GET /api/v1/faculty/registers/:id/export/internal-evaluation-excel
// ─────────────────────────────────────────────────────────
router.get('/registers/:id/export/internal-evaluation-excel', [param('id').isInt(), validate], async (req, res) => {
  const registerId = req.params.id;

  try {
    const regRows = await query(
      `SELECT ar.*, s.name as subject_name, s.code as subject_code,
              d.name as department_name, d.code as department_code,
              ay.label as academic_year_label
       FROM attendance_registers ar
       LEFT JOIN subjects s ON ar.subject_id = s.id
       LEFT JOIN departments d ON ar.department_id = d.id
       LEFT JOIN academic_years ay ON ar.academic_year_id = ay.id
       WHERE ar.id = ?`,
      [registerId]
    );
    if (!regRows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Register not found' } });
    const register = regRows[0];

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
        `SELECT s.id as student_id, s.official_enrollment_no, s.registration_no, s.full_name,
                COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no
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
    assignSubmissions.forEach(sub => { assignScoreMap[`${sub.assessment_id}_${sub.student_id}`] = sub.marks_obtained; });

    let exams;
    let examSubmissions;
    if (register.group_id) {
      exams = await query(
        `SELECT id, title as name, max_marks
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
        `SELECT id, title as name, max_marks
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
      let isAbsent = sub.status === 'ABSENT';
      if (sub.feedback && typeof sub.feedback === 'string' && sub.feedback.startsWith('{')) {
        try {
          const parsed = JSON.parse(sub.feedback);
          if (parsed.is_absent !== undefined) isAbsent = Boolean(parsed.is_absent);
        } catch { /* ignore */ }
      }
      examScoreMap[`${sub.assessment_id}_${sub.student_id}`] = { marks: sub.marks_obtained, is_absent: isAbsent };
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

    const exportPayload = {
      institution_name: institutionName,
      session_label: `Internal Evaluation Sheet ${register.academic_year_label || '2026-27 (Winter)'}`,
      department_name: register.department_name,
      department_code: register.department_code,
      subject_name: register.subject_name,
      semester: register.semester,
      assignments,
      exams,
      roster
    };

    const buffer = await excelExportService.generateInternalEvaluationExcel(exportPayload);

    const safeSubj = (register.subject_name || 'Subject').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Internal_Evaluation_${safeSubj}_Semester_${register.semester}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// CUSTOM EXPORT INTERNAL EVALUATION SHEET TO EXCEL (.xlsx)
// POST /api/v1/faculty/registers/:id/export/internal-evaluation-excel
// ─────────────────────────────────────────────────────────
router.post('/registers/:id/export/internal-evaluation-excel', [param('id').isInt(), validate], async (req, res) => {
  const registerId = req.params.id;

  try {
    const regRows = await query(
      `SELECT ar.*, s.name as subject_name, d.name as department_name, d.code as department_code,
              ay.label as academic_year_label
       FROM attendance_registers ar
       LEFT JOIN subjects s ON ar.subject_id = s.id
       LEFT JOIN departments d ON ar.department_id = d.id
       LEFT JOIN academic_years ay ON ar.academic_year_id = ay.id
       WHERE ar.id = ?`,
      [registerId]
    );
    const register = regRows[0] || {};

    const setRows = await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'institution_name'`);
    const institutionName = setRows[0]?.setting_value || 'Government Polytechnic Nainital';

    const customData = req.body || {};

    const currentAyRow = (await query(`SELECT label FROM academic_years WHERE is_current = 1 LIMIT 1`))[0];
    const sessionLabelFromTable = currentAyRow?.label || register.academic_year_label || '2026-27 (Winter)';

    const exportPayload = {
      institution_name: customData.institution_name || institutionName,
      session_label: customData.session_label || `Internal Evaluation Sheet ${sessionLabelFromTable}`,
      dept_semester_text: customData.dept_semester_text || null,
      academic_session: sessionLabelFromTable,
      department_name: customData.department_name || register.department_name,
      department_code: customData.department_code || register.department_code,
      subject_name: customData.subject_name || register.subject_name,
      semester: customData.semester || register.semester || 3,
      assignments: customData.assignments || [],
      exams: customData.exams || [],
      custom_columns: customData.custom_columns || [],
      marks_scheme: customData.marks_scheme || customData.scheme || {},
      roster: customData.roster || customData.students || []
    };

    const buffer = await excelExportService.generateInternalEvaluationExcel(exportPayload);

    const safeSubj = (exportPayload.subject_name || 'Subject').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Internal_Evaluation_${safeSubj}_Custom.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// EXPORT ALL UNIT TESTS SUMMARY SHEET TO EXCEL (.xlsx)
// POST /api/v1/faculty/registers/:id/export/unit-tests-summary-excel
// POST /api/v1/faculty/registers/:id/export/all-tests-excel (alias)
// ─────────────────────────────────────────────────────────
router.post(['/registers/:id/export/unit-tests-summary-excel', '/registers/:id/export/all-tests-excel'], [param('id').isInt(), validate], async (req, res) => {
  const registerId = req.params.id;

  try {
    const regRows = await query(
      `SELECT ar.*, s.name as subject_name, d.name as department_name, d.code as department_code,
              ay.label as academic_year_label
       FROM attendance_registers ar
       LEFT JOIN subjects s ON ar.subject_id = s.id
       LEFT JOIN departments d ON ar.department_id = d.id
       LEFT JOIN academic_years ay ON ar.academic_year_id = ay.id
       WHERE ar.id = ?`,
      [registerId]
    );
    const register = regRows[0] || {};

    const setRows = await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'institution_name'`);
    const institutionName = setRows[0]?.setting_value || 'Uttarakhand Government Institute of Polytechnic, Srinagar Garhwal';

    const customData = req.body || {};

    const exportPayload = {
      institution_name: customData.institution_name || institutionName,
      session_label: customData.session_label || `Internal Evaluation Sheet ${register.academic_year_label || '2026 Session'}`,
      department_name: customData.department_name || register.department_name,
      department_code: customData.department_code || register.department_code,
      subject_name: customData.subject_name || register.subject_name,
      year: customData.year || register.year || 3,
      semester: customData.semester || register.semester || 5,
      target_avg_max: customData.target_avg_max || 20,
      exams: customData.exams || [],
      roster: customData.roster || []
    };

    const buffer = await excelExportService.generateUnitTestsSummaryExcel(exportPayload);

    const safeSubj = (exportPayload.subject_name || 'Subject').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Unit_Test_Summary_${safeSubj}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────
// COMMON FACULTY MANAGER ENDPOINTS (redesign.md Sections 10-11 Case B)
// ─────────────────────────────────────────────────────────

function requireCommonFacultyManager() {
  return (req, res, next) => {
    if (req.user.roles.includes('COMMON_FACULTY_MANAGER') || req.user.roles.includes('SYSTEM_ADMIN')) {
      return next();
    }
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'You must be appointed as Common Faculty Manager to access this resource.' }
    });
  };
}

/**
 * GET /api/v1/faculty/common/pending
 * List pending common faculty (no-department) registrations
 */
router.get('/common/pending', requireCommonFacultyManager(), async (req, res) => {
  try {
    const rows = await query(
      `SELECT frr.id, frr.full_name, frr.email, frr.phone, frr.employee_id,
              frr.account_type, frr.created_at
       FROM faculty_registration_requests frr
       WHERE frr.approval_type = 'COMMON_FACULTY_MANAGER' AND frr.status = 'PENDING'
       ORDER BY frr.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/faculty/common/:id/approve
 * Common Faculty Manager approves a no-department faculty member
 */
router.post('/common/:id/approve', requireCommonFacultyManager(), async (req, res) => {
  const reqId = Number(req.params.id);
  try {
    const reqRows = await query(
      `SELECT * FROM faculty_registration_requests WHERE id = ? AND approval_type = 'COMMON_FACULTY_MANAGER' AND status = 'PENDING'`,
      [reqId]
    );
    if (!reqRows || reqRows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pending common faculty registration request not found' } });
    }
    const r = reqRows[0];

    let createdUserId = null;
    let createdTeacherId = null;

    await withTransaction(async (conn) => {
      // 1. Create active user account
      const [uRes] = await conn.execute(
        `INSERT INTO users (username, email, password_hash, must_change_password, status)
         VALUES (?, ?, ?, 0, 'ACTIVE')`,
        [r.email.toLowerCase(), r.email.toLowerCase(), r.password_hash]
      );
      createdUserId = uRes.insertId ?? uRes.lastInsertRowid;

      // 2. Assign TEACHER role
      await conn.execute(`INSERT INTO user_roles (user_id, role) VALUES (?, 'TEACHER')`, [createdUserId]);

      // 3. Create teacher profile with department_id = NULL (Common Faculty)
      const [tRes] = await conn.execute(
        `INSERT INTO teachers (user_id, department_id, employee_id, full_name, phone)
         VALUES (?, NULL, ?, ?, ?)`,
        [createdUserId, r.employee_id || null, r.full_name, r.phone || null]
      );
      createdTeacherId = tRes.insertId ?? tRes.lastInsertRowid;

      // 4. Update request status to APPROVED
      await conn.execute(
        `UPDATE faculty_registration_requests 
         SET status = 'APPROVED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [req.user.id, reqId]
      );

      // 5. Audit log
      await conn.execute(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
         VALUES (?, 'FACULTY_APPROVED', 'teachers', ?, ?, CURRENT_TIMESTAMP)`,
        [req.user.id, String(createdTeacherId), JSON.stringify({ common_faculty: true, email: r.email, approved_from_request: reqId })]
      );
    });

    res.status(200).json({
      success: true,
      message: `Common faculty registration for ${r.full_name} has been approved successfully.`,
      data: {
        request_id: reqId,
        user_id: createdUserId,
        teacher_id: createdTeacherId,
        department_id: null,
        status: 'APPROVED'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/faculty/common/:id/reject
 * Common Faculty Manager rejects a no-department faculty member
 */
router.post('/common/:id/reject', requireCommonFacultyManager(), [
  body('reason').optional().trim(),
  validate
], async (req, res) => {
  const reqId = Number(req.params.id);
  const { reason } = req.body;
  try {
    const reqRows = await query(
      `SELECT * FROM faculty_registration_requests WHERE id = ? AND approval_type = 'COMMON_FACULTY_MANAGER' AND status = 'PENDING'`,
      [reqId]
    );
    if (!reqRows || reqRows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pending common faculty registration request not found' } });
    }

    await query(
      `UPDATE faculty_registration_requests
       SET status = 'REJECTED', rejection_reason = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [reason || 'Rejected by Common Faculty Manager', req.user.id, reqId]
    );

    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
       VALUES (?, 'FACULTY_REJECTED', 'faculty_registration_requests', ?, ?, CURRENT_TIMESTAMP)`,
      [req.user.id, String(reqId), JSON.stringify({ reason: reason || 'Rejected by Common Faculty Manager', email: reqRows[0].email })]
    );

    res.json({ success: true, message: 'Common faculty registration request rejected.' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * GET /api/v1/faculty/common/members
 * List all active common faculty members (department_id IS NULL)
 */
router.get('/common/members', requireCommonFacultyManager(), async (req, res) => {
  try {
    const rows = await query(
      `SELECT t.id as teacher_id, t.full_name, t.employee_id, t.phone,
              u.id as user_id, u.email as gmail, u.created_at,
              (SELECT COUNT(*) FROM teaching_groups tg WHERE tg.teacher_id = t.id AND tg.status = 'ACTIVE') as active_groups_count
       FROM teachers t
       JOIN users u ON t.user_id = u.id
       WHERE t.department_id IS NULL
       ORDER BY t.full_name ASC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;
