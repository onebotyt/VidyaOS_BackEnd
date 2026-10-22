/**
 * Report Controller — HTTP request/response handlers for attendance analytics and reports.
 */

const reportModel = require('../models/reportModel');
const reportService = require('../services/reportService');
const logger = require('../utils/logger');

class ReportController {
  /**
   * Faculty/HOD Attendance Analytics Dashboard summary.
   * 
   * @route GET /api/v1/reports/analytics (routes/reports.js)
   * @access Protected (TEACHER, FACULTY, HOD, SYSTEM_ADMIN)
   * @usesModel ReportModel.getAnalyticsClasses() (models/reportModel.js)
   * @usesModel ReportModel.getAnalyticsTrend() (models/reportModel.js)
   * @usesModel ReportModel.getAnalyticsBelowThresholdCount() (models/reportModel.js)
   */
  async getAnalytics(req, res) {
    try {
      const teacherId = req.user.teacher_id;
      const isHod = Boolean(req.user.is_hod || req.user.roles?.includes('HOD'));
      const deptId = req.user.department_id;

      if (!teacherId && !isHod) {
        return res.json({ success: true, data: { classes: [], trend: [], defaulter_count: 0, below_threshold_count: 0 } });
      }

      const [classes, trend, belowCount] = await Promise.all([
        reportModel.getAnalyticsClasses({ teacherId, isHod, deptId }),
        reportModel.getAnalyticsTrend({ teacherId, isHod, deptId, limit: 14 }),
        reportModel.getAnalyticsBelowThresholdCount({ teacherId, isHod, deptId, threshold: 75 })
      ]);

      return res.json({
        success: true,
        data: {
          classes,
          trend,
          defaulter_count: belowCount,
          below_threshold_count: belowCount
        }
      });
    } catch (err) {
      logger.error('[ReportController] getAnalytics error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Official Teacher Register Report.
   * 
   * @route GET /api/v1/reports/teacher-register (routes/reports.js)
   * @access Protected (TEACHER, FACULTY, HOD, SYSTEM_ADMIN)
   * @usesModel ReportModel.getTeacherRegisterData() (models/reportModel.js)
   */
  async getTeacherRegister(req, res) {
    const effDeptId = req.query.department_id || req.query.branch_id;
    const { year, semester, subject_id } = req.query;

    if (!effDeptId || !year || !semester) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Cohort parameters required' }
      });
    }

    try {
      const { totalConducted, students } = await reportModel.getTeacherRegisterData({
        departmentId: effDeptId,
        year,
        semester,
        subjectId: subject_id
      });

      return res.status(200).json({
        success: true,
        data: {
          total_conducted: totalConducted,
          students
        }
      });
    } catch (err) {
      logger.error('[ReportController] getTeacherRegister error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Stream Comparison Report (Audit of Discrepancies between sessions and devices).
   * 
   * @route GET /api/v1/reports/stream-comparison (routes/reports.js)
   * @access Protected (TEACHER, FACULTY, HOD, SYSTEM_ADMIN)
   * @usesService ReportService.getStreamComparison() (services/reportService.js)
   */
  async getStreamComparison(req, res) {
    const sessionId = req.query.session_id;
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'session_id query parameter is required' }
      });
    }

