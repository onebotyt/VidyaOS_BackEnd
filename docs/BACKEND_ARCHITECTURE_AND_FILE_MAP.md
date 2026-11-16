# VidyaOS Backend — Exhaustive Architecture & File-by-File Reference

This document catalogues every file in `VidyaOS_BackEnd-main`, its exact line count, exported functions/classes, and architectural responsibilities.

## 1. Layered MVC + Service Architecture

```
VidyaOS_BackEnd-main/
├── server.js                  # Express 4 entry point, security headers, route mounting & background intervals
├── render.yaml                # Render.com cloud deployment blueprint (Pure MySQL)
├── .env.example               # MySQL 8.x, JWT, and operational environment variable template
├── ca.pem                     # Aiven / Cloud MySQL SSL Root CA certificate
├── src/
│   ├── config/
│   │   └── db.js              # Pure MySQL 8.x (mysql2/promise) pool, SQL normalizer & transaction manager
│   ├── middleware/            # 6 security, RBAC, scope, rate-limit, upload & validation middlewares
│   ├── utils/                 # 5 cryptographic token, QR/PIN, logger, formatter & native Excel utilities
│   ├── services/              # 15 domain & autonomous background services (promotion, OCR, Excel, migrations)
│   ├── routes/                # 24 declarative Express routers (/api/v1/*)
│   ├── controllers/           # 22 HTTP request/response controllers
│   └── models/                # 20 parameterized MySQL data-access models
├── database/
│   ├── schema.sql             # Core MySQL 8.x DDL schema
│   ├── cpanel_production_mysql.sql # Complete production & demo MySQL dump
│   ├── migrations/            # Incremental SQL migration scripts (001 to 005)
│   └── seeds/                 # Initial master department/branch/year seed SQL
└── scripts/
    ├── seed-production-clean.js  # Pure MySQL production bootstrap seeder (1 Admin + 6 Depts)
    ├── seed-presentation-demo.js # Pure MySQL full institutional demo dataset seeder
    └── generate-cpanel-mysql.js  # SQL export builder for cPanel phpMyAdmin
```

## 2. Complete File-by-File Inventory & Exports

### Directory: `/(root)`

| File | Lines | Key Functions / Methods / Exports | Architectural Responsibility |
| :--- | ---: | :--- | :--- |
| `README.md` | 598 | Declarative module / SQL | Configuration / asset file |
| `ca.pem` | 26 | Declarative module / SQL | Configuration / asset file |
| `package.json` | 44 | Declarative module / SQL | Configuration / asset file |
| `pnpm-lock.yaml` | 3449 | `dependencies()` | Configuration / asset file |
| `pnpm-workspace.yaml` | 3 | Declarative module / SQL | Configuration / asset file |
| `render.yaml` | 45 | Declarative module / SQL | Configuration / asset file |
| `server.js` | 546 | `startServer()` | College Biometric Attendance System - Main Express Server Entry Point — Base API URL: /api/v1 |

### Directory: `/src/config`

| File | Lines | Key Functions / Methods / Exports | Architectural Responsibility |
| :--- | ---: | :--- | :--- |
| `db.js` | 174 | `normalizeParams()`, `getPool()`, `wrapConnection()`, `query()`, `execute()`, `get()`, `run()`, `withTransaction()` | VidyaOS Pure MySQL 8.x / MariaDB Database Adapter — Exclusively uses mysql2/promise connection pooling. |

### Directory: `/src/middleware`

| File | Lines | Key Functions / Methods / Exports | Architectural Responsibility |
| :--- | ---: | :--- | :--- |
| `auth.js` | 214 | `invalidateUserAuthCache()`, `auth()` | JWT Authentication Middleware (with 15s TTL Profile Cache & Throttled Session Heartbeat) |
| `rateLimiter.js` | 48 | Declarative module / SQL | Express Rate Limiters for Security & Brute-Force Prevention |
| `requireRole.js` | 42 | `requireRole()` | System Role Verification Middleware |
| `requireScope.js` | 361 | `requireSubjectTeacher()`, `requireDepartmentFaculty()`, `requireClassTeacher()`, `requireTeachingGroupOwner()`, `requireHOD()`, `requireHODOrClassTeacher()`, `requireCommonFacultyManager()` | Dynamic Scoped RBAC Middleware — Validates teacher assignments dynamically from teacher_assignments table. |
| `upload.js` | 55 | `ensureDir()`, `makeUploader()` | Shared Multer Upload Configuration — Used by assignments (teacher attachments + student submissions). |
| `validate.js` | 27 | `validate()` | Express-validator Schema Validation Middleware |

