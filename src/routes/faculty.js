/**
 * Faculty Routes (/api/v1/faculty/*)
 * Concise declarative Express router delegating to FacultyController.
 * Provides bidirectional code traceability across 3-tier MVC architecture.
 */

const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requireDepartmentFaculty, requireCommonFacultyManager } = require('../middleware/requireScope');
const validate = require('../middleware/validate');
const FacultyController = require('../controllers/facultyController');

// All routes require authentication and TEACHER or SYSTEM_ADMIN role
router.use(auth, requireRole('TEACHER', 'SYSTEM_ADMIN'));

// @route   GET /api/v1/faculty/dashboard
// @desc    Get dashboard metrics, active registers summary, and schedule for current teacher
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler FacultyController.getDashboard() -> FacultyModel.getDashboardStats()
router.get('/dashboard', FacultyController.getDashboard);

// @route   GET /api/v1/faculty/registers
// @desc    List all attendance registers accessible to the logged-in faculty
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler FacultyController.getRegisters() -> FacultyModel.getRegistersForTeacher()
router.get('/registers', FacultyController.getRegisters);

// @route   GET /api/v1/faculty/my-students
// @desc    List unique students enrolled across all registers belonging to current teacher
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler FacultyController.getMyStudents() -> FacultyModel.getStudentsForTeacher()
router.get('/my-students', FacultyController.getMyStudents);

// @route   GET /api/v1/faculty/registers/:id
// @desc    Retrieve detailed register matrix, students, sessions, and records for month
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler FacultyController.getRegisterDetail() -> FacultyModel.getRegisterDetail()
router.get('/registers/:id', [param('id').isInt(), validate], FacultyController.getRegisterDetail);

// @route   PUT /api/v1/faculty/registers/:id/mark-cell
// @desc    Quick Pen update attendance status for a single student on a specific date
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler FacultyController.markCell() -> FacultyModel.markCell()
router.put('/registers/:id/mark-cell', [
  param('id').isInt(),
  body('date').isDate().withMessage('Valid date required (YYYY-MM-DD)'),
  body('student_id').isInt(),
  body('status').isIn(['PRESENT', 'ABSENT', 'LATE', 'CLEAR']),
  validate
], FacultyController.markCell);

// @route   PUT /api/v1/faculty/registers/:id/student-status
// @desc    Update student enrollment state within register (ENROLLED, TRANSFERRED, DROPPED)
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler FacultyController.updateStudentStatus() -> FacultyModel.updateStudentStatus()
router.put('/registers/:id/student-status', [
  param('id').isInt(),
  body('student_id').isInt(),
  body('status').isIn(['ENROLLED', 'TRANSFERRED', 'DROPPED']),
  validate
], FacultyController.updateStudentStatus);

// @route   POST /api/v1/faculty/registers
// @desc    Create a new personal attendance register for subject/cohort
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler FacultyController.createPersonalRegister() -> FacultyModel.createPersonalRegister()
router.post('/registers', [
  body('name').trim().notEmpty().withMessage('Register name required'),
  body('subject_id').optional().isInt(),
  body('department_id').optional().isInt(),
  body('year').optional().isInt({ min: 1, max: 4 }),
  body('semester').optional().isInt({ min: 1, max: 8 }),
  validate
], FacultyController.createPersonalRegister);

// @route   POST /api/v1/faculty/registers/:id/sessions
// @desc    Create a new daily class session for a specific register
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler FacultyController.createSession() -> FacultyModel.createSession()
router.post('/registers/:id/sessions', [
  param('id').isInt(),
  body('session_date').isDate().withMessage('Valid date required (YYYY-MM-DD)'),
  body('period_number').optional().isInt({ min: 1, max: 10 }),
  body('session_type').optional().isIn(['THEORY', 'PRACTICAL', 'TUTORIAL']),
  validate
], FacultyController.createSession);

// @route   GET /api/v1/faculty/cohorts
// @desc    Retrieve cohorts assigned to the teacher or department
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler FacultyController.getCohorts() -> FacultyModel.getCohorts()
router.get('/cohorts', FacultyController.getCohorts);

// @route   GET /api/v1/faculty/subjects
// @desc    Retrieve curriculum subjects taught by or accessible to faculty
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler FacultyController.getSubjects() -> FacultyModel.getSubjects()
router.get('/subjects', FacultyController.getSubjects);

// @route   GET /api/v1/faculty/cohorts/students
// @desc    List all students belonging to a specified cohort
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler FacultyController.getCohortStudents() -> FacultyModel.getCohortStudents()
router.get('/cohorts/students', FacultyController.getCohortStudents);

// @route   GET /api/v1/faculty/cohorts/biometrics
// @desc    Retrieve biometric registration status of students in a cohort
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler FacultyController.getCohortBiometrics() -> FacultyModel.getCohortBiometrics()
router.get('/cohorts/biometrics', FacultyController.getCohortBiometrics);

// @route   POST /api/v1/faculty/cohorts/registration-toggle
// @desc    Open or close student self-registration for a department cohort
// @access  Protected (TEACHER, SYSTEM_ADMIN with department scope)
// @handler FacultyController.toggleCohortRegistration() -> FacultyModel.toggleCohortRegistration()
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
], FacultyController.toggleCohortRegistration);

