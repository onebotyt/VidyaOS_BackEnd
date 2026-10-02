/**
 * College Biometric Attendance System - Main Express Server Entry Point
 * Base API URL: /api/v1
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const os = require('os');
const fs = require('fs');
require('dotenv').config();

const { testConnection } = require('./src/config/db');
const logger = require('./src/utils/logger');
const attendanceService = require('./src/services/attendanceService');
const sessionService = require('./src/services/sessionService');
const departmentService = require('./src/services/departmentService');
const curriculumService = require('./src/services/curriculumService');
const studentMigrationService = require('./src/services/studentMigrationService');
const iotMigrationService = require('./src/services/iotMigrationService');
const { generalLimiter } = require('./src/middleware/rateLimiter');

// Import Route Handlers
const authRoutes = require('./src/routes/auth');
const studentRoutes = require('./src/routes/students');
const facultyRoutes = require('./src/routes/faculty');
const hodRoutes = require('./src/routes/hod');
const attendanceRoutes = require('./src/routes/attendance');
const deviceRoutes = require('./src/routes/devices');
const reportRoutes = require('./src/routes/reports');
const adminRoutes = require('./src/routes/admin');
const leaveRoutes = require('./src/routes/leave');
const timetableRoutes = require('./src/routes/timetable');
const assignmentRoutes = require('./src/routes/assignments');
const examRoutes = require('./src/routes/exams');
const curriculumRoutes = require('./src/routes/curriculum');
const teachingGroupRoutes = require('./src/routes/teachingGroups');
const notificationRoutes = require('./src/routes/notifications');

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Parsing Middleware
app.use(helmet({
  contentSecurityPolicy: false // Allows local dashboard scripts and styles
}));
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(generalLimiter);

// Anti-Cache Header Middleware (Ensures browser always gets latest JS, CSS & HTML)
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const start = Date.now();
  res.on('finish', () => {
    if (req.originalUrl.startsWith('/api/')) {
      console.log(`[API ${req.method}] ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms) [Auth: ${req.headers.authorization ? 'YES' : 'NO'}]`);
    }
  });
  next();
});

// Admin URL Aliases / Normalization — Consolidated Academic Structure
app.get('/admin/departments.html', (req, res) => res.redirect(301, '/admin/academic-structure.html?tab=departments'));
app.get('/admin/branches.html', (req, res) => res.redirect(301, '/admin/academic-structure.html?tab=departments'));
app.get(['/admin/subjects.html', '/admin/subjects', '/faculty/hod-subjects.html', '/faculty/hod-subjects'], (req, res) => res.redirect(301, '/faculty/groups.html'));
app.get(['/admin/academic-years.html', '/admin/academic_years.html', '/admin/academic_year.html', '/admin/academic-year.html'], (req, res) => res.redirect(301, '/admin/academic-structure.html?tab=academic-years'));
app.get(['/admin/academic_structure.html', '/admin/academic_structure', '/admin/academic-structure'], (req, res) => res.redirect(301, '/admin/academic-structure.html'));
app.get(['/admin/audit.html', '/admin/audit'], (req, res) => res.redirect(301, '/admin/audit-logs.html'));
app.get(['/admin/whatsapp', '/admin/whatsapp.html', '/admin/whatsapp-gateway', '/admin/whatsapp_gateway', '/admin/whatsapp_gateway.html'], (req, res) => res.redirect(301, '/admin/whatsapp-gateway.html'));

// Faculty URL Aliases / Normalization — Consolidated Pages
app.get(['/faculty/analytics.html', '/faculty/analytics'], (req, res) => res.redirect(301, '/faculty/reports.html?tab=analytics'));
app.get(['/faculty/marks.html', '/faculty/marks'], (req, res) => {
  const regId = req.query.id || req.query.register_id;
  const idQuery = regId ? `?id=${regId}` : '';
  res.redirect(301, `/faculty/tests.html${idQuery}`);
});
app.get('/faculty/tests', (req, res) => {
  const regId = req.query.id || req.query.register_id;
  const idQuery = regId ? `?id=${regId}` : '';
  res.redirect(301, `/faculty/tests.html${idQuery}`);
});
app.get('/faculty/assignments', (req, res) => {
  const regId = req.query.id || req.query.register_id;
  const idQuery = regId ? `?id=${regId}` : '';
  res.redirect(301, `/faculty/assignments.html${idQuery}`);
});
app.get(['/faculty/evaluation', '/faculty/internal-evaluation', '/faculty/internal-evaluation.html'], (req, res) => {
  const regId = req.query.id || req.query.register_id;
  const idQuery = regId ? `?id=${regId}` : '';
  res.redirect(301, `/faculty/evaluation.html${idQuery}`);
});
app.get(['/faculty/attendance/quick.html', '/faculty/attendance/quick', '/faculty/attendance/quick/'], (req, res) => res.redirect(301, '/faculty/registers.html'));
app.get(['/faculty/register-view.html', '/faculty/register-view'], (req, res) => {
  const regId = req.query.id || req.query.register_id;
  if (regId) return res.redirect(301, `/faculty/registers.html?id=${regId}`);
  res.redirect(301, '/faculty/registers.html');
});
app.get(['/faculty/groups', '/faculty/teaching-groups'], (req, res) => res.redirect(301, '/faculty/groups.html'));
app.get(['/student/groups', '/student/teaching-groups'], (req, res) => res.redirect(301, '/student/groups.html'));

// Student URL Aliases / Normalization — Consolidated Attendance & Calendar
app.get([
  '/student/attendance/subjects.html',
  '/student/attendance/subjects',
  '/student/attendance/history.html',
  '/student/attendance/history',
  '/student/attendance/active.html',
  '/student/attendance/active',
  '/student/attendance',
  '/student/attendance/'
], (req, res) => res.redirect(301, '/student/attendance.html'));

// Login URL Normalization & Redirects
app.get(['/login', '/login.html', '/faculty/login', '/faculty/login.html'], (req, res) => res.redirect(301, '/login/faculty.html'));
app.get(['/student/login', '/student/login.html'], (req, res) => res.redirect(301, '/login/student.html'));

// Self-Registration Redirects
app.get(['/register/student.html', '/register/student', '/register', '/register/'], (req, res) => res.redirect(301, '/login/student-register.html'));
app.get(['/faculty/registrations.html', '/faculty/registrations'], (req, res) => res.redirect(301, '/faculty/students.html'));

// HOD Consolidation Redirects
app.get(['/faculty/hod-assignments.html', '/faculty/hod-assignments'], (req, res) => res.redirect(301, '/faculty/hod-teachers.html'));
app.get(['/faculty/hod_archive.html', '/faculty/hod_archive', '/faculty/archive.html', '/faculty/archive'], (req, res) => res.redirect(301, '/faculty/hod-archive.html'));

// Hardware Terminals Redirect to Department HOD
app.get(['/admin/devices.html', '/admin/devices', '/faculty/devices.html', '/faculty/devices'], (req, res) => res.redirect(301, '/faculty/hod-devices.html'));

// HOD Settings Redirects
app.get(['/faculty/settings.html', '/faculty/settings', '/faculty/hod_settings.html', '/faculty/hod_settings'], (req, res) => res.redirect(301, '/faculty/hod-settings.html'));

// Admin Audit Logs Redirects
app.get(['/admin/audit-logs', '/admin/audit', '/admin/audit.html'], (req, res) => res.redirect(301, '/admin/audit-logs.html'));

// Serve Shared Assets (Single Source of Truth with backward compatibility)
const sharedDir = path.join(__dirname, '../frontend/shared');
if (fs.existsSync(sharedDir)) {
  app.use('/shared', express.static(sharedDir));
  app.use('/js', express.static(path.join(sharedDir, 'js')));
  app.use('/css', express.static(path.join(sharedDir, 'css')));
}

// Serve Frontend Static Web Client (when co-located or in Docker)
const frontendDir = path.join(__dirname, '../frontend');
if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir));
}

// Serve Uploaded Files (assignment attachments & student submissions)
const uploadsDir = process.env.UPLOADS_DIR
  ? (path.isAbsolute(process.env.UPLOADS_DIR) ? process.env.UPLOADS_DIR : path.resolve(process.cwd(), process.env.UPLOADS_DIR))
  : path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Health Check
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'ONLINE',
      timestamp: new Date().toISOString(),
      service: 'VidyaOS Institutional REST API'
    }
  });
});

// Normalize duplicated /api/v1/api/v1/ prefixes if any client script prepends baseUrl twice
app.use((req, res, next) => {
  if (req.url.startsWith('/api/v1/api/v1/')) {
    req.url = req.url.replace('/api/v1/api/v1/', '/api/v1/');
  }
  next();
});

// Public Departments Route for Student & Faculty Registration
app.get(['/api/v1/departments', '/api/v1/auth/departments'], async (req, res) => {
  try {
    const { query } = require('./src/config/db');
    const rows = await query(
      `SELECT id, name, code, degree_duration_years, active_term
       FROM departments
       WHERE is_active = 1
       ORDER BY id ASC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// Mount /api/v1 REST API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/students', studentRoutes);
app.use('/api/v1/faculty', facultyRoutes);
app.use('/api/v1/hod', hodRoutes);          // HOD department administration
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api/v1/devices', deviceRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/leave', leaveRoutes);
app.use('/api/v1/timetable', timetableRoutes);
app.use('/api/v1/assignments', assignmentRoutes);
app.use('/api/v1/exams', examRoutes);
app.use('/api/v1/curriculum', curriculumRoutes);
app.use('/api/v1/teaching-groups', teachingGroupRoutes);
app.use('/api/v1/notifications', notificationRoutes);

// Fallback Route for SPA/Frontend
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: `API endpoint '${req.path}' does not exist` }
    });
  }
  const frontendIndex = path.join(__dirname, '../frontend/index.html');
  if (fs.existsSync(frontendIndex)) {
    return res.sendFile(frontendIndex);
  }
  // When running as standalone API server (e.g. Render), redirect root visits to Vercel frontend
  if (req.path === '/' || req.path === '') {
    return res.redirect(302, process.env.FRONTEND_URL || 'https://vidyaos-pink.vercel.app');
  }
  return res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route '${req.path}' not found on backend API service` }
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error('Unhandled server error', { error: err.message, stack: err.stack, path: req.path });
  res.status(err.status || 500).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An unexpected server error occurred'
    }
  });
});

// Start Background Interval: Auto-Close Open Sessions
const autoCloseIntervalSeconds = parseInt(process.env.AUTO_CLOSE_CHECK_INTERVAL_SECONDS, 10) || 60;
setInterval(() => {
  attendanceService.autoCloseOpenSessions();
}, autoCloseIntervalSeconds * 1000);

// Initialize Server & Database Test
async function startServer() {
  await testConnection();

  // Automatically synchronize active academic session (e.g. "2026 Session") on startup
  try {
    const syncRes = await sessionService.syncAcademicSession();
    logger.info(`Academic Session automated & active: [${syncRes.active_session}]`);
  } catch (err) {
    logger.warn(`Failed to auto-sync academic session: ${err.message}`);
  }

  // Automatically ensure standard institutional departments exist
  try {
    await departmentService.ensureHardcodedDepartments();
  } catch (err) {
    logger.warn(`Failed to auto-seed departments: ${err.message}`);
  }

  // Ensure syllabus_scheme column exists (safe migration)
  try {
    await curriculumService.ensureSyllabusSchemeColumn();
  } catch (err) {
    logger.warn(`Failed to migrate syllabus_scheme column: ${err.message}`);
  }

  // Ensure UBTER student identifiers columns exist (registration_no, class_roll_no)
  try {
    await studentMigrationService.ensureStudentColumns();
    await studentMigrationService.ensureOtpAndPhoneColumns();
  } catch (err) {
    logger.warn(`Failed to migrate student columns: ${err.message}`);
  }

  // Ensure IoT presence, department enrollments & attendance corrections schema exists
  try {
    await iotMigrationService.ensureIotAndCorrectionTables();
  } catch (err) {
    logger.warn(`Failed to migrate IoT and correction tables: ${err.message}`);
  }

  // Periodic Session Rollover Check (Runs hourly to detect calendar year rollovers)
  setInterval(() => {
    sessionService.syncAcademicSession().catch(() => {});
  }, 3600 * 1000);

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`College Attendance System Backend running:`);
    logger.info(`  ➜ Local:   http://localhost:${PORT}`);
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const net of ifaces[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          logger.info(`  ➜ Network: http://${net.address}:${PORT} (${name})`);
        }
      }
    }
    logger.info(`REST API Base URL: http://localhost:${PORT}/api/v1`);
  });
}

// Handle Uncaught Exceptions & Rejections gracefully
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', { message: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection:', { reason });
});

startServer();

module.exports = app;