### Directory: `/src/utils`

| File | Lines | Key Functions / Methods / Exports | Architectural Responsibility |
| :--- | ---: | :--- | :--- |
| `esp32Crypto.js` | 145 | `deriveAes256Key()`, `generateDeviceSecretKey()`, `encryptEsp32Payload()`, `decryptEsp32Payload()`, `computeTemplateSha256()`, `computeHmacSignature()` | VidyaOS ESP32 Hardware Cryptographic Engine (AES-256-GCM + HMAC-SHA256) — Provides bidirectional authenticated encryption between the Node.j |
| `formatters.js` | 16 | `normalizePhone()` | Shared Institutional String & Data Formatters |
| `generateNativeExcelReport.py` | 407 | Declarative module / SQL | Configuration / asset file |
| `logger.js` | 22 | Declarative module / SQL | Structured Logger for College Attendance Backend |
| `pinQrHelper.js` | 38 | `generatePin()`, `generateQrPayload()` | PIN & Dynamic QR Code Helper Utilities |
| `tokenHelper.js` | 85 | `generateAccessToken()`, `generateRefreshToken()`, `generateActivationToken()`, `verifyAccessToken()`, `verifyRefreshToken()`, `hashToken()` | JWT Token Generation & Cryptographic Hashing Utilities |

### Directory: `/src/services`

