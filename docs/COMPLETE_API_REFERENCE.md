# VidyaOS Backend — Complete REST API Reference (All 308+ Endpoints)

> **Base URL**: `/api/v1`  
> **Database Engine**: Pure MySQL 8.x / MariaDB (`mysql2/promise` pool)  
> **Authentication**: `Authorization: Bearer <access_token>` (or `HttpOnly` cookie `accessToken`) + `X-Device-Id` header.

## 1. Public & System Health Endpoints (`server.js`)

| Method | Endpoint Path | Auth / Role | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/health`, `/ping`, `/api/v1/health`, `/api/v1/ping` | Public | Returns server uptime, timestamp, and `ONLINE` status (used by Render keep-alive and login pre-warming). |
| `GET` | `/api/v1/departments`, `/api/v1/auth/departments` | Public | Returns active institutional departments (`CE`, `IT`, `ME`, `EE`, `ECE`, `PHARM`) for registration dropdowns. |
| `GET` | `/api/v1/settings/institution`, `/api/v1/auth/institution-profile`, `/api/v1/admin/settings/public` | Public | Returns institutional branding (`institution_name`, `institution_code`, `institution_logo_url`, `institution_banner_url`, `institution_affiliation`). |

## 2. Authentication, Registration, OTP, OAuth, Sessions & Password Lifecycle (`src/routes/auth.js`)
**Mount Prefix**: `/api/v1/auth`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `POST` | `/faculty/login` | `/api/v1/auth/faculty/login` | `AuthController.facultyLogin` (authLimiter) |
| `GET` | `/me` | `/api/v1/auth/me` | `AuthController.getMe` (Protected) |
| `POST` | `/student/login` | `/api/v1/auth/student/login` | `AuthController.studentLogin` (authLimiter) |
| `POST` | `/login` | `/api/v1/auth/login` | `AuthController.login` (authLimiter) |
| `POST` | `/change-password` | `/api/v1/auth/change-password` | `AuthController.changePassword` (Protected) |
| `GET` | `/google/config` | `/api/v1/auth/google/config` | `AuthController.getGoogleConfig` (Protected) |
| `GET` | `/google/url` | `/api/v1/auth/google/url` | `AuthController.getGoogleUrl` (Protected) |
| `GET` | `/google/callback` | `/api/v1/auth/google/callback` | `AuthController.handleGoogleCallback` (Protected) |
| `POST` | `/google/save-credentials` | `/api/v1/auth/google/save-credentials` | `AuthController.saveGoogleCredentials` (Protected) |
| `POST` | `/google/link` | `/api/v1/auth/google/link` | `AuthController.linkGoogleAccount` (Protected) |
| `POST` | `/google` | `/api/v1/auth/google` | `AuthController.googleLogin` (authLimiter) |
| `POST` | `/refresh` | `/api/v1/auth/refresh` | `AuthController.refreshToken` (Protected) |
| `POST` | `/logout` | `/api/v1/auth/logout` | `AuthController.logout` (Protected) |
| `GET` | `/heartbeat` | `/api/v1/auth/heartbeat` | `AuthController.heartbeat` (Protected) |
| `POST` | `/student/activate` | `/api/v1/auth/student/activate` | `AuthController.activateStudent` (Protected) |
| `GET` | `/student/registration/cohorts` | `/api/v1/auth/student/registration/cohorts` | `AuthController.getRegistrationCohorts` (Protected) |
| `GET` | `/departments` | `/api/v1/auth/departments` | `AuthController.getDepartments` (Protected) |
| `GET` | `/registration-gates` | `/api/v1/auth/registration-gates` | `AuthController.getRegistrationGates` (Protected) |
| `GET` | `/student/registration/status` | `/api/v1/auth/student/registration/status` | `AuthController.getStudentRegistrationStatus` (Protected) |
| `POST` | `/student/register` | `/api/v1/auth/student/register` | `AuthController.registerStudent` (authLimiter) |
| `POST` | `/faculty/register` | `/api/v1/auth/faculty/register` | `AuthController.registerFaculty` (authLimiter) |

## 3. System Administration, Departments, Academic Years, HODs, Teachers, Branding & Audit Logs (`src/routes/admin.js`)
**Mount Prefix**: `/api/v1/admin`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `GET` | `/stats` | `/api/v1/admin/stats` | `AdminController.getStats` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/departments` | `/api/v1/admin/departments` | `AdminController.getDepartments` (auth, requireRole('SYSTEM_ADMIN') |
| `POST` | `/departments` | `/api/v1/admin/departments` | `AdminController.createDepartment` (auth, requireRole('SYSTEM_ADMIN') |
| `PUT` | `/departments/:id` | `/api/v1/admin/departments/:id` | `AdminController.updateDepartment` (auth, requireRole('SYSTEM_ADMIN') |
| `POST` | `/departments/:id/archive` | `/api/v1/admin/departments/:id/archive` | `AdminController.archiveDepartment` (auth, requireRole('SYSTEM_ADMIN') |
| `DELETE` | `/departments/:id` | `/api/v1/admin/departments/:id` | `AdminController.deleteDepartment` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/branches` | `/api/v1/admin/branches` | `AdminController.getBranches` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/academic-years` | `/api/v1/admin/academic-years` | `AdminController.getAcademicYears` (auth, requireRole('SYSTEM_ADMIN') |
| `POST` | `/academic-years` | `/api/v1/admin/academic-years` | `AdminController.createAcademicYear` (auth, requireRole('SYSTEM_ADMIN') |
| `PUT` | `/academic-years/:id` | `/api/v1/admin/academic-years/:id` | `AdminController.updateAcademicYear` (auth, requireRole('SYSTEM_ADMIN') |
| `PUT` | `/academic-years/:id/set-current` | `/api/v1/admin/academic-years/:id/set-current` | `AdminController.setCurrentAcademicYear` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/session/status` | `/api/v1/admin/session/status` | `AdminController.getSessionStatus` (auth, requireRole('SYSTEM_ADMIN') |
| `POST` | `/session/sync` | `/api/v1/admin/session/sync` | `AdminController.syncSession` (auth, requireRole('SYSTEM_ADMIN') |
| `PUT` | `/session/config` | `/api/v1/admin/session/config` | `AdminController.updateSessionConfig` (auth, requireRole('SYSTEM_ADMIN') |
| `PUT` | `/session/duration` | `/api/v1/admin/session/duration` | `AdminController.updateSessionDuration` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/hods` | `/api/v1/admin/hods` | `AdminController.getHods` (auth, requireRole('SYSTEM_ADMIN') |
| `POST` | `/hods` | `/api/v1/admin/hods` | `AdminController.createHod` (auth, requireRole('SYSTEM_ADMIN') |
| `PUT` | `/hods/:teacher_id/department` | `/api/v1/admin/hods/:teacher_id/department` | `AdminController.reassignHodDepartment` (auth, requireRole('SYSTEM_ADMIN') |
| `POST` | `/hods/:teacher_id/reset-password` | `/api/v1/admin/hods/:teacher_id/reset-password` | `AdminController.resetHodPassword` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/faculty/search` | `/api/v1/admin/faculty/search` | `AdminController.searchFaculty` (auth, requireRole('SYSTEM_ADMIN') |
| `POST` | `/hods/assign-existing` | `/api/v1/admin/hods/assign-existing` | `AdminController.assignExistingTeacherHod` (auth, requireRole('SYSTEM_ADMIN') |
| `DELETE` | `/hods/:teacher_id` | `/api/v1/admin/hods/:teacher_id` | `AdminController.removeHod` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/devices` | `/api/v1/admin/devices` | `AdminController.getDevices` (auth, requireRole('SYSTEM_ADMIN') |
| `POST` | `/devices` | `/api/v1/admin/devices` | `AdminController.createDevice` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/settings` | `/api/v1/admin/settings` | `AdminController.getSettings` (auth, requireRole('SYSTEM_ADMIN') |
| `PUT` | `/settings` | `/api/v1/admin/settings` | `AdminController.updateSettings` (auth, requireRole('SYSTEM_ADMIN') |
| `POST` | `/branding/upload` | `/api/v1/admin/branding/upload` | `async (req, res)` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/reports/department` | `/api/v1/admin/reports/department` | `AdminController.getDepartmentReports` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/reports/attendance` | `/api/v1/admin/reports/attendance` | `AdminController.getDepartmentReports` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/reports/export` | `/api/v1/admin/reports/export` | `AdminController.exportDepartmentReports` (auth, requireRole('SYSTEM_ADMIN') |
| `POST` | `/reports/export` | `/api/v1/admin/reports/export` | `AdminController.exportDepartmentReports` (auth, requireRole('SYSTEM_ADMIN') |
| `POST` | `/attendance/corrections` | `/api/v1/admin/attendance/corrections` | `AdminController.applyAttendanceCorrection` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/audit` | `/api/v1/admin/audit` | `AdminController.getAuditLogs` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/audit-logs` | `/api/v1/admin/audit-logs` | `AdminController.getAuditLogs` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/hierarchy` | `/api/v1/admin/hierarchy` | `AdminController.getHierarchy` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/students/analytics` | `/api/v1/admin/students/analytics` | `AdminController.getStudentAnalytics` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/students/roster` | `/api/v1/admin/students/roster` | `AdminController.getStudentRoster` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/profile` | `/api/v1/admin/profile` | `AdminController.getProfile` (auth, requireRole('SYSTEM_ADMIN') |
| `PUT` | `/profile` | `/api/v1/admin/profile` | `AdminController.updateProfile` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/registrations/pending-hods` | `/api/v1/admin/registrations/pending-hods` | `AdminController.getPendingHods` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/hods/pending` | `/api/v1/admin/hods/pending` | `AdminController.getPendingHods` (auth, requireRole('SYSTEM_ADMIN') |
| `POST` | `/registrations/hods/:id/approve` | `/api/v1/admin/registrations/hods/:id/approve` | `AdminController.approveHodRegistration` (auth, requireRole('SYSTEM_ADMIN') |
| `POST` | `/registrations/hods/:id/reject` | `/api/v1/admin/registrations/hods/:id/reject` | `AdminController.rejectHodRegistration` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/common-faculty-manager` | `/api/v1/admin/common-faculty-manager` | `AdminController.getCommonFacultyManager` (auth, requireRole('SYSTEM_ADMIN') |
| `POST` | `/common-faculty-manager` | `/api/v1/admin/common-faculty-manager` | `AdminController.assignCommonFacultyManager` (auth, requireRole('SYSTEM_ADMIN') |
| `DELETE` | `/common-faculty-manager` | `/api/v1/admin/common-faculty-manager` | `AdminController.removeCommonFacultyManager` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/teachers` | `/api/v1/admin/teachers` | `AdminController.getAllTeachers` (auth, requireRole('SYSTEM_ADMIN') |
| `POST` | `/teachers` | `/api/v1/admin/teachers` | `[ body('full_name').custom((val, { req }) => { const name = ` (auth, requireRole('SYSTEM_ADMIN') |
| `PUT` | `/teachers/:id` | `/api/v1/admin/teachers/:id` | `AdminController.updateFaculty` (auth, requireRole('SYSTEM_ADMIN') |
| `PATCH` | `/teachers/:id/status` | `/api/v1/admin/teachers/:id/status` | `AdminController.toggleFacultyStatus` (auth, requireRole('SYSTEM_ADMIN') |
| `POST` | `/teachers/:id/reset-password` | `/api/v1/admin/teachers/:id/reset-password` | `[ param('id').isInt(), body('new_password').custom((val, { r` (auth, requireRole('SYSTEM_ADMIN') |
| `DELETE` | `/teachers/:id` | `/api/v1/admin/teachers/:id` | `AdminController.deleteFaculty` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/trash/faculty` | `/api/v1/admin/trash/faculty` | `AdminController.getTrashFaculty` (auth, requireRole('SYSTEM_ADMIN') |
| `POST` | `/trash/faculty/:id/restore` | `/api/v1/admin/trash/faculty/:id/restore` | `AdminController.restoreFaculty` (auth, requireRole('SYSTEM_ADMIN') |
| `DELETE` | `/trash/faculty/:id/permanent` | `/api/v1/admin/trash/faculty/:id/permanent` | `AdminController.permanentDeleteFaculty` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/registration-gates` | `/api/v1/admin/registration-gates` | `AdminController.getRegistrationGates` (auth, requireRole('SYSTEM_ADMIN') |
| `PUT` | `/registration-gates` | `/api/v1/admin/registration-gates` | `AdminController.updateRegistrationGates` (auth, requireRole('SYSTEM_ADMIN') |
| `POST` | `/registration-gates/toggle` | `/api/v1/admin/registration-gates/toggle` | `AdminController.toggleRegistrationGate` (auth, requireRole('SYSTEM_ADMIN') |
| `GET` | `/administrators` | `/api/v1/admin/administrators` | `AdminController.getAdministrators` (auth, requireRole('SYSTEM_ADMIN') |
| `POST` | `/administrators` | `/api/v1/admin/administrators` | `AdminController.createAdministrator` (auth, requireRole('SYSTEM_ADMIN') |
| `DELETE` | `/administrators/:id` | `/api/v1/admin/administrators/:id` | `AdminController.deleteAdministrator` (auth, requireRole('SYSTEM_ADMIN') |

## 4. Head of Department (HOD) Command Center, Faculty Approvals, Cohort Allocations & Alumni Archive (`src/routes/hod.js`)
**Mount Prefix**: `/api/v1/hod`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `GET` | `/dashboard` | `/api/v1/hod/dashboard` | `HodController.getDashboard` (requireHOD) |
| `GET` | `/teachers` | `/api/v1/hod/teachers` | `HodController.getTeachers` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `POST` | `/teachers` | `/api/v1/hod/teachers` | `HodController.createTeacher` (requireHOD) |
| `GET` | `/teachers/:id` | `/api/v1/hod/teachers/:id` | `HodController.getTeacherById` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `PUT` | `/teachers/:id` | `/api/v1/hod/teachers/:id` | `HodController.updateTeacher` (requireHOD) |
| `POST` | `/teachers/:id/reset-password` | `/api/v1/hod/teachers/:id/reset-password` | `HodController.resetTeacherPassword` (requireHOD) |
| `DELETE` | `/teachers/:id` | `/api/v1/hod/teachers/:id` | `HodController.deleteTeacher` (requireHOD) |
| `GET` | `/faculty-roster` | `/api/v1/hod/faculty-roster` | `HodController.getFacultyRoster` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `GET` | `/students-roster` | `/api/v1/hod/students-roster` | `HodController.getStudentsRoster` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `GET` | `/department-classes` | `/api/v1/hod/department-classes` | `HodController.getDepartmentClasses` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `GET` | `/department-classes/:registerId/attendance` | `/api/v1/hod/department-classes/:registerId/attendance` | `HodController.getDepartmentClassAttendance` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `GET` | `/subjects` | `/api/v1/hod/subjects` | `HodController.getSubjects` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `POST` | `/subjects` | `/api/v1/hod/subjects` | `HodController.createSubject` (requireHOD) |
| `PUT` | `/subjects/:id` | `/api/v1/hod/subjects/:id` | `HodController.updateSubject` (requireHOD) |
| `DELETE` | `/subjects/:id` | `/api/v1/hod/subjects/:id` | `HodController.deleteSubject` (requireHOD) |
| `GET` | `/assignments` | `/api/v1/hod/assignments` | `HodController.getAssignments` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `POST` | `/assignments/subject-teacher` | `/api/v1/hod/assignments/subject-teacher` | `HodController.createSubjectTeacherAssignment` (requireHOD) |
| `POST` | `/assignments/class-teacher` | `/api/v1/hod/assignments/class-teacher` | `HodController.createClassTeacherAssignment` (requireHOD) |
| `DELETE` | `/assignments/:id` | `/api/v1/hod/assignments/:id` | `HodController.deleteAssignment` (requireHOD) |
| `GET` | `/reports` | `/api/v1/hod/reports` | `HodController.getReports` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `GET` | `/devices` | `/api/v1/hod/devices` | `HodController.getDevices` (requireHOD) |
| `POST` | `/devices` | `/api/v1/hod/devices` | `HodController.createDevice` (requireHOD) |
| `PATCH` | `/devices/:id/toggle` | `/api/v1/hod/devices/:id/toggle` | `HodController.toggleDevice` (requireHOD) |
| `DELETE` | `/devices/:id` | `/api/v1/hod/devices/:id` | `HodController.deleteDevice` (requireHOD) |
| `GET` | `/students` | `/api/v1/hod/students` | `HodController.getStudents` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `POST` | `/students` | `/api/v1/hod/students` | `HodController.createStudent` (requireHOD) |
| `POST` | `/students/bulk` | `/api/v1/hod/students/bulk` | `HodController.bulkCreateStudents` (requireHOD) |
| `DELETE` | `/students/:id` | `/api/v1/hod/students/:id` | `HodController.deleteStudent` (requireHOD) |
| `POST` | `/students/:id/reset-password` | `/api/v1/hod/students/:id/reset-password` | `HodController.resetStudentPassword` (requireHOD) |
| `POST` | `/students/reindex-roll` | `/api/v1/hod/students/reindex-roll` | `HodController.reindexRoll` (requireHOD) |
| `GET` | `/promotion/preview` | `/api/v1/hod/promotion/preview` | `HodController.getPromotionPreview` (requireHOD) |
| `POST` | `/promotion/execute` | `/api/v1/hod/promotion/execute` | `HodController.executePromotion` (requireHOD) |
| `GET` | `/hierarchy` | `/api/v1/hod/hierarchy` | `HodController.getHierarchy` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `GET` | `/archive/batches` | `/api/v1/hod/archive/batches` | `HodController.getArchiveBatches` (requireHOD) |
| `GET` | `/archive` | `/api/v1/hod/archive` | `HodController.getArchive` (requireHOD) |
| `GET` | `/registrations/pending-faculty` | `/api/v1/hod/registrations/pending-faculty` | `HodController.getPendingFacultyRegistrations` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `GET` | `/faculty-registrations/pending` | `/api/v1/hod/faculty-registrations/pending` | `HodController.getPendingFacultyRegistrations` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `POST` | `/registrations/faculty/:id/approve` | `/api/v1/hod/registrations/faculty/:id/approve` | `HodController.approveFacultyRegistration` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `POST` | `/faculty-registrations/:id/approve` | `/api/v1/hod/faculty-registrations/:id/approve` | `HodController.approveFacultyRegistration` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `POST` | `/registrations/faculty/:id/reject` | `/api/v1/hod/registrations/faculty/:id/reject` | `HodController.rejectFacultyRegistration` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `POST` | `/faculty-registrations/:id/reject` | `/api/v1/hod/faculty-registrations/:id/reject` | `HodController.rejectFacultyRegistration` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `POST` | `/faculty-registrations/:id/adjudicate` | `/api/v1/hod/faculty-registrations/:id/adjudicate` | `HodController.adjudicateFacultyRegistration` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `POST` | `/registrations/faculty/:id/adjudicate` | `/api/v1/hod/registrations/faculty/:id/adjudicate` | `HodController.adjudicateFacultyRegistration` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `GET` | `/faculty-registration-status` | `/api/v1/hod/faculty-registration-status` | `HodController.getFacultyRegistrationStatus` (requireHOD) |
| `POST` | `/faculty-registration-toggle` | `/api/v1/hod/faculty-registration-toggle` | `HodController.toggleFacultyRegistration` (requireHOD) |

## 5. Faculty Dashboard, 31-Day Attendance Registers, Internal Evaluation & Excel Exports (`src/routes/faculty.js`)
**Mount Prefix**: `/api/v1/faculty`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `GET` | `/dashboard` | `/api/v1/faculty/dashboard` | `FacultyController.getDashboard` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `GET` | `/registers` | `/api/v1/faculty/registers` | `FacultyController.getRegisters` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `GET` | `/my-students` | `/api/v1/faculty/my-students` | `FacultyController.getMyStudents` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `GET` | `/registers/:id` | `/api/v1/faculty/registers/:id` | `FacultyController.getRegisterDetail` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `PUT` | `/registers/:id/mark-cell` | `/api/v1/faculty/registers/:id/mark-cell` | `FacultyController.markCell` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `PUT` | `/registers/:id/student-status` | `/api/v1/faculty/registers/:id/student-status` | `FacultyController.updateStudentStatus` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `POST` | `/registers` | `/api/v1/faculty/registers` | `FacultyController.createPersonalRegister` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `POST` | `/registers/:id/sessions` | `/api/v1/faculty/registers/:id/sessions` | `FacultyController.createSession` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `DELETE` | `/registers/:id/sessions/:sessionId` | `/api/v1/faculty/registers/:id/sessions/:sessionId` | `FacultyController.deleteSession` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `GET` | `/cohorts` | `/api/v1/faculty/cohorts` | `FacultyController.getCohorts` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `GET` | `/subjects` | `/api/v1/faculty/subjects` | `FacultyController.getSubjects` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `GET` | `/cohorts/students` | `/api/v1/faculty/cohorts/students` | `FacultyController.getCohortStudents` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `GET` | `/cohorts/biometrics` | `/api/v1/faculty/cohorts/biometrics` | `FacultyController.getCohortBiometrics` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `POST` | `/cohorts/registration-toggle` | `/api/v1/faculty/cohorts/registration-toggle` | `FacultyController.toggleCohortRegistration` (requireDepartmentFaculty) |
| `GET` | `/cohorts/registration-status` | `/api/v1/faculty/cohorts/registration-status` | `FacultyController.getCohortRegistrationStatus` (requireDepartmentFaculty) |
| `GET` | `/profile` | `/api/v1/faculty/profile` | `FacultyController.getProfile` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `PUT` | `/profile` | `/api/v1/faculty/profile` | `FacultyController.updateProfile` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `GET` | `/my-classes` | `/api/v1/faculty/my-classes` | `FacultyController.getMyClasses` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `GET` | `/registers/:id/internal-evaluation` | `/api/v1/faculty/registers/:id/internal-evaluation` | `FacultyController.getInternalEvaluation` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `GET` | `/registers/:id/export/internal-evaluation-excel` | `/api/v1/faculty/registers/:id/export/internal-evaluation-excel` | `FacultyController.exportInternalEvaluationExcel` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `POST` | `/registers/:id/export/internal-evaluation-excel` | `/api/v1/faculty/registers/:id/export/internal-evaluation-excel` | `FacultyController.exportInternalEvaluationExcelCustom` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `POST` | `/registers/:id/export/unit-tests-summary-excel` | `/api/v1/faculty/registers/:id/export/unit-tests-summary-excel` | `FacultyController.exportUnitTestsSummaryExcel` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `POST` | `/registers/:id/export/all-tests-excel` | `/api/v1/faculty/registers/:id/export/all-tests-excel` | `FacultyController.exportUnitTestsSummaryExcel` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `POST` | `/registers/:id/export/attendance` | `/api/v1/faculty/registers/:id/export/attendance` | `FacultyController.exportAttendanceRegister` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `POST` | `/export/table-to-excel` | `/api/v1/faculty/export/table-to-excel` | `FacultyController.exportTableToExcel` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |
| `GET` | `/common/pending` | `/api/v1/faculty/common/pending` | `FacultyController.getCommonPending` (requireCommonFacultyManager) |
| `POST` | `/common/:id/approve` | `/api/v1/faculty/common/:id/approve` | `FacultyController.approveCommon` (requireCommonFacultyManager) |
| `POST` | `/common/:id/reject` | `/api/v1/faculty/common/:id/reject` | `FacultyController.rejectCommon` (requireCommonFacultyManager) |
| `GET` | `/common/members` | `/api/v1/faculty/common/members` | `FacultyController.getCommonMembers` (requireCommonFacultyManager) |
| `PUT` | `/session-header` | `/api/v1/faculty/session-header` | `async (req, res)` (auth, requireRole('TEACHER', 'SYSTEM_ADMIN') |

## 6. Student Self-Service Profile, Attendance Telemetry, Provisioning & Registration Adjudication (`src/routes/students.js`)
**Mount Prefix**: `/api/v1/students (and /api/v1/student)`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | `/api/v1/students` | `StudentController.getStudents` (requireRole) |
| `GET` | `/me` | `/api/v1/students/me` | `StudentController.getProfile` (requireRole) |
| `GET` | `/teaching-groups` | `/api/v1/students/teaching-groups` | `TeachingGroupController.getStudentGroups` (requireRole) |
| `GET` | `/courses` | `/api/v1/students/courses` | `TeachingGroupController.getStudentGroups` (requireRole) |
| `GET` | `/classes` | `/api/v1/students/classes` | `TeachingGroupController.getStudentGroups` (requireRole) |
| `PUT` | `/me` | `/api/v1/students/me` | `StudentController.updateProfile` (requireRole) |
| `GET` | `/me/attendance/stats` | `/api/v1/students/me/attendance/stats` | `StudentController.getAttendanceStats` (requireRole) |
| `GET` | `/me/attendance/subjects` | `/api/v1/students/me/attendance/subjects` | `StudentController.getAttendanceSubjects` (requireRole) |
| `GET` | `/me/attendance` | `/api/v1/students/me/attendance` | `StudentController.getAttendanceHistory` (requireRole) |
| `POST` | `/provision` | `/api/v1/students/provision` | `StudentController.provisionStudent` (requireRole, requireDepartmentFaculty) |
| `POST` | `/provision/bulk` | `/api/v1/students/provision/bulk` | `StudentController.bulkProvision` (requireRole, requireDepartmentFaculty) |
| `GET` | `/registrations/pending` | `/api/v1/students/registrations/pending` | `StudentController.listPendingRegistrations` (requireRole, requireDepartmentFaculty) |
| `GET` | `/registrations/count` | `/api/v1/students/registrations/count` | `StudentController.countPendingRegistrations` (requireRole, requireDepartmentFaculty) |
| `POST` | `/registrations/:id/adjudicate` | `/api/v1/students/registrations/:id/adjudicate` | `StudentController.adjudicateRegistration` (requireRole, requireDepartmentFaculty) |
| `POST` | `/registrations/:id/approve` | `/api/v1/students/registrations/:id/approve` | `StudentController.adjudicateRegistration` (requireRole, requireDepartmentFaculty) |
| `POST` | `/:id/approve` | `/api/v1/students/:id/approve` | `StudentController.adjudicateRegistration` (requireRole, requireDepartmentFaculty) |
| `POST` | `/:id/transfer-department` | `/api/v1/students/:id/transfer-department` | `StudentController.transferDepartment` (requireRole) |
| `GET` | `/:id/department-history` | `/api/v1/students/:id/department-history` | `StudentController.getDepartmentHistory` (Protected) |
| `GET` | `/:id/academic-dossier` | `/api/v1/students/:id/academic-dossier` | `StudentController.getAcademicDossier` (Protected) |

## 7. Google Classroom-Style Teaching Groups, Stream Posts, Comments, Classwork & Unit Tests (`src/routes/teachingGroups.js`)
**Mount Prefix**: `/api/v1/teaching-groups`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `GET` | `/overview` | `/api/v1/teaching-groups/overview` | `TeachingGroupController.getOverview` (Protected) |
| `GET` | `/` | `/api/v1/teaching-groups` | `TeachingGroupController.listGroups` (Protected) |
| `GET` | `/teacher/my-groups` | `/api/v1/teaching-groups/teacher/my-groups` | `TeachingGroupController.listGroups` (Protected) |
| `GET` | `/my-groups` | `/api/v1/teaching-groups/my-groups` | `TeachingGroupController.listGroups` (Protected) |
| `POST` | `/` | `/api/v1/teaching-groups` | `TeachingGroupController.createGroup` (requireRole) |
| `POST` | `/join` | `/api/v1/teaching-groups/join` | `TeachingGroupController.joinGroup` (requireRole) |
| `GET` | `/student/my-groups` | `/api/v1/teaching-groups/student/my-groups` | `TeachingGroupController.getStudentGroups` (requireRole) |
| `GET` | `/student/my-classes` | `/api/v1/teaching-groups/student/my-classes` | `TeachingGroupController.getStudentGroups` (requireRole) |
| `GET` | `/my-classes` | `/api/v1/teaching-groups/my-classes` | `TeachingGroupController.getStudentGroups` (Protected) |
| `GET` | `/:id` | `/api/v1/teaching-groups/:id` | `TeachingGroupController.getGroupDetails` (Protected) |
| `PUT` | `/:id` | `/api/v1/teaching-groups/:id` | `TeachingGroupController.editGroup` (requireRole) |
| `POST` | `/:id/units` | `/api/v1/teaching-groups/:id/units` | `TeachingGroupController.saveUnit` (requireRole) |
| `GET` | `/:id/members` | `/api/v1/teaching-groups/:id/members` | `TeachingGroupController.getMembers` (Protected) |
| `POST` | `/:id/members` | `/api/v1/teaching-groups/:id/members` | `TeachingGroupController.addMembers` (requireRole, requireTeachingGroupOwner) |
| `DELETE` | `/:id/members/:studentId` | `/api/v1/teaching-groups/:id/members/:studentId` | `TeachingGroupController.removeMember` (requireRole, requireTeachingGroupOwner) |
| `GET` | `/:id/unenrolled-students` | `/api/v1/teaching-groups/:id/unenrolled-students` | `TeachingGroupController.getUnenrolledStudents` (requireRole) |
| `POST` | `/:id/archive` | `/api/v1/teaching-groups/:id/archive` | `TeachingGroupController.archiveGroup` (Protected) |
| `POST` | `/:id/unarchive` | `/api/v1/teaching-groups/:id/unarchive` | `TeachingGroupController.unarchiveGroup` (Protected) |
| `POST` | `/:id/trash` | `/api/v1/teaching-groups/:id/trash` | `TeachingGroupController.trashGroup` (requireRole) |
| `POST` | `/:id/delete` | `/api/v1/teaching-groups/:id/delete` | `TeachingGroupController.trashGroup` (requireRole) |
| `DELETE` | `/:id` | `/api/v1/teaching-groups/:id` | `TeachingGroupController.trashGroup` (requireRole) |
| `POST` | `/:id/restore` | `/api/v1/teaching-groups/:id/restore` | `TeachingGroupController.restoreGroup` (requireRole) |
| `DELETE` | `/:id/permanent` | `/api/v1/teaching-groups/:id/permanent` | `TeachingGroupController.permanentDelete` (requireRole) |
| `POST` | `/:id/promote` | `/api/v1/teaching-groups/:id/promote` | `TeachingGroupController.promoteCohort` (requireRole, requireTeachingGroupOwner) |
| `POST` | `/broadcast-notice` | `/api/v1/teaching-groups/broadcast-notice` | `TeachingGroupController.broadcastNotice` (requireRole) |
| `POST` | `/auto-archive-expired` | `/api/v1/teaching-groups/auto-archive-expired` | `TeachingGroupController.autoArchiveExpired` (Protected) |
| `GET` | `/:id/stream` | `/api/v1/teaching-groups/:id/stream` | `TeachingGroupController.getStreamPosts` (Protected) |
| `POST` | `/:id/stream` | `/api/v1/teaching-groups/:id/stream` | `auth, (req, res, next) => { const ct = req.headers['content-` (Protected) |
| `DELETE` | `/:id/stream/:postId` | `/api/v1/teaching-groups/:id/stream/:postId` | `TeachingGroupController.deleteStreamPost` (Protected) |
| `GET` | `/posts/:postId/comments` | `/api/v1/teaching-groups/posts/:postId/comments` | `TeachingGroupController.getPostComments` (Protected) |
| `GET` | `/:id/stream/:postId/comments` | `/api/v1/teaching-groups/:id/stream/:postId/comments` | `TeachingGroupController.getPostComments` (Protected) |
| `GET` | `/:id/posts/:postId/comments` | `/api/v1/teaching-groups/:id/posts/:postId/comments` | `TeachingGroupController.getPostComments` (Protected) |
| `POST` | `/posts/:postId/comments` | `/api/v1/teaching-groups/posts/:postId/comments` | `TeachingGroupController.createPostComment` (Protected) |
| `POST` | `/:id/stream/:postId/comments` | `/api/v1/teaching-groups/:id/stream/:postId/comments` | `TeachingGroupController.createPostComment` (Protected) |
| `POST` | `/:id/posts/:postId/comments` | `/api/v1/teaching-groups/:id/posts/:postId/comments` | `TeachingGroupController.createPostComment` (Protected) |
| `GET` | `/:id/assignments` | `/api/v1/teaching-groups/:id/assignments` | `TeachingGroupController.getAssignments` (Protected) |
| `POST` | `/:id/assignments` | `/api/v1/teaching-groups/:id/assignments` | `TeachingGroupController.createAssignment` (requireRole) |
| `PUT` | `/:id/assignments/:assignmentId` | `/api/v1/teaching-groups/:id/assignments/:assignmentId` | `TeachingGroupController.editAssignment` (requireRole) |
| `GET` | `/:id/assignments/:assignmentId/submissions` | `/api/v1/teaching-groups/:id/assignments/:assignmentId/submissions` | `TeachingGroupController.getAssignmentSubmissions` (Protected) |
| `GET` | `/:id/assignments/:assignmentId/scores` | `/api/v1/teaching-groups/:id/assignments/:assignmentId/scores` | `TeachingGroupController.getAssignmentSubmissions` (Protected) |
| `POST` | `/:id/assignments/:assignmentId/scores` | `/api/v1/teaching-groups/:id/assignments/:assignmentId/scores` | `TeachingGroupController.saveAssignmentScores` (requireRole) |
| `DELETE` | `/:id/assignments/:assignmentId` | `/api/v1/teaching-groups/:id/assignments/:assignmentId` | `TeachingGroupController.deleteAssignment` (requireRole) |
| `GET` | `/:id/tests` | `/api/v1/teaching-groups/:id/tests` | `TeachingGroupController.getTests` (Protected) |
| `POST` | `/:id/tests` | `/api/v1/teaching-groups/:id/tests` | `TeachingGroupController.scheduleTest` (requireRole) |
| `PUT` | `/:id/tests/:testId` | `/api/v1/teaching-groups/:id/tests/:testId` | `TeachingGroupController.editTest` (requireRole) |
| `DELETE` | `/:id/tests/:testId` | `/api/v1/teaching-groups/:id/tests/:testId` | `TeachingGroupController.deleteTest` (requireRole) |
| `GET` | `/:id/tests/:testId/scores` | `/api/v1/teaching-groups/:id/tests/:testId/scores` | `TeachingGroupController.getTestScores` (Protected) |
| `POST` | `/:id/tests/:testId/scores` | `/api/v1/teaching-groups/:id/tests/:testId/scores` | `TeachingGroupController.saveTestScores` (requireRole) |
| `ALL` | `/:id/tests/:testId/export/:format` | `/api/v1/teaching-groups/:id/tests/:testId/export/:format` | `TeachingGroupController.exportTest` (requireRole) |

## 8. Live Attendance Sessions, QR/PIN Roll-Call Studio, ESP32 Sync & Post-Session Corrections (`src/routes/attendance.js`)
**Mount Prefix**: `/api/v1/attendance`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `POST` | `/sessions` | `/api/v1/attendance/sessions` | `AttendanceController.createSession` (requireRole) |
| `GET` | `/sessions` | `/api/v1/attendance/sessions` | `AttendanceController.listSessions` (Protected) |
| `GET` | `/sessions/:id` | `/api/v1/attendance/sessions/:id` | `AttendanceController.getSessionDetails` (Protected) |
| `PUT` | `/sessions/:id/state` | `/api/v1/attendance/sessions/:id/state` | `AttendanceController.transitionState` (requireRole) |
| `POST` | `/sessions/:id/pin` | `/api/v1/attendance/sessions/:id/pin` | `AttendanceController.generatePin` (requireRole) |
| `POST` | `/sessions/:id/qr` | `/api/v1/attendance/sessions/:id/qr` | `AttendanceController.generateQr` (requireRole) |
| `POST` | `/sessions/:id/self-attendance` | `/api/v1/attendance/sessions/:id/self-attendance` | `AttendanceController.submitSelfAttendance` (requireRole) |
| `GET` | `/sessions/:id/self-attendance` | `/api/v1/attendance/sessions/:id/self-attendance` | `AttendanceController.getSelfAttendanceRequests` (requireRole) |
| `POST` | `/sessions/:id/self-attendance/:reqId/adjudicate` | `/api/v1/attendance/sessions/:id/self-attendance/:reqId/adjudicate` | `AttendanceController.adjudicateSelfAttendance` (requireRole) |
| `POST` | `/sessions/:id/sync-esp32` | `/api/v1/attendance/sessions/:id/sync-esp32` | `AttendanceController.syncEsp32Scans` (requireRole) |
| `POST` | `/sessions/:id/records` | `/api/v1/attendance/sessions/:id/records` | `AttendanceController.saveRecords` (requireRole) |
| `GET` | `/registers/:id/summary` | `/api/v1/attendance/registers/:id/summary` | `AttendanceController.getRegisterSummary` (Protected) |
| `GET` | `/registers/:id/esp32-day-scans` | `/api/v1/attendance/registers/:id/esp32-day-scans` | `AttendanceController.getEsp32DayScans` (requireRole) |
| `POST` | `/registers/:id/confirm-day-attendance` | `/api/v1/attendance/registers/:id/confirm-day-attendance` | `AttendanceController.confirmDayAttendance` (requireRole) |
| `POST` | `/sessions/:id/correct` | `/api/v1/attendance/sessions/:id/correct` | `AttendanceController.correctAttendance` (requireRole) |
| `GET` | `/sessions/:id/corrections` | `/api/v1/attendance/sessions/:id/corrections` | `AttendanceController.getCorrections` (requireRole) |

## 9. ESP32 Biometric Hardware Terminals, Fingerprint Slot Mapping & Webhook Ingestion (`src/routes/devices.js`)
**Mount Prefix**: `/api/v1/devices`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `POST` | `/esp32/heartbeat` | `/api/v1/devices/esp32/heartbeat` | `(req, res)` (deviceWebhookLimiter) |
| `POST` | `/esp32/template-upload` | `/api/v1/devices/esp32/template-upload` | `(req, res)` (deviceWebhookLimiter) |
| `GET` | `/esp32/templates-sync` | `/api/v1/devices/esp32/templates-sync` | `(req, res)` (deviceWebhookLimiter) |
| `POST` | `/esp32/templates-sync` | `/api/v1/devices/esp32/templates-sync` | `(req, res)` (deviceWebhookLimiter) |
| `POST` | `/esp32/attendance` | `/api/v1/devices/esp32/attendance` | `(req, res)` (deviceWebhookLimiter) |
| `POST` | `/webhook/scan` | `/api/v1/devices/webhook/scan` | `(req, res)` (deviceWebhookLimiter) |
| `GET` | `/hod/overview` | `/api/v1/devices/hod/overview` | `(req, res)` (requireRole) |
| `POST` | `/hod/command` | `/api/v1/devices/hod/command` | `(req, res)` (requireRole) |
| `POST` | `/hod/simulate-esp32` | `/api/v1/devices/hod/simulate-esp32` | `(req, res)` (requireRole) |
| `DELETE` | `/hod/templates/:student_id` | `/api/v1/devices/hod/templates/:student_id` | `(req, res)` (requireRole) |
| `GET` | `/` | `/api/v1/devices` | `(req, res)` (requireRole) |
| `POST` | `/` | `/api/v1/devices` | `(req, res)` (requireRole) |
| `POST` | `/:id/slots` | `/api/v1/devices/:id/slots` | `(req, res)` (requireRole) |
| `DELETE` | `/:id/slots/:slot_id` | `/api/v1/devices/:id/slots/:slot_id` | `(req, res)` (requireRole) |
| `PUT` | `/:id/status` | `/api/v1/devices/:id/status` | `(req, res)` (requireRole) |
| `GET` | `/events/raw` | `/api/v1/devices/events/raw` | `(req, res)` (requireRole) |

## 10. Institutional Attendance Analytics, Defaulter Lists, Stream Comparison & Native Excel Reports (`src/routes/reports.js`)
**Mount Prefix**: `/api/v1/reports`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `GET` | `/analytics` | `/api/v1/reports/analytics` | `(req, res)` (auth, requireRole('TEACHER', 'FACULTY', 'HOD', 'SYSTEM_ADMIN') |
| `GET` | `/teacher-register` | `/api/v1/reports/teacher-register` | `(req, res)` (auth, requireRole('TEACHER', 'FACULTY', 'HOD', 'SYSTEM_ADMIN') |
| `GET` | `/stream-comparison` | `/api/v1/reports/stream-comparison` | `(req, res)` (auth, requireRole('TEACHER', 'FACULTY', 'HOD', 'SYSTEM_ADMIN') |
| `GET` | `/esp32-presence` | `/api/v1/reports/esp32-presence` | `(req, res)` (auth, requireRole('TEACHER', 'FACULTY', 'HOD', 'SYSTEM_ADMIN') |
| `GET` | `/self-attendance` | `/api/v1/reports/self-attendance` | `(req, res)` (auth, requireRole('TEACHER', 'FACULTY', 'HOD', 'SYSTEM_ADMIN') |
| `GET` | `/daily-summary` | `/api/v1/reports/daily-summary` | `(req, res)` (auth, requireRole('TEACHER', 'FACULTY', 'HOD', 'SYSTEM_ADMIN') |
| `GET` | `/student/:id` | `/api/v1/reports/student/:id` | `(req, res)` (auth, requireRole('TEACHER', 'FACULTY', 'HOD', 'SYSTEM_ADMIN') |
| `GET` | `/teaching-groups` | `/api/v1/reports/teaching-groups` | `(req, res)` (auth, requireRole('TEACHER', 'FACULTY', 'HOD', 'SYSTEM_ADMIN') |
| `GET` | `/iot-vs-official` | `/api/v1/reports/iot-vs-official` | `(req, res)` (auth, requireRole('TEACHER', 'FACULTY', 'HOD', 'SYSTEM_ADMIN') |

## 11. Coursework Assignments, Student File Submissions & Grading (`src/routes/assignments.js`)
**Mount Prefix**: `/api/v1/assignments`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `POST` | `/` | `/api/v1/assignments` | `(req, res)` (requireRole) |
| `GET` | `/` | `/api/v1/assignments` | `(req, res)` (auth) |
| `GET` | `/:id/submissions` | `/api/v1/assignments/:id/submissions` | `(req, res)` (requireRole) |
| `POST` | `/upload-document` | `/api/v1/assignments/upload-document` | `(req, res)` (requireRole) |
| `POST` | `/:id/submit` | `/api/v1/assignments/:id/submit` | `(req, res)` (requireRole) |
| `POST` | `/:id/submit-final-docs` | `/api/v1/assignments/:id/submit-final-docs` | `(req, res)` (requireRole) |
| `POST` | `/:id/unsubmit` | `/api/v1/assignments/:id/unsubmit` | `(req, res)` (requireRole) |
| `PUT` | `/submissions/:submissionId/grade` | `/api/v1/assignments/submissions/:submissionId/grade` | `(req, res)` (requireRole) |
| `DELETE` | `/:id` | `/api/v1/assignments/:id` | `(req, res)` (requireRole) |

## 12. Unit Tests, Internal Examinations & Score Entry (`src/routes/exams.js`)
**Mount Prefix**: `/api/v1/exams`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `POST` | `/` | `/api/v1/exams` | `(req, res)` (requireRole) |
| `GET` | `/` | `/api/v1/exams` | `(req, res)` (auth) |
| `GET` | `/:id/roster` | `/api/v1/exams/:id/roster` | `(req, res)` (requireRole) |
| `POST` | `/:id/scores` | `/api/v1/exams/:id/scores` | `(req, res)` (requireRole) |
| `GET` | `/:id/export/excel` | `/api/v1/exams/:id/export/excel` | `(req, res)` (requireRole) |
| `POST` | `/:id/export/excel` | `/api/v1/exams/:id/export/excel` | `(req, res)` (requireRole) |
| `DELETE` | `/:id` | `/api/v1/exams/:id` | `(req, res)` (requireRole) |

## 13. Student Medical/Academic Leave Applications & Faculty Adjudication (`src/routes/leave.js`)
**Mount Prefix**: `/api/v1/leave`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `POST` | `/` | `/api/v1/leave` | `(req, res)` (requireRole) |
| `GET` | `/my` | `/api/v1/leave/my` | `(req, res)` (requireRole) |
| `GET` | `/` | `/api/v1/leave` | `(req, res)` (requireRole) |
| `PUT` | `/:id/decision` | `/api/v1/leave/:id/decision` | `(req, res)` (requireRole) |

## 14. Department & Cohort Weekly Period Schedules (`src/routes/timetable.js`)
**Mount Prefix**: `/api/v1/timetable`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | `/api/v1/timetable` | `(req, res)` (auth) |
| `POST` | `/` | `/api/v1/timetable` | `(req, res)` (requireRole) |
| `DELETE` | `/:id` | `/api/v1/timetable/:id` | `(req, res)` (requireRole) |

## 15. IRDT Uttarakhand Polytechnic Syllabus Booklets & Subject Seeding (`src/routes/curriculum.js`)
**Mount Prefix**: `/api/v1/curriculum`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `GET` | `/booklets` | `/api/v1/curriculum/booklets` | `curriculumController.getBooklets` (Protected) |
| `GET` | `/booklets/:deptCode` | `/api/v1/curriculum/booklets/:deptCode` | `curriculumController.getBookletByDept` (Protected) |
| `POST` | `/seed` | `/api/v1/curriculum/seed` | `curriculumController.seedCurriculum` (requireRole) |

## 16. In-App Real-Time Notification Feed & Unread Counters (`src/routes/notifications.js`)
**Mount Prefix**: `/api/v1/notifications`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | `/api/v1/notifications` | `(req, res)` (auth) |
| `GET` | `/unread-count` | `/api/v1/notifications/unread-count` | `(req, res)` (auth) |
| `PUT` | `/:id/read` | `/api/v1/notifications/:id/read` | `(req, res)` (auth) |
| `PUT` | `/mark-all-read` | `/api/v1/notifications/mark-all-read` | `(req, res)` (auth) |

## 17. NBA Course File Preparation, CO-PO Attainment Matrices & HOD Verification (`src/routes/courseFile.js`)
**Mount Prefix**: `/api/v1/course-files`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `GET` | `/definitions` | `/api/v1/course-files/definitions` | `(req, res)` (auth) |
| `GET` | `/` | `/api/v1/course-files` | `(req, res)` (auth) |
| `POST` | `/:id/documents` | `/api/v1/course-files/:id/documents` | `(req, res)` (auth) |
| `DELETE` | `/:id/documents/:item_key` | `/api/v1/course-files/:id/documents/:item_key` | `(req, res)` (auth) |
| `PUT` | `/:id/evaluation-scheme` | `/api/v1/course-files/:id/evaluation-scheme` | `(req, res)` (auth) |
| `PUT` | `/:id/structured-data` | `/api/v1/course-files/:id/structured-data` | `(req, res)` (auth) |
| `POST` | `/:id/audit` | `/api/v1/course-files/:id/audit` | `(req, res)` (requireRole) |

## 18. Theory Classes Delivery Dossier (7 NBA Artifacts) & HOD Audit (`src/routes/theoryClass.js`)
**Mount Prefix**: `/api/v1/theory-classes`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `GET` | `/definitions` | `/api/v1/theory-classes/definitions` | `(req, res)` (auth) |
| `GET` | `/` | `/api/v1/theory-classes` | `(req, res)` (auth) |
| `POST` | `/:id/documents` | `/api/v1/theory-classes/:id/documents` | `(req, res)` (auth) |
| `DELETE` | `/:id/documents/:item_key` | `/api/v1/theory-classes/:id/documents/:item_key` | `(req, res)` (auth) |
| `POST` | `/:id/audit` | `/api/v1/theory-classes/:id/audit` | `(req, res)` (requireRole) |

## 19. Laboratory Classes Delivery Dossier (7 NBA Artifacts) & HOD Audit (`src/routes/labClass.js`)
**Mount Prefix**: `/api/v1/lab-classes`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `GET` | `/definitions` | `/api/v1/lab-classes/definitions` | `(req, res)` (auth) |
| `GET` | `/` | `/api/v1/lab-classes` | `(req, res)` (auth) |
| `POST` | `/:id/documents` | `/api/v1/lab-classes/:id/documents` | `(req, res)` (auth) |
| `DELETE` | `/:id/documents/:item_key` | `/api/v1/lab-classes/:id/documents/:item_key` | `(req, res)` (auth) |
| `POST` | `/:id/audit` | `/api/v1/lab-classes/:id/audit` | `(req, res)` (requireRole) |

## 20. Student Performance Monitoring Dossier (Advanced/Slow Learners & Remedial Records) (`src/routes/studentPerformance.js`)
**Mount Prefix**: `/api/v1/student-performance`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `GET` | `/definitions` | `/api/v1/student-performance/definitions` | `(req, res)` (auth) |
| `GET` | `/` | `/api/v1/student-performance` | `(req, res)` (auth) |
| `POST` | `/:id/documents` | `/api/v1/student-performance/:id/documents` | `(req, res)` (auth) |
| `DELETE` | `/:id/documents/:item_key` | `/api/v1/student-performance/:id/documents/:item_key` | `(req, res)` (auth) |
| `POST` | `/:id/audit` | `/api/v1/student-performance/:id/audit` | `(req, res)` (requireRole) |

## 21. NBA Direct Assessment Dossier (8 Artifacts) & HOD Audit (`src/routes/directAssessment.js`)
**Mount Prefix**: `/api/v1/direct-assessment`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `GET` | `/definitions` | `/api/v1/direct-assessment/definitions` | `(req, res)` (auth) |
| `GET` | `/` | `/api/v1/direct-assessment` | `(req, res)` (auth) |
| `POST` | `/documents` | `/api/v1/direct-assessment/documents` | `(req, res)` (auth) |
| `POST` | `/:id/documents` | `/api/v1/direct-assessment/:id/documents` | `(req, res)` (auth) |
| `DELETE` | `/documents` | `/api/v1/direct-assessment/documents` | `(req, res)` (auth) |
| `DELETE` | `/documents/:item_key` | `/api/v1/direct-assessment/documents/:item_key` | `(req, res)` (auth) |
| `DELETE` | `/:id/documents/:item_key` | `/api/v1/direct-assessment/:id/documents/:item_key` | `(req, res)` (auth) |
| `POST` | `/audit` | `/api/v1/direct-assessment/audit` | `(req, res)` (requireRole) |
| `POST` | `/:id/audit` | `/api/v1/direct-assessment/:id/audit` | `(req, res)` (requireRole) |

## 22. NBA Indirect Assessment Dossier (5 Surveys/Feedback Artifacts) & HOD Audit (`src/routes/indirectAssessment.js`)
**Mount Prefix**: `/api/v1/indirect-assessment`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `GET` | `/definitions` | `/api/v1/indirect-assessment/definitions` | `(req, res)` (auth) |
| `GET` | `/` | `/api/v1/indirect-assessment` | `(req, res)` (auth) |
| `POST` | `/documents` | `/api/v1/indirect-assessment/documents` | `(req, res)` (auth) |
| `POST` | `/:id/documents` | `/api/v1/indirect-assessment/:id/documents` | `(req, res)` (auth) |
| `DELETE` | `/documents` | `/api/v1/indirect-assessment/documents` | `(req, res)` (auth) |
| `DELETE` | `/documents/:item_key` | `/api/v1/indirect-assessment/documents/:item_key` | `(req, res)` (auth) |
| `DELETE` | `/:id/documents/:item_key` | `/api/v1/indirect-assessment/:id/documents/:item_key` | `(req, res)` (auth) |
| `POST` | `/audit` | `/api/v1/indirect-assessment/audit` | `(req, res)` (requireRole) |
| `POST` | `/:id/audit` | `/api/v1/indirect-assessment/:id/audit` | `(req, res)` (requireRole) |

## 23. Combined 13-Item NBA Assessment Process Dossier & Readiness Tracker (`src/routes/assessmentProcess.js`)
**Mount Prefix**: `/api/v1/assessment-process`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `GET` | `/definitions` | `/api/v1/assessment-process/definitions` | `(req, res)` (auth) |
| `GET` | `/` | `/api/v1/assessment-process` | `(req, res)` (auth) |
| `POST` | `/documents` | `/api/v1/assessment-process/documents` | `(req, res)` (auth) |
| `POST` | `/:id/documents` | `/api/v1/assessment-process/:id/documents` | `(req, res)` (auth) |
| `DELETE` | `/documents` | `/api/v1/assessment-process/documents` | `(req, res)` (auth) |
| `DELETE` | `/documents/:item_key` | `/api/v1/assessment-process/documents/:item_key` | `(req, res)` (auth) |
| `DELETE` | `/:id/documents/:item_key` | `/api/v1/assessment-process/:id/documents/:item_key` | `(req, res)` (auth) |
| `POST` | `/audit` | `/api/v1/assessment-process/audit` | `(req, res)` (requireRole) |
| `POST` | `/:id/audit` | `/api/v1/assessment-process/:id/audit` | `(req, res)` (requireRole) |

## 24. Faculty Drive & Media Asset Vault + Omni-Search (`src/routes/media.js`)
**Mount Prefix**: `/api/v1/media (and /api/v1/search)`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | `/api/v1/media` | `(req, res)` (auth) |
| `POST` | `/upload` | `/api/v1/media/upload` | `(req, res)` (auth) |
| `GET` | `/search/omni` | `/api/v1/media/search/omni` | `(req, res)` (auth) |
| `GET` | `/omni` | `/api/v1/media/omni` | `(req, res)` (auth) |
| `GET` | `/:id` | `/api/v1/media/:id` | `(req, res)` (auth) |
| `PUT` | `/:id` | `/api/v1/media/:id` | `(req, res)` (auth) |
| `DELETE` | `/:id` | `/api/v1/media/:id` | `(req, res)` (auth) |

## 25. PDF & Image Question Paper OCR Parser (Tesseract.js + pdf-parse) (`src/routes/ocr.js`)
**Mount Prefix**: `/api/v1/ocr`

| Method | Sub-Route | Full Path | Handler / Middleware |
| :--- | :--- | :--- | :--- |
| `POST` | `/extract-questions` | `/api/v1/ocr/extract-questions` | `(req, res)` (requireRole) |
