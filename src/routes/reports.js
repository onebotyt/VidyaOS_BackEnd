/**
 * Reporting & Analytics Routes (/api/v1/reports/*)
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { query } = require('../config/db');
const reportService = require('../services/reportService');
const defaulterService = require('../services/defaulterService');
const parentGatewayService = require('../services/parentGatewayService');

router.use(auth, requireRole('TEACHER', 'FACULTY', 'HOD', 'SYSTEM_ADMIN'));

/**
 * Faculty Attendance Analytics Dashboard
 * One simple call that powers the whole analytics screen:
 * per-class attendance %, a day-by-day trend, and a defaulter count.
 * GET /api/v1/reports/analytics
 */
router.get('/analytics', async (req, res) => {
  try {
    const teacherId = req.user.teacher_id;
    if (!teacherId) return res.json({ success: true, data: { classes: [], trend: [], defaulter_count: 0 } });

    const classes = await query(
      `SELECT r.id as register_id,
              COALESCE(tg.id, r.id) as class_id,
              COALESCE(tg.subject_name, sub.name, r.name) as subject_name,
              COUNT(DISTINCT s.id) as sessions_conducted,
              SUM(CASE WHEN ra.attendance_status IN ('PRESENT','LATE') THEN 1 ELSE 0 END) as attended_marks,
              SUM(CASE WHEN ra.attendance_status IS NOT NULL THEN 1 ELSE 0 END) as total_marks
       FROM attendance_registers r
       LEFT JOIN teaching_groups tg ON tg.id = r.group_id
       LEFT JOIN subjects sub ON sub.id = r.subject_id
       JOIN attendance_sessions s ON s.register_id = r.id AND s.state = 'FINALIZED'
       LEFT JOIN register_attendance ra ON ra.session_id = s.id
       WHERE r.teacher_id = ?
       GROUP BY r.id, tg.id, sub.id
       ORDER BY subject_name ASC`,
      [teacherId]
    );

    const classSummary = classes.map(c => ({
      class_id: c.class_id,
      register_id: c.register_id,
      subject_id: c.class_id,
      subject_name: c.subject_name,
      sessions_conducted: Number(c.sessions_conducted) || 0,
      attendance_percentage: Number(c.total_marks) > 0
        ? Number(((Number(c.attended_marks) / Number(c.total_marks)) * 100).toFixed(1))
        : 0
    }));

    const trend = await query(
      `SELECT s.session_date,
              SUM(CASE WHEN ra.attendance_status IN ('PRESENT','LATE') THEN 1 ELSE 0 END) as attended_marks,
              SUM(CASE WHEN ra.attendance_status IS NOT NULL THEN 1 ELSE 0 END) as total_marks
       FROM attendance_registers r
       JOIN attendance_sessions s ON s.register_id = r.id AND s.state = 'FINALIZED'
       LEFT JOIN register_attendance ra ON ra.session_id = s.id
       WHERE r.teacher_id = ?
       GROUP BY s.session_date
       ORDER BY s.session_date DESC
       LIMIT 14`,
      [teacherId]
    );

    const trendData = trend.reverse().map(t => ({
      date: t.session_date,
      attendance_percentage: Number(t.total_marks) > 0
        ? Number(((Number(t.attended_marks) / Number(t.total_marks)) * 100).toFixed(1))
        : 0
    }));

    const [defaulterRow] = await query(
      `SELECT COUNT(*) as cnt FROM (
         SELECT ass.student_id,
                SUM(CASE WHEN ra.attendance_status IN ('PRESENT','LATE') THEN 1 ELSE 0 END) as attended,
                COUNT(*) as total
         FROM attendance_registers r
         JOIN attendance_sessions s ON s.register_id = r.id AND s.state = 'FINALIZED'
         JOIN attendance_session_students ass ON ass.session_id = s.id AND ass.included = 1
         LEFT JOIN register_attendance ra ON ra.session_id = s.id AND ra.student_id = ass.student_id
         WHERE r.teacher_id = ?
         GROUP BY ass.student_id
         HAVING total > 0 AND (CAST(attended AS REAL) / total) * 100 < 75
       ) d`,
      [teacherId]
    );

    res.json({
      success: true,
      data: {
        classes: classSummary,
        trend: trendData,
        defaulter_count: defaulterRow?.cnt || 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Official Teacher Register Report
 * GET /api/v1/reports/teacher-register
 */
router.get('/teacher-register', async (req, res) => {
  const effDeptId = req.query.department_id || req.query.branch_id;
  const effBranchId = req.query.branch_id || req.query.department_id;
  const { year, semester, subject_id, academic_year_id } = req.query;

  if (!effDeptId || !year || !semester) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Cohort parameters required' }
    });
  }

  try {
    let subjectFilter = '';
    const params = [effDeptId, year, semester];

    if (subject_id) {
      subjectFilter = 'AND s.subject_id = ?';
      params.push(subject_id);
    }

    // 1. Total finalized sessions conducted for this cohort
    const [sessRows] = await query(
      `SELECT COUNT(DISTINCT s.id) as total_conducted 
       FROM attendance_sessions s 
       WHERE s.department_id = ? AND s.year = ? AND s.semester = ? 
         AND s.state = 'FINALIZED' ${subjectFilter}`,
      params
    );
    const totalConducted = sessRows ? sessRows.total_conducted : 0;

    // 2. Student attendance aggregations
    const reportParams = [effDeptId, year, semester];
    if (subject_id) reportParams.push(subject_id);

    const rows = await query(
      `SELECT 
         st.id as student_id, st.official_enrollment_no, st.full_name, e.class_roll_no,
         COUNT(DISTINCT ass.session_id) as sessions_included,
         SUM(CASE WHEN ra.attendance_status = 'PRESENT' THEN 1 ELSE 0 END) as present_count,
         SUM(CASE WHEN ra.attendance_status = 'LATE' THEN 1 ELSE 0 END) as late_count,
         SUM(CASE WHEN ra.attendance_status = 'ABSENT' THEN 1 ELSE 0 END) as absent_count
       FROM enrollments e
       JOIN students st ON e.student_id = st.id
       JOIN attendance_session_students ass ON ass.student_id = st.id AND ass.included = TRUE
       JOIN attendance_sessions s ON s.id = ass.session_id AND s.state = 'FINALIZED'
       LEFT JOIN register_attendance ra ON ra.session_id = s.id AND ra.student_id = st.id
       WHERE e.department_id = ? AND e.year = ? AND e.semester = ? AND e.status = 'ENROLLED'
         ${subjectFilter}
       GROUP BY st.id, st.official_enrollment_no, st.full_name, e.class_roll_no
       ORDER BY e.class_roll_no ASC`,
      reportParams
    );

    const formatted = rows.map(r => {
      const attended = (Number(r.present_count) || 0) + (Number(r.late_count) || 0);
      const total = Number(r.sessions_included) || totalConducted;
      const pct = total > 0 ? Number(((attended / total) * 100).toFixed(2)) : 100.0;
      return {
        ...r,
        total_attended: attended,
        percentage: pct,
        is_defaulter: pct < 75.0
      };
    });

    res.status(200).json({
      success: true,
      data: {
        total_conducted: totalConducted,
        students: formatted
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Stream Comparison Report (Audit of Discrepancies)
 * GET /api/v1/reports/stream-comparison
 */
router.get('/stream-comparison', async (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'session_id query parameter is required' }
    });
  }

  try {
    const comparison = await reportService.getStreamComparison(sessionId);
    res.status(200).json({ success: true, data: comparison });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Low Attendance Defaulter Report (< 75% or custom threshold)
 * GET /api/v1/reports/low-attendance
 */
router.get('/low-attendance', async (req, res) => {
  const { department_id, branch_id, year, semester, subject_id } = req.query;
  const threshold = parseFloat(req.query.threshold || '75');

  try {
    let where = "WHERE e.status = 'ENROLLED'";
    const params = [];
    const effDept = department_id || branch_id;
    if (effDept) { where += ' AND e.department_id = ?'; params.push(effDept); }
    if (year) { where += ' AND e.year = ?'; params.push(year); }
    if (semester) { where += ' AND e.semester = ?'; params.push(semester); }

    let subjectFilter = '';
    if (subject_id) {
      subjectFilter = 'AND s.subject_id = ?';
      params.push(subject_id);
    }

    const rows = await query(
      `SELECT st.id as student_id, st.official_enrollment_no, st.full_name, e.class_roll_no,
              d.name as department_name, d.name as branch_name, e.year, e.semester,
              COUNT(DISTINCT s.id) as sessions_conducted,
              SUM(CASE WHEN ra.attendance_status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) as attended_count,
              SUM(CASE WHEN ra.attendance_status = 'ABSENT' THEN 1 ELSE 0 END) as absent_count
       FROM enrollments e
       JOIN students st ON e.student_id = st.id
       JOIN departments d ON e.department_id = d.id
       LEFT JOIN attendance_session_students ass ON ass.student_id = st.id AND ass.included = 1
       LEFT JOIN attendance_sessions s ON s.id = ass.session_id AND s.state = 'FINALIZED' ${subjectFilter}
       LEFT JOIN register_attendance ra ON ra.session_id = s.id AND ra.student_id = st.id
       ${where}
       GROUP BY st.id, st.official_enrollment_no, st.full_name, e.class_roll_no, d.name, e.year, e.semester
       ORDER BY e.class_roll_no ASC`,
      params
    );

    const defaulters = rows
      .map(r => {
        const total = Number(r.sessions_conducted) || 0;
        const attended = Number(r.attended_count) || 0;
        const pct = total > 0 ? parseFloat(((attended / total) * 100).toFixed(2)) : 100.0;
        const classesNeeded = pct < threshold && total > 0
          ? Math.ceil((threshold / 100 * total - attended) / (1 - threshold / 100))
          : 0;
        return {
          ...r,
          total_conducted: total,
          total_attended: attended,
          percentage: pct,
          threshold,
          is_defaulter: pct < threshold,
          classes_needed_to_recover: Math.max(0, classesNeeded)
        };
      })
      .filter(r => r.is_defaulter);

    res.json({ success: true, data: defaulters, count: defaulters.length, threshold });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * ESP32 Raw Hardware Presence Scans Log
 * GET /api/v1/reports/esp32-presence
 */
router.get('/esp32-presence', async (req, res) => {
  const { device_id, from_date, to_date, student_id } = req.query;
  const limit = parseInt(req.query.limit, 10) || 50;

  try {
    let where = 'WHERE 1=1';
    const params = [];
    if (device_id) { where += ' AND ep.device_id = ?'; params.push(device_id); }
    if (student_id) { where += ' AND ep.student_id = ?'; params.push(student_id); }
    if (from_date) { where += ' AND ep.scan_time >= ?'; params.push(from_date); }
    if (to_date) { where += ' AND ep.scan_time <= ?'; params.push(to_date); }
    params.push(limit);

    const rows = await query(
      `SELECT ep.*, dev.name as device_name, dev.device_uid,
              s.official_enrollment_no, s.full_name, e.class_roll_no
       FROM esp32_presence ep
       JOIN devices dev ON ep.device_id = dev.id
       JOIN students s ON ep.student_id = s.id
       JOIN enrollments e ON e.student_id = s.id
       ${where}
       ORDER BY ep.scan_time DESC
       LIMIT ?`,
      params
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Self-Attendance Audit & Frequency Log
 * GET /api/v1/reports/self-attendance
 */
router.get('/self-attendance', async (req, res) => {
  const { session_id, student_id } = req.query;
  try {
    let where = 'WHERE 1=1';
    const params = [];
    if (session_id) { where += ' AND ssa.session_id = ?'; params.push(session_id); }
    if (student_id) { where += ' AND ssa.student_id = ?'; params.push(student_id); }

    const rows = await query(
      `SELECT ssa.*, s.official_enrollment_no, s.full_name, e.class_roll_no,
              asess.label as session_label, sub.name as subject_name
       FROM student_self_attendance ssa
       JOIN students s ON ssa.student_id = s.id
       JOIN enrollments e ON e.student_id = s.id
       JOIN attendance_sessions asess ON ssa.session_id = asess.id
       JOIN subjects sub ON asess.subject_id = sub.id
       ${where}
       ORDER BY ssa.request_time DESC
       LIMIT 100`,
      params
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Daily Summary of Conducted Sessions
 * GET /api/v1/reports/daily-summary
 */
router.get('/daily-summary', async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const departmentId = req.query.department_id;

  try {
    let where = 'WHERE asess.session_date = ?';
    const params = [date];
    if (departmentId) { where += ' AND asess.department_id = ?'; params.push(departmentId); }

    const rows = await query(
      `SELECT asess.id, asess.label, asess.session_type, asess.state, asess.session_date,
              COALESCE(tg.subject_name, sub.name, r.name) as subject_name, sub.code as subject_code,
              t.full_name as teacher_name,
              d.name as department_name, d.name as branch_name, asess.year, asess.semester,
              COUNT(ass.id) as total_students,
              SUM(CASE WHEN ra.attendance_status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) as present_count,
              SUM(CASE WHEN ra.attendance_status = 'ABSENT' THEN 1 ELSE 0 END) as absent_count
       FROM attendance_sessions asess
       JOIN attendance_registers r ON asess.register_id = r.id
       LEFT JOIN teaching_groups tg ON r.group_id = tg.id
       LEFT JOIN subjects sub ON asess.subject_id = sub.id
       JOIN teachers t ON asess.teacher_id = t.id
       JOIN departments d ON asess.department_id = d.id
       LEFT JOIN attendance_session_students ass ON ass.session_id = asess.id AND ass.included = 1
       LEFT JOIN register_attendance ra ON ra.session_id = asess.id AND ra.student_id = ass.student_id
       ${where}
       GROUP BY asess.id
       ORDER BY asess.id DESC`,
      params
    );

    res.json({ success: true, data: rows, date });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Full 360° Report for a Single Student
 * GET /api/v1/reports/student/:id
 */
router.get('/student/:id', async (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  try {
    const studentRows = await query(
      `SELECT s.id, s.official_enrollment_no, s.full_name, s.entry_mode,
              e.class_roll_no, e.year, e.semester,
              d.name as department_name, d.name as branch_name, ay.label as academic_year_label
       FROM students s
       JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
       JOIN departments d ON e.department_id = d.id
       JOIN academic_years ay ON e.academic_year_id = ay.id
       WHERE s.id = ?`,
      [studentId]
    );

    if (!studentRows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Student not found' } });

    const [stats, subjectBreakdown, recentHistory] = await Promise.all([
      reportService.getStudentAttendanceStats(studentId),
      reportService.getStudentSubjectBreakdown(studentId),
      reportService.getStudentAttendanceHistory(studentId, { limit: 20 })
    ]);

    res.json({
      success: true,
      data: {
        student: studentRows[0],
        stats,
        subjects: subjectBreakdown,
        recent_sessions: recentHistory
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Teaching Groups Institutional & Cohort Performance Report
 * GET /api/v1/reports/teaching-groups
 */
router.get('/teaching-groups', async (req, res) => {
  try {
    const { group_id, academic_year_id, semester, status } = req.query;
    let where = 'WHERE 1=1';
    const params = [];

    if (!req.user.roles.includes('SYSTEM_ADMIN')) {
      where += ' AND tg.teacher_id = ?';
      params.push(req.user.teacher_id);
    }

    if (group_id) {
      where += ' AND tg.id = ?';
      params.push(Number(group_id));
    }
    if (academic_year_id) {
      where += ' AND tg.academic_year_id = ?';
      params.push(Number(academic_year_id));
    }
    if (semester) {
      where += ' AND tg.semester = ?';
      params.push(Number(semester));
    }
    if (status) {
      where += ' AND tg.status = ?';
      params.push(status);
    }

    const groups = await query(
      `SELECT tg.id, tg.name, tg.subject_name, tg.component, tg.semester, tg.invite_code, tg.status, tg.created_at,
              t.full_name as teacher_name, u.email as teacher_email,
              ay.label as academic_year_label,
              ar.id as linked_register_id,
              (SELECT COUNT(*) FROM teaching_group_members tgm WHERE tgm.group_id = tg.id AND (tgm.status = 'ENROLLED' OR tgm.status = 'ACTIVE')) as student_count,
              (SELECT COUNT(*) FROM assessments a WHERE a.group_id = tg.id AND (a.type = 'ASSIGNMENT' OR a.type IS NULL)) as assignments_count,
              (SELECT COUNT(*) FROM assessments a WHERE a.group_id = tg.id AND a.type = 'EXAM') as tests_count,
              (SELECT COUNT(*) FROM classroom_posts cp WHERE cp.group_id = tg.id) as posts_count,
              (SELECT COUNT(DISTINCT s.id) 
               FROM attendance_sessions s 
               WHERE s.register_id = ar.id AND s.state = 'FINALIZED') as sessions_conducted,
              (SELECT SUM(CASE WHEN ra.attendance_status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END)
               FROM attendance_sessions s
               JOIN register_attendance ra ON ra.session_id = s.id
               WHERE s.register_id = ar.id AND s.state = 'FINALIZED') as attended_marks,
              (SELECT SUM(CASE WHEN ra.attendance_status IS NOT NULL THEN 1 ELSE 0 END)
               FROM attendance_sessions s
               JOIN register_attendance ra ON ra.session_id = s.id
               WHERE s.register_id = ar.id AND s.state = 'FINALIZED') as total_marks
       FROM teaching_groups tg
       JOIN teachers t ON tg.teacher_id = t.id
       LEFT JOIN users u ON t.user_id = u.id
       LEFT JOIN academic_years ay ON tg.academic_year_id = ay.id
       LEFT JOIN attendance_registers ar ON ar.group_id = tg.id
       ${where}
       ORDER BY tg.id DESC`,
      params
    );

    const formatted = groups.map(g => {
      const conducted = Number(g.sessions_conducted) || 0;
      const attended = Number(g.attended_marks) || 0;
      const total = Number(g.total_marks) || 0;
      const avgPct = total > 0 ? Number(((attended / total) * 100).toFixed(1)) : 0;
      return {
        id: g.id,
        group_id: g.id,
        name: g.name,
        subject_name: g.subject_name,
        component: g.component,
        semester: g.semester,
        status: g.status,
        invite_code: g.invite_code,
        teacher_name: g.teacher_name,
        teacher_email: g.teacher_email,
        academic_year_label: g.academic_year_label,
        linked_register_id: g.linked_register_id,
        student_count: Number(g.student_count) || 0,
        assignments_count: Number(g.assignments_count) || 0,
        assignment_count: Number(g.assignments_count) || 0,
        tests_count: Number(g.tests_count) || 0,
        exam_count: Number(g.tests_count) || 0,
        posts_count: Number(g.posts_count) || 0,
        sessions_conducted: conducted,
        average_attendance_percentage: avgPct,
        average_attendance: avgPct
      };
    });

    res.json({ success: true, data: formatted, count: formatted.length });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Comparison Report: IoT Campus Presence Evidence vs. Official Subject Register Attendance
 * Strictly separates raw biometric physical scans from finalized teacher registers.
 * (redesign.md Section 62 & Invariant 20)
 * GET /api/v1/reports/iot-vs-official
 */
router.get('/iot-vs-official', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const { department_id, group_id, student_id } = req.query;

    let studentFilter = 'WHERE 1=1';
    const params = [];

    if (student_id) {
      studentFilter += ' AND s.id = ?';
      params.push(Number(student_id));
    }
    if (department_id) {
      studentFilter += ' AND e.department_id = ?';
      params.push(Number(department_id));
    }
    if (group_id) {
      studentFilter += " AND s.id IN (SELECT student_id FROM teaching_group_members WHERE group_id = ? AND (status = 'ENROLLED' OR status = 'ACTIVE'))";
      params.push(Number(group_id));
    }

    const students = await query(
      `SELECT DISTINCT s.id as student_id, s.full_name, s.official_enrollment_no, COALESCE(e.class_roll_no, s.class_roll_no) as class_roll_no,
              COALESCE(d.name, 'General') as department_name
       FROM students s
       LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
       LEFT JOIN departments d ON e.department_id = d.id
       ${studentFilter}
       ORDER BY COALESCE(e.class_roll_no, s.class_roll_no) ASC, s.full_name ASC`,
      params
    );

    // Fetch raw IoT scans for these students on this date
    const iotScans = await query(
      `SELECT ie.student_id, ie.scan_time, ie.event_type, ie.verification_status,
              COALESCE(dev.name, ie.device_id, 'Campus Gate') as device_name,
              COALESCE(dev.device_uid, ie.device_id) as device_uid
       FROM iot_attendance_events ie
       LEFT JOIN devices dev ON ie.device_id = dev.device_uid OR ie.device_id = dev.id
       WHERE ie.scan_date = ?
       ORDER BY ie.scan_time ASC`,
      [date]
    );

    const iotMap = new Map();
    for (const scan of iotScans) {
      if (!iotMap.has(scan.student_id)) iotMap.set(scan.student_id, []);
      iotMap.get(scan.student_id).push(scan);
    }

    // Fetch finalized register attendance records for these students on this date
    const officialAtt = await query(
      `SELECT ra.student_id, ra.attendance_status, ra.source, ra.marked_at as created_at,
              asess.label as session_label, asess.session_type,
              COALESCE(tg.subject_name, sub.name, r.name) as subject_name,
              t.full_name as teacher_name
       FROM register_attendance ra
       JOIN attendance_sessions asess ON ra.session_id = asess.id
       JOIN attendance_registers r ON asess.register_id = r.id
       LEFT JOIN teaching_groups tg ON r.group_id = tg.id
       LEFT JOIN subjects sub ON asess.subject_id = sub.id
       JOIN teachers t ON asess.teacher_id = t.id
       WHERE asess.session_date = ? AND asess.state = 'FINALIZED'`,
      [date]
    );

    const officialMap = new Map();
    for (const att of officialAtt) {
      if (!officialMap.has(att.student_id)) officialMap.set(att.student_id, []);
      officialMap.get(att.student_id).push(att);
    }

    const comparisonResults = students.map(st => {
      const scans = iotMap.get(st.student_id) || [];
      const records = officialMap.get(st.student_id) || [];

      const iotDetected = scans.length > 0;
      const attendedSessions = records.filter(r => r.attendance_status === 'PRESENT' || r.attendance_status === 'LATE').length;
      const absentSessions = records.filter(r => r.attendance_status === 'ABSENT').length;
      const officialPresent = attendedSessions > 0;

      let status = 'NOT_APPLICABLE';
      if (records.length > 0) {
        if (iotDetected && officialPresent) {
          status = 'MATCH_PRESENT';
        } else if (!iotDetected && !officialPresent) {
          status = 'MATCH_ABSENT';
        } else if (iotDetected && !officialPresent) {
          status = 'DISCREPANCY_IOT_NO_CLASS'; // Detected on campus terminal, marked absent in lecture
        } else if (!iotDetected && officialPresent) {
          status = 'DISCREPANCY_CLASS_NO_IOT'; // In class, but no terminal scan
        }
      } else if (iotDetected) {
        status = 'ON_CAMPUS_NO_SESSION';
      }

      const iotStatus = iotDetected ? 'PRESENT' : 'ABSENT';
      const officialStatus = officialPresent ? 'PRESENT' : (records.length > 0 ? 'ABSENT' : 'NO_CLASS');

      return {
        student_id: st.student_id,
        student_name: st.full_name,
        official_enrollment_no: st.official_enrollment_no,
        class_roll_no: st.class_roll_no,
        department_name: st.department_name,
        student: {
          id: st.student_id,
          full_name: st.full_name,
          official_enrollment_no: st.official_enrollment_no,
          class_roll_no: st.class_roll_no,
          department_name: st.department_name
        },
        iot_status: iotStatus,
        official_status: officialStatus,
        reconciliation_status: status,
        iot_campus_presence: {
          source_type: 'RAW_IOT_EVIDENCE',
          label: 'IoT Campus Biometric Presence (Raw Evidence)',
          detected: iotDetected,
          total_scans: scans.length,
          scans: scans.map(s => ({
            time: s.scan_time,
            device_name: s.device_name,
            device_uid: s.device_uid,
            status: s.verification_status
          }))
        },
        official_subject_attendance: {
          source_type: 'OFFICIAL_ACADEMIC_REGISTER',
          label: 'Official Subject Attendance (Teacher Finalized Ledger)',
          total_sessions: records.length,
          attended_sessions: attendedSessions,
          absent_sessions: absentSessions,
          records: records.map(r => ({
            session: r.session_label,
            subject: r.subject_name,
            type: r.session_type,
            status: r.attendance_status,
            marked_by: r.teacher_name,
            source: r.source
          }))
        }
      };
    });

    res.json({
      success: true,
      data: {
        date,
        invariant_20_compliance: 'Raw IoT events are strictly physical presence evidence; official attendance percentage is computed strictly from finalized registers.',
        total_students: comparisonResults.length,
        summary: {
          match_present: comparisonResults.filter(r => r.reconciliation_status === 'MATCH_PRESENT').length,
          match_absent: comparisonResults.filter(r => r.reconciliation_status === 'MATCH_ABSENT').length,
          discrepancies: comparisonResults.filter(r => r.reconciliation_status.startsWith('DISCREPANCY')).length,
          on_campus_no_session: comparisonResults.filter(r => r.reconciliation_status === 'ON_CAMPUS_NO_SESSION').length
        },
        reconciliation: comparisonResults,
        comparisons: comparisonResults
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Institutional Defaulter & Attendance Warning Report (Sections 44, 45, 62)
 * GET /api/v1/reports/defaulters
 */
router.get('/defaulters', async (req, res) => {
  try {
    const groupId = req.query.group_id ? Number(req.query.group_id) : undefined;
    const departmentId = req.query.department_id ? Number(req.query.department_id) : (req.user.is_hod ? req.user.department_id : undefined);
    const semester = req.query.semester ? Number(req.query.semester) : undefined;
    const academicYearId = req.query.academic_year_id ? Number(req.query.academic_year_id) : undefined;
    const threshold = req.query.threshold ? Number(req.query.threshold) : 75;

    const report = await defaulterService.getDefaulterReport({
      groupId,
      departmentId,
      semester,
      academicYearId,
      threshold
    });

    res.status(200).json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Batch Dispatch Early Warning Attendance Notifications
 * POST /api/v1/reports/defaulters/notify
 */
router.post('/defaulters/notify', auth, async (req, res) => {
  try {
    const studentIds = req.body.studentIds || req.body.student_ids;
    const threshold = req.body.threshold || 75;
    const customMessage = req.body.customMessage || req.body.message;

    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Array of studentIds required' } });
    }

    const result = await defaulterService.sendDefaulterNotifications({
      studentIds,
      threshold: Number(threshold) || 75,
      customMessage,
      actorId: req.user ? req.user.id : 1,
      ipAddress: req.ip
    });

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Export Defaulters Notice Sheet as CSV
 * GET /api/v1/reports/defaulters/export
 */
router.get('/defaulters/export', async (req, res) => {
  try {
    const groupId = req.query.group_id ? Number(req.query.group_id) : undefined;
    const departmentId = req.query.department_id ? Number(req.query.department_id) : undefined;
    const semester = req.query.semester ? Number(req.query.semester) : undefined;
    const threshold = req.query.threshold ? Number(req.query.threshold) : 75;

    const report = await defaulterService.getDefaulterReport({
      groupId,
      departmentId,
      semester,
      threshold
    });

    const csvRows = [
      ['Roll No', 'Enrollment No', 'Student Name', 'Department', 'Semester', 'Conducted', 'Attended', 'Absent', 'Attendance %', 'Status', 'Safe Absences (if >= 75%)', 'Required Classes (to 75%)', 'Shortfall Classes', 'Student Email']
    ];

    report.data.forEach(r => {
      csvRows.push([
        r.class_roll_no || '--',
        `"${r.official_enrollment_no || ''}"`,
        `"${r.student_name}"`,
        `"${r.department_code || r.department_name || ''}"`,
        r.semester,
        r.conducted_sessions,
        r.attended_sessions,
        r.absent_sessions,
        `${r.attendance_percentage}%`,
        r.status,
        r.safe_absences,
        r.required_classes,
        r.shortfall,
        `"${r.student_email || '--'}"`
      ]);
    });

    const csvContent = csvRows.map(row => row.join(',')).join('\r\n');
    const filename = `institutional_defaulters_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Autonomous Parent WhatsApp / SMS Gateway & Critical Defaulter Webhook Escalation
 * POST /api/v1/reports/defaulters/escalate-parents
 */
router.post('/defaulters/escalate-parents', auth, async (req, res) => {
  try {
    const {
      defaulters,
      studentIds,
      channel = 'WHATSAPP',
      templateType = 'ATTENDANCE_CRITICAL',
      customTemplate,
      institutionName,
      criticalOnly = false,
      groupId,
      departmentId,
      semester
    } = req.body;

    let targetList = Array.isArray(defaulters) ? defaulters : [];

    // If studentIds were provided instead of full student objects, resolve them
    if (targetList.length === 0 && Array.isArray(studentIds) && studentIds.length > 0) {
      const report = await defaulterService.getDefaulterReport({
        groupId,
        departmentId: departmentId || (req.user.is_hod ? req.user.department_id : undefined),
        semester,
        threshold: 100
      });
      const idSet = new Set(studentIds.map(Number));
      targetList = (report.data || []).filter(s => idSet.has(s.student_id));

      // Direct DB lookup fallback to guarantee resolution for any student ID
      const resolvedIds = new Set(targetList.map(s => s.student_id));
      const missingIds = studentIds.filter(id => !resolvedIds.has(Number(id)));
      if (missingIds.length > 0) {
        const placeholders = missingIds.map(() => '?').join(',');
        const directStudents = await query(
          `SELECT s.id as student_id, s.user_id, s.full_name as student_name, s.official_enrollment_no,
                  s.phone as student_phone, s.parent_phone, s.parent_name,
                  d.name as department_name, d.code as department_code
           FROM students s
           LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
           LEFT JOIN departments d ON e.department_id = d.id
           WHERE s.id IN (${placeholders})`,
          missingIds
        );
        directStudents.forEach(st => {
          targetList.push({
            ...st,
            attendance_percentage: 0,
            conducted_sessions: 0,
            attended_sessions: 0,
            shortfall: 0
          });
        });
      }
    }

    if (targetList.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'No defaulter students provided for parent escalation' }
      });
    }

    const result = await parentGatewayService.dispatchBatchDefaulterEscalation({
      defaulters: targetList,
      channel,
      templateType,
      customTemplate,
      dispatchedBy: req.user ? req.user.id : null,
      institutionName,
      criticalOnly
    });

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: err.message }
    });
  }
});

/**
 * Defaulter Parent Communication Dispatch History Logs
 * GET /api/v1/reports/defaulters/communication-logs
 */
router.get('/defaulters/communication-logs', auth, async (req, res) => {
  try {
    const studentId = req.query.student_id ? Number(req.query.student_id) : undefined;
    const departmentId = req.query.department_id ? Number(req.query.department_id) : (req.user.is_hod ? req.user.department_id : undefined);
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const result = await parentGatewayService.getCommunicationLogs({
      studentId,
      departmentId,
      limit,
      offset
    });

    const logsArray = result.logs || [];
    res.status(200).json({
      success: true,
      data: logsArray,
      total: result.total,
      logs: logsArray
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: err.message }
    });
  }
});

/**
 * Generate Single Student Direct WhatsApp Click-to-Chat Link (Supports GET and POST)
 * GET/POST /api/v1/reports/defaulters/generate-whatsapp-link
 */
const handleGenerateWhatsAppLink = async (req, res) => {
  try {
    const studentId = req.query.student_id || req.body?.student_id || req.body?.student?.student_id || req.body?.student?.id;
    const templateType = req.query.template_type || req.body?.templateType || req.body?.template_type || 'ATTENDANCE_CRITICAL';
    const customMessage = req.query.message || req.body?.message;

    let student = req.body?.student;
    let targetPhone = req.query.phone || req.body?.phone;

    if (!student && studentId) {
      const studentRows = await query(
        `SELECT s.id as student_id, s.full_name as student_name, s.official_enrollment_no,
                s.phone as student_phone, s.parent_phone, s.parent_name,
                d.name as department_name, d.code as department_code
         FROM students s
         LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
         LEFT JOIN departments d ON e.department_id = d.id
         WHERE s.id = ? LIMIT 1`,
        [studentId]
      );
      if (studentRows && studentRows.length > 0) {
        student = studentRows[0];
        targetPhone = targetPhone || student.parent_phone || student.student_phone;
      }
    } else if (student) {
      targetPhone = targetPhone || student.parent_phone || student.student_phone;
    }

    if (!targetPhone) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Target phone number is required or student has no registered phone' }
      });
    }

    let msg = customMessage;
    if (!msg && student) {
      const tpl = parentGatewayService.DEFAULT_TEMPLATES[templateType] || parentGatewayService.DEFAULT_TEMPLATES.ATTENDANCE_CRITICAL;
      msg = parentGatewayService.formatTemplate(tpl, student);
    } else if (!msg) {
      msg = 'Attendance notice from institution.';
    }

    const whatsappLink = parentGatewayService.generateWhatsAppLink(targetPhone, msg);

    res.status(200).json({
      success: true,
      data: {
        phone: parentGatewayService.normalizePhone(targetPhone),
        message: msg,
        whatsapp_url: whatsappLink,
        whatsapp_link: whatsappLink,
        whatsapp_web_url: whatsappLink
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: err.message }
    });
  }
};

router.get('/defaulters/generate-whatsapp-link', auth, handleGenerateWhatsAppLink);
router.post('/defaulters/generate-whatsapp-link', auth, handleGenerateWhatsAppLink);

module.exports = router;


