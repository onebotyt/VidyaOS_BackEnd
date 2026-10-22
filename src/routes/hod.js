/**
 * HOD Department Administration Routes (/api/v1/hod/*)
 * Concise declarative Express router delegating directly to HodController.
 * Provides bidirectional code traceability across 3-tier MVC architecture.
 */

const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requireHOD, requireHODOrClassTeacher } = require('../middleware/requireScope');
const validate = require('../middleware/validate');
const HodController = require('../controllers/hodController');

// All HOD/Department routes require authenticated TEACHER or SYSTEM_ADMIN with HOD or Class Teacher assignment
router.use(auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), requireHODOrClassTeacher());

// @route   GET /api/v1/hod/dashboard
// @desc    Retrieve high-level departmental dashboard KPIs, active registers, attendance rates, and today's sessions
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.getDashboard() -> HodModel.getDashboard()
router.get('/dashboard', requireHOD(), HodController.getDashboard);

// @route   GET /api/v1/hod/teachers
// @desc    List all faculty members belonging to the department
// @access  Protected (HOD, Class Teacher, SYSTEM_ADMIN)
// @handler HodController.getTeachers() -> HodModel.getTeachers()
router.get('/teachers', HodController.getTeachers);

// @route   POST /api/v1/hod/teachers
// @desc    Create a new teacher user account and departmental faculty profile
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.createTeacher() -> HodModel.createTeacher()
router.post('/teachers', requireHOD(), [
  body('full_name').trim().notEmpty().withMessage('Full name required'),
  body('email').isEmail().withMessage('Valid institutional Gmail required'),
  body('password').trim().notEmpty().withMessage('Password required'),
  body('phone').optional().trim(),
  body('employee_id').optional().trim(),
  validate
], HodController.createTeacher);

// @route   GET /api/v1/hod/teachers/:id
// @desc    Retrieve teacher details and active course assignments by ID within department
// @access  Protected (HOD, Class Teacher, SYSTEM_ADMIN)
// @handler HodController.getTeacherById() -> HodModel.getTeacherById()
router.get('/teachers/:id', [param('id').isInt(), validate], HodController.getTeacherById);

// @route   PUT /api/v1/hod/teachers/:id
// @desc    Update teacher full name, phone number, or employee ID
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.updateTeacher() -> HodModel.updateTeacher()
router.put('/teachers/:id', requireHOD(), [
  param('id').isInt(),
  body('full_name').optional().trim().notEmpty(),
  body('employee_id').optional().trim(),
  body('phone').optional().trim(),
  validate
], HodController.updateTeacher);

// @route   POST /api/v1/hod/teachers/:id/reset-password
// @desc    Reset teacher account password and invalidate active user sessions
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.resetTeacherPassword() -> HodModel.resetTeacherPassword()
router.post('/teachers/:id/reset-password', requireHOD(), [
  param('id').isInt(),
  body('new_password').trim().notEmpty().withMessage('New password is required'),
  validate
], HodController.resetTeacherPassword);

// @route   DELETE /api/v1/hod/teachers/:id
// @desc    Delete teacher profile, account, roles, sessions, and course assignments
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.deleteTeacher() -> HodModel.deleteTeacher()
router.delete('/teachers/:id', requireHOD(), [param('id').isInt(), validate], HodController.deleteTeacher);

// @route   GET /api/v1/hod/faculty-roster
// @desc    Retrieve department faculty roster with active teaching workloads and assigned subjects
// @access  Protected (HOD, Class Teacher, SYSTEM_ADMIN)
// @handler HodController.getFacultyRoster() -> HodModel.getFacultyRoster()
router.get('/faculty-roster', HodController.getFacultyRoster);

// @route   GET /api/v1/hod/students-roster
// @desc    Retrieve departmental student roster with cumulative attendance percentages and threshold compliance
// @access  Protected (HOD, Class Teacher, SYSTEM_ADMIN)
// @handler HodController.getStudentsRoster() -> HodModel.getStudentsRoster()
router.get('/students-roster', HodController.getStudentsRoster);

