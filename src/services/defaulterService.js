/**
 * Institutional Defaulter & Early Warning Notice Service
 * Sections 44, 45, 62 of redesign.md
 */

const { query } = require('../config/db');
const notificationService = require('./notificationService');
const auditService = require('./auditService');
const logger = require('../utils/logger');

/**
 * Calculate attendance metrics and early warning status for students
 * @param {Object} params
 * @param {number} [params.groupId] - Scoped Teaching Group ID
 * @param {number} [params.departmentId] - Scoped Department ID
 * @param {number} [params.semester] - Semester filter
 * @param {number} [params.academicYearId] - Academic Year filter
 * @param {number} [params.threshold=75] - Defaulter percentage threshold
 */
async function getDefaulterReport({ groupId, departmentId, semester, academicYearId, threshold = 75 } = {}) {
  const cutoff = Number(threshold) || 75;

  let students = [];

  if (groupId) {
    // Teaching Group Scoped Defaulters
    const groupSql = `
      SELECT s.id as student_id, s.user_id, s.full_name as student_name, s.official_enrollment_no,
             s.phone as student_phone, s.parent_phone, s.parent_name,
             u.email as student_email,
             d.name as department_name, d.code as department_code,
             tg.name as group_name, tg.subject_name, tg.semester as group_semester,
             COALESCE(SUM(CASE WHEN ra.attendance_status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END), 0) as total_attended,
             COALESCE(SUM(CASE WHEN ra.attendance_status = 'ABSENT' THEN 1 ELSE 0 END), 0) as total_absent,
             COUNT(DISTINCT ats.id) as total_conducted
      FROM teaching_group_members tgm
      JOIN students s ON tgm.student_id = s.id
      JOIN users u ON s.user_id = u.id
      JOIN teaching_groups tg ON tgm.group_id = tg.id
      LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
      LEFT JOIN departments d ON e.department_id = d.id
      LEFT JOIN attendance_registers ar ON ar.group_id = tg.id
      LEFT JOIN attendance_sessions ats ON ats.register_id = ar.id AND ats.state = 'FINALIZED'
      LEFT JOIN register_attendance ra ON ra.session_id = ats.id AND ra.student_id = s.id
      WHERE tgm.group_id = ? AND tgm.status = 'ENROLLED'
      GROUP BY s.id, s.user_id, s.full_name, s.official_enrollment_no, s.phone, s.parent_phone, s.parent_name, u.email, d.name, d.code, tg.name, tg.subject_name, tg.semester
    `;
    students = await query(groupSql, [groupId]);
  } else {
    // Department / Institutional Cohort Defaulters
    let whereClauses = [`e.status = 'ENROLLED'`];
    let params = [];

    if (departmentId) {
      whereClauses.push(`e.department_id = ?`);
      params.push(departmentId);
    }
    if (semester) {
      whereClauses.push(`e.semester = ?`);
      params.push(semester);
    }
    if (academicYearId) {
      whereClauses.push(`e.academic_year_id = ?`);
      params.push(academicYearId);
    }

    const deptSql = `
      SELECT s.id as student_id, s.user_id, s.full_name as student_name, s.official_enrollment_no,
             s.phone as student_phone, s.parent_phone, s.parent_name,
             u.email as student_email,
             d.name as department_name, d.code as department_code,
             e.semester as cohort_semester, e.class_roll_no,
             COALESCE(SUM(CASE WHEN ra.attendance_status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END), 0) as total_attended,
             COALESCE(SUM(CASE WHEN ra.attendance_status = 'ABSENT' THEN 1 ELSE 0 END), 0) as total_absent,
             COUNT(DISTINCT ats.id) as total_conducted
      FROM enrollments e
      JOIN students s ON e.student_id = s.id
      JOIN users u ON s.user_id = u.id
      JOIN departments d ON e.department_id = d.id
      LEFT JOIN attendance_sessions ats ON ats.department_id = e.department_id AND ats.semester = e.semester AND ats.state = 'FINALIZED'
      LEFT JOIN register_attendance ra ON ra.session_id = ats.id AND ra.student_id = s.id
      WHERE ${whereClauses.join(' AND ')}
      GROUP BY s.id, s.user_id, s.full_name, s.official_enrollment_no, s.phone, s.parent_phone, s.parent_name, u.email, d.name, d.code, e.semester, e.class_roll_no
    `;
    students = await query(deptSql, params);
  }

  // Compute Defaulter Analytics
  const records = students.map(st => {
    const conducted = Number(st.total_conducted) || 0;
    const attended = Number(st.total_attended) || 0;
    const absent = Number(st.total_absent) || 0;
    const pct = conducted > 0 ? Number(((attended / conducted) * 100).toFixed(1)) : 100.0;

    let status = 'HEALTHY';
    let safeAbsences = 0;
    let requiredClasses = 0;
    let shortfall = 0;

    if (pct < 60) {
      status = 'CRITICAL';
    } else if (pct < cutoff) {
      status = 'WARNING';
    } else {
      status = 'HEALTHY';
    }

    if (status === 'HEALTHY' && conducted > 0) {
      // How many future classes can student miss while keeping percentage >= cutoff?
      safeAbsences = Math.max(0, Math.floor((attended * 100 / cutoff) - conducted));
    } else if (conducted > 0) {
      // How many consecutive classes must student attend to reach cutoff?
      const targetRatio = cutoff / 100;
      const numerator = (targetRatio * conducted) - attended;
      const denominator = 1 - targetRatio;
      requiredClasses = denominator > 0 ? Math.max(0, Math.ceil(numerator / denominator)) : 0;
      shortfall = Math.max(0, Math.ceil((targetRatio * conducted) - attended));
    }

    return {
      student_id: st.student_id,
      user_id: st.user_id,
      student_name: st.student_name,
      official_enrollment_no: st.official_enrollment_no,
      class_roll_no: st.class_roll_no || null,
      student_email: st.student_email || '--',
      student_phone: st.student_phone || null,
      parent_phone: st.parent_phone || null,
      parent_name: st.parent_name || null,
      department_name: st.department_name,
      department_code: st.department_code,
      group_name: st.group_name || null,
      subject_name: st.subject_name || null,
      semester: st.group_semester || st.cohort_semester || 1,
      conducted_sessions: conducted,
      attended_sessions: attended,
      absent_sessions: absent,
      attendance_percentage: pct,
      status, // 'HEALTHY' | 'WARNING' | 'CRITICAL'
      safe_absences: safeAbsences,
      required_classes: requiredClasses,
      shortfall
    };
  });

  // Sort: CRITICAL first, then WARNING, then by attendance_percentage ascending
  records.sort((a, b) => {
    const scoreA = a.status === 'CRITICAL' ? 0 : a.status === 'WARNING' ? 1 : 2;
    const scoreB = b.status === 'CRITICAL' ? 0 : b.status === 'WARNING' ? 1 : 2;
    if (scoreA !== scoreB) return scoreA - scoreB;
    return a.attendance_percentage - b.attendance_percentage;
  });

  const totalStudents = records.length;
  const criticalDefaulters = records.filter(r => r.status === 'CRITICAL').length;
  const warningDefaulters = records.filter(r => r.status === 'WARNING').length;
  const totalDefaulters = criticalDefaulters + warningDefaulters;
  const healthyStudents = totalStudents - totalDefaulters;

  return {
    threshold: cutoff,
    total_students: totalStudents,
    total_defaulters: totalDefaulters,
    critical_defaulters: criticalDefaulters,
    warning_defaulters: warningDefaulters,
    healthy_students: healthyStudents,
    data: records,
    records: records
  };
}