// @route   GET /api/v1/faculty/cohorts/registration-status
// @desc    Check whether student self-registration is currently active for cohort
// @access  Protected (TEACHER, SYSTEM_ADMIN with department scope)
// @handler FacultyController.getCohortRegistrationStatus() -> FacultyModel.getCohortRegistrationStatus()
router.get('/cohorts/registration-status', requireDepartmentFaculty(), FacultyController.getCohortRegistrationStatus);

// @route   GET /api/v1/faculty/profile
// @desc    Retrieve current authenticated faculty member's profile
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler FacultyController.getProfile() -> FacultyModel.getProfile()
router.get('/profile', FacultyController.getProfile);

// @route   PUT /api/v1/faculty/profile
// @desc    Update current authenticated faculty member's contact info or password
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler FacultyController.updateProfile() -> FacultyModel.updateProfile()
router.put('/profile', [
  body('full_name').optional().trim().notEmpty(),
  body('phone').optional().trim(),
  body('email').optional().isEmail().withMessage('Valid email required'),
  body('current_password').optional().trim(),
  body('new_password').optional().isLength({ min: 8 }).withMessage('Password min 8 characters'),
  validate
], FacultyController.updateProfile);

// @route   GET /api/v1/faculty/my-classes
// @desc    Get all active teaching classes/cohorts assigned to faculty
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler FacultyController.getMyClasses() -> FacultyModel.getMyClasses()
router.get('/my-classes', FacultyController.getMyClasses);

// @route   GET /api/v1/faculty/registers/:id/internal-evaluation
// @desc    Compute comprehensive internal evaluation score sheet for register
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler FacultyController.getInternalEvaluation() -> FacultyModel.getInternalEvaluationSheet()
router.get('/registers/:id/internal-evaluation', [param('id').isInt(), validate], FacultyController.getInternalEvaluation);

// @route   GET /api/v1/faculty/registers/:id/export/internal-evaluation-excel
// @desc    Export register internal evaluation sheet formatted as Excel document
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler FacultyController.exportInternalEvaluationExcel() -> FacultyModel.getInternalEvaluationSheet() -> excelExportService
router.get('/registers/:id/export/internal-evaluation-excel', [param('id').isInt(), validate], FacultyController.exportInternalEvaluationExcel);

// @route   POST /api/v1/faculty/registers/:id/export/internal-evaluation-excel
// @desc    Export register internal evaluation sheet with customized grading weights
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler FacultyController.exportInternalEvaluationExcelCustom() -> FacultyModel.getInternalEvaluationSheet() -> excelExportService
router.post('/registers/:id/export/internal-evaluation-excel', [param('id').isInt(), validate], FacultyController.exportInternalEvaluationExcelCustom);

// @route   POST /api/v1/faculty/registers/:id/export/unit-tests-summary-excel
// @route   POST /api/v1/faculty/registers/:id/export/all-tests-excel
// @desc    Export unit test summaries and test marks roster as Excel document
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler FacultyController.exportUnitTestsSummaryExcel() -> excelExportService
router.post(['/registers/:id/export/unit-tests-summary-excel', '/registers/:id/export/all-tests-excel'], [param('id').isInt(), validate], FacultyController.exportUnitTestsSummaryExcel);

// @route   POST /api/v1/faculty/export/table-to-excel
// @desc    Export custom client table rows into authentic Microsoft Excel (.xlsx) workbook
// @access  Protected (TEACHER, SYSTEM_ADMIN)
router.post('/export/table-to-excel', FacultyController.exportTableToExcel);

// @route   GET /api/v1/faculty/common/pending
// @desc    Retrieve pending registrations for first-year / common pool students
// @access  Protected (TEACHER, SYSTEM_ADMIN with Common Faculty Manager role)
// @handler FacultyController.getCommonPending() -> FacultyModel.getCommonPending()
router.get('/common/pending', requireCommonFacultyManager(), FacultyController.getCommonPending);

// @route   POST /api/v1/faculty/common/:id/approve
// @desc    Approve a pending student self-registration in common pool
// @access  Protected (TEACHER, SYSTEM_ADMIN with Common Faculty Manager role)
// @handler FacultyController.approveCommon() -> FacultyModel.approveCommon()
router.post('/common/:id/approve', requireCommonFacultyManager(), FacultyController.approveCommon);

// @route   POST /api/v1/faculty/common/:id/reject
// @desc    Reject a pending student self-registration in common pool
// @access  Protected (TEACHER, SYSTEM_ADMIN with Common Faculty Manager role)
// @handler FacultyController.rejectCommon() -> FacultyModel.rejectCommon()
router.post('/common/:id/reject', requireCommonFacultyManager(), [
  body('reason').optional().trim(),
  validate
], FacultyController.rejectCommon);

// @route   GET /api/v1/faculty/common/members
// @desc    Retrieve approved members in common pool
// @access  Protected (TEACHER, SYSTEM_ADMIN with Common Faculty Manager role)
// @handler FacultyController.getCommonMembers() -> FacultyModel.getCommonMembers()
router.get('/common/members', requireCommonFacultyManager(), FacultyController.getCommonMembers);

module.exports = router;