// @route   GET /api/v1/hod/department-classes
// @desc    List all attendance classes/registers in department with teacher and session stats
// @access  Protected (HOD, Class Teacher, SYSTEM_ADMIN)
// @handler HodController.getDepartmentClasses() -> HodModel.getDepartmentClasses()
router.get('/department-classes', HodController.getDepartmentClasses);

// @route   GET /api/v1/hod/department-classes/:registerId/attendance
// @desc    Retrieve detailed attendance matrix or summary ledger for a department class register
// @access  Protected (HOD, Class Teacher, SYSTEM_ADMIN)
// @handler HodController.getDepartmentClassAttendance() -> HodModel.getDepartmentClassAttendance()
router.get('/department-classes/:registerId/attendance', HodController.getDepartmentClassAttendance);

// @route   GET /api/v1/hod/subjects
// @desc    List all curriculum subjects configured in the department
// @access  Protected (HOD, Class Teacher, SYSTEM_ADMIN)
// @handler HodController.getSubjects() -> HodModel.getSubjects()
router.get('/subjects', HodController.getSubjects);

// @route   POST /api/v1/hod/subjects
// @desc    Create a new curriculum subject in the department
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.createSubject() -> HodModel.createSubject()
router.post('/subjects', requireHOD(), [
  body('name').trim().notEmpty().withMessage('Subject name required'),
  body('code').trim().notEmpty().withMessage('Subject code required'),
  body('year').isInt({ min: 1, max: 3 }).withMessage('Year 1-3 required'),
  body('semester').isInt({ min: 1, max: 6 }).withMessage('Semester 1-6 required'),
  body('has_practical').optional().isBoolean(),
  body('syllabus_scheme').optional().trim(),
  validate
], HodController.createSubject);

// @route   PUT /api/v1/hod/subjects/:id
// @desc    Update curriculum subject details, year, semester, scheme, or active status
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.updateSubject() -> HodModel.updateSubject()
router.put('/subjects/:id', requireHOD(), [
  param('id').isInt(),
  body('name').optional().trim().notEmpty(),
  body('code').optional().trim().notEmpty(),
  body('year').optional().isInt({ min: 1, max: 3 }),
  body('semester').optional().isInt({ min: 1, max: 6 }),
  body('has_practical').optional().isBoolean(),
  body('syllabus_scheme').optional().trim(),
  body('is_active').optional().isBoolean(),
  validate
], HodController.updateSubject);

// @route   DELETE /api/v1/hod/subjects/:id
// @desc    Deactivate a curriculum subject in the department
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.deleteSubject() -> HodModel.deleteSubject()
router.delete('/subjects/:id', requireHOD(), [param('id').isInt(), validate], HodController.deleteSubject);

// @route   GET /api/v1/hod/assignments
// @desc    Retrieve active teacher course and class teacher assignments in the department
// @access  Protected (HOD, Class Teacher, SYSTEM_ADMIN)
// @handler HodController.getAssignments() -> HodModel.getTeacherAssignments()
router.get('/assignments', HodController.getAssignments);

// @route   POST /api/v1/hod/assignments/subject-teacher
// @desc    Assign a teacher to a subject and auto-generate the official attendance register
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.createSubjectTeacherAssignment() -> HodModel.createSubjectTeacherAssignment()
router.post('/assignments/subject-teacher', requireHOD(), [
  body('teacher_id').isInt().withMessage('Teacher ID required'),
  body('subject_id').isInt().withMessage('Subject ID required'),
  body('session_type_scope').isIn(['THEORY', 'PRACTICAL']).withMessage('session_type_scope must be THEORY or PRACTICAL'),
  body('branch_id').optional(),
  body('year').optional().isInt({ min: 1, max: 3 }),
  body('semester').optional().isInt({ min: 1, max: 6 }),
  validate
], HodController.createSubjectTeacherAssignment);

