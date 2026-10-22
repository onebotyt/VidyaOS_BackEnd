/**
 * Hardware Device & ESP32 Webhook Routes (/api/v1/devices/*)
 * Delegates request processing to DeviceController.
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { deviceWebhookLimiter } = require('../middleware/rateLimiter');
const deviceController = require('../controllers/deviceController');

// @route   POST /api/v1/devices/webhook/scan
// @desc    ESP32 Hardware Webhook (Autonomous Presence Log)
// @access  Public (X-Device-Secret header verification)
// @handler DeviceController.handleScanWebhook() -> DeviceService.processScanWebhook()
router.post(
  '/webhook/scan',
  deviceWebhookLimiter,
  [
    body('device_uid').trim().notEmpty().withMessage('device_uid is required'),
    body('scans').isArray({ min: 1 }).withMessage('scans array is required'),
    validate
  ],
  (req, res) => deviceController.handleScanWebhook(req, res)
);

// @route   GET /api/v1/devices
// @desc    List Registered Hardware Devices
// @access  Protected (SYSTEM_ADMIN, TEACHER)
// @handler DeviceController.getDevices() -> DeviceModel.listDevices()
router.get('/', auth, requireRole('SYSTEM_ADMIN', 'TEACHER'), (req, res) => deviceController.getDevices(req, res));

// @route   POST /api/v1/devices
// @desc    Register New Hardware Terminal
// @access  Protected (SYSTEM_ADMIN, TEACHER)
// @handler DeviceController.registerDevice() -> DeviceModel.createDevice()
router.post(
  '/',
  auth,
  requireRole('SYSTEM_ADMIN', 'TEACHER'),
  [
    body('device_uid').trim().notEmpty().withMessage('Unique device identifier required'),
    body('name').trim().notEmpty().withMessage('Terminal name required'),
    body('department_id').optional().isInt().withMessage('Department ID must be integer'),
    body('branch_id').optional(),
    body('year').optional().isInt({ min: 1, max: 6 }).withMessage('Year must be between 1 and 6'),
    body('semester').optional().isInt({ min: 1, max: 12 }).withMessage('Semester must be between 1 and 12'),
    body('years').optional(),
    body('semesters').optional(),
    validate
  ],
  (req, res) => deviceController.registerDevice(req, res)
);

// @route   POST /api/v1/devices/:id/slots
// @desc    Assign / Confirm Fingerprint Slot
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler DeviceController.assignSlot() -> DeviceService.assignSlot() -> DeviceModel.getById()
router.post(
  '/:id/slots',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('slot_id').isInt({ min: 1, max: 1000 }).withMessage('Slot ID must be between 1 and 1000'),
    body('student_id').isInt().withMessage('Valid student ID required'),
    validate
  ],
  (req, res) => deviceController.assignSlot(req, res)
);

// @route   DELETE /api/v1/devices/:id/slots/:slot_id
// @desc    Delete / Deactivate Fingerprint Slot
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler DeviceController.removeSlot() -> DeviceModel.getSlot(), DeviceModel.deleteSlot()
router.delete('/:id/slots/:slot_id', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), (req, res) => deviceController.removeSlot(req, res));

// @route   PUT /api/v1/devices/:id/status
// @desc    Toggle Device Active Status
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler DeviceController.updateDeviceStatus() -> DeviceModel.updateStatus()
router.put('/:id/status', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), (req, res) => deviceController.updateDeviceStatus(req, res));

// @route   GET /api/v1/devices/events/raw
// @desc    Get Raw Immutable IoT Attendance Events
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler DeviceController.getRawEvents() -> DeviceModel.getRawIotEvents()
router.get('/events/raw', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), (req, res) => deviceController.getRawEvents(req, res));

module.exports = router;
