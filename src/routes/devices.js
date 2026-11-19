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

// @route   POST /api/v1/devices/esp32/wifi-scan-report
// @desc    ESP32 Uploads Nearby Wi-Fi Scan Results
router.post('/esp32/wifi-scan-report', deviceWebhookLimiter, (req, res) => deviceController.handleWifiScanReport(req, res));

// @route   POST /api/v1/devices/esp32/logs
// @desc    ESP32 Transmits Remote Diagnostic Logs Over Internet
router.post('/esp32/logs', deviceWebhookLimiter, (req, res) => deviceController.handleDeviceLogs(req, res));

// @route   POST /api/v1/devices/webhook/scan
// @desc    Compatible ESP32 Hardware Webhook (Encrypted or JSON)
router.post('/webhook/scan', deviceWebhookLimiter, (req, res) => deviceController.handleScanWebhook(req, res));

// ── 2. HOD & Faculty Biometric & Wi-Fi Management Endpoints ──────────────────
const facultyRoles = ['TEACHER', 'HOD', 'DEPT_HEAD', 'FACULTY', 'CLASS_TEACHER', 'COMMON_FACULTY_MANAGER', 'SYSTEM_ADMIN', 'ADMIN'];

// @route   GET /api/v1/devices/hod/overview
// @desc    Complete HOD Department ESP32 & Student Biometric Template Overview
router.get('/hod/overview', auth, requireRole(...facultyRoles), (req, res) => deviceController.getHodEsp32Overview(req, res));

// @route   GET /api/v1/devices/hod/detect
// @desc    Auto-Detect Nearby or Active ESP32 Biometric Terminal
router.get('/hod/detect', auth, requireRole(...facultyRoles), (req, res) => deviceController.detectNearbyDevice(req, res));

// @route   GET /api/v1/devices/hod/:device_id/wifi
// @desc    List Configured Wi-Fi Networks for Terminal
router.get('/hod/:device_id/wifi', auth, requireRole(...facultyRoles), (req, res) => deviceController.getDeviceWifiNetworks(req, res));

// @route   GET /api/v1/devices/hod/:device_id/ping
// @desc    Check Live Connection and Telemetry of ESP32
router.get('/hod/:device_id/ping', auth, requireRole(...facultyRoles), (req, res) => deviceController.pingDevice(req, res));

// @route   POST /api/v1/devices/hod/:device_id/ota-update
// @desc    Trigger Over-The-Air (OTA) Firmware Update on ESP32
router.post('/hod/:device_id/ota-update', auth, requireRole(...facultyRoles), (req, res) => deviceController.triggerOtaUpdate(req, res));

// @route   POST /api/v1/devices/hod/:device_id/wifi
// @desc    Add New Wi-Fi Network & Queue to ESP32
router.post('/hod/:device_id/wifi', auth, requireRole(...facultyRoles), (req, res) => deviceController.addDeviceWifiNetwork(req, res));

// @route   PUT /api/v1/devices/hod/:device_id/wifi/:wifi_id/default
// @desc    Set a Wi-Fi Network as Default
router.put('/hod/:device_id/wifi/:wifi_id/default', auth, requireRole(...facultyRoles), (req, res) => deviceController.setDefaultWifiNetwork(req, res));

// @route   DELETE /api/v1/devices/hod/:device_id/wifi/:wifi_id
// @desc    Delete Wi-Fi Network from Terminal
router.delete('/hod/:device_id/wifi/:wifi_id', auth, requireRole(...facultyRoles), (req, res) => deviceController.deleteDeviceWifiNetwork(req, res));

// @route   POST /api/v1/devices/hod/:device_id/wifi/scan
// @desc    Trigger Real-Time Nearby Wi-Fi Scan on ESP32
router.post('/hod/:device_id/wifi/scan', auth, requireRole(...facultyRoles), (req, res) => deviceController.triggerWifiScan(req, res));

// @route   GET /api/v1/devices/hod/:device_id/wifi/scans
// @desc    Fetch Latest Scanned Nearby Wi-Fi Networks
router.get('/hod/:device_id/wifi/scans', auth, requireRole(...facultyRoles), (req, res) => deviceController.getLatestWifiScans(req, res));

// @route   POST /api/v1/devices/hod/:device_id/wifi/switch
// @desc    Instruct ESP32 to Switch to a Specific Network
router.post('/hod/:device_id/wifi/switch', auth, requireRole(...facultyRoles), (req, res) => deviceController.switchDeviceWifi(req, res));