// @route   POST /api/v1/hod/assignments/class-teacher
// @desc    Appoint a Class Teacher for a cohort, deactivating prior assignments
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.createClassTeacherAssignment() -> HodModel.createClassTeacherAssignment()
router.post('/assignments/class-teacher', requireHOD(), [
  body('teacher_id').isInt().withMessage('Teacher ID required'),
  body('branch_id').optional().isInt(),
  body('year').isInt({ min: 1, max: 3 }).withMessage('Year 1-3 required'),
  body('semester').isInt({ min: 1, max: 6 }).withMessage('Semester 1-6 required'),
  validate
], HodController.createClassTeacherAssignment);

// @route   DELETE /api/v1/hod/assignments/:id
// @desc    Deactivate a teacher assignment and archive the linked official attendance register
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.deleteAssignment() -> HodModel.deleteAssignment()
router.delete('/assignments/:id', requireHOD(), [param('id').isInt(), validate], HodController.deleteAssignment);

// @route   GET /api/v1/hod/reports
// @desc    Compile and return department analytics report data: KPIs, trends, cohort summaries, and scan logs
// @access  Protected (HOD, Class Teacher, SYSTEM_ADMIN)
// @handler HodController.getReports() -> HodModel.getReports()
router.get('/reports', HodController.getReports);

// @route   GET /api/v1/hod/devices
// @desc    List all IoT hardware devices registered to the department
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.getDevices() -> HodModel.getDevices()
router.get('/devices', requireHOD(), HodController.getDevices);

// @route   POST /api/v1/hod/devices
// @desc    Register a new IoT terminal device assigned to the department
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.createDevice() -> HodModel.createDevice()
router.post('/devices', requireHOD(), [
  body('device_uid').trim().notEmpty().withMessage('Device UID required'),
  body('name').optional().trim(),
  body('secret').trim().notEmpty().withMessage('Device secret required'),
  body('academic_year_id').optional().isInt(),
  body('year').optional().isInt({ min: 1, max: 3 }),
  body('semester').optional().isInt({ min: 1, max: 6 }),
  validate
], HodController.createDevice);

// @route   PATCH /api/v1/hod/devices/:id/toggle
// @desc    Toggle device active/inactive state
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.toggleDevice() -> HodModel.toggleDevice()
router.patch('/devices/:id/toggle', requireHOD(), [param('id').isInt(), validate], HodController.toggleDevice);

// @route   DELETE /api/v1/hod/devices/:id
// @desc    Delete an IoT device from the department
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.deleteDevice() -> HodModel.deleteDevice()
router.delete('/devices/:id', requireHOD(), [param('id').isInt(), validate], HodController.deleteDevice);

// @route   GET /api/v1/hod/students
// @desc    Paginated student listing in department filtered by cohort, year, and search
// @access  Protected (HOD, Class Teacher, SYSTEM_ADMIN)
// @handler HodController.getStudents() -> HodModel.getStudents()
router.get('/students', HodController.getStudents);

// @route   POST /api/v1/hod/students
// @desc    Enroll a new student, create provisioned user account, and reindex roll numbers
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.createStudent() -> HodModel.createStudent()
router.post('/students', requireHOD(), [
  body('official_enrollment_no').trim().notEmpty().withMessage('Official enrollment number required'),
  body('full_name').trim().notEmpty().withMessage('Student full name required'),
  body('email').optional().trim().isEmail().withMessage('Valid email required'),
  body('initial_password').optional().trim(),
  body('academic_year_id').optional().isInt(),
  body('year').isInt({ min: 1, max: 6 }).withMessage('Year required'),
  body('semester').isInt({ min: 1, max: 12 }).withMessage('Semester required'),
  body('is_lateral_entry').optional().isBoolean(),
  validate
], HodController.createStudent);

// @route   POST /api/v1/hod/students/bulk
// @desc    Bulk import and enroll students for a cohort in a single transaction with automatic roll indexing
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.bulkCreateStudents() -> HodModel.bulkCreateStudents()
router.post('/students/bulk', requireHOD(), [
  body('academic_year_id').optional().isInt(),
  body('year').isInt({ min: 1, max: 6 }).withMessage('Year required'),
  body('semester').isInt({ min: 1, max: 12 }).withMessage('Semester required'),
  body('students').isArray({ min: 1 }).withMessage('Students list required'),
  validate
], HodController.bulkCreateStudents);