    try {
      const comparison = await reportService.getStreamComparison(sessionId);
      return res.status(200).json({ success: true, data: comparison });
    } catch (err) {
      logger.error('[ReportController] getStreamComparison error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * ESP32 Raw Hardware Presence Scans Log.
   * 
   * @route GET /api/v1/reports/esp32-presence (routes/reports.js)
   * @access Protected (TEACHER, FACULTY, HOD, SYSTEM_ADMIN)
   * @usesModel ReportModel.getEsp32PresenceLogs() (models/reportModel.js)
   */
  async getEsp32Presence(req, res) {
    const { device_id, from_date, to_date, student_id } = req.query;
    const limit = parseInt(req.query.limit, 10) || 50;

    try {
      const rows = await reportModel.getEsp32PresenceLogs({
        deviceId: device_id,
        studentId: student_id,
        fromDate: from_date,
        toDate: to_date,
        limit
      });
      return res.json({ success: true, data: rows });
    } catch (err) {
      logger.error('[ReportController] getEsp32Presence error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Self-Attendance Audit & Frequency Log.
   * 
   * @route GET /api/v1/reports/self-attendance (routes/reports.js)
   * @access Protected (TEACHER, FACULTY, HOD, SYSTEM_ADMIN)
   * @usesModel ReportModel.getSelfAttendanceLogs() (models/reportModel.js)
   */
  async getSelfAttendance(req, res) {
    const { session_id, student_id } = req.query;
    try {
      const rows = await reportModel.getSelfAttendanceLogs({ sessionId: session_id, studentId: student_id });
      return res.json({ success: true, data: rows });
    } catch (err) {
      logger.error('[ReportController] getSelfAttendance error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Daily Summary of Conducted Attendance Sessions.
   * 
   * @route GET /api/v1/reports/daily-summary (routes/reports.js)
   * @access Protected (TEACHER, FACULTY, HOD, SYSTEM_ADMIN)
   * @usesModel ReportModel.getDailySessionsSummary() (models/reportModel.js)
   */
  async getDailySummary(req, res) {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const departmentId = req.query.department_id;

    try {
      const rows = await reportModel.getDailySessionsSummary({ date, departmentId });
      return res.json({ success: true, data: rows, date });
    } catch (err) {
      logger.error('[ReportController] getDailySummary error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Full 360° Comprehensive Report for a Single Student.
   * 
   * @route GET /api/v1/reports/student/:id (routes/reports.js)
   * @access Protected (TEACHER, FACULTY, HOD, SYSTEM_ADMIN)
   * @usesModel ReportModel.getStudentProfile() (models/reportModel.js)
   * @usesService ReportService.getStudentAttendanceStats() (services/reportService.js)
   * @usesService ReportService.getStudentSubjectBreakdown() (services/reportService.js)
   * @usesService ReportService.getStudentAttendanceHistory() (services/reportService.js)
   */
  async getStudentReport(req, res) {
    const studentId = parseInt(req.params.id, 10);
    try {
      const student = await reportModel.getStudentProfile(studentId);
      if (!student) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Student not found' } });
      }

      const [stats, subjectBreakdown, recentHistory] = await Promise.all([
        reportService.getStudentAttendanceStats(studentId),
        reportService.getStudentSubjectBreakdown(studentId),
        reportService.getStudentAttendanceHistory(studentId, { limit: 20 })
      ]);

      return res.json({
        success: true,
        data: {
          student,
          stats,
          subjects: subjectBreakdown,
          recent_sessions: recentHistory
        }
      });
    } catch (err) {
      logger.error('[ReportController] getStudentReport error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Teaching Groups Institutional & Cohort Performance Report.
   * 
   * @route GET /api/v1/reports/teaching-groups (routes/reports.js)
   * @access Protected (TEACHER, FACULTY, HOD, SYSTEM_ADMIN)
   * @usesModel ReportModel.getTeachingGroupsReport() (models/reportModel.js)
   */
  async getTeachingGroupsReport(req, res) {
    try {
      const { group_id, academic_year_id, semester, status } = req.query;
      const isSystemAdmin = req.user.roles.includes('SYSTEM_ADMIN');
      const teacherId = req.user.teacher_id;

      const formatted = await reportModel.getTeachingGroupsReport({
        isSystemAdmin,
        teacherId,
        groupId: group_id,
        academicYearId: academic_year_id,
        semester,
        status
      });

      return res.json({ success: true, data: formatted, count: formatted.length });
    } catch (err) {
      logger.error('[ReportController] getTeachingGroupsReport error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Comparison Report: IoT Campus Presence Evidence vs Official Subject Register Attendance.
   * 
   * @route GET /api/v1/reports/iot-vs-official (routes/reports.js)
   * @access Protected (TEACHER, FACULTY, HOD, SYSTEM_ADMIN)
   * @usesModel ReportModel.getIotVsOfficialComparisonData() (models/reportModel.js)
   */
  async getIotVsOfficialComparison(req, res) {
    try {
      const date = req.query.date || new Date().toISOString().slice(0, 10);
      const { department_id, group_id, student_id } = req.query;

      const comparisonResults = await reportModel.getIotVsOfficialComparisonData({
        date,
        departmentId: department_id,
        groupId: group_id,
        studentId: student_id
      });

      return res.json({
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
      logger.error('[ReportController] getIotVsOfficialComparison error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = new ReportController();
