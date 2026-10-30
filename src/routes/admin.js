/**
 * Institutional Master Data Administration Routes (/api/v1/admin/*)
 * Concise declarative Express router delegating to AdminController.
 * Provides bidirectional code traceability across 3-tier MVC architecture.
 */

const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const AdminController = require('../controllers/adminController');

// All admin routes require authentication and SYSTEM_ADMIN role
router.use(auth, requireRole('SYSTEM_ADMIN'));

// @route   GET /api/v1/admin/stats
// @desc    Get high-level institutional statistics across students, teachers, departments, and sessions
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.getStats() -> AdminModel.getStats()
router.get('/stats', AdminController.getStats);

// @route   GET /api/v1/admin/departments
// @desc    List all academic departments with HOD details and enrolled student counts
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.getDepartments() -> AdminModel.getDepartments()
router.get('/departments', AdminController.getDepartments);

// @route   POST /api/v1/admin/departments
// @desc    Create a new academic department in the institutional structure
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.createDepartment() -> AdminModel.createDepartment()
router.post('/departments', [
  body('name').trim().notEmpty().withMessage('Department name required'),
  body('code').trim().notEmpty().withMessage('Department code required'),
  validate
], AdminController.createDepartment);

// @route   PUT /api/v1/admin/departments/:id
// @desc    Update department name, code, degree duration, or active status
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.updateDepartment() -> AdminModel.updateDepartment()
router.put('/departments/:id', [
  param('id').isInt(),
  body('name').optional().trim().notEmpty(),
  body('code').optional().trim().notEmpty(),
  body('degree_duration_years').optional().isInt({ min: 1, max: 6 }),
  validate
], AdminController.updateDepartment);

// @route   POST /api/v1/admin/departments/:id/archive
// @desc    Archive a department and deactivate its attendance registers
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.archiveDepartment() -> AdminModel.archiveDepartment()
router.post('/departments/:id/archive', [param('id').isInt(), validate], AdminController.archiveDepartment);

// @route   DELETE /api/v1/admin/departments/:id
// @desc    Permanently delete an archived department and purge associated records
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.deleteDepartment() -> AdminModel.deleteDepartment()
router.delete('/departments/:id', [param('id').isInt(), validate], AdminController.deleteDepartment);

// @route   GET /api/v1/admin/branches
// @desc    List institutional departments mapped as academic branches
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.getBranches() -> AdminModel.getDepartments()
router.get('/branches', AdminController.getBranches);

// @route   GET /api/v1/admin/academic-years
// @desc    List all academic years in chronological order
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.getAcademicYears() -> AdminModel.getAcademicYears()
router.get('/academic-years', AdminController.getAcademicYears);

// @route   POST /api/v1/admin/academic-years
// @desc    Create a new institutional academic year definition
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.createAcademicYear() -> AdminModel.createAcademicYear()
router.post('/academic-years', [
  body('label').trim().notEmpty().withMessage('Label required (e.g. 2026-27 (Odd Semester))'),
  body('start_date').isDate().withMessage('start_date required (YYYY-MM-DD)'),
  body('end_date').isDate().withMessage('end_date required (YYYY-MM-DD)'),
  validate
], AdminController.createAcademicYear);

// @route   PUT /api/v1/admin/academic-years/:id
// @desc    Update academic year label or date ranges
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.updateAcademicYear() -> AdminModel.updateAcademicYear()
router.put('/academic-years/:id', [
  param('id').isInt(),
  body('label').optional().trim().notEmpty(),
  body('start_date').optional().isDate(),
  body('end_date').optional().isDate(),
  validate
], AdminController.updateAcademicYear);

// @route   PUT /api/v1/admin/academic-years/:id/set-current
// @desc    Set designated academic year as current active session
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.setCurrentAcademicYear() -> AdminModel.setCurrentAcademicYear()
router.put('/academic-years/:id/set-current', [param('id').isInt(), validate], AdminController.setCurrentAcademicYear);