| File | Lines | Key Functions / Methods / Exports | Architectural Responsibility |
| :--- | ---: | :--- | :--- |
| `adminBootstrapService.js` | 155 | `bootstrap()` | System Administrator Environment Bootstrapping Service — Enables zero-touch initial administrator onboarding on cloud deployments (Render/Ve |
| `attendanceService.js` | 580 | `createSession()`, `transitionState()`, `generatePin()`, `generateQr()`, `submitSelfAttendance()`, `getSelfAttendanceRequests()`, `adjudicateSelfAttendance()`, `syncEsp32Scans()` | Attendance Core Service — Manages session state machine, roster freezing, the 3 attendance streams, and auto-close timer. |
| `auditService.js` | 203 | `logAudit()`, `getAuditLogs()` | Institutional Audit Logging Service — Compliant with Section 54 of redesign.md |
| `authService.js` | 1081 | `isValidEmail()`, `parseLoginCredential()`, `getGoogleClient()`, `verifyGoogleToken()`, `enforceSingleActiveSession()`, `persistSession()`, `buildUserPayload()`, `facultyLogin()` | Authentication Service — - Faculty login (Gmail + temp/permanent password, detects must_change_password) |
| `curriculumService.js` | 12 | Declarative module / SQL | Curriculum Service — Backward compatibility layer delegating to CurriculumModel. |
| `departmentService.js` | 62 | `ensureHardcodedDepartments()`, `isHardcodedDepartment()` | Department Service & Master Institutional Seeder — Manages institutional academic departments and ensures standard hardcoded |
| `deviceService.js` | 614 | `resolveAuthenticatedDevice()`, `processEncryptedHeartbeat()`, `processTemplateUpload()`, `getEncryptedDepartmentTemplates()`, `processScanWebhook()`, `getCohortBiometrics()`, `assignSlot()` | Hardware Device & Encrypted ESP32 Biometric Service (MySQL 8.x) — Implements the 5 Core VidyaOS ESP32 Hardware Requirements: |
| `excelExportService.js` | 2639 | `getDefaultInstitutionName()`, `generateClassTestExcel()`, `generateInternalEvaluationExcel()`, `generateUnitTestsSummaryExcel()`, `buildClassTestMarksheetHtml()`, `generateClassTestPdf()`, `generateClassTestDoc()`, `getOrGenerateChartImages()` | Institutional Excel Export Service — Generates pixel-perfect, fully styled Microsoft Excel & Google Sheets (.xlsx) workbooks |
| `iotMigrationService.js` | 150 | `getTableCols()`, `safeAddColumn()`, `ensureIotAndCorrectionTables()` | IoT Presence, Encrypted ESP32 Biometric Templates, Command Queue & Telemetry Migration Service (MySQL 8.x) |
| `notificationService.js` | 159 | `sendNotification()`, `sendBatchNotification()`, `getUserNotifications()`, `getUnreadCount()`, `markAsRead()`, `markAllAsRead()` | In-App Notification Hub Service — Compliant with Section 55 of redesign.md |
| `ocrService.js` | 206 | `extractQuestions()` | OCR & QUESTION PAPER PARSER SERVICE — backend/src/services/ocrService.js |
| `promotionEngineService.js` | 233 | `checkAndRunAutomatedSemesterPromotion()`, `getPromotionEngineStatus()` | Autonomous Bi-Annual Student Promotion & Progression Engine — Automatically promotes students across semester boundaries: |
| `reportService.js` | 214 | `getStudentAttendanceStats()`, `getStudentSubjectBreakdown()`, `getStudentAttendanceHistory()`, `getStreamComparison()` | Attendance Reporting & Predictive Analytics Service — Computes official attendance % and 75% threshold deficit/surplus formulas. |
| `sessionService.js` | 361 | `computeAutoSessionLabel()`, `resolveSession()`, `getSessionSettings()`, `syncAcademicSession()`, `getSessionStatus()`, `getActiveSession()`, `updateSessionDuration()` | Session & Academic Year Automation Service — Automatically resolves and synchronizes the active academic session (e.g. "2026 Session") |
| `studentMigrationService.js` | 127 | `getTableColumnNames()`, `ensureStudentColumns()`, `ensureOtpAndPhoneColumns()` | Student & Auth Schema Migration Service (MySQL 8.x) — Ensures required columns and tables exist on MySQL startup: |

### Directory: `/src/routes`

| File | Lines | Key Functions / Methods / Exports | Architectural Responsibility |
| :--- | ---: | :--- | :--- |
| `admin.js` | 505 | Declarative module / SQL | Institutional Master Data Administration Routes (/api/v1/admin/*) — Concise declarative Express router delegating to AdminController. |
| `assessmentProcess.js` | 48 | Declarative module / SQL | Assessment Process Routes (/api/v1/assessment-process/*) — Milestone 323 & 324: 13-Record Direct & Indirect Assessment Dossier System |
| `assignments.js` | 87 | Declarative module / SQL | Assignment Routes (/api/v1/assignments/*) — Delegates request processing to AssignmentController. |
| `attendance.js` | 162 | Declarative module / SQL | Attendance Core Routes (/api/v1/attendance/*) — Pure declarative router delegating to AttendanceController. |
| `auth.js` | 261 | Declarative module / SQL | Authentication Routes (/api/v1/auth/*) — Pure declarative router delegating to AuthController. |
| `courseFile.js` | 61 | Declarative module / SQL | Course File Preparation Routes (/api/v1/course-files/*) — Milestone 163: Institutional NBA/NAAC Course File Dossier System |
| `curriculum.js` | 30 | Declarative module / SQL | Curriculum Routes — IRDT Uttarakhand Syllabus Integration — Base: /api/v1/curriculum |
| `devices.js` | 76 | Declarative module / SQL | Hardware Device & Encrypted ESP32 Biometric Routes (/api/v1/devices/*) |
| `directAssessment.js` | 49 | Declarative module / SQL | Direct Assessment Routes (/api/v1/direct-assessment/*) — Milestone 324: Dedicated 8-Record Direct Assessment Dossier System |
| `exams.js` | 76 | Declarative module / SQL | Exam / Test Score Routes (/api/v1/exams/*) — Delegates request processing to ExamController. |
| `faculty.js` | 258 | Declarative module / SQL | Faculty Routes (/api/v1/faculty/*) — Concise declarative Express router delegating to FacultyController. |
| `hod.js` | 368 | Declarative module / SQL | HOD Department Administration Routes (/api/v1/hod/*) — Concise declarative Express router delegating directly to HodController. |
| `indirectAssessment.js` | 49 | Declarative module / SQL | Indirect Assessment Routes (/api/v1/indirect-assessment/*) — Milestone 324: Dedicated 5-Record Indirect Assessment Dossier System |
| `labClass.js` | 40 | Declarative module / SQL | Laboratory Class Academic Dossier Routes (/api/v1/lab-classes/*) — Milestone 317: 7-Record Academic Dossier System for Laboratory Classes |
| `leave.js` | 55 | Declarative module / SQL | Leave Application Routes (/api/v1/leave/*) — Delegates request processing to LeaveController. |
| `media.js` | 53 | Declarative module / SQL | Faculty Drive & Media Asset Hub API + Omnisearch — Location: /src/routes/media.js |
| `notifications.js` | 34 | Declarative module / SQL | Notifications REST API Routes (/api/v1/notifications/*) — Delegates request processing to NotificationController. |
| `ocr.js` | 35 | Declarative module / SQL | OCR ROUTES (/api/v1/ocr/*) — backend/src/routes/ocr.js |
| `reports.js` | 59 | Declarative module / SQL | Reporting & Analytics Routes (/api/v1/reports/*) — Delegates request processing to ReportController. |
| `studentPerformance.js` | 40 | Declarative module / SQL | Student Performance Monitoring Routes (/api/v1/student-performance/*) — Milestone 322: 8-Record Student Performance Monitoring Academic Doss |
| `students.js` | 203 | Declarative module / SQL | Student Routes (/api/v1/students/*) — Pure declarative router delegating to StudentController. |
| `teachingGroups.js` | 424 | Declarative module / SQL | Teaching Groups REST API Routes (/api/v1/teaching-groups/*) — Pure declarative router delegating to TeachingGroupController. |
| `theoryClass.js` | 40 | Declarative module / SQL | Theory Class Academic Dossier Routes (/api/v1/theory-classes/*) — Milestone 316: 7-Record Academic Dossier System for Theory Classes |
| `timetable.js` | 49 | Declarative module / SQL | Timetable Routes (/api/v1/timetable/*) — Delegates request processing to TimetableController. |

### Directory: `/src/controllers`

| File | Lines | Key Functions / Methods / Exports | Architectural Responsibility |
| :--- | ---: | :--- | :--- |
| `adminController.js` | 1294 | `getStats()`, `getDepartments()`, `createDepartment()`, `updateDepartment()`, `archiveDepartment()`, `deleteDepartment()`, `getBranches()`, `getAcademicYears()` | Admin Controller — Coordinates HTTP requests and responses for institutional master data administration: |
| `assessmentProcessController.js` | 403 | `getDirectAssessmentDossier()`, `getIndirectAssessmentDossier()`, `getAssessmentDossier()`, `uploadDocument()`, `deleteDocument()`, `auditAssessment()` | Assessment Process Controller — Handlers for Direct (8 items) & Indirect (5 items) Assessment artifacts. — Location: src/controllers/assessm |
| `assignmentController.js` | 341 | `createAssignment()`, `listAssignments()`, `getSubmissions()`, `uploadDocument()`, `submitAssignment()`, `submitFinalDocs()`, `unsubmitAssignment()`, `gradeSubmission()` | Assignment Controller — HTTP request/response handlers for coursework assignments. |
| `attendanceController.js` | 585 | `createSession()`, `listSessions()`, `getSessionDetails()`, `transitionState()`, `generatePin()`, `generateQr()`, `submitSelfAttendance()`, `getSelfAttendanceRequests()` | Attendance Controller — Coordinates HTTP request processing, validations, business service invocations, and error responses. |
| `authController.js` | 1018 | `getClientInfo()`, `setAuthCookies()`, `clearAuthCookies()`, `facultyLogin()`, `getMe()`, `studentLogin()`, `login()`, `changePassword()` | Auth Controller — Coordinates authentication, tokens, cookie management, OAuth workflows, and self-registration. |
| `courseFileController.js` | 384 | `getCourseFile()`, `uploadDocument()`, `deleteDocument()`, `updateEvaluationScheme()`, `updateStructuredData()`, `auditCourseFile()` | Course File Controller — HTTP request/response handlers for Course File preparation dossier. |
| `curriculumController.js` | 91 | `getBooklets()`, `getBookletByDept()`, `seedCurriculum()` | Curriculum Controller — Handles HTTP requests for IRDT curriculum & syllabus |
| `deviceController.js` | 488 | `handleScanWebhook()`, `handleEsp32Heartbeat()`, `handleTemplateUpload()`, `handleTemplatesSync()`, `getHodEsp32Overview()`, `queueHodDeviceCommand()`, `simulateEsp32Action()`, `deleteStudentTemplate()` | Device Controller — HTTP request/response handlers for ESP32 biometric terminals, — AES-256-GCM encrypted webhooks, portable cloud template  |
| `examController.js` | 339 | `createExam()`, `listExams()`, `getRoster()`, `saveScores()`, `exportExcel()`, `exportCustomExcel()`, `deleteExam()` | Exam Controller — HTTP request/response handlers for tests, exams, and marks. |
| `facultyController.js` | 1144 | `getDashboard()`, `getRegisters()`, `getMyStudents()`, `getRegisterDetail()`, `markCell()`, `updateStudentStatus()`, `createPersonalRegister()`, `createSession()` | Faculty Controller — Coordinates HTTP requests and responses for faculty dashboard, registers, |
| `hodController.js` | 1222 | `resolveHodDeptId()`, `getDashboard()`, `getTeachers()`, `createTeacher()`, `getTeacherById()`, `updateTeacher()`, `resetTeacherPassword()`, `deleteTeacher()` | HOD Controller — Handles request validation, status codes, service delegation, and HTTP responses |
| `labClassController.js` | 310 | `getLabClass()`, `uploadDocument()`, `deleteDocument()`, `auditLabClass()` | Laboratory Class Controller — HTTP request/response handlers for 7-record Laboratory Class Academic Dossier. — Location: src/controllers/lab |
| `leaveController.js` | 110 | `applyLeave()`, `getMyLeaves()`, `getLeaveRequests()`, `decideLeave()` | Leave Controller — HTTP request/response handlers for student leave applications. |
| `mediaController.js` | 294 | `classifyFile()`, `listAssets()`, `uploadAsset()`, `searchOmni()`, `getAsset()`, `updateAsset()`, `deleteAsset()` | Media Controller — HTTP request/response handlers for faculty drive assets and omnisearch. |
| `notificationController.js` | 125 | `getNotifications()`, `getUnreadCount()`, `markAsRead()`, `markAllAsRead()` | Notification Controller — HTTP request/response handlers for notifications. |
| `ocrController.js` | 54 | `extractQuestions()` | OCR CONTROLLER — backend/src/controllers/ocrController.js |
| `reportController.js` | 288 | `getAnalytics()`, `getTeacherRegister()`, `getStreamComparison()`, `getEsp32Presence()`, `getSelfAttendance()`, `getDailySummary()`, `getStudentReport()`, `getTeachingGroupsReport()` | Report Controller — HTTP request/response handlers for attendance analytics and reports. |
| `studentController.js` | 813 | `getStudents()`, `getProfile()`, `updateProfile()`, `getAttendanceStats()`, `getAttendanceSubjects()`, `getAttendanceHistory()`, `provisionStudent()`, `bulkProvision()` | Student Controller — Coordinates HTTP request processing, validations, business service invocations, and error responses for students. |
| `studentPerformanceController.js` | 298 | `getPerformanceDossier()`, `uploadDocument()`, `deleteDocument()`, `auditPerformance()` | Student Performance Monitoring Controller — HTTP request/response handlers for 8-artifact Performance Dossier. — Location: src/controllers/s |
| `teachingGroupController.js` | 1521 | `generateInviteCode()`, `getOverview()`, `listGroups()`, `createGroup()`, `getGroupDetails()`, `joinGroup()`, `getMembers()`, `addMembers()` | Teaching Group Controller — Coordinates HTTP request processing, validations, service calls, and responses for teaching groups. |
| `theoryClassController.js` | 309 | `getTheoryClass()`, `uploadDocument()`, `deleteDocument()`, `auditTheoryClass()` | Theory Class Controller — HTTP request/response handlers for 7-record Theory Class Academic Dossier. — Location: src/controllers/theoryClass |
| `timetableController.js` | 98 | `getTimetable()`, `addSlot()`, `removeSlot()` | Timetable Controller — HTTP request/response handlers for class schedules. |

### Directory: `/src/models`

| File | Lines | Key Functions / Methods / Exports | Architectural Responsibility |
| :--- | ---: | :--- | :--- |
| `adminModel.js` | 1982 | `getStats()`, `getDepartments()`, `getDepartmentById()`, `createDepartment()`, `updateDepartment()`, `archiveDepartment()`, `deleteDepartment()`, `getAcademicYears()` | Admin Model — Encapsulates MySQL 8.x queries and transactions for institutional master data administration: |
| `assessmentProcessModel.js` | 378 | `getGroupDetails()`, `getOrCreateAssessmentFile()`, `getDocuments()`, `getById()`, `upsertDocument()`, `deleteDocument()`, `auditAssessment()` | Assessment Process Model — Data access layer for Direct Assessment (8 items) & Indirect Assessment (5 items). — Location: src/models/assessm |
| `assignmentModel.js` | 305 | `create()`, `getGroupMemberUserIds()`, `listForStudent()`, `listForTeacher()`, `getById()`, `getSubmissionsRoster()`, `upsertSubmission()`, `deleteSubmission()` | Assignment Model — Data access layer for coursework, assessments, and student submissions. |
| `attendanceModel.js` | 457 | `getCurrentAcademicYearId()`, `getRegisterById()`, `getDefaultSubjectId()`, `findExistingRegister()`, `createRegister()`, `getSubjectName()`, `getAcademicYearLabel()`, `listSessions()` | Attendance Model — Encapsulates MySQL 8.x queries for attendance sessions, registers, roster snapshots, and ESP32 sync. |
| `authModel.js` | 352 | `getActiveAcademicYear()`, `getSetting()`, `getSettingsMatching()`, `getSettingsIn()`, `getActiveDepartments()`, `getDepartmentById()`, `countDepartmentTeachers()`, `getRegistrationGatesData()` | Auth Model — Encapsulates MySQL 8.x queries and transactions for authentication, registration gates, and account self-registration. |
| `courseFileModel.js` | 343 | `getGroupDetails()`, `getOrCreateCourseFile()`, `getDocuments()`, `getGroupStudentsWithAttendance()`, `getGroupAssignments()`, `getById()`, `upsertDocument()`, `deleteDocument()` | Course File Model — Data access layer for NBA/NAAC 18 Course File artifacts. |
| `curriculumModel.js` | 102 | `getBookletUrl()`, `getBookletRegistry()`, `ensureSyllabusSchemeColumn()` | Curriculum Model — IRDT Uttarakhand Polytechnic — Data access and schema operations for curriculum and syllabus schemes. |
| `deviceModel.js` | 183 | `listDevices()`, `getById()`, `getByUid()`, `createDevice()`, `getSlot()`, `deleteSlot()`, `updateStatus()`, `getRawIotEvents()` | Device Model — MySQL 8.x data access layer for ESP32 biometric terminals, — portable student fingerprint templates, remote command queue, an |
| `examModel.js` | 353 | `create()`, `getGroupMemberUserIds()`, `listForStudent()`, `listForTeacher()`, `getById()`, `getMeta()`, `getRoster()`, `saveScores()` | Exam Model — Data access layer for class tests, exam scores, and rosters. |
| `facultyModel.js` | 1534 | `getDashboardSummary()`, `getRegisters()`, `getMyStudents()`, `getRegisterById()`, `findTodaySession()`, `autoCreateTodaySession()`, `createSessionManual()`, `deleteSession()` | Faculty Model — Encapsulates MySQL 8.x queries and transactions for faculty dashboard, registers, |
| `hodModel.js` | 2117 | `getDashboard()`, `getTeachers()`, `findExistingUser()`, `createTeacher()`, `getTeacherById()`, `updateTeacher()`, `resetTeacherPassword()`, `deleteTeacher()` | HOD Model — Encapsulates MySQL 8.x queries and transactions for department administration: |
| `labClassModel.js` | 301 | `getGroupDetails()`, `getOrCreateLabClass()`, `getDocuments()`, `getGroupStudentsWithAttendance()`, `getGroupAssignments()`, `getById()`, `upsertDocument()`, `deleteDocument()` | Laboratory Class Model — Data access layer for 7 Laboratory Class Academic Dossier artifacts. — Location: src/models/labClassModel.js |
| `leaveModel.js` | 112 | `createApplication()`, `getByStudentId()`, `getForTeacher()`, `updateDecision()` | Leave Model — Data access layer for student leave requests. |
| `mediaModel.js` | 265 | `getTeacherContext()`, `listAssets()`, `createAsset()`, `getById()`, `updateAsset()`, `deleteAsset()`, `searchOmni()` | Media Model — Data access layer for faculty drive assets, media files, and global omnisearch. |
| `reportModel.js` | 550 | `getAnalyticsClasses()`, `getAnalyticsTrend()`, `getAnalyticsBelowThresholdCount()`, `getTeacherRegisterData()`, `getEsp32PresenceLogs()`, `getSelfAttendanceLogs()`, `getDailySessionsSummary()`, `getStudentProfile()` | Report Model — Data access layer for analytics, attendance ledgers, and logs. |
| `studentModel.js` | 818 | `getProfile()`, `getStudents()`, `getBiometricSlot()`, `updateUserEmail()`, `getUserPasswordHash()`, `updateUserPassword()`, `updateStudentDetails()`, `getStudentIdByUserId()` | Student Model — Encapsulates MySQL 8.x queries and transactions for student accounts, enrollments, registrations, and dossiers. |
| `studentPerformanceModel.js` | 268 | `getGroupDetails()`, `getOrCreatePerformanceFile()`, `getDocuments()`, `getById()`, `upsertDocument()`, `deleteDocument()`, `auditPerformance()` | Student Performance Monitoring Model — Data access layer for 8 Student Performance Monitoring artifacts. — Location: src/models/studentPerfo |
| `teachingGroupModel.js` | 1293 | `resolveTeacher()`, `getCurrentAcademicYearId()`, `getOverviewData()`, `listGroups()`, `checkInviteCode()`, `createGroupTransaction()`, `getGroupById()`, `getGroupMembers()` | Teaching Group Model — Encapsulates MySQL 8.x queries and transactions for classroom groups, memberships, stream posts, classwork, and tests |
| `theoryClassModel.js` | 293 | `getGroupDetails()`, `getOrCreateTheoryClass()`, `getDocuments()`, `getGroupStudentsWithAttendance()`, `getGroupAssignments()`, `getById()`, `upsertDocument()`, `deleteDocument()` | Theory Class Model — Data access layer for 7 Theory Class Academic Dossier artifacts. — Location: src/models/theoryClassModel.js |
| `timetableModel.js` | 82 | `getStudentCohort()`, `getSlots()`, `createSlot()`, `deleteSlot()` | Timetable Model — Data access layer for weekly schedule slots. |

### Directory: `/scripts`

| File | Lines | Key Functions / Methods / Exports | Architectural Responsibility |
| :--- | ---: | :--- | :--- |
| `generate-cpanel-mysql.js` | 760 | Declarative module / SQL | Generator for cPanel Production MySQL Dump — Generates database/cpanel_production_mysql.sql |
| `seed-presentation-demo.js` | 37 | `seedPresentationDemo()` | Institutional Demo Seed Runner (MySQL 8.x) — Applies database/schema.sql and database/seeds/001_initial_master_data.sql to the configured My |
| `seed-production-clean.js` | 60 | `seedProductionClean()` | Production Clean Seed Script (MySQL 8.x) — Seeds standard institutional departments, active academic year, and 1 System Administrator. |

### Directory: `/database`

| File | Lines | Key Functions / Methods / Exports | Architectural Responsibility |
| :--- | ---: | :--- | :--- |
| `cpanel_production_mysql.sql` | 804 | Declarative module / SQL | Configuration / asset file |
| `schema.sql` | 868 | Declarative module / SQL | Configuration / asset file |

### Directory: `/database/migrations`

| File | Lines | Key Functions / Methods / Exports | Architectural Responsibility |
| :--- | ---: | :--- | :--- |
| `001_initial_schema.sql` | 550 | Declarative module / SQL | Configuration / asset file |
| `002_add_attendance_registers.sql` | 57 | Declarative module / SQL | Configuration / asset file |
| `003_faculty_plus_features.sql` | 119 | Declarative module / SQL | Configuration / asset file |
| `004_consolidate_similar_tables.sql` | 59 | Declarative module / SQL | Configuration / asset file |
| `005_nullable_enrollment_roll_no.sql` | 10 | Declarative module / SQL | Configuration / asset file |
| `006_esp32_encrypted_biometric_templates.sql` | 58 | Declarative module / SQL | Configuration / asset file |

### Directory: `/database/seeds`

| File | Lines | Key Functions / Methods / Exports | Architectural Responsibility |
| :--- | ---: | :--- | :--- |
| `001_initial_master_data.sql` | 72 | Declarative module / SQL | Configuration / asset file |
