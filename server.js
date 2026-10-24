/**
 * College Biometric Attendance System - Main Express Server Entry Point
 * Base API URL: /api/v1
 */

const express = require('express');
const compression = require('compression');
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
const dbSyncService = require('./src/services/dbSyncService');
const promotionEngineService = require('./src/services/promotionEngineService');
const { generalLimiter } = require('./src/middleware/rateLimiter');

// Import Route Handlers & Controllers
const authController = require('./src/controllers/authController');
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
const courseFileRoutes = require('./src/routes/courseFile');
const mediaRoutes = require('./src/routes/media');

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Parsing Middleware
app.use(helmet({
  contentSecurityPolicy: false // Allows local dashboard scripts and styles
}));
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(generalLimiter);

// Cache-Control Header Middleware:
// - Dynamic API routes and HTML pages: no-cache to guarantee fresh institutional state
// - Static assets (CSS, JS, fonts, images): cacheable with ETag validation & 1-day TTL
app.use((req, res, next) => {
  const isApi = req.originalUrl.startsWith('/api/');
  const isHtml = req.path.endsWith('.html') || req.path === '/' || (req.headers.accept && req.headers.accept.includes('text/html'));
  if (isApi || isHtml || process.env.NODE_ENV !== 'production') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  }
  const start = Date.now();
  res.on('finish', () => {
    if (isApi) {
      console.log(`[API ${req.method}] ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms) [Auth: ${req.headers.authorization ? 'YES' : 'NO'}]`);
    }
  });
  next();
});

// Clean Entry Point & Canonical Tab Redirection (Core Architectural Invariants)
app.get(['/login', '/login.html'], (req, res) => res.redirect(301, '/login/index.html'));
app.get(['/register', '/register.html'], (req, res) => res.redirect(301, '/login/register.html'));
app.get(['/login/student-register.html', '/login/student-register', '/register/student', '/register/student.html'], (req, res) => {
  const query = req.url.includes('?') ? '&' + req.url.split('?')[1] : '';
  res.redirect(301, `/login/register.html?role=student${query}`);
});
app.get(['/login/faculty-register.html', '/login/faculty-register', '/register/faculty', '/register/faculty.html'], (req, res) => {
  const query = req.url.includes('?') ? '&' + req.url.split('?')[1] : '';
  res.redirect(301, `/login/register.html?role=faculty${query}`);
});
app.get('/admin/academic_structure.html', (req, res) => res.redirect(301, '/admin/academic-structure.html'));
app.get('/admin/departments.html', (req, res) => res.redirect(301, '/admin/academic-structure.html?tab=departments'));
app.get('/faculty/analytics.html', (req, res) => res.redirect(301, '/faculty/reports.html?tab=analytics'));
app.get(['/faculty/marks.html', '/faculty/marks'], (req, res) => {
  const regId = req.query.id || req.query.register_id;
  res.redirect(301, `/faculty/tests.html${regId ? `?id=${regId}` : ''}`);
});
app.get(['/faculty/attendance/quick.html', '/faculty/attendance/quick'], (req, res) => res.redirect(301, '/faculty/registers.html'));
app.get('/student/attendance/subjects.html', (req, res) => res.redirect(301, '/student/attendance.html'));
app.get(['/student/todo.html', '/student/todo'], (req, res) => res.redirect(301, '/student/assignments.html'));


// Static file serving options with production caching
const staticOptions = {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  etag: true,
  lastModified: true
};

// Resolve Frontend directory (Default: ../frontend, Configurable for Collab Preview: process.env.FRONTEND_DIR)
const frontendBase = process.env.FRONTEND_DIR
  ? (path.isAbsolute(process.env.FRONTEND_DIR) ? process.env.FRONTEND_DIR : path.resolve(__dirname, process.env.FRONTEND_DIR))
  : path.join(__dirname, '../frontend');

// Serve Shared Assets (Single Source of Truth with backward compatibility)
const sharedDir = path.join(frontendBase, 'shared');
if (fs.existsSync(sharedDir)) {
  app.use('/shared', express.static(sharedDir, staticOptions));
  app.use('/js', express.static(path.join(sharedDir, 'js'), staticOptions));
  app.use('/css', express.static(path.join(sharedDir, 'css'), staticOptions));
}

