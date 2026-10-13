/**
 * Attendance Reporting & Predictive Analytics Service
 * Computes official attendance % and 75% threshold deficit/surplus formulas.
 */

const { query } = require('../config/db');

class ReportService {
  /**
   * Get Student Attendance Stats & 75% Predictor
   */
  async getStudentAttendanceStats(studentId, academicYearId = null) {
    // 1. Total finalized sessions where student was included
    let sessionFilter = '';
    const params = [studentId];
    if (academicYearId) {
      sessionFilter = 'AND s.academic_year_id = ?';
      params.push(academicYearId);
    }

    const conductedRows = await query(
      `SELECT COUNT(DISTINCT s.id) as total_conducted
       FROM attendance_sessions s
       JOIN attendance_session_students ass ON ass.session_id = s.id AND ass.student_id = ?
       WHERE s.state = 'FINALIZED' AND ass.included = TRUE ${sessionFilter}`,
      params
    );
    const C = conductedRows[0].total_conducted || 0;

    // 2. Total attended (PRESENT or LATE) in finalized sessions
    const attendedRows = await query(
      `SELECT 
         SUM(CASE WHEN ra.attendance_status = 'PRESENT' THEN 1 ELSE 0 END) as present_count,
         SUM(CASE WHEN ra.attendance_status = 'LATE' THEN 1 ELSE 0 END) as late_count,
         SUM(CASE WHEN ra.attendance_status = 'ABSENT' THEN 1 ELSE 0 END) as absent_count
       FROM register_attendance ra
       JOIN attendance_sessions s ON ra.session_id = s.id
       JOIN attendance_session_students ass ON ass.session_id = s.id AND ass.student_id = ra.student_id
       WHERE ra.student_id = ? 
         AND s.state = 'FINALIZED' 
         AND ass.included = TRUE ${sessionFilter}`,
      params
    );

    const presentCount = Number(attendedRows[0].present_count) || 0;
    const lateCount = Number(attendedRows[0].late_count) || 0;
    const P = presentCount + lateCount;
    const A = Number(attendedRows[0].absent_count) || (C - P);

    const currentPercentage = C > 0 ? Number(((P / C) * 100).toFixed(2)) : 100.0;
    const threshold = 75.0;
    const T = 0.75;

    let prediction = {};
    if (C === 0) {
      prediction = {
        status: 'SAFE',
        safe_absences_remaining: 0,
        classes_needed_to_recover: 0,
        message: 'No finalized sessions conducted yet.'
      };
    } else if (currentPercentage >= threshold) {
      prediction = {
        status: 'SAFE',
        safe_absences_remaining: 0,
        classes_needed_to_recover: 0,
        message: `Attendance satisfies the statutory ${threshold}% institutional requirement.`
      };
    } else {
      prediction = {
        status: 'DEFICIT',
        safe_absences_remaining: 0,
        classes_needed_to_recover: 0,
        message: `Attendance is currently ${currentPercentage}%, below the statutory ${threshold}% requirement.`
      };
    }

    return {
      threshold_percentage: threshold,
      total_conducted: C,
      total_attended: P,
      present_count: presentCount,
      late_count: lateCount,
      total_absent: A,
      current_percentage: currentPercentage,
      prediction
    };
  }

  /**
   * Subject-Wise Attendance Breakdown for Student
   */
  async getStudentSubjectBreakdown(studentId) {
    const rows = await query(
      `SELECT 
         r.group_id as group_id,
         r.id as register_id,
         tg.component as component,
         COALESCE(tg.id, sub.id, r.id) as subject_id,
         COALESCE(tg.subject_name, sub.name, r.name) as subject_name,
         sub.code as subject_code,
         COUNT(DISTINCT s.id) as total_conducted,
         SUM(CASE WHEN ra.attendance_status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) as total_attended,
         SUM(CASE WHEN ra.attendance_status = 'ABSENT' THEN 1 ELSE 0 END) as total_absent
       FROM attendance_sessions s
       JOIN attendance_registers r ON s.register_id = r.id
       LEFT JOIN teaching_groups tg ON r.group_id = tg.id
       LEFT JOIN subjects sub ON s.subject_id = sub.id
       JOIN attendance_session_students ass ON ass.session_id = s.id AND ass.student_id = ? AND ass.included = TRUE
       LEFT JOIN register_attendance ra ON ra.session_id = s.id AND ra.student_id = ?
       WHERE s.state = 'FINALIZED'
       GROUP BY r.id, tg.id, sub.id
       ORDER BY subject_name ASC`,
      [studentId, studentId]
    );

    return rows.map(r => {
      const conducted = Number(r.total_conducted) || 0;
      const attended = Number(r.total_attended) || 0;
      const absent = Number(r.total_absent) || (conducted - attended);
      const pct = conducted > 0 ? Number(((attended / conducted) * 100).toFixed(2)) : 100.0;
      return {
        group_id: r.group_id,
        register_id: r.register_id,
        component: r.component,
        subject_id: r.subject_id,
        subject_name: r.subject_name,
        subject_code: r.subject_code,
        conducted,
        attended,
        absent,
        percentage: pct,
        is_defaulter: pct < 75.0
      };
    });
  }

