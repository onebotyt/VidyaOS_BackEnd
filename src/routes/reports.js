/**
 * Reporting & Analytics Routes (/api/v1/reports/*)
 * Delegates request processing to ReportController.
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const reportController = require('../controllers/reportController');

router.use(auth, requireRole('TEACHER', 'FACULTY', 'HOD', 'SYSTEM_ADMIN'));

// @route   GET /api/v1/reports/analytics
// @desc    Faculty & HOD attendance analytics overview and trends
// @handler ReportController.getAnalytics -> ReportModel.getAnalyticsClasses() / getAnalyticsTrend()
router.get('/analytics', (req, res) => reportController.getAnalytics(req, res));

// @route   GET /api/v1/reports/teacher-register
// @desc    Official Teacher Register ledger and student percentages
// @handler ReportController.getTeacherRegister -> ReportModel.getTeacherRegisterData()
router.get('/teacher-register', (req, res) => reportController.getTeacherRegister(req, res));

// @route   GET /api/v1/reports/stream-comparison
// @desc    Audit discrepancies between attendance session and biometric events
// @handler ReportController.getStreamComparison -> ReportService.getStreamComparison()
router.get('/stream-comparison', (req, res) => reportController.getStreamComparison(req, res));

// @route   GET /api/v1/reports/esp32-presence
// @desc    Raw ESP32 hardware biometric presence scans log
// @handler ReportController.getEsp32Presence -> ReportModel.getEsp32PresenceLogs()
router.get('/esp32-presence', (req, res) => reportController.getEsp32Presence(req, res));

// @route   GET /api/v1/reports/self-attendance
// @desc    Student self-attendance claim audit and frequency feed
// @handler ReportController.getSelfAttendance -> ReportModel.getSelfAttendanceLogs()
router.get('/self-attendance', (req, res) => reportController.getSelfAttendance(req, res));

// @route   GET /api/v1/reports/daily-summary
// @desc    Daily institutional breakdown of conducted class sessions
// @handler ReportController.getDailySummary -> ReportModel.getDailySessionsSummary()
router.get('/daily-summary', (req, res) => reportController.getDailySummary(req, res));

// @route   GET /api/v1/reports/student/:id
// @desc    Full 360-degree attendance profile and predictor statistics for a student
// @handler ReportController.getStudentReport -> ReportModel.getStudentProfile() / ReportService.getStudentAttendanceStats()
router.get('/student/:id', (req, res) => reportController.getStudentReport(req, res));

// @route   GET /api/v1/reports/teaching-groups
// @desc    Teaching groups institutional performance and syllabus compliance
// @handler ReportController.getTeachingGroupsReport -> ReportModel.getTeachingGroupsReportData()
router.get('/teaching-groups', (req, res) => reportController.getTeachingGroupsReport(req, res));

// @route   GET /api/v1/reports/iot-vs-official
// @desc    Reconciled report between raw IoT campus presence and official register records
// @handler ReportController.getIotVsOfficialComparison -> ReportModel.getIotVsOfficialComparisonData()
router.get('/iot-vs-official', (req, res) => reportController.getIotVsOfficialComparison(req, res));

module.exports = router;