// @route   GET /api/v1/admin/session/status
// @desc    Check status of automated academic session engine
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.getSessionStatus() -> sessionService.getSessionStatus()
router.get('/session/status', AdminController.getSessionStatus);

// @route   POST /api/v1/admin/session/sync
// @desc    Trigger manual synchronization of academic session engine
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.syncSession() -> sessionService.syncAcademicSession()
router.post('/session/sync', AdminController.syncSession);

// @route   PUT /api/v1/admin/session/config
// @desc    Update academic session calendar month boundaries configuration
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.updateSessionConfig() -> sessionService.updateSessionConfig()
router.put('/session/config', [
  body('odd_start_month').optional().isInt({ min: 1, max: 12 }),
  body('odd_end_month').optional().isInt({ min: 1, max: 12 }),
  body('even_start_month').optional().isInt({ min: 1, max: 12 }),
  body('even_end_month').optional().isInt({ min: 1, max: 12 }),
  body('default_duration_years').optional().isInt({ min: 1, max: 6 }),
  validate
], AdminController.updateSessionConfig);

// @route   PUT /api/v1/admin/session/duration
// @desc    Update degree duration years for a specific department
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.updateSessionDuration() -> sessionService.updateDepartmentDuration()
router.put('/session/duration', [
  body('department_id').isInt().withMessage('department_id required'),
  body('degree_duration_years').isInt({ min: 1, max: 6 }).withMessage('degree_duration_years must be 1-6'),
  validate
], AdminController.updateSessionDuration);

// @route   GET /api/v1/admin/hods
// @desc    Retrieve all active HOD assignments and departmental leadership info
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.getHods() -> AdminModel.getHODs()
router.get('/hods', AdminController.getHods);

// @route   POST /api/v1/admin/hods
// @desc    Create a new HOD user account and assign leadership of department
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.createHod() -> AdminModel.createHODTransaction()
router.post('/hods', [
  body('full_name').trim().notEmpty().withMessage('Full name required'),
  body('email').isEmail().withMessage('Valid institutional Gmail required'),
  body('password').trim().notEmpty().withMessage('Password required'),
  body('department_id').isInt().withMessage('Department ID required'),
  body('phone').optional().trim(),
  body('employee_id').optional().trim(),
  validate
], AdminController.createHod);

// @route   PUT /api/v1/admin/hods/:teacher_id/department
// @desc    Reassign an existing HOD to another department
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.reassignHodDepartment() -> AdminModel.reassignHOD()
router.put('/hods/:teacher_id/department', [
  param('teacher_id').isInt(),
  body('department_id').isInt().withMessage('department_id required'),
  validate
], AdminController.reassignHodDepartment);