  /**
   * Student Attendance History Log
   */
  async getStudentAttendanceHistory(studentId, { subjectId, fromDate, toDate, limit = 50 }) {
    let filter = '';
    const params = [studentId];

    if (subjectId) {
      filter += ' AND (s.subject_id = ? OR r.group_id = ? OR r.id = ?)';
      params.push(subjectId, subjectId, subjectId);
    }
    if (fromDate) {
      filter += ' AND s.start_time >= ?';
      params.push(fromDate);
    }
    if (toDate) {
      filter += ' AND s.start_time <= ?';
      params.push(toDate);
    }

    params.push(limit);

    return await query(
      `SELECT s.id as session_id, s.subject_id, s.label, s.session_type, s.start_time,
              COALESCE(tg.subject_name, sub.name, r.name) as subject_name,
              sub.code as subject_code,
              t.full_name as teacher_name,
              ra.attendance_status, ra.source, ra.marked_at
       FROM attendance_sessions s
       JOIN attendance_registers r ON s.register_id = r.id
       LEFT JOIN teaching_groups tg ON r.group_id = tg.id
       LEFT JOIN subjects sub ON s.subject_id = sub.id
       JOIN teachers t ON s.teacher_id = t.id
       JOIN attendance_session_students ass ON ass.session_id = s.id AND ass.student_id = ?
       LEFT JOIN register_attendance ra ON ra.session_id = s.id AND ra.student_id = ass.student_id
       WHERE s.state = 'FINALIZED' ${filter}
       ORDER BY s.start_time DESC
       LIMIT ?`,
      params
    );
  }

  /**
   * Stream Comparison Report (Teacher Register vs ESP32 Biometric Scans)
   */
  async getStreamComparison(sessionId) {
    return await query(
      `SELECT 
         s.id as student_id, s.official_enrollment_no, s.full_name, ass.class_roll_no,
         ra.attendance_status as official_register_status,
         ra.source as register_source,
         CASE WHEN ep.id IS NOT NULL THEN 'PRESENT' ELSE 'ABSENT' END as esp32_presence_status,
         ep.scan_time as esp32_scan_time,
         ssa.verification_method as self_attendance_method,
         ssa.request_status as self_attendance_status,
         CASE 
           WHEN ra.attendance_status IN ('PRESENT', 'LATE') AND ep.id IS NOT NULL THEN 'MATCH_PRESENT'
           WHEN ra.attendance_status = 'ABSENT' AND ep.id IS NULL THEN 'MATCH_ABSENT'
           WHEN ra.attendance_status IN ('PRESENT', 'LATE') AND ep.id IS NULL THEN 'MANUAL_OVERRIDE_PRESENT'
           WHEN ra.attendance_status = 'ABSENT' AND ep.id IS NOT NULL THEN 'BIOMETRIC_TOUCH_BUT_MARKED_ABSENT'
           ELSE 'UNKNOWN'
         END as comparison_audit
       FROM attendance_session_students ass
       JOIN students s ON ass.student_id = s.id
       LEFT JOIN register_attendance ra ON ra.session_id = ass.session_id AND ra.student_id = ass.student_id
       LEFT JOIN esp32_presence ep ON ep.student_id = ass.student_id 
            AND ep.scan_time BETWEEN (SELECT DATE_SUB(start_time, INTERVAL 30 MINUTE) FROM attendance_sessions WHERE id = ass.session_id)
                                 AND (SELECT DATE_ADD(COALESCE(end_time, auto_close_at), INTERVAL 30 MINUTE) FROM attendance_sessions WHERE id = ass.session_id)
       LEFT JOIN student_self_attendance ssa ON ssa.session_id = ass.session_id AND ssa.student_id = ass.student_id
       WHERE ass.session_id = ? AND ass.included = TRUE
       ORDER BY ass.class_roll_no ASC`,
      [sessionId]
    );
  }
}

module.exports = new ReportService();
