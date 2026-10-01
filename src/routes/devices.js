/**
 * Hardware Device & ESP32 Webhook Routes (/api/v1/devices/*)
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { deviceWebhookLimiter } = require('../middleware/rateLimiter');
const { query } = require('../config/db');
const deviceService = require('../services/deviceService');
const auditService = require('../services/auditService');
const logger = require('../utils/logger');

/**
 * ESP32 Hardware Webhook (Autonomous Presence Log)
 * POST /api/v1/devices/webhook/scan
 * Unauthenticated (Secured via Pre-Shared Secret Header / Payload)
 */
router.post(
  '/webhook/scan',
  deviceWebhookLimiter,
  [
    body('device_uid').trim().notEmpty().withMessage('device_uid is required'),
    body('scans').isArray({ min: 1 }).withMessage('scans array is required'),
    validate
  ],
  async (req, res) => {
    const { device_uid, scans } = req.body;
    const secretKey = req.headers['x-device-secret'];

    try {
      const result = await deviceService.processScanWebhook(device_uid, scans, secretKey);
      res.status(200).json({
        success: true,
        data: result,
        message: `Processed ${result.processed} scan(s): ${result.inserted} recorded, ${result.duplicates} duplicates acknowledged.`
      });
    } catch (err) {
      logger.error('ESP32 webhook processing error', { error: err.message, device_uid });
      const status = err.status || 500;
      res.status(status).json({
        success: false,
        error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }
);

/**
 * List Registered Hardware Devices
 * GET /api/v1/devices
 */
router.get('/', auth, requireRole('SYSTEM_ADMIN', 'TEACHER'), async (req, res) => {
  try {
    const devices = await query(
      `SELECT d.id, d.device_uid, d.name, d.is_active, d.last_heartbeat_at,
              d.department_id, d.department_id as branch_id, d.year, d.semester,
              dept.code as department_code, dept.code as branch_code,
              (SELECT COUNT(*) FROM fingerprint_slots fs WHERE fs.device_id = d.id AND fs.is_active = 1) as enrolled_count
       FROM devices d
       LEFT JOIN departments dept ON d.department_id = dept.id
       ORDER BY d.name ASC`
    );

    const now = new Date();
    const formatted = devices.map(d => {
      let isOnline = false;
      let minutesSinceHeartbeat = null;
      if (d.last_heartbeat_at) {
        const hbTime = new Date(d.last_heartbeat_at);
        minutesSinceHeartbeat = Math.round((now - hbTime) / 60000);
        isOnline = minutesSinceHeartbeat <= 5;
      }
      return {
        ...d,
        is_online: isOnline,
        minutes_since_heartbeat: minutesSinceHeartbeat,
        total_slots: 1000
      };
    });

    res.status(200).json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Register New Hardware Terminal
 * POST /api/v1/devices
 */
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
  async (req, res) => {
    let { device_uid, name, department_id, year = 1, semester = 1, years, semesters, academic_year_id, secret_key } = req.body;

    try {
      if (!req.user.roles.includes('SYSTEM_ADMIN')) {
        // Must be HOD
        const hodAssignment = await query(
          `SELECT department_id FROM teacher_assignments WHERE teacher_id = ? AND assignment_type = 'HOD' AND is_active = 1 LIMIT 1`,
          [req.user.teacher_id]
        );
        if (!hodAssignment.length) {
          return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only HOD or Admin can register hardware devices' } });
        }
        department_id = hodAssignment[0].department_id;
      }

      if (!department_id) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Department ID is required' } });
      }

      const ayId = academic_year_id || (await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`))[0]?.id || 1;

      // Multi-year & auto-semester parsing
      let assignedYearsStr = null;
      let assignedSemestersStr = null;
      let parsedYears = [];
      let parsedSemesters = [];

      if (Array.isArray(years) && years.length > 0) {
        parsedYears = [...new Set(years.map(y => parseInt(y, 10)).filter(y => !isNaN(y) && y > 0))].sort((a, b) => a - b);
        assignedYearsStr = parsedYears.join(',');
        year = parsedYears[0];
      } else if (typeof years === 'string' && years.trim()) {
        parsedYears = [...new Set(years.trim().split(',').map(y => parseInt(y, 10)).filter(y => !isNaN(y) && y > 0))].sort((a, b) => a - b);
        assignedYearsStr = parsedYears.join(',');
        year = parsedYears[0] || parseInt(year, 10) || 1;
      } else {
        year = parseInt(year, 10) || 1;
        parsedYears = [year];
        assignedYearsStr = String(year);
      }

      if (Array.isArray(semesters) && semesters.length > 0) {
        parsedSemesters = [...new Set(semesters.map(s => parseInt(s, 10)).filter(s => !isNaN(s) && s > 0))].sort((a, b) => a - b);
        assignedSemestersStr = parsedSemesters.join(',');
        semester = parsedSemesters[0];
      } else if (typeof semesters === 'string' && semesters.trim()) {
        parsedSemesters = [...new Set(semesters.trim().split(',').map(s => parseInt(s, 10)).filter(s => !isNaN(s) && s > 0))].sort((a, b) => a - b);
        assignedSemestersStr = parsedSemesters.join(',');
        semester = parsedSemesters[0] || parseInt(semester, 10) || 1;
      } else {
        parsedSemesters = [];
        parsedYears.forEach(y => {
          parsedSemesters.push((y * 2) - 1, y * 2);
        });
        parsedSemesters = [...new Set(parsedSemesters)].sort((a, b) => a - b);
        assignedSemestersStr = parsedSemesters.join(',');
        semester = parsedSemesters[0] || 1;
      }

      const [insertRes] = await query(
        `INSERT INTO devices (device_uid, name, department_id, year, semester, assigned_years, assigned_semesters, academic_year_id, secret_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [device_uid, name, department_id, year, semester, assignedYearsStr, assignedSemestersStr, ayId, secret_key || 'default_secret']
      );

      await auditService.logAudit({
        eventType: auditService.AUDIT_EVENTS.DEVICE_REGISTERED,
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'ADMIN',
        targetType: 'devices',
        targetId: insertRes.insertId,
        details: { device_uid, name, department_id },
        ipAddress: req.ip
      });

      res.status(201).json({
        success: true,
        data: { id: insertRes.insertId, device_uid, name },
        message: 'Device registered successfully'
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Device UID already exists' } });
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * Assign / Confirm Fingerprint Slot
 * POST /api/v1/devices/:id/slots
 */
router.post(
  '/:id/slots',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('slot_id').isInt({ min: 1, max: 1000 }).withMessage('Slot ID must be between 1 and 1000'),
    body('student_id').isInt().withMessage('Valid student ID required'),
    validate
  ],
  async (req, res) => {
    try {
      if (!req.user.roles.includes('SYSTEM_ADMIN')) {
        // Teacher's department:
        const teacherRows = await query('SELECT department_id FROM teachers WHERE id = ?', [req.user.teacher_id]);
        const teacherDeptId = teacherRows[0]?.department_id;

        // Device's department:
        const deviceRows = await query('SELECT department_id FROM devices WHERE id = ?', [req.params.id]);
        if (!deviceRows.length) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Device not found' } });
        }
        const deviceDeptId = deviceRows[0].department_id;

        // Student's department:
        const studentEnrollments = await query(
          `SELECT department_id FROM enrollments WHERE student_id = ? AND status = 'ENROLLED' LIMIT 1`,
          [req.body.student_id]
        );
        const studentDeptId = studentEnrollments[0]?.department_id;

        // Check if teacher is HOD of that department
        const isHod = await query(
          `SELECT id FROM departments WHERE id = ? AND hod_user_id = ?`,
          [deviceDeptId, req.user.id]
        );

        if (!isHod.length && (!teacherDeptId || teacherDeptId !== deviceDeptId || (studentDeptId && studentDeptId !== teacherDeptId))) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Department faculty can only enroll fingerprints for students within their own department.'
            }
          });
        }
      }
      const result = await deviceService.assignSlot(req.params.id, req.body.slot_id, req.body.student_id);

      await auditService.logAudit({
        eventType: auditService.AUDIT_EVENTS.BIOMETRIC_ENROLLED,
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'TEACHER',
        targetType: 'fingerprint_slots',
        targetId: req.body.slot_id,
        details: { device_id: req.params.id, slot_id: req.body.slot_id, student_id: req.body.student_id },
        ipAddress: req.ip
      });

      res.status(201).json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * Delete / Deactivate Fingerprint Slot
 * DELETE /api/v1/devices/:id/slots/:slot_id
 */
router.delete('/:id/slots/:slot_id', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const slotId = parseInt(req.params.slot_id, 10);
    const deviceId = parseInt(req.params.id, 10);

    const [existing] = await query(
      'SELECT student_id FROM fingerprint_slots WHERE device_id = ? AND slot_id = ?',
      [deviceId, slotId]
    );

    await query(
      'DELETE FROM fingerprint_slots WHERE device_id = ? AND slot_id = ?',
      [deviceId, slotId]
    );

    await auditService.logAudit({
      eventType: auditService.AUDIT_EVENTS.BIOMETRIC_REMOVED,
      actorId: req.user.id,
      actorRole: req.user.roles?.[0] || 'TEACHER',
      targetType: 'fingerprint_slots',
      targetId: slotId,
      details: { device_id: deviceId, slot_id: slotId, student_id: existing?.student_id },
      ipAddress: req.ip
    });

    res.json({ success: true, message: `Slot ${slotId} removed successfully` });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Toggle Device Active Status
 * PUT /api/v1/devices/:id/status
 */
router.put('/:id/status', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const { is_active } = req.body;
    const deviceId = parseInt(req.params.id, 10);

    await query('UPDATE devices SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, deviceId]);

    await auditService.logAudit({
      eventType: is_active ? 'DEVICE_ENABLED' : auditService.AUDIT_EVENTS.DEVICE_DISABLED,
      actorId: req.user.id,
      actorRole: req.user.roles?.[0] || 'ADMIN',
      targetType: 'devices',
      targetId: deviceId,
      details: { is_active: Boolean(is_active) },
      ipAddress: req.ip
    });

    res.json({ success: true, message: `Device status updated to ${is_active ? 'Active' : 'Disabled'}` });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Get Raw Immutable IoT Attendance Events
 * GET /api/v1/devices/events/raw
 * (HOD, Department Faculty, System Admin)
 */
router.get('/events/raw', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const { department_id, device_id, student_id, date, from_date, to_date, limit = 100 } = req.query;
    let deptId = department_id;

    if (!req.user.roles.includes('SYSTEM_ADMIN')) {
      const tRows = await query('SELECT department_id FROM teachers WHERE id = ?', [req.user.teacher_id]);
      const teacherDept = tRows[0]?.department_id;
      if (teacherDept) {
        deptId = teacherDept;
      }
    }

    let sql = `
      SELECT ie.id, ie.student_id, ie.device_id, ie.department_id,
             ie.scan_time, ie.scan_date, ie.verification_status, ie.event_type,
             s.official_enrollment_no, s.registration_no, s.full_name,
             COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no,
             d.device_uid, d.name as device_name,
             dept.name as department_name, dept.code as department_code
      FROM iot_attendance_events ie
      JOIN students s ON ie.student_id = s.id
      JOIN devices d ON ie.device_id = d.id
      LEFT JOIN departments dept ON ie.department_id = dept.id
      LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
      WHERE 1=1
    `;
    const params = [];

    if (deptId) {
      sql += ` AND ie.department_id = ?`;
      params.push(Number(deptId));
    }
    if (device_id) {
      sql += ` AND ie.device_id = ?`;
      params.push(Number(device_id));
    }
    if (student_id) {
      sql += ` AND ie.student_id = ?`;
      params.push(Number(student_id));
    }
    if (date) {
      sql += ` AND ie.scan_date = ?`;
      params.push(date);
    }
    if (from_date) {
      sql += ` AND ie.scan_date >= ?`;
      params.push(from_date);
    }
    if (to_date) {
      sql += ` AND ie.scan_date <= ?`;
      params.push(to_date);
    }

    sql += ` ORDER BY ie.scan_time DESC LIMIT ?`;
    params.push(Math.min(parseInt(limit, 10) || 100, 500));

    const events = await query(sql, params);
    res.status(200).json({ success: true, data: events, count: events.length });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;