// @route   POST /api/v1/devices/hod/:device_id/wifi/fallback
// @desc    Trigger Instant Fallback to Default Institutional Wi-Fi
router.post('/hod/:device_id/wifi/fallback', auth, requireRole(...facultyRoles), (req, res) => deviceController.triggerWifiFallback(req, res));

// @route   POST /api/v1/devices/hod/:device_id/wifi/reset
// @desc    Reset Wi-Fi Credentials on ESP32 to Factory Default
router.post('/hod/:device_id/wifi/reset', auth, requireRole(...facultyRoles), (req, res) => deviceController.triggerWifiReset(req, res));

// @route   GET /api/v1/devices/hod/:device_id/logs
// @desc    Fetch Remote Diagnostic Logs Transmitted from ESP32 over Internet
router.get('/hod/:device_id/logs', auth, requireRole(...facultyRoles), (req, res) => deviceController.getDeviceLogs(req, res));

// @route   DELETE /api/v1/devices/hod/:device_id/logs
// @desc    Clear Remote Diagnostic Logs for Terminal
router.delete('/hod/:device_id/logs', auth, requireRole(...facultyRoles), (req, res) => deviceController.clearDeviceLogs(req, res));

// @route   POST /api/v1/devices/hod/command
// @desc    Queue Remote Command to ESP32 (ENROLL_STUDENT, SYNC_TEMPLATES, BUZZER_CHIME)
router.post('/hod/command', auth, requireRole(...facultyRoles), (req, res) => deviceController.queueHodDeviceCommand(req, res));

// Direct route aliases for HOD device actions
router.post('/hod/:device_id/enroll', auth, requireRole(...facultyRoles), (req, res) => {
  req.body.device_id = parseInt(req.params.device_id, 10);
  req.body.command_type = 'ENROLL_STUDENT';
  return deviceController.queueHodDeviceCommand(req, res);
});

router.post('/hod/:device_id/sync-templates', auth, requireRole(...facultyRoles), (req, res) => {
  req.body.device_id = parseInt(req.params.device_id, 10);
  req.body.command_type = 'SYNC_TEMPLATES';
  return deviceController.queueHodDeviceCommand(req, res);
});

// @route   POST /api/v1/devices/hod/simulate-esp32
// @desc    Simulate Encrypted ESP32 Enrollment or Attendance Scan with OLED Preview
router.post('/hod/simulate-esp32', auth, requireRole(...facultyRoles), (req, res) => deviceController.simulateEsp32Action(req, res));
router.post('/hod/simulate-biometric', auth, requireRole(...facultyRoles), (req, res) => {
  req.body.action_type = req.body.action || req.body.action_type || 'ENROLL_TEMPLATE';
  return deviceController.simulateEsp32Action(req, res);
});

// @route   DELETE /api/v1/devices/hod/templates/:student_id
// @desc    Remove a student's cloud fingerprint template
router.delete('/hod/templates/:student_id', auth, requireRole(...facultyRoles), (req, res) => deviceController.deleteStudentTemplate(req, res));
router.delete('/hod/template/:student_id', auth, requireRole(...facultyRoles), (req, res) => deviceController.deleteStudentTemplate(req, res));

// ── 3. Standard Device Administration Routes ────────────────────────────────

router.get('/', auth, requireRole(...facultyRoles), (req, res) => deviceController.getDevices(req, res));

router.post(
  '/',
  auth,
  requireRole(...facultyRoles),
  [
    body('device_uid').trim().notEmpty().withMessage('Unique device identifier required'),
    body('name').trim().notEmpty().withMessage('Terminal name required'),
    validate
  ],
  (req, res) => deviceController.registerDevice(req, res)
);

router.post('/:id/slots', auth, requireRole(...facultyRoles), (req, res) => deviceController.assignSlot(req, res));
router.delete('/:id/slots/:slot_id', auth, requireRole(...facultyRoles), (req, res) => deviceController.removeSlot(req, res));
router.put('/:id/status', auth, requireRole(...facultyRoles), (req, res) => deviceController.updateDeviceStatus(req, res));
router.get('/events/raw', auth, requireRole(...facultyRoles), (req, res) => deviceController.getRawEvents(req, res));

module.exports = router;