/**
 * Dispatch Early Warning Notifications to Flagged Defaulters
 */
async function sendDefaulterNotifications({ studentIds = [], threshold = 75, customMessage, actorId, ipAddress } = {}) {
  if (!studentIds || studentIds.length === 0) {
    return { success: false, message: 'No students selected for notification.' };
  }

  // Look up user IDs for the students
  const placeholders = studentIds.map(() => '?').join(',');
  const studentRows = await query(
    `SELECT id, user_id, full_name FROM students WHERE id IN (${placeholders})`,
    studentIds
  );

  const userIds = studentRows.map(s => s.user_id).filter(Boolean);
  if (userIds.length === 0) {
    return { success: false, message: 'No active user accounts found for selected students.' };
  }

  const noticeTitle = '⚠️ Institutional Attendance Warning';
  const noticeMsg = customMessage || `Notice: Your current attendance is below the institutional requirement of ${threshold}%. Review your register and attend all upcoming classes to avoid exam debarment.`;

  const notifResult = await notificationService.sendBatchNotification({
    userIds,
    type: notificationService.NOTIFICATION_TYPES.ATTENDANCE_WARNING || 'ATTENDANCE_WARNING',
    title: noticeTitle,
    message: noticeMsg,
    linkUrl: '/student/attendance.html'
  });

  // Log Audit Event
  await auditService.logAudit({
    eventType: auditService.AUDIT_EVENTS.DEFAULTER_NOTICE_DISPATCHED || 'DEFAULTER_NOTICE_DISPATCHED',
    actorId: actorId || 1,
    actorRole: 'FACULTY',
    targetType: 'attendance_reports',
    targetId: studentIds.length,
    details: {
      recipient_count: userIds.length,
      threshold,
      student_ids: studentIds
    },
    ipAddress
  });

  logger.info(`[DEFAULTERS] Dispatched attendance warning notifications to ${userIds.length} students.`);

  return {
    success: true,
    recipients_count: userIds.length,
    notifications_created: notifResult.notifications_created || userIds.length,
    data: {
      recipients_count: userIds.length,
      notifications_created: notifResult.notifications_created || userIds.length
    }
  };
}

/**
 * Calculate list of defaulter student records below specified threshold
 */
async function calculateDefaulterList(params = {}) {
  const report = await getDefaulterReport(params);
  const cutoff = Number(params.threshold) || 75;
  const list = report.data || report.records || [];
  return list.filter(r => cutoff >= 100 ? true : r.attendance_percentage < cutoff);
}

module.exports = {
  getDefaulterReport,
  calculateDefaulterList,
  calculateDefaulters: calculateDefaulterList,
  sendDefaulterNotifications
};
