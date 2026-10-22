/**
 * Device Controller — HTTP request/response handlers for hardware biometric terminals.
 */

const deviceModel = require('../models/deviceModel');
const deviceService = require('../services/deviceService');
const auditService = require('../services/auditService');
const { query } = require('../config/db');
const logger = require('../utils/logger');

class DeviceController {
  /**
   * Ingests hardware biometric fingerprint scans posted by ESP32 terminals.
   * 
   * @route POST /api/v1/devices/webhook/scan (routes/devices.js)
   * @access Public (X-Device-Secret header verification)
   * @usesService DeviceService.processScanWebhook() (services/deviceService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async handleScanWebhook(req, res) {
    const { device_uid, scans } = req.body;
    const secretKey = req.headers['x-device-secret'];

    try {
      const result = await deviceService.processScanWebhook(device_uid, scans, secretKey);
      return res.status(200).json({
        success: true,
        data: result,
        message: `Processed ${result.processed} scan(s): ${result.inserted} recorded, ${result.duplicates} duplicates acknowledged.`
      });
    } catch (err) {
      logger.error('[DeviceController] ESP32 webhook error:', { error: err.message, device_uid });
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }

  /**
   * Retrieves list of registered hardware devices with online status.
   * 
   * @route GET /api/v1/devices (routes/devices.js)
   * @access Protected (SYSTEM_ADMIN, TEACHER)
   * @usesModel DeviceModel.listDevices() (models/deviceModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async getDevices(req, res) {
    try {
      const formatted = await deviceModel.listDevices();
      return res.status(200).json({ success: true, data: formatted });
    } catch (err) {
      logger.error('[DeviceController] getDevices error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Registers a new biometric terminal device.
   * 
   * @route POST /api/v1/devices (routes/devices.js)
   * @access Protected (SYSTEM_ADMIN, HOD)
   * @usesModel DeviceModel.createDevice() (models/deviceModel.js)
   * @usesService AuditService.logAudit() (services/auditService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async registerDevice(req, res) {
    let { device_uid, name, department_id, year = 1, semester = 1, years, semesters, academic_year_id, secret_key } = req.body;

    try {
      if (!req.user.roles.includes('SYSTEM_ADMIN')) {
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

      const insertId = await deviceModel.createDevice({
        deviceUid: device_uid,
        name,
        departmentId: department_id,
        year,
        semester,
        assignedYearsStr,
        assignedSemestersStr,
        academicYearId: ayId,
        secretKey: secret_key
      });

      await auditService.logAudit({
        eventType: auditService.AUDIT_EVENTS.DEVICE_REGISTERED,
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'ADMIN',
        targetType: 'devices',
        targetId: insertId,
        details: { device_uid, name, department_id },
        ipAddress: req.ip
      });

      return res.status(201).json({
        success: true,
        data: { id: insertId, device_uid, name },
        message: 'Device registered successfully'
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' || /unique constraint/i.test(err.message)) {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Device UID already exists' } });
      }
      logger.error('[DeviceController] registerDevice error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Enrolls / maps a student fingerprint slot to a specific device.
   * 
   * @route POST /api/v1/devices/:id/slots (routes/devices.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel DeviceModel.getById() (models/deviceModel.js)
   * @usesService DeviceService.assignSlot() (services/deviceService.js)
   * @usesService AuditService.logAudit() (services/auditService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async assignSlot(req, res) {
    try {
      if (!req.user.roles.includes('SYSTEM_ADMIN')) {
        const teacherRows = await query('SELECT department_id FROM teachers WHERE id = ?', [req.user.teacher_id]);
        const teacherDeptId = teacherRows[0]?.department_id;

        const device = await deviceModel.getById(req.params.id);
        if (!device) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Device not found' } });
        }
        const deviceDeptId = device.department_id;

        const studentEnrollments = await query(
          `SELECT department_id FROM enrollments WHERE student_id = ? AND status = 'ENROLLED' LIMIT 1`,
          [req.body.student_id]
        );
        const studentDeptId = studentEnrollments[0]?.department_id;

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

      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      logger.error('[DeviceController] assignSlot error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Deallocates / deletes a student fingerprint slot from a device.
   * 
   * @route DELETE /api/v1/devices/:id/slots/:slot_id (routes/devices.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel DeviceModel.getSlot() (models/deviceModel.js)
   * @usesModel DeviceModel.deleteSlot() (models/deviceModel.js)
   * @usesService AuditService.logAudit() (services/auditService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async removeSlot(req, res) {
    try {
      const slotId = parseInt(req.params.slot_id, 10);
      const deviceId = parseInt(req.params.id, 10);

      const existing = await deviceModel.getSlot(deviceId, slotId);
      await deviceModel.deleteSlot(deviceId, slotId);

      await auditService.logAudit({
        eventType: auditService.AUDIT_EVENTS.BIOMETRIC_REMOVED,
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'TEACHER',
        targetType: 'fingerprint_slots',
        targetId: slotId,
        details: { device_id: deviceId, slot_id: slotId, student_id: existing?.student_id },
        ipAddress: req.ip
      });

      return res.json({ success: true, message: `Slot ${slotId} removed successfully` });
    } catch (err) {
      logger.error('[DeviceController] removeSlot error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Updates device active or disabled status.
   * 
   * @route PUT /api/v1/devices/:id/status (routes/devices.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel DeviceModel.updateStatus() (models/deviceModel.js)
   * @usesService AuditService.logAudit() (services/auditService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async updateDeviceStatus(req, res) {
    try {
      const { is_active } = req.body;
      const deviceId = parseInt(req.params.id, 10);

      await deviceModel.updateStatus(deviceId, is_active);

      await auditService.logAudit({
        eventType: is_active ? 'DEVICE_ENABLED' : auditService.AUDIT_EVENTS.DEVICE_DISABLED,
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'ADMIN',
        targetType: 'devices',
        targetId: deviceId,
        details: { is_active: Boolean(is_active) },
        ipAddress: req.ip
      });

      return res.json({ success: true, message: `Device status updated to ${is_active ? 'Active' : 'Disabled'}` });
    } catch (err) {
      logger.error('[DeviceController] updateDeviceStatus error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves raw immutable IoT biometric events feed with query filtering.
   * 
   * @route GET /api/v1/devices/events/raw (routes/devices.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel DeviceModel.getRawIotEvents() (models/deviceModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async getRawEvents(req, res) {
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

      const events = await deviceModel.getRawIotEvents({
        deptId,
        deviceId: device_id,
        studentId: student_id,
        date,
        fromDate: from_date,
        toDate: to_date,
        limit
      });

      return res.status(200).json({ success: true, data: events, count: events.length });
    } catch (err) {
      logger.error('[DeviceController] getRawEvents error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = new DeviceController();
