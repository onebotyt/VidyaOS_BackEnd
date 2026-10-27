/**
 * ══════════════════════════════════════════════════════════════
 * OCR ROUTES (/api/v1/ocr/*)
 * backend/src/routes/ocr.js
 * ══════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const ocrController = require('../controllers/ocrController');

// In-memory buffer upload for OCR analysis
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024 // 30MB limit for high-res scans / PDFs
  }
});

router.use(auth);

// @route   POST /api/v1/ocr/extract-questions
// @desc    Intelligently extracts questions, instructions, and max marks from uploaded PDF/Image
// @access  Protected (TEACHER, SYSTEM_ADMIN)
router.post(
  '/extract-questions',
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  upload.single('document'),
  (req, res) => ocrController.extractQuestions(req, res)
);

module.exports = router;