// @route   POST /api/v1/admin/hods/:teacher_id/reset-password
// @desc    Administratively reset password for an HOD teacher account
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.resetHodPassword() -> AdminModel.resetTeacherPassword()
router.post('/hods/:teacher_id/reset-password', [
  param('teacher_id').isInt(),
  body('new_password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  validate
], AdminController.resetHodPassword);

// @route   GET /api/v1/admin/faculty/search
// @desc    Search faculty members across name, email, or employee ID
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.searchFaculty() -> AdminModel.searchFaculty()
router.get('/faculty/search', AdminController.searchFaculty);

// @route   POST /api/v1/admin/hods/assign-existing
// @desc    Appoint an existing faculty member to the HOD role of a department
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.assignExistingTeacherHod() -> AdminModel.reassignHOD()
router.post('/hods/assign-existing', [
  body('teacher_id').isInt().withMessage('teacher_id required'),
  body('department_id').isInt().withMessage('department_id required'),
  validate
], AdminController.assignExistingTeacherHod);

// @route   DELETE /api/v1/admin/hods/:teacher_id
// @desc    Remove HOD appointment from teacher while maintaining teacher account
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.removeHod() -> AdminModel.removeHOD()
router.delete('/hods/:teacher_id', [param('teacher_id').isInt(), validate], AdminController.removeHod);

// @route   GET /api/v1/admin/devices
// @desc    Retrieve list of registered IoT attendance devices
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.getDevices() -> AdminModel.getDevices()
router.get('/devices', AdminController.getDevices);

// @route   POST /api/v1/admin/devices
// @desc    Register a new IoT terminal hardware device
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.createDevice() -> AdminModel.createDevice()
router.post('/devices', [
  body('device_uid').trim().notEmpty().withMessage('Device UID required'),
  body('name').trim().notEmpty().withMessage('Device name required'),
  body('department_id').isInt(),
  body('year').isInt({ min: 1, max: 4 }),
  body('semester').isInt({ min: 1, max: 8 }),
  validate
], AdminController.createDevice);

// @route   GET /api/v1/admin/settings
// @desc    Retrieve all institutional system configuration settings
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.getSettings() -> AdminModel.getSettings()
router.get('/settings', AdminController.getSettings);

// @route   PUT /api/v1/admin/settings
// @desc    Update institutional system configuration key-value settings
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.updateSettings() -> AdminModel.updateSettings()
router.put('/settings', [
  body('settings').isObject().withMessage('settings object required'),
  validate
], AdminController.updateSettings);

// @route   GET /api/v1/admin/reports/department
// @route   GET /api/v1/admin/reports/attendance
// @desc    Compile and return department attendance analytics and scan logs
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.getDepartmentReports() -> AdminModel.getDepartmentReportsData()
router.get(['/reports/department', '/reports/attendance'], AdminController.getDepartmentReports);

// @route   GET /api/v1/admin/reports/export
// @route   POST /api/v1/admin/reports/export
// @desc    Export department attendance reports formatted as Excel workbook
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.exportDepartmentReports() -> AdminModel.getDepartmentReportsData() -> excelExportService
router.get('/reports/export', AdminController.exportDepartmentReports);
router.post('/reports/export', AdminController.exportDepartmentReports);

// @route   POST /api/v1/admin/attendance/corrections
// @desc    Correct attendance record status post-finalization with required audit justification
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.applyAttendanceCorrection() -> AdminModel.applyAttendanceCorrection()
router.post('/attendance/corrections', [
  body('register_record_id').isInt().withMessage('register_record_id required'),
  body('new_status').isIn(['PRESENT', 'ABSENT', 'LATE']).withMessage('new_status must be PRESENT, ABSENT, or LATE'),
  body('reason').trim().isLength({ min: 10 }).withMessage('Reason must be at least 10 characters'),
  validate
], AdminController.applyAttendanceCorrection);

// @route   GET /api/v1/admin/audit
// @route   GET /api/v1/admin/audit-logs
// @desc    Search and paginate system audit logs with multi-column filtering
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.getAuditLogs() -> auditService.getAuditLogs()
router.get(['/audit', '/audit-logs'], AdminController.getAuditLogs);

// @route   GET /api/v1/admin/hierarchy
// @desc    Retrieve institutional hierarchy tree of departments, teachers, and student cohorts
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.getHierarchy() -> AdminModel.getHierarchy()
router.get('/hierarchy', AdminController.getHierarchy);

// @route   GET /api/v1/admin/students/analytics
// @desc    Retrieve student demographic analytics, biometric coverage, and cohort breakdown
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.getStudentAnalytics() -> AdminModel.getStudentAnalytics()
router.get('/students/analytics', AdminController.getStudentAnalytics);

// @route   GET /api/v1/admin/students/roster
// @desc    Paginated student roster listing with department and biometric details
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.getStudentRoster() -> AdminModel.getStudentRoster()
router.get('/students/roster', AdminController.getStudentRoster);

// @route   GET /api/v1/admin/profile
// @desc    Retrieve current authenticated admin profile
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.getProfile() -> AdminModel.getAdminProfile()
router.get('/profile', AdminController.getProfile);

// @route   PUT /api/v1/admin/profile
// @desc    Update admin profile email or password with verification of current password
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.updateProfile() -> AdminModel.updateAdminProfile()
router.put('/profile', [
  body('email').optional().isEmail().withMessage('Valid email required'),
  body('current_password').optional().trim(),
  body('new_password').optional().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  validate
], AdminController.updateProfile);

// @route   GET /api/v1/admin/registrations/pending-hods
// @desc    List pending HOD self-registration requests awaiting administrative adjudication
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.getPendingHods() -> AdminModel.getPendingHODRegistrations()
router.get(['/registrations/pending-hods', '/hods/pending'], AdminController.getPendingHods);

// @route   POST /api/v1/admin/registrations/hods/:id/approve
// @desc    Approve a pending HOD registration, creating user account and departmental HOD assignment
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.approveHodRegistration() -> AdminModel.approveHODRegistration()
router.post('/registrations/hods/:id/approve', [param('id').isInt(), validate], AdminController.approveHodRegistration);

// @route   POST /api/v1/admin/registrations/hods/:id/reject
// @desc    Reject a pending HOD registration request with reason
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.rejectHodRegistration() -> AdminModel.rejectHODRegistration()
router.post('/registrations/hods/:id/reject', [
  param('id').isInt(),
  body('reason').optional().trim(),
  validate
], AdminController.rejectHodRegistration);

// @route   GET /api/v1/admin/common-faculty-manager
// @desc    Retrieve the currently designated Common Faculty Manager
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.getCommonFacultyManager() -> AdminModel.getCommonFacultyManager()
router.get('/common-faculty-manager', AdminController.getCommonFacultyManager);

// @route   POST /api/v1/admin/common-faculty-manager
// @desc    Assign a faculty member as the institutional Common Faculty Manager
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.assignCommonFacultyManager() -> AdminModel.assignCommonFacultyManager()
router.post('/common-faculty-manager', [
  body('teacher_id').isInt().withMessage('teacher_id is required'),
  validate
], AdminController.assignCommonFacultyManager);

// @route   DELETE /api/v1/admin/common-faculty-manager
// @desc    Remove active Common Faculty Manager designation
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.removeCommonFacultyManager() -> AdminModel.removeCommonFacultyManager()
router.delete('/common-faculty-manager', AdminController.removeCommonFacultyManager);

// @route   GET /api/v1/admin/teachers
// @desc    List all active teachers across all departments
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.getAllTeachers() -> AdminModel.getAllTeachers()
router.get('/teachers', AdminController.getAllTeachers);

// @route   GET /api/v1/admin/registration-gates
// @desc    Retrieve state of registration gates for HOD and Common Faculty
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.getRegistrationGates() -> AdminModel.getRegistrationGates()
router.get('/registration-gates', AdminController.getRegistrationGates);

// @route   POST /api/v1/admin/registration-gates/toggle
// @desc    Toggle open/closed state of institutional registration gate (HOD or COMMON_FACULTY)
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.toggleRegistrationGate() -> AdminModel.toggleRegistrationGate()
router.post('/registration-gates/toggle', [
  body('target').isIn(['HOD', 'COMMON_FACULTY']).withMessage('target must be HOD or COMMON_FACULTY'),
  body('open').isBoolean().withMessage('open flag (boolean) is required'),
  validate
], AdminController.toggleRegistrationGate);

// @route   GET /api/v1/admin/administrators
// @desc    List all system administrator accounts
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.getAdministrators() -> AdminModel.getAdministrators()
router.get('/administrators', AdminController.getAdministrators);

// @route   POST /api/v1/admin/administrators
// @desc    Create a new permanent system administrator in database
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.createAdministrator() -> AdminModel.createAdministrator()
router.post('/administrators', [
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('full_name').trim().isLength({ min: 2 }).withMessage('Full name required (min 2 chars)'),
  body('phone').optional().trim(),
  body('employee_id').optional().trim(),
  validate
], AdminController.createAdministrator);

// @route   DELETE /api/v1/admin/administrators/:id
// @desc    Remove an administrator account
// @access  Protected (SYSTEM_ADMIN)
// @handler AdminController.deleteAdministrator() -> AdminModel.deleteAdministrator()
router.delete('/administrators/:id', [
  param('id').isInt().withMessage('Valid user ID required'),
  validate
], AdminController.deleteAdministrator);

module.exports = router;
