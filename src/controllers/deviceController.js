/**
 * Device Controller — HTTP request/response handlers for ESP32 biometric terminals,
 * AES-256-GCM encrypted webhooks, portable cloud template storage, and HOD device management.
 */

const crypto = require('crypto');
const deviceModel = require('../models/deviceModel');
const deviceService = require('../services/deviceService');
const auditService = require('../services/auditService');
const { query } = require('../config/db');
const logger = require('../utils/logger');

class DeviceController {
  /**
   * 1. Ingests hardware biometric fingerprint scans (supports both AES-256-GCM encrypted
   *    envelopes and legacy JSON scan arrays; 100% slot-agnostic using student_id).
   * @route POST /api/v1/devices/webhook/scan & POST /api/v1/devices/esp32/attendance
   */
  async handleScanWebhook(req, res) {
    const device_uid = req.body.device_uid || req.headers['x-device-uid'];
    const scans = req.body.scans;

    try {
      const result = await deviceService.processScanWebhook(device_uid, scans, req.headers, req.body);
      return res.status(200).json({
        success: true,
        data: result,
        encrypted_response: result.encrypted_envelope,
        message: `Processed ${result.processed} scan(s): ${result.inserted} recorded, ${result.duplicates} duplicates acknowledged.`
      });
    } catch (err) {
      logger.error('[DeviceController] ESP32 attendance webhook error:', { error: err.message, device_uid });
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }

  /**
   * 2. Encrypted ESP32 Heartbeat + 2S Battery/W25Q32 Telemetry + Remote Command Polling
   * @route POST /api/v1/devices/esp32/heartbeat
   */
  async handleEsp32Heartbeat(req, res) {
    const device_uid = req.body.device_uid || req.headers['x-device-uid'];
    try {
      const result = await deviceService.processEncryptedHeartbeat(device_uid, req.headers, req.body, req.ip);
      return res.status(200).json({
        success: true,
        data: result.plain,
        encrypted_response: result.encrypted
      });
    } catch (err) {
      logger.error('[DeviceController] ESP32 heartbeat error:', { error: err.message, device_uid });
      return res.status(err.status || 500).json({
        success: false,
        error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }

  /**
   * 3. Encrypted ESP32 Fingerprint Template Upload (Stores 512-byte AS608 template under student_id)
   * @route POST /api/v1/devices/esp32/template-upload
   */
  async handleTemplateUpload(req, res) {
    const device_uid = req.body.device_uid || req.headers['x-device-uid'];
    try {
      const result = await deviceService.processTemplateUpload(device_uid, req.headers, req.body);
      return res.status(201).json({
        success: true,
        data: result.plain,
        encrypted_response: result.encrypted,
        message: `Biometric template stored for ${result.plain.full_name} (Roll #${result.plain.class_roll_no})`
      });
    } catch (err) {
      logger.error('[DeviceController] ESP32 template upload error:', { error: err.message, device_uid });
      return res.status(err.status || 500).json({
        success: false,
        error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }

  /**
   * 4. Encrypted Department Template Bundle Download (Restores all student templates to a new/replacement ESP32)
   * @route GET /api/v1/devices/esp32/templates-sync & POST /api/v1/devices/esp32/templates-sync
   */
  async handleTemplatesSync(req, res) {
    const device_uid = req.query.device_uid || req.body?.device_uid || req.headers['x-device-uid'];
    try {
      const result = await deviceService.getEncryptedDepartmentTemplates(device_uid, req.headers, req.body || {});
      return res.status(200).json({
        success: true,
        data: result.plain,
        encrypted_response: result.encrypted
      });
    } catch (err) {
      logger.error('[DeviceController] ESP32 template sync error:', { error: err.message, device_uid });
      return res.status(err.status || 500).json({
        success: false,
        error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }

  /**
   * 5. HOD Department ESP32 & Student Biometric Management Overview
   * @route GET /api/v1/devices/hod/overview
   */
  async getHodEsp32Overview(req, res) {
    try {
      let deptId = req.query.department_id ? parseInt(req.query.department_id, 10) : null;
      if (!deptId && req.user.teacher_id) {
        const tRows = await query('SELECT department_id FROM teachers WHERE id = ?', [req.user.teacher_id]);
        deptId = tRows[0]?.department_id || null;
      }
      if (!deptId) {
        const dRows = await query('SELECT id FROM departments ORDER BY id ASC LIMIT 1');
        deptId = dRows[0]?.id || 1;
      }

      const [deptRow] = await query('SELECT id, name, code FROM departments WHERE id = ?', [deptId]);
      const devices = await deviceModel.listDevices(deptId);
      const cohortBio = await deviceService.getCohortBiometrics(
        deptId,
        deptId,
        req.query.year ? parseInt(req.query.year, 10) : null,
        req.query.semester ? parseInt(req.query.semester, 10) : null,
        null
      );

      const commands = await query(
        `SELECT cq.id, cq.device_id, cq.command_type, cq.student_id, cq.payload_json,
                cq.status, cq.result_message, cq.created_at, cq.completed_at,
                d.device_uid, d.name as device_name,
                s.full_name as student_name
         FROM esp32_command_queue cq
         JOIN devices d ON cq.device_id = d.id
         LEFT JOIN students s ON cq.student_id = s.id
         WHERE cq.department_id = ?
         ORDER BY cq.id DESC
         LIMIT 25`,
        [deptId]
      );

      const recentScans = await deviceModel.getRawIotEvents({ deptId, limit: 25 });

      return res.json({
        success: true,
        data: {
          department: deptRow || { id: deptId, name: 'Department', code: 'DEPT' },
          devices,
          students: cohortBio.students,
          commands,
          recent_scans: recentScans
        }
      });
    } catch (err) {
      logger.error('[DeviceController] getHodEsp32Overview error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * 6. Queue Remote Command to Department ESP32 (Enroll Student Fingerprint / Sync All Templates / Test Buzzer)
   * @route POST /api/v1/devices/hod/command
   */
  async queueHodDeviceCommand(req, res) {
    try {
      const { device_id, command_type, student_id, finger_index = 1 } = req.body;
      const device = await deviceModel.getById(device_id);
      if (!device) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'ESP32 device not found' } });
      }

      let payload = { finger_index: Number(finger_index) || 1 };

      if (command_type === 'ENROLL_STUDENT') {
        if (!student_id) {
          return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'student_id is required for ENROLL_STUDENT' } });
        }
        const stRows = await query(
          `SELECT s.id, s.full_name, s.official_enrollment_no,
                  COALESCE(e.class_roll_no, s.class_roll_no, 0) as class_roll_no,
                  e.year, e.semester
           FROM students s
           LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
           WHERE s.id = ? LIMIT 1`,
          [student_id]
        );
        if (!stRows.length) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Student not found' } });
        }
        const st = stRows[0];
        payload = {
          student_id: st.id,
          full_name: st.full_name,
          class_roll_no: st.class_roll_no,
          official_enrollment_no: st.official_enrollment_no,
          year: st.year,
          semester: st.semester,
          finger_index: Number(finger_index) || 1
        };

        // Cancel any older pending enrollment command on this device
        await query(
          `UPDATE esp32_command_queue SET status = 'CANCELLED' WHERE device_id = ? AND status = 'PENDING' AND command_type = 'ENROLL_STUDENT'`,
          [device.id]
        );
      }

      const resInsert = await query(
        `INSERT INTO esp32_command_queue (device_id, department_id, command_type, student_id, payload_json, status, created_by)
         VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
        [device.id, device.department_id, command_type, student_id || null, JSON.stringify(payload), req.user.id]
      );

      const cmdId = resInsert.insertId || resInsert[0]?.insertId || resInsert.lastID;
      return res.status(201).json({
        success: true,
        data: {
          command_id: cmdId,
          device_id: device.id,
          device_uid: device.device_uid,
          command_type,
          payload
        },
        message: command_type === 'ENROLL_STUDENT'
          ? `ESP32 '${device.name}' is ready to scan fingerprint for ${payload.full_name} (Roll #${payload.class_roll_no})`
          : `Command '${command_type}' queued for ESP32 '${device.name}'`
      });
    } catch (err) {
      logger.error('[DeviceController] queueHodDeviceCommand error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * 7. Simulate / Execute Instant Encrypted Fingerprint Template Capture or Attendance Scan
   *    (Allows HOD to test end-to-end AES-256-GCM template storage & OLED display preview!)
   * @route POST /api/v1/devices/hod/simulate-esp32
   */
  async simulateEsp32Action(req, res) {
    try {
      const { device_id, action_type, student_id, is_offline_sync = false, battery_voltage = 7.85, battery_pct = 84 } = req.body;
      const device = await deviceModel.getById(device_id);
      if (!device) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'ESP32 device not found' } });
      }

      const secret = device.secret_key || device.secret_hash || 'default_secret';
      const { encryptEsp32Payload } = require('../utils/esp32Crypto');

      // Update heartbeat & battery telemetry first
      await deviceService.processEncryptedHeartbeat(
        device.device_uid,
        {},
        encryptEsp32Payload({
          battery_voltage: Number(battery_voltage) || 7.85,
          battery_pct: Number(battery_pct) || 84,
          offline_queue_count: is_offline_sync ? 0 : 0,
          w25q32_used_kb: 128
        }, secret),
        req.ip
      );

      if (action_type === 'ENROLL_TEMPLATE') {
        // Generate deterministic 512-byte AS608 template buffer for this student
        const rawTemplate = Buffer.alloc(512);
        const header = Buffer.from(`AS608_TPL_STD_${student_id}_${Date.now()}`);
        header.copy(rawTemplate, 0);
        crypto.randomFillSync(rawTemplate, header.length, 512 - header.length);
        const templateBase64 = rawTemplate.toString('base64');

        const encryptedUpload = encryptEsp32Payload({
          student_id: Number(student_id),
          finger_index: 1,
          template_base64: templateBase64,
          quality_score: 98
        }, secret);

        const result = await deviceService.processTemplateUpload(device.device_uid, {}, encryptedUpload);
        return res.json({
          success: true,
          data: result.plain,
          encrypted_wire_sample: encryptedUpload,
          message: `AES-256-GCM Encrypted 512-byte AS608 template stored in MySQL for ${result.plain.full_name}!`
        });
      }

      if (action_type === 'MARK_ATTENDANCE') {
        const eventId = `ESP32-${device.device_uid}-${student_id}-${Date.now()}`;
        const encryptedScan = encryptEsp32Payload({
          scans: [
            {
              event_id: eventId,
              student_id: Number(student_id),
              scanned_at: new Date().toISOString(),
              confidence: 99,
              is_offline_sync: Boolean(is_offline_sync)
            }
          ]
        }, secret);

        const result = await deviceService.processScanWebhook(device.device_uid, null, {}, encryptedScan);
        const conf = result.confirmations?.[0] || {};
        return res.json({
          success: true,
          data: conf,
          encrypted_wire_sample: encryptedScan,
          message: `Attendance Marked for ${conf.full_name || 'Student'} (Roll #${conf.class_roll_no || '—'})`
        });
      }

      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Unsupported action_type' } });
    } catch (err) {
      logger.error('[DeviceController] simulateEsp32Action error:', { error: err.message });
      return res.status(err.status || 500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * 8. Delete a student's cloud fingerprint template
   * @route DELETE /api/v1/devices/hod/templates/:student_id
   */
  async deleteStudentTemplate(req, res) {
    try {
      const studentId = parseInt(req.params.student_id, 10);
      await query(`DELETE FROM student_biometric_templates WHERE student_id = ?`, [studentId]);
      await query(`DELETE FROM fingerprint_slots WHERE student_id = ?`, [studentId]);
      return res.json({ success: true, message: 'Student biometric template removed from cloud vault.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  async getDevices(req, res) {
    try {
      let deptId = req.query.department_id ? parseInt(req.query.department_id, 10) : null;
      if (!req.user.roles.includes('SYSTEM_ADMIN') && req.user.teacher_id && !deptId) {
        const tRows = await query('SELECT department_id FROM teachers WHERE id = ?', [req.user.teacher_id]);
        deptId = tRows[0]?.department_id || null;
      }
      const formatted = await deviceModel.listDevices(deptId);
      return res.status(200).json({ success: true, data: formatted });
    } catch (err) {
      logger.error('[DeviceController] getDevices error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  async registerDevice(req, res) {
    let { device_uid, name, department_id, year = 1, semester = 1, years, semesters, academic_year_id, secret_key, secret } = req.body;

    try {
      if (!req.user.roles.includes('SYSTEM_ADMIN')) {
        const tRows = await query('SELECT department_id FROM teachers WHERE id = ?', [req.user.teacher_id]);
        if (tRows.length && tRows[0].department_id) {
          department_id = tRows[0].department_id;
        }
      }

      if (!department_id) {
        const dRows = await query('SELECT id FROM departments ORDER BY id ASC LIMIT 1');
        department_id = dRows[0]?.id || 1;
      }

      const ayId = academic_year_id || (await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`))[0]?.id || 1;

      let assignedYearsStr = '1,2,3';
      let assignedSemestersStr = '1,2,3,4,5,6';

      if (Array.isArray(years) && years.length > 0) {
        assignedYearsStr = years.join(',');
      } else if (typeof years === 'string' && years.trim()) {
        assignedYearsStr = years.trim();
      }

      if (Array.isArray(semesters) && semesters.length > 0) {
        assignedSemestersStr = semesters.join(',');
      } else if (typeof semesters === 'string' && semesters.trim()) {
        assignedSemestersStr = semesters.trim();
      }

      const created = await deviceModel.createDevice({
        deviceUid: device_uid,
        name,
        departmentId: department_id,
        year: parseInt(year, 10) || 1,
        semester: parseInt(semester, 10) || 1,
        assignedYearsStr,
        assignedSemestersStr,
        academicYearId: ayId,
        secretKey: secret_key || secret
      });

      await auditService.logAudit({
        eventType: auditService.AUDIT_EVENTS.DEVICE_REGISTERED,
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'HOD',
        targetType: 'devices',
        targetId: created.id,
        details: { device_uid, name, department_id, encryption: 'AES-256-GCM' },
        ipAddress: req.ip
      });

      return res.status(201).json({
        success: true,
        data: {
          id: created.id,
          device_uid,
          name,
          department_id,
          secret_key: created.secret_key,
          encryption_mode: 'AES-256-GCM'
        },
        message: 'ESP32 Biometric Terminal registered with AES-256-GCM encryption key'
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' || /unique constraint|Duplicate entry/i.test(err.message)) {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Device UID already exists' } });
      }
      logger.error('[DeviceController] registerDevice error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  async assignSlot(req, res) {
    try {
      const result = await deviceService.assignSlot(req.params.id, req.body.slot_id || 1, req.body.student_id);
      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  async removeSlot(req, res) {
    try {
      const slotId = parseInt(req.params.slot_id, 10);
      const deviceId = parseInt(req.params.id, 10);
      await deviceModel.deleteSlot(deviceId, slotId);
      return res.json({ success: true, message: `Slot ${slotId} removed successfully` });
    } catch (err) {
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  async updateDeviceStatus(req, res) {
    try {
      const { is_active } = req.body;
      const deviceId = parseInt(req.params.id, 10);
      await deviceModel.updateStatus(deviceId, is_active);
      return res.json({ success: true, message: `Device status updated to ${is_active ? 'Active' : 'Disabled'}` });
    } catch (err) {
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  async getRawEvents(req, res) {
    try {
      const { department_id, device_id, student_id, date, from_date, to_date, limit = 100 } = req.query;
      let deptId = department_id;

      if (!req.user.roles.includes('SYSTEM_ADMIN') && req.user.teacher_id && !deptId) {
        const tRows = await query('SELECT department_id FROM teachers WHERE id = ?', [req.user.teacher_id]);
        deptId = tRows[0]?.department_id;
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
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = new DeviceController();
