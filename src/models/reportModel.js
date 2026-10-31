/**
 * Report Model — Data access layer for analytics, attendance ledgers, and logs.
 */

const { query } = require('../config/db');

class ReportModel {
  /**
   * Retrieves per-class attendance summary for faculty/HOD.
   * 
   * @calledBy ReportController.getAnalytics() (controllers/reportController.js)
   * @route GET /api/v1/reports/analytics (routes/reports.js)
   * @param {Object} opts Filter options { teacherId, isHod, deptId }
   * @returns {Promise<Array<Object>>} Class attendance summaries
   */
  async getAnalyticsClasses({ teacherId, isHod, deptId }) {
    const whereClause = isHod && deptId 
      ? '(r.teacher_id = ? OR r.department_id = ? OR sub.department_id = ?)' 
      : 'r.teacher_id = ?';
    const params = isHod && deptId ? [teacherId || -1, deptId, deptId] : [teacherId];

    const rows = await query(
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
       WHERE ${whereClause}
       GROUP BY r.id, tg.id, sub.id
       ORDER BY subject_name ASC`,
      params
    );

    return rows.map(c => ({
      class_id: c.class_id,
      register_id: c.register_id,
      subject_id: c.class_id,
      subject_name: c.subject_name,
      sessions_conducted: Number(c.sessions_conducted) || 0,
      attendance_percentage: Number(c.total_marks) > 0
        ? Number(((Number(c.attended_marks) / Number(c.total_marks)) * 100).toFixed(1))
        : 0
    }));
  }

  /**
   * Retrieves multi-day attendance trend data.
   * 
   * @calledBy ReportController.getAnalytics() (controllers/reportController.js)
   * @route GET /api/v1/reports/analytics (routes/reports.js)
   * @param {Object} opts { teacherId, isHod, deptId, limit }
   * @returns {Promise<Array<Object>>} Daily attendance percentage points
   */
  async getAnalyticsTrend({ teacherId, isHod, deptId, limit = 14 }) {
    const trendWhere = isHod && deptId
      ? '(r.teacher_id = ? OR r.department_id = ?)'
      : 'r.teacher_id = ?';
    const trendParams = isHod && deptId ? [teacherId || -1, deptId, limit] : [teacherId, limit];

    const rows = await query(
      `SELECT s.session_date,
              SUM(CASE WHEN ra.attendance_status IN ('PRESENT','LATE') THEN 1 ELSE 0 END) as attended_marks,
              SUM(CASE WHEN ra.attendance_status IS NOT NULL THEN 1 ELSE 0 END) as total_marks
       FROM attendance_registers r
       JOIN attendance_sessions s ON s.register_id = r.id AND s.state = 'FINALIZED'
       LEFT JOIN register_attendance ra ON ra.session_id = s.id
       WHERE ${trendWhere}
       GROUP BY s.session_date
       ORDER BY s.session_date DESC
       LIMIT ?`,
      trendParams
    );

    return rows.reverse().map(t => ({
      date: t.session_date,
      attendance_percentage: Number(t.total_marks) > 0
        ? Number(((Number(t.attended_marks) / Number(t.total_marks)) * 100).toFixed(1))
        : 0
    }));
  }

  /**
   * Counts students with cumulative attendance below statutory threshold (75%).
   * 
   * @calledBy ReportController.getAnalytics() (controllers/reportController.js)
   * @route GET /api/v1/reports/analytics (routes/reports.js)
   * @param {Object} opts { teacherId, isHod, deptId, threshold }
   * @returns {Promise<number>} Count of students below threshold
   */
  async getAnalyticsBelowThresholdCount({ teacherId, isHod, deptId, threshold = 75 }) {
    const trendWhere = isHod && deptId
      ? '(r.teacher_id = ? OR r.department_id = ?)'
      : 'r.teacher_id = ?';
    const trendParams = isHod && deptId ? [teacherId || -1, deptId, threshold] : [teacherId, threshold];

    const [row] = await query(
      `SELECT COUNT(*) as cnt FROM (
         SELECT ass.student_id,
                SUM(CASE WHEN ra.attendance_status IN ('PRESENT','LATE') THEN 1 ELSE 0 END) as attended,
                COUNT(*) as total
         FROM attendance_registers r
         JOIN attendance_sessions s ON s.register_id = r.id AND s.state = 'FINALIZED'
         JOIN attendance_session_students ass ON ass.session_id = s.id AND ass.included = 1
         LEFT JOIN register_attendance ra ON ra.session_id = s.id AND ra.student_id = ass.student_id
         WHERE ${trendWhere}
         GROUP BY ass.student_id
         HAVING total > 0 AND ((attended * 100.0) / total) < ?
       ) d`,
      trendParams
    );

    return row?.cnt || 0;
  }

  /**
   * Retrieves official Teacher Register ledger data (sessions conducted & student roster).
   * 
   * @calledBy ReportController.getTeacherRegister() (controllers/reportController.js)
   * @route GET /api/v1/reports/teacher-register (routes/reports.js)
   * @param {Object} opts { departmentId, year, semester, subjectId }
   * @returns {Promise<{totalConducted: number, students: Array<Object>}>}
   */
  async getTeacherRegisterData({ departmentId, year, semester, subjectId }) {
    let subjectFilter = '';
    const sessParams = [departmentId, year, semester];
    if (subjectId) {
      subjectFilter = 'AND s.subject_id = ?';
      sessParams.push(subjectId);
    }

    const [sessRows] = await query(
      `SELECT COUNT(DISTINCT s.id) as total_conducted 
       FROM attendance_sessions s 
       WHERE s.department_id = ? AND s.year = ? AND s.semester = ? 
         AND s.state = 'FINALIZED' ${subjectFilter}`,
      sessParams
    );
    const totalConducted = sessRows ? sessRows.total_conducted : 0;

    const reportParams = [departmentId, year, semester];
    if (subjectId) reportParams.push(subjectId);

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

    const students = rows.map(r => {
      const attended = (Number(r.present_count) || 0) + (Number(r.late_count) || 0);
      const total = Number(r.sessions_included) || totalConducted;
      const pct = total > 0 ? Number(((attended / total) * 100).toFixed(2)) : 100.0;
      return {
        ...r,
        total_attended: attended,
        percentage: pct,
        below_threshold: pct < 75.0
      };
    });

    return { totalConducted, students };
  }

  /**
   * Retrieves raw hardware presence scan events recorded by ESP32 biometric kiosks.
   * 
   * @calledBy ReportController.getEsp32Presence() (controllers/reportController.js)
   * @route GET /api/v1/reports/esp32-presence (routes/reports.js)
   * @param {Object} opts { deviceId, studentId, fromDate, toDate, limit }
   * @returns {Promise<Array<Object>>} Raw presence scan events
   */
  async getEsp32PresenceLogs({ deviceId, studentId, fromDate, toDate, limit = 50 }) {
    let where = 'WHERE 1=1';
    const params = [];
    if (deviceId) { where += ' AND ep.device_id = ?'; params.push(deviceId); }
    if (studentId) { where += ' AND ep.student_id = ?'; params.push(studentId); }
    if (fromDate) { where += ' AND ep.scan_time >= ?'; params.push(fromDate); }
    if (toDate) { where += ' AND ep.scan_time <= ?'; params.push(toDate); }
    params.push(limit);

    return await query(
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
  }

  /**
   * Retrieves student self-attendance claims and adjudication audit logs.
   * 
   * @calledBy ReportController.getSelfAttendance() (controllers/reportController.js)
   * @route GET /api/v1/reports/self-attendance (routes/reports.js)
   * @param {Object} opts { sessionId, studentId, limit }
   * @returns {Promise<Array<Object>>}
   */
  async getSelfAttendanceLogs({ sessionId, studentId, limit = 100 }) {
    let where = 'WHERE 1=1';
    const params = [];
    if (sessionId) { where += ' AND ssa.session_id = ?'; params.push(sessionId); }
    if (studentId) { where += ' AND ssa.student_id = ?'; params.push(studentId); }
    params.push(limit);

    return await query(
      `SELECT ssa.*, s.official_enrollment_no, s.full_name, e.class_roll_no,
              asess.label as session_label, sub.name as subject_name
       FROM student_self_attendance ssa
       JOIN students s ON ssa.student_id = s.id
       JOIN enrollments e ON e.student_id = s.id
       JOIN attendance_sessions asess ON ssa.session_id = asess.id
       JOIN subjects sub ON asess.subject_id = sub.id
       ${where}
       ORDER BY ssa.request_time DESC
       LIMIT ?`,
      params
    );
  }

  /**
   * Retrieves daily summary of conducted attendance sessions across branches.
   * 
   * @calledBy ReportController.getDailySummary() (controllers/reportController.js)
   * @route GET /api/v1/reports/daily-summary (routes/reports.js)
   * @param {Object} opts { date, departmentId }
   * @returns {Promise<Array<Object>>}
   */
  async getDailySessionsSummary({ date, departmentId }) {
    let where = 'WHERE asess.session_date = ?';
    const params = [date];
    if (departmentId) { where += ' AND asess.department_id = ?'; params.push(departmentId); }

    return await query(
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
  }

  /**
   * Retrieves 360-degree student academic profile and active cohort enrollment.
   * 
   * @calledBy ReportController.getStudentReport() (controllers/reportController.js)
   * @route GET /api/v1/reports/student/:id (routes/reports.js)
   * @param {number} studentId
   * @returns {Promise<Object|null>}
   */
  async getStudentProfile(studentId) {
    const rows = await query(
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
    return rows[0] || null;
  }

  /**
   * Retrieves institutional performance analytics for teaching groups.
   * 
   * @calledBy ReportController.getTeachingGroupsReport() (controllers/reportController.js)
   * @route GET /api/v1/reports/teaching-groups (routes/reports.js)
   * @param {Object} opts { isSystemAdmin, teacherId, groupId, academicYearId, semester, status }
   * @returns {Promise<Array<Object>>}
   */
  async getTeachingGroupsReport({ isSystemAdmin, teacherId, groupId, academicYearId, semester, status }) {
    let where = 'WHERE 1=1';
    const params = [];

    if (!isSystemAdmin) {
      where += ' AND tg.teacher_id = ?';
      params.push(teacherId);
    }
    if (groupId) {
      where += ' AND tg.id = ?';
      params.push(Number(groupId));
    }
    if (academicYearId) {
      where += ' AND tg.academic_year_id = ?';
      params.push(Number(academicYearId));
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

    return groups.map(g => {
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
  }

  /**
   * Reconciles IoT biometric kiosk touches against official finalized class attendance ledgers.
   * 
   * @calledBy ReportController.getIotVsOfficialComparison() (controllers/reportController.js)
   * @route GET /api/v1/reports/iot-vs-official (routes/reports.js)
   * @param {Object} opts { date, departmentId, groupId, studentId }
   * @returns {Promise<Array<Object>>} Reconciled comparison entries
   */
  async getIotVsOfficialComparisonData({ date, departmentId, groupId, studentId }) {
    let studentFilter = 'WHERE 1=1';
    const params = [];

    if (studentId) {
      studentFilter += ' AND s.id = ?';
      params.push(Number(studentId));
    }
    if (departmentId) {
      studentFilter += ' AND e.department_id = ?';
      params.push(Number(departmentId));
    }
    if (groupId) {
      studentFilter += " AND s.id IN (SELECT student_id FROM teaching_group_members WHERE group_id = ? AND (status = 'ENROLLED' OR status = 'ACTIVE'))";
      params.push(Number(groupId));
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

    return students.map(st => {
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
          status = 'DISCREPANCY_IOT_NO_CLASS';
        } else if (!iotDetected && officialPresent) {
          status = 'DISCREPANCY_CLASS_NO_IOT';
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
  }
}

module.exports = new ReportModel();
