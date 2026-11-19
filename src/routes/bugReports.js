/**
 * Bug Report Routes (/api/v1/bug-reports/*)
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const bugReportController = require('../controllers/bugReportController');

// Multer storage setup for bug reports
const UPLOAD_ROOT = process.env.UPLOADS_DIR
  ? (path.isAbsolute(process.env.UPLOADS_DIR) ? process.env.UPLOADS_DIR : path.resolve(process.cwd(), process.env.UPLOADS_DIR))
  : path.join(__dirname, '../../uploads');

const bugUploadsDir = path.join(UPLOAD_ROOT, 'bug-reports');
if (!fs.existsSync(bugUploadsDir)) {
  fs.mkdirSync(bugUploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, bugUploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeBase = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 50);
    const unique = `${Date.now()}_${Math.round(Math.random() * 1e6)}`;
    cb(null, `${safeBase}_${unique}${ext}`);
  }
});

const uploadBugFiles = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max file size
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'screenshot') {
      if (!['.png', '.jpg', '.jpeg'].includes(ext)) {
        return cb(new Error('Screenshot must be a PNG, JPG, or JPEG file.'));
      }
    } else if (file.fieldname === 'recording') {
      if (!['.mp4', '.webm'].includes(ext)) {
        return cb(new Error('Screen recording must be an MP4 or WebM video file.'));
      }
    }
    cb(null, true);
  }
}).fields([
  { name: 'screenshot', maxCount: 1 },
  { name: 'recording', maxCount: 1 }
]);

// Wrapper for clean multer error handling
function handleBugUpload(req, res, next) {
  uploadBugFiles(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: { code: 'FILE_TOO_LARGE', message: 'File is too large. Screenshots must be <= 10MB and recordings <= 50MB.' }
        });
      }
      return res.status(400).json({
        success: false,
        error: { code: 'UPLOAD_ERROR', message: err.message }
      });
    }
    next();
  });
}

// All bug report endpoints require authentication
router.use(auth);

// Submitter endpoints (Students, Faculty, Admins)
router.post('/', handleBugUpload, (req, res) => bugReportController.submitBugReport(req, res));
router.get('/my', (req, res) => bugReportController.getMyBugReports(req, res));
router.get('/my/:id', (req, res) => bugReportController.getMyBugReportById(req, res));

// Admin management endpoints
router.get('/admin/all', requireRole('ADMIN', 'SYSTEM_ADMIN'), (req, res) => bugReportController.adminGetAllReports(req, res));
router.get('/admin/statistics', requireRole('ADMIN', 'SYSTEM_ADMIN'), (req, res) => bugReportController.adminGetStatistics(req, res));
router.get('/admin/:id', requireRole('ADMIN', 'SYSTEM_ADMIN'), (req, res) => bugReportController.adminGetReportById(req, res));
router.put('/admin/:id/status', requireRole('ADMIN', 'SYSTEM_ADMIN'), (req, res) => bugReportController.adminUpdateStatus(req, res));

module.exports = router;
