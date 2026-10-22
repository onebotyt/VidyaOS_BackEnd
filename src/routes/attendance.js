/**
 * Attendance Core Routes (/api/v1/attendance/*)
 * Pure declarative router delegating to AttendanceController.
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const AttendanceController = require('../controllers/attendanceController');

// @route   POST /api/v1/attendance/sessions
// @desc    Teacher/Admin: Create a new attendance session & auto-provision register if needed
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler AttendanceController.createSession() -> AttendanceModel.createRegister(), attendanceService.createSession()
router.post(
  '/sessions',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('register_id').optional().isInt(),
    body('subject_id').optional().isInt(),
    body('department_id').optional().isInt(),
    body('branch_id').optional(),
    body('year').optional().isInt({ min: 1, max: 3 }),
    body('semester').optional().isInt({ min: 1, max: 6 }),
    validate
  ],
  AttendanceController.createSession
);

// @route   GET /api/v1/attendance/sessions
// @desc    List attendance sessions for student or teacher
// @access  Protected (All Authenticated Users)
// @handler AttendanceController.listSessions() -> AttendanceModel.listSessions()
router.get('/sessions', auth, AttendanceController.listSessions);

// @route   GET /api/v1/attendance/sessions/:id
// @desc    Get session details, cohort context, and student marking roster
// @access  Protected (All Authenticated Users)
// @handler AttendanceController.getSessionDetails() -> AttendanceModel.getSessionWithCohort(), AttendanceModel.getSessionRosterWithMarking()
router.get('/sessions/:id', auth, AttendanceController.getSessionDetails);

// @route   PUT /api/v1/attendance/sessions/:id/state
// @desc    Transition session lifecycle state (OPEN, CLOSED, FINALIZED)
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler AttendanceController.transitionState() -> attendanceService.transitionState()
router.put(
  '/sessions/:id/state',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('state').isIn(['DRAFT', 'OPEN', 'CLOSED', 'FINALIZED']).withMessage('Invalid state value'),
    validate
  ],
  AttendanceController.transitionState
);

// @route   POST /api/v1/attendance/sessions/:id/pin
// @desc    Generate dynamic 6-digit rolling PIN for classroom roll call
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler AttendanceController.generatePin() -> attendanceService.generatePin()
router.post('/sessions/:id/pin', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), AttendanceController.generatePin);

// @route   POST /api/v1/attendance/sessions/:id/qr
// @desc    Generate dynamic single-use QR token for visual student check-in
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler AttendanceController.generateQr() -> attendanceService.generateQr()
router.post('/sessions/:id/qr', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), AttendanceController.generateQr);

// @route   POST /api/v1/attendance/sessions/:id/self-attendance
// @desc    Student: Submit self-attendance check-in request with PIN/QR and proof
// @access  Protected (STUDENT)
// @handler AttendanceController.submitSelfAttendance() -> attendanceService.submitSelfAttendance()
router.post('/sessions/:id/self-attendance', auth, requireRole('STUDENT'), AttendanceController.submitSelfAttendance);

// @route   GET /api/v1/attendance/sessions/:id/self-attendance
// @desc    Teacher/Admin: Retrieve pending self-attendance check-in claims
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler AttendanceController.getSelfAttendanceRequests() -> attendanceService.getSelfAttendanceRequests()
router.get('/sessions/:id/self-attendance', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), AttendanceController.getSelfAttendanceRequests);

// @route   POST /api/v1/attendance/sessions/:id/self-attendance/:reqId/adjudicate
// @desc    Teacher/Admin: Adjudicate (ACCEPT/REJECT) student self-attendance check-in claim
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler AttendanceController.adjudicateSelfAttendance() -> attendanceService.adjudicateSelfAttendance()
router.post(
  '/sessions/:id/self-attendance/:reqId/adjudicate',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('action').isIn(['ACCEPT', 'REJECT']).withMessage("Action must be 'ACCEPT' or 'REJECT'"),
    validate
  ],
  AttendanceController.adjudicateSelfAttendance
);

// @route   POST /api/v1/attendance/sessions/:id/sync-esp32
// @desc    Teacher/Admin: Correlate hardware ESP32 scans with active session roster
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler AttendanceController.syncEsp32Scans() -> attendanceService.syncEsp32Scans()
router.post('/sessions/:id/sync-esp32', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), AttendanceController.syncEsp32Scans);

// @route   POST /api/v1/attendance/sessions/:id/records
// @desc    Teacher/Admin: Save bulk verified attendance status records
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler AttendanceController.saveRecords() -> attendanceService.saveRegisterRecords()
router.post(
  '/sessions/:id/records',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('records').isArray({ min: 1 }).withMessage('Records array required'),
    validate
  ],
  AttendanceController.saveRecords
);

// @route   GET /api/v1/attendance/registers/:id/summary
// @desc    Get aggregate attendance summary statistics for a register
// @access  Protected (All Authenticated Users)
// @handler AttendanceController.getRegisterSummary() -> AttendanceModel.getRegisterSummary()
router.get('/registers/:id/summary', auth, AttendanceController.getRegisterSummary);

// @route   GET /api/v1/attendance/registers/:id/esp32-day-scans
// @desc    Teacher/Admin: Retrieve hardware biometric day scans for ledger reconciliation
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler AttendanceController.getEsp32DayScans() -> AttendanceModel.getEsp32DayScans()
router.get('/registers/:id/esp32-day-scans', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), AttendanceController.getEsp32DayScans);

// @route   POST /api/v1/attendance/registers/:id/confirm-day-attendance
// @desc    Teacher/Admin: Confirm and finalize day attendance ledger session
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler AttendanceController.confirmDayAttendance() -> AttendanceModel.recordDayAttendance(), AttendanceModel.finalizeDaySession()
router.post('/registers/:id/confirm-day-attendance', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), AttendanceController.confirmDayAttendance);

// @route   POST /api/v1/attendance/sessions/:id/correct
// @desc    Teacher/Admin: Correct finalized attendance entry with audit trail
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler AttendanceController.correctAttendance() -> attendanceService.correctAttendanceRecord()
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
  AttendanceController.correctAttendance
);

// @route   GET /api/v1/attendance/sessions/:id/corrections
// @desc    Teacher/Admin: Retrieve correction audit history logs for a session
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler AttendanceController.getCorrections() -> attendanceService.getSessionCorrections()
router.get('/sessions/:id/corrections', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), AttendanceController.getCorrections);

module.exports = router;
