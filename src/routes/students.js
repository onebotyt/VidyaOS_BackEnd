/**
 * Student Routes (/api/v1/students/*)
 * Pure declarative router delegating to StudentController.
 *
 * Architecture Role: Router (Routing Layer)
 * Interacts With:
 *   - Controllers: controllers/studentController.js
 *   - Models: models/studentModel.js
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requireDepartmentFaculty } = require('../middleware/requireScope');
const validate = require('../middleware/validate');
const StudentController = require('../controllers/studentController');

// ==========================================
// Student Self-Service Profile & Attendance
// ==========================================

// @route   GET /api/v1/students/me
// @desc    Retrieve logged-in student profile with biometric status
// @access  Protected (STUDENT)
// @handler StudentController.getProfile() -> StudentModel.getProfile(), StudentModel.getBiometricSlot()
router.get('/me', auth, requireRole('STUDENT'), StudentController.getProfile);

// @route   PUT /api/v1/students/me
// @desc    Update student profile email and/or password
// @access  Protected (STUDENT)
// @handler StudentController.updateProfile() -> StudentModel.updateUserEmail(), StudentModel.updateUserPassword()
router.put(
  '/me',
  auth,
  requireRole('STUDENT'),
  [
    body('email').optional().isEmail().withMessage('Valid email required'),
    body('current_password').optional().trim(),
    body('new_password').optional().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('address').optional().trim(),
    body('aadhar_number').optional().trim(),
    body('father_name').optional().trim(),
    body('mother_name').optional().trim(),
    body('dob').optional().trim(),
    body('gender').optional().trim(),
    body('category').optional().trim(),
    body('phone').optional().trim(),
    validate
  ],
  StudentController.updateProfile
);

// @route   GET /api/v1/students/me/attendance/stats
// @desc    Retrieve overall attendance statistics for self
// @access  Protected (STUDENT)
// @handler StudentController.getAttendanceStats() -> reportService.getStudentAttendanceStats()
router.get('/me/attendance/stats', auth, requireRole('STUDENT'), StudentController.getAttendanceStats);

// @route   GET /api/v1/students/me/attendance/subjects
// @desc    Retrieve subject-wise attendance breakdown for self
// @access  Protected (STUDENT)
// @handler StudentController.getAttendanceSubjects() -> reportService.getStudentSubjectBreakdown()
router.get('/me/attendance/subjects', auth, requireRole('STUDENT'), StudentController.getAttendanceSubjects);

// @route   GET /api/v1/students/me/attendance
// @desc    Retrieve detailed session-by-session attendance history for self
// @access  Protected (STUDENT)
// @handler StudentController.getAttendanceHistory() -> reportService.getStudentAttendanceHistory()
router.get('/me/attendance', auth, requireRole('STUDENT'), StudentController.getAttendanceHistory);

// ==========================================
// Single & Bulk Provisioning
// ==========================================

// @route   POST /api/v1/students/provision
// @desc    Provision a single new student account with generated credentials
// @access  Protected (TEACHER, Department Faculty)
// @handler StudentController.provisionStudent() -> StudentModel.provisionStudentTransaction()
router.post(
  '/provision',
  auth,
  requireRole('TEACHER'),
  requireDepartmentFaculty(),
  [
    body('full_name').trim().notEmpty().withMessage('Full name is required'),
    body('official_enrollment_no').trim().notEmpty().withMessage('Official enrollment number is required'),
    body('class_roll_no').optional().isInt({ min: 1 }).withMessage('Class roll number must be greater than 0'),
    body('department_id').isInt().withMessage('Department ID required'),
    body('branch_id').optional(),
    body('year').isInt({ min: 1, max: 3 }).withMessage('Year must be between 1 and 3'),
    body('semester').isInt({ min: 1, max: 6 }).withMessage('Semester must be between 1 and 6'),
    validate
  ],
  StudentController.provisionStudent
);

// @route   POST /api/v1/students/provision/bulk
// @desc    Bulk provision student cohort from roster array
// @access  Protected (TEACHER, Department Faculty)
// @handler StudentController.bulkProvision() -> StudentModel.provisionStudentTransaction()
router.post(
  '/provision/bulk',
  auth,
  requireRole('TEACHER'),
  requireDepartmentFaculty(),
  [
    body('department_id').isInt().withMessage('Department ID required'),
    body('branch_id').optional(),
    body('year').isInt({ min: 1, max: 3 }).withMessage('Year must be between 1 and 3'),
    body('semester').isInt({ min: 1, max: 6 }).withMessage('Semester must be between 1 and 6'),
    body('students').isArray({ min: 1 }).withMessage('Array of students is required'),
    validate
  ],
  StudentController.bulkProvision
);

// ==========================================
// Self-Registration Approvals & Management
// ==========================================

// @route   GET /api/v1/students/registrations/pending
// @desc    List pending self-registration requests for department review
// @access  Protected (TEACHER, Department Faculty)
// @handler StudentController.listPendingRegistrations() -> StudentModel.listPendingRegistrations()
router.get('/registrations/pending', auth, requireRole('TEACHER'), requireDepartmentFaculty(), StudentController.listPendingRegistrations);

// @route   GET /api/v1/students/registrations/count
// @desc    Count pending self-registrations for badge display
// @access  Protected (TEACHER, Department Faculty)
// @handler StudentController.countPendingRegistrations() -> StudentModel.countPendingRegistrations()
router.get('/registrations/count', auth, requireRole('TEACHER'), requireDepartmentFaculty(), StudentController.countPendingRegistrations);

// @route   POST /api/v1/students/registrations/:id/adjudicate
// @desc    Approve or reject a student self-registration request
// @access  Protected (TEACHER, Department Faculty)
// @handler StudentController.adjudicateRegistration() -> StudentModel.adjudicateRegistrationTransaction()
router.post(
  ['/registrations/:id/adjudicate', '/registrations/:id/approve', '/:id/approve'],
  auth,
  requireRole('TEACHER'),
  requireDepartmentFaculty(),
  [
    body('action').optional().isIn(['APPROVE', 'REJECT']).withMessage("Action must be 'APPROVE' or 'REJECT'"),
    body('official_enrollment_no').optional().isString().trim(),
    body('enrollment_no').optional().isString().trim(),
    body('class_roll_no').optional(),
    validate
  ],
  StudentController.adjudicateRegistration
);

// ==========================================
// Department Transfers & Academic Dossier
// ==========================================

// @route   POST /api/v1/students/:id/transfer-department
// @desc    Transfer student to another department with historical enrollment preserved
// @access  Protected (TEACHER [HOD] or SYSTEM_ADMIN)
// @handler StudentController.transferDepartment() -> StudentModel.transferDepartmentTransaction()
router.post(
  '/:id/transfer-department',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('new_department_id').isInt().withMessage('Valid new department ID required'),
    body('reason').optional().trim(),
    validate
  ],
  StudentController.transferDepartment
);

// @route   GET /api/v1/students/:id/department-history
// @desc    View department transfer history of a student
// @access  Protected (Self student or Faculty)
// @handler StudentController.getDepartmentHistory() -> StudentModel.getDepartmentHistory()
router.get('/:id/department-history', auth, StudentController.getDepartmentHistory);

// @route   GET /api/v1/students/:id/academic-dossier
// @desc    Retrieve full multi-semester academic dossier (attendance, assignments, exams)
// @access  Protected (Self student or Faculty)
// @handler StudentController.getAcademicDossier() -> StudentModel.getAcademicDossierRaw()
router.get('/:id/academic-dossier', auth, StudentController.getAcademicDossier);

module.exports = router;