// @route   DELETE /api/v1/hod/students/:id
// @desc    Delete student record, user account, attendance records, and reindex roll numbers
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.deleteStudent() -> HodModel.deleteStudent()
router.delete('/students/:id', requireHOD(), [param('id').isInt(), validate], HodController.deleteStudent);

// @route   POST /api/v1/hod/students/:id/reset-password
// @desc    Reset student account password
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.resetStudentPassword() -> HodModel.resetStudentPassword()
router.post('/students/:id/reset-password', requireHOD(), [
  param('id').isInt(),
  body('new_password').trim().notEmpty().withMessage('New password is required'),
  validate
], HodController.resetStudentPassword);

// @route   POST /api/v1/hod/students/reindex-roll
// @desc    Re-index class roll numbers alphabetically by student name for a cohort
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.reindexRoll() -> HodModel.reindexCohortRollNumbers()
router.post('/students/reindex-roll', requireHOD(), [
  body('academic_year_id').optional().isInt(),
  body('year').isInt({ min: 1, max: 6 }).withMessage('Year required'),
  body('semester').isInt({ min: 1, max: 12 }).withMessage('Semester required'),
  validate
], HodController.reindexRoll);

// @route   GET /api/v1/hod/settings
// @desc    Retrieve department academic configuration and attendance threshold settings
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.getSettings() -> HodModel.getSettings()
router.get('/settings', requireHOD(), HodController.getSettings);

// @route   PUT /api/v1/hod/settings
// @desc    Update departmental settings (duration, active term, attendance threshold)
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.updateSettings() -> HodModel.updateSettings()
router.put('/settings', requireHOD(), [
  body('degree_duration_years').optional().isInt({ min: 1, max: 3 }),
  body('active_term').optional().isIn(['ODD', 'EVEN']),
  body('attendance_threshold').optional().isFloat({ min: 0, max: 100 }),
  body('defaulter_threshold_percent').optional().isFloat({ min: 0, max: 100 }),
  validate
], HodController.updateSettings);

// @route   GET /api/v1/hod/settings/duration
// @desc    Retrieve department degree duration and active term configuration
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.getDurationSettings() -> HodModel.getDurationSettings()
router.get('/settings/duration', requireHOD(), HodController.getDurationSettings);

// @route   POST /api/v1/hod/settings/duration
// @desc    Update department degree duration years with typed code confirmation
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.updateDurationSettings() -> HodModel.updateDurationSettings()
router.post('/settings/duration', requireHOD(), [
  body('duration_years').isInt({ min: 1, max: 3 }).withMessage('Duration years must be between 1 and 3'),
  body('confirm_code').trim().notEmpty().withMessage('Confirmation code required'),
  validate
], HodController.updateDurationSettings);

// @route   GET /api/v1/hod/promotion/preview
// @desc    Calculate preview of students eligible for semester promotion or demotion reversal
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.getPromotionPreview() -> HodModel.getPromotionPreview()
router.get('/promotion/preview', requireHOD(), HodController.getPromotionPreview);

// @route   POST /api/v1/hod/promotion/execute
// @desc    Execute atomic batch semester promotion or demotion reversal with automatic roll reindexing
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.executePromotion() -> HodModel.executePromotion() -> auditService.logAudit() & notificationService.sendNotification()
router.post('/promotion/execute', requireHOD(), HodController.executePromotion);

// @route   GET /api/v1/hod/hierarchy
// @desc    Retrieve department hierarchy tree for UI dropdown menus (branches, subjects, teachers, academic years)
// @access  Protected (HOD, Class Teacher, SYSTEM_ADMIN)
// @handler HodController.getHierarchy() -> HodModel.getHierarchy()
router.get('/hierarchy', HodController.getHierarchy);