// Serve ExcelJS standalone browser bundle for client-side genuine .xlsx generation
app.get(['/js/exceljs.min.js', '/shared/js/exceljs.min.js'], (req, res, next) => {
  const p1 = path.join(frontendBase, 'shared/js/exceljs.min.js');
  const p2 = path.join(__dirname, 'node_modules/exceljs/dist/exceljs.min.js');
  if (fs.existsSync(p1)) {
    res.setHeader('Content-Type', 'application/javascript');
    return res.sendFile(p1);
  }
  if (fs.existsSync(p2)) {
    res.setHeader('Content-Type', 'application/javascript');
    return res.sendFile(p2);
  }
  next();
});


// Universal Single-Engine Google Classroom Workspace:
// Route student classroom to the unified Google Classroom workspace engine
app.get(['/student/group-detail.html', '/student/group-detail', '/student/group-detail/'], (req, res) => {
  res.sendFile(path.join(frontendBase, 'faculty/group-detail/index.html'));
});
app.use('/student/group-detail', express.static(path.join(frontendBase, 'faculty/group-detail')));

// Universal rewrite for legacy .html requests to modular folder index.html
app.get('/:section/:page.html', (req, res, next) => {
  const { section, page } = req.params;
  const modularPath = path.join(frontendBase, `${section}/${page}/index.html`);
  if (fs.existsSync(modularPath)) {
    return res.sendFile(modularPath);
  }
  next();
});

// Fallback handlers for direct asset requests: /:section/:page.css & /:section/:page.js
app.get('/:section/:page.css', (req, res, next) => {
  const { section, page } = req.params;
  const candidates = [
    path.join(frontendBase, `${section}/${page}/${page}.css`),
    path.join(frontendBase, `${section}/${page}/student-group.css`),
    path.join(frontendBase, `${section}/${page}/core.css`)
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      res.setHeader('Content-Type', 'text/css');
      return res.sendFile(c);
    }
  }
  next();
});

app.get('/:section/:page.js', (req, res, next) => {
  const { section, page } = req.params;
  const candidates = [
    path.join(frontendBase, `${section}/${page}/${page}.js`),
    path.join(frontendBase, `${section}/${page}/student-group.js`)
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      res.setHeader('Content-Type', 'application/javascript');
      return res.sendFile(c);
    }
  }
  next();
});

// Serve Frontend Static Web Client (when co-located or in Docker)
const frontendDir = frontendBase;
if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir, staticOptions));
}

// Serve Uploaded Files (assignment attachments & student submissions)
const uploadsDir = process.env.UPLOADS_DIR
  ? (path.isAbsolute(process.env.UPLOADS_DIR) ? process.env.UPLOADS_DIR : path.resolve(process.cwd(), process.env.UPLOADS_DIR))
  : path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir, staticOptions));

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
app.get(['/api/v1/departments', '/api/v1/auth/departments'], (req, res) => authController.getDepartments(req, res));

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
app.use('/api/v1/course-files', courseFileRoutes);
app.use('/api/v1/media', mediaRoutes);
app.use('/api/v1/search', mediaRoutes);

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
  dbSyncService.initDatabasePersistence();
  await testConnection();

  // Automatically synchronize active academic session & run semester promotion on startup
  try {
    const syncRes = await sessionService.syncAcademicSession();
    logger.info(`Academic Session automated & active: [${syncRes.active_session}]`);
    const promoRes = await promotionEngineService.checkAndRunAutomatedSemesterPromotion();
    if (promoRes.executed) {
      logger.info(`Autonomous Semester Promotion executed for ${promoRes.active_term}: ${promoRes.promoted_count} promoted, ${promoRes.graduated_count} graduated.`);
    }
  } catch (err) {
    logger.warn(`Failed to auto-sync academic session or run promotion: ${err.message}`);
  }

  // Periodic hourly check to auto-roll semester at midnight on boundary dates (July 1 & Jan 1)
  setInterval(async () => {
    try {
      await sessionService.syncAcademicSession();
      await promotionEngineService.checkAndRunAutomatedSemesterPromotion();
    } catch (e) {
      // background silent catch
    }
  }, 3600000);

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

  const serverInstance = app.listen(PORT, '0.0.0.0', () => {
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

  // Graceful shutdown handling for Docker / Kubernetes / systemd / PM2 / Render
  const gracefulShutdown = (signal) => {
    logger.info(`Received ${signal}. Capturing pre-shutdown snapshot and shutting down gracefully...`);
    try {
      dbSyncService.capturePreShutdownSnapshot();
    } catch (_) {}
    serverInstance.close(() => {
      logger.info('HTTP server closed. Exiting process.');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Forcefully terminating server after timeout.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
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
