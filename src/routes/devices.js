/**
 * Hardware Device & Encrypted ESP32 Biometric Routes (/api/v1/devices/*)
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { deviceWebhookLimiter } = require('../middleware/rateLimiter');
const deviceController = require('../controllers/deviceController');

// ── 1. Encrypted ESP32 Hardware Endpoints (AES-256-GCM / X-Device-UID) ──────

// @route   POST /api/v1/devices/esp32/heartbeat
// @desc    Encrypted ESP32 Heartbeat + 2S Battery/W25Q32 Telemetry + Command Poll
router.post('/esp32/heartbeat', deviceWebhookLimiter, (req, res) => deviceController.handleEsp32Heartbeat(req, res));

// @route   POST /api/v1/devices/esp32/template-upload
// @desc    ESP32 Uploads Captured 512-Byte AS608 Fingerprint Template for Student
router.post('/esp32/template-upload', deviceWebhookLimiter, (req, res) => deviceController.handleTemplateUpload(req, res));

// @route   GET & POST /api/v1/devices/esp32/templates-sync
// @desc    ESP32 Downloads Encrypted Department Fingerprint Templates Bundle
router.get('/esp32/templates-sync', deviceWebhookLimiter, (req, res) => deviceController.handleTemplatesSync(req, res));
router.post('/esp32/templates-sync', deviceWebhookLimiter, (req, res) => deviceController.handleTemplatesSync(req, res));

// @route   POST /api/v1/devices/esp32/attendance
// @desc    Encrypted Slot-Agnostic Online & W25Q32 Offline Batch Attendance Sync
router.post('/esp32/attendance', deviceWebhookLimiter, (req, res) => deviceController.handleScanWebhook(req, res));

// @route   POST /api/v1/devices/webhook/scan
// @desc    Compatible ESP32 Hardware Webhook (Encrypted or JSON)
router.post('/webhook/scan', deviceWebhookLimiter, (req, res) => deviceController.handleScanWebhook(req, res));

// ── 2. HOD & Faculty Biometric Management Endpoints ─────────────────────────

// @route   GET /api/v1/devices/hod/overview
// @desc    Complete HOD Department ESP32 & Student Biometric Template Overview
router.get('/hod/overview', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), (req, res) => deviceController.getHodEsp32Overview(req, res));

// @route   POST /api/v1/devices/hod/command
// @desc    Queue Remote Command to ESP32 (ENROLL_STUDENT, SYNC_TEMPLATES, BUZZER_CHIME)
router.post('/hod/command', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), (req, res) => deviceController.queueHodDeviceCommand(req, res));

// @route   POST /api/v1/devices/hod/simulate-esp32
// @desc    Simulate Encrypted ESP32 Enrollment or Attendance Scan with OLED Preview
router.post('/hod/simulate-esp32', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), (req, res) => deviceController.simulateEsp32Action(req, res));

// @route   DELETE /api/v1/devices/hod/templates/:student_id
// @desc    Remove a student's cloud fingerprint template
router.delete('/hod/templates/:student_id', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), (req, res) => deviceController.deleteStudentTemplate(req, res));

// ── 3. Standard Device Administration Routes ────────────────────────────────

router.get('/', auth, requireRole('SYSTEM_ADMIN', 'TEACHER'), (req, res) => deviceController.getDevices(req, res));

router.post(
  '/',
  auth,
  requireRole('SYSTEM_ADMIN', 'TEACHER'),
  [
    body('device_uid').trim().notEmpty().withMessage('Unique device identifier required'),
    body('name').trim().notEmpty().withMessage('Terminal name required'),
    validate
  ],
  (req, res) => deviceController.registerDevice(req, res)
);

router.post('/:id/slots', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), (req, res) => deviceController.assignSlot(req, res));
router.delete('/:id/slots/:slot_id', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), (req, res) => deviceController.removeSlot(req, res));
router.put('/:id/status', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), (req, res) => deviceController.updateDeviceStatus(req, res));
router.get('/events/raw', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), (req, res) => deviceController.getRawEvents(req, res));

module.exports = router;