// @route   GET /api/v1/hod/archive/batches
// @desc    List distinct graduation years for alumni students in department
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.getArchiveBatches() -> HodModel.getArchiveBatches()
router.get('/archive/batches', requireHOD(), HodController.getArchiveBatches);

// @route   GET /api/v1/hod/archive
// @desc    Retrieve archived alumni students with lifetime attendance stats and KPI metrics
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.getArchive() -> HodModel.getArchive()
router.get('/archive', requireHOD(), HodController.getArchive);

// @route   GET /api/v1/hod/registrations/pending-faculty
// @route   GET /api/v1/hod/faculty-registrations/pending
// @desc    Retrieve pending faculty registration requests awaiting HOD approval
// @access  Protected (HOD, Class Teacher, SYSTEM_ADMIN)
// @handler HodController.getPendingFacultyRegistrations() -> HodModel.getPendingFacultyRegistrations()
router.get(['/registrations/pending-faculty', '/faculty-registrations/pending'], HodController.getPendingFacultyRegistrations);

// @route   POST /api/v1/hod/registrations/faculty/:id/approve
// @route   POST /api/v1/hod/faculty-registrations/:id/approve
// @desc    Approve a pending faculty self-registration, creating user account, teacher record, and audit log
// @access  Protected (HOD, Class Teacher, SYSTEM_ADMIN)
// @handler HodController.approveFacultyRegistration() -> HodModel.approveFacultyRegistration() -> notificationService.sendNotification()
router.post(['/registrations/faculty/:id/approve', '/faculty-registrations/:id/approve'], HodController.approveFacultyRegistration);

// @route   POST /api/v1/hod/registrations/faculty/:id/reject
// @route   POST /api/v1/hod/faculty-registrations/:id/reject
// @desc    Reject a pending faculty self-registration with recorded reason
// @access  Protected (HOD, Class Teacher, SYSTEM_ADMIN)
// @handler HodController.rejectFacultyRegistration() -> HodModel.rejectFacultyRegistration()
router.post(['/registrations/faculty/:id/reject', '/faculty-registrations/:id/reject'], [
  body('reason').optional().trim(),
  body('rejection_reason').optional().trim(),
  validate
], HodController.rejectFacultyRegistration);

// @route   POST /api/v1/hod/faculty-registrations/:id/adjudicate
// @route   POST /api/v1/hod/registrations/faculty/:id/adjudicate
// @desc    Adjudicate a pending faculty registration by delegating to approve or reject handlers
// @access  Protected (HOD, Class Teacher, SYSTEM_ADMIN)
// @handler HodController.adjudicateFacultyRegistration() -> HodModel.approveFacultyRegistration() / rejectFacultyRegistration()
router.post(['/faculty-registrations/:id/adjudicate', '/registrations/faculty/:id/adjudicate'], [
  body('action').optional().isIn(['APPROVE', 'REJECT']).withMessage("Action must be 'APPROVE' or 'REJECT'"),
  body('reason').optional().trim(),
  body('rejection_reason').optional().trim(),
  validate
], HodController.adjudicateFacultyRegistration);

// @route   GET /api/v1/hod/faculty-registration-status
// @desc    Check whether faculty self-registration gate is open for department
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.getFacultyRegistrationStatus() -> HodModel.getFacultyRegistrationStatus()
router.get('/faculty-registration-status', requireHOD(), HodController.getFacultyRegistrationStatus);

// @route   POST /api/v1/hod/faculty-registration-toggle
// @desc    Toggle departmental faculty self-registration gate with audit trail
// @access  Protected (HOD, SYSTEM_ADMIN)
// @handler HodController.toggleFacultyRegistration() -> HodModel.toggleFacultyRegistration()
router.post('/faculty-registration-toggle', requireHOD(), [
  body('open').isBoolean().withMessage('open flag (boolean) is required'),
  body('department_id').optional().isInt(),
  validate
], HodController.toggleFacultyRegistration);

module.exports = router;
