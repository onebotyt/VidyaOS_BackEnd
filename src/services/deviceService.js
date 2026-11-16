/**
 * Hardware Device & Encrypted ESP32 Biometric Service (MySQL 8.x)
 *
 * Implements the 5 Core VidyaOS ESP32 Hardware Requirements:
 * 1. End-to-End AES-256-GCM Encrypted Communication between Server & ESP32.
 * 2. 100% Slot-Agnostic Server Architecture: Server never needs to know which
 *    AS608 fingerprint slot a student occupies on the ESP32; the ESP32 manages
 *    its own slot-to-student table locally in W25Q32 SPI Flash and communicates
 *    using student_id.
 * 3. Portable Cloud Biometric Templates: When an ESP32 registers a student's
 *    fingerprint, it uploads the 512-byte AS608 template to MySQL
 *    (student_biometric_templates). Replacing a device requires zero student
 *    re-registration — the new ESP32 simply downloads the department's templates!
 * 4. Student Name, Roll Number & "ATTENDANCE MARKED" Display Confirmation:
 *    Returns full student identity (full_name, class_roll_no, official_enrollment_no)
 *    for immediate rendering on the 0.96" OLED screen and W25Q32 local cache.
 * 5. Remote HOD Command Queue: Supports remote fingerprint enrollment, template
 *    restoration sync, and live 2S 3.7V battery + W25Q32 offline queue telemetry.
 */

const { query } = require('../config/db');
const logger = require('../utils/logger');
const {
  encryptEsp32Payload,
  decryptEsp32Payload,
  computeTemplateSha256
} = require('../utils/esp32Crypto');

class DeviceService {
  /**
   * Resolves and authenticates an ESP32 device by UID, returning the device row and its AES-256 secret key.
   */
  async resolveAuthenticatedDevice(deviceUid, reqHeaders = {}, rawBody = {}) {
    if (!deviceUid) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'device_uid is required' };
    }

    const rows = await query(
      `SELECT id, device_uid, name, department_id, year, semester,
              assigned_years, assigned_semesters, academic_year_id,
              secret_key, secret_hash, is_active
       FROM devices
       WHERE device_uid = ?
       LIMIT 1`,
      [deviceUid]
    );

    if (!rows || rows.length === 0) {
      throw { status: 404, code: 'NOT_FOUND', message: `ESP32 terminal '${deviceUid}' is not registered` };
    }

    const device = rows[0];
    if (!device.is_active) {
      throw { status: 403, code: 'FORBIDDEN', message: `ESP32 terminal '${deviceUid}' is currently deactivated` };
    }

    const effectiveSecret = device.secret_key || device.secret_hash || 'default_secret';

    // Decrypt body if wrapped in AES-256-GCM envelope
    let decryptedPayload = rawBody;
    if (rawBody && rawBody.encrypted) {
      try {
        decryptedPayload = decryptEsp32Payload(rawBody, effectiveSecret);
      } catch (err) {
        throw {
          status: 401,
          code: 'ENCRYPTION_AUTH_FAILED',
          message: `AES-256-GCM authentication failed for device '${deviceUid}': ${err.message}`
        };
      }
    } else {
      // If unencrypted (e.g. simulator or legacy webhook), check optional header secret if provided
      const headerSecret = reqHeaders['x-device-secret'];
      if (headerSecret && device.secret_key && headerSecret !== device.secret_key && headerSecret !== device.secret_hash) {
        throw { status: 401, code: 'UNAUTHORIZED_DEVICE', message: 'Invalid X-Device-Secret header' };
      }
    }

    return { device, effectiveSecret, decryptedPayload };
  }

  /**
   * 1. Encrypted ESP32 Heartbeat + Battery/W25Q32 Telemetry + Pending Command Dispatch
   */
  async processEncryptedHeartbeat(deviceUid, reqHeaders, rawBody, clientIp = null) {
    const { device, effectiveSecret, decryptedPayload } = await this.resolveAuthenticatedDevice(
      deviceUid,
      reqHeaders,
      rawBody
    );

    const {
      battery_voltage = null,
      battery_pct = null,
      is_charging = 0,
      offline_queue_count = 0,
      w25q32_used_kb = 0,
      as608_enrolled_count = 0,
      wifi_rssi = null,
      firmware_version = 'v3.0-AES256-GCM'
    } = decryptedPayload;

    await query(
      `UPDATE devices
       SET last_heartbeat_at = CURRENT_TIMESTAMP,
           battery_voltage = COALESCE(?, battery_voltage),
           battery_pct = COALESCE(?, battery_pct),
           is_charging = COALESCE(?, is_charging),
           offline_queue_count = COALESCE(?, offline_queue_count),
           w25q32_used_kb = COALESCE(?, w25q32_used_kb),
           as608_enrolled_count = COALESCE(?, as608_enrolled_count),
           wifi_rssi = COALESCE(?, wifi_rssi),
           ip_address = COALESCE(?, ip_address),
           firmware_version = COALESCE(?, firmware_version)
       WHERE id = ?`,
      [
        battery_voltage,
        battery_pct,
        is_charging ? 1 : 0,
        offline_queue_count || 0,
        w25q32_used_kb || 0,
        as608_enrolled_count || 0,
        wifi_rssi,
        clientIp,
        firmware_version,
        device.id
      ]
    );

    // Fetch oldest PENDING command for this ESP32 device
    const pendingCmds = await query(
      `SELECT id, command_type, student_id, payload_json, created_at
       FROM esp32_command_queue
       WHERE device_id = ? AND status = 'PENDING'
       ORDER BY id ASC
       LIMIT 1`,
      [device.id]
    );

    let activeCommand = null;
    if (pendingCmds && pendingCmds.length > 0) {
      const cmd = pendingCmds[0];
      await query(
        `UPDATE esp32_command_queue SET status = 'DELIVERED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [cmd.id]
      );
      let parsedPayload = {};
      try {
        parsedPayload = cmd.payload_json ? JSON.parse(cmd.payload_json) : {};
      } catch (_) {}

      activeCommand = {
        command_id: cmd.id,
        command_type: cmd.command_type,
        student_id: cmd.student_id,
        ...parsedPayload
      };
    }

    // Count total templates in department so ESP32 knows if its local W25Q32 roster is out of sync
    const [tplCountRow] = await query(
      `SELECT COUNT(DISTINCT sbt.student_id) as total_templates
       FROM student_biometric_templates sbt
       JOIN enrollments e ON e.student_id = sbt.student_id AND e.status = 'ENROLLED'
       WHERE e.department_id = ? AND sbt.is_active = 1`,
      [device.department_id]
    );

    const responseObj = {
      status: 'OK',
      device_uid: device.device_uid,
      department_id: device.department_id,
      server_time: new Date().toISOString(),
      cloud_template_count: tplCountRow?.total_templates || 0,
      command: activeCommand
    };

    return {
      plain: responseObj,
      encrypted: encryptEsp32Payload(responseObj, effectiveSecret)
    };
  }

  /**
   * 2. Portable Fingerprint Template Upload from ESP32 -> MySQL (Slot-Agnostic!)
   * Stores the 512-byte AS608 template under student_id so replacing an ESP32
   * never requires students to re-register their fingerprints.
   */
  async processTemplateUpload(deviceUid, reqHeaders, rawBody) {
    const { device, effectiveSecret, decryptedPayload } = await this.resolveAuthenticatedDevice(
      deviceUid,
      reqHeaders,
      rawBody
    );

    const {
      command_id = null,
      student_id,
      finger_index = 1,
      template_base64,
      quality_score = 96
    } = decryptedPayload;

    if (!student_id || !template_base64) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'student_id and template_base64 are required' };
    }

    // Verify student exists and fetch their Name + Roll No for OLED display
    const studentRows = await query(
      `SELECT s.id, s.full_name, s.official_enrollment_no, s.registration_no,
              COALESCE(e.class_roll_no, s.class_roll_no) as class_roll_no,
              COALESCE(e.department_id, ?) as department_id,
              e.year, e.semester
       FROM students s
       LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
       WHERE s.id = ?
       LIMIT 1`,
      [device.department_id, student_id]
    );

    if (!studentRows || studentRows.length === 0) {
      throw { status: 404, code: 'NOT_FOUND', message: `Student ID ${student_id} not found` };
    }

    const student = studentRows[0];
    const templateSha256 = computeTemplateSha256(template_base64);

    // Upsert portable template under student_id (Zero slot_id coupling on server!)
    await query(
      `INSERT INTO student_biometric_templates
        (student_id, department_id, finger_index, template_base64, template_sha256, quality_score, captured_by_device_uid, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         department_id = VALUES(department_id),
         template_base64 = VALUES(template_base64),
         template_sha256 = VALUES(template_sha256),
         quality_score = VALUES(quality_score),
         captured_by_device_uid = VALUES(captured_by_device_uid),
         is_active = 1,
         updated_at = CURRENT_TIMESTAMP`,
      [
        student.id,
        student.department_id || device.department_id,
        Number(finger_index) || 1,
        template_base64,
        templateSha256,
        Number(quality_score) || 95,
        device.device_uid
      ]
    );

    // Mark remote enrollment command COMPLETED if triggered via command queue
    if (command_id) {
      await query(
        `UPDATE esp32_command_queue
         SET status = 'COMPLETED',
             result_message = ?,
             completed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [`Enrolled ${student.full_name} (Roll #${student.class_roll_no || '—'})`, command_id]
      );
    } else {
      await query(
        `UPDATE esp32_command_queue
         SET status = 'COMPLETED',
             result_message = ?,
             completed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE device_id = ? AND student_id = ? AND command_type = 'ENROLL_STUDENT' AND status IN ('PENDING', 'DELIVERED')`,
        [`Enrolled ${student.full_name} (Roll #${student.class_roll_no || '—'})`, device.id, student.id]
      );
    }

    const responseObj = {
      status: 'TEMPLATE_STORED',
      student_id: student.id,
      full_name: student.full_name,
      class_roll_no: student.class_roll_no || 0,
      official_enrollment_no: student.official_enrollment_no || '',
      template_sha256: templateSha256,
      oled_title: 'ENROLLED SUCCESS',
      oled_line1: student.full_name,
      oled_line2: `Roll No: #${student.class_roll_no || '—'}`,
      oled_line3: student.official_enrollment_no || 'Saved to Cloud'
    };

    return {
      plain: responseObj,
      encrypted: encryptEsp32Payload(responseObj, effectiveSecret)
    };
  }

  /**
   * 3. Department Biometric Template Bundle Sync (Server -> ESP32)
   * Allows any new or replacement ESP32 connected to the department to download all
   * student templates + student names & roll numbers into its local AS608 & W25Q32 flash.
   */
  async getEncryptedDepartmentTemplates(deviceUid, reqHeaders, rawBody = {}) {
    const { device, effectiveSecret } = await this.resolveAuthenticatedDevice(
      deviceUid,
      reqHeaders,
      rawBody
    );

    const templates = await query(
      `SELECT sbt.student_id, sbt.finger_index, sbt.template_base64, sbt.template_sha256, sbt.quality_score,
              s.full_name, s.official_enrollment_no, s.registration_no,
              COALESCE(e.class_roll_no, s.class_roll_no, 0) as class_roll_no,
              e.year, e.semester
       FROM student_biometric_templates sbt
       JOIN students s ON sbt.student_id = s.id
       JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
       WHERE e.department_id = ? AND sbt.is_active = 1
       ORDER BY COALESCE(e.class_roll_no, s.class_roll_no, 9999) ASC, s.full_name ASC`,
      [device.department_id]
    );

    // Mark any pending SYNC_TEMPLATES command as COMPLETED
    await query(
      `UPDATE esp32_command_queue
       SET status = 'COMPLETED',
           result_message = ?,
           completed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE device_id = ? AND command_type = 'SYNC_TEMPLATES' AND status IN ('PENDING', 'DELIVERED')`,
      [`Synced ${templates.length} student template(s) to ESP32`, device.id]
    );

    const responseObj = {
      status: 'SYNC_READY',
      device_uid: device.device_uid,
      department_id: device.department_id,
      count: templates.length,
      templates: templates.map((t) => ({
        student_id: t.student_id,
        full_name: t.full_name,
        class_roll_no: t.class_roll_no,
        official_enrollment_no: t.official_enrollment_no,
        year: t.year,
        semester: t.semester,
        finger_index: t.finger_index,
        template_base64: t.template_base64,
        template_sha256: t.template_sha256
      }))
    };

    return {
      plain: responseObj,
      encrypted: encryptEsp32Payload(responseObj, effectiveSecret)
    };
  }

  /**
   * 4. Process Slot-Agnostic Online & W25Q32 Offline Attendance Scans
   * Accepts scans identified directly by `student_id` (or legacy `slot_id`),
   * records presence in esp32_presence & iot_attendance_events, auto-marks
   * active class attendance registers, and returns Student Name + Roll Number
   * + "Attendance Marked" for the 0.96" OLED screen!
   */
  async processScanWebhook(deviceUid, scansInput, secretKeyOrHeaders = {}, rawBody = null) {
    let device = null;
    let effectiveSecret = 'default_secret';
    let scans = scansInput;

    if (rawBody && rawBody.encrypted) {
      const resolved = await this.resolveAuthenticatedDevice(deviceUid, secretKeyOrHeaders, rawBody);
      device = resolved.device;
      effectiveSecret = resolved.effectiveSecret;
      scans = resolved.decryptedPayload.scans || [];
    } else {
      const devices = await query(
        `SELECT id, device_uid, name, department_id, secret_key, secret_hash, is_active
         FROM devices WHERE device_uid = ? LIMIT 1`,
        [deviceUid]
      );
      if (!devices || devices.length === 0) {
        throw { status: 404, code: 'NOT_FOUND', message: `Device '${deviceUid}' not registered in institutional directory` };
      }
      device = devices[0];
      if (!device.is_active) {
        throw { status: 403, code: 'FORBIDDEN', message: `Device '${deviceUid}' is deactivated` };
      }
      effectiveSecret = device.secret_key || device.secret_hash || 'default_secret';
    }

    await query(`UPDATE devices SET last_heartbeat_at = CURRENT_TIMESTAMP WHERE id = ?`, [device.id]);

    let inserted = 0;
    let duplicates = 0;
    let unmapped = 0;
    const confirmations = [];

    for (const scan of (scans || [])) {
      const { event_id, scanned_at, is_offline_sync = false, confidence = 100 } = scan;
      let studentId = scan.student_id ? Number(scan.student_id) : null;

      // Legacy fallback: only if an older payload sent slot_id without student_id
      if (!studentId && scan.slot_id) {
        const slots = await query(
          `SELECT student_id FROM fingerprint_slots WHERE device_id = ? AND slot_id = ? AND is_active = 1 LIMIT 1`,
          [device.id, scan.slot_id]
        );
        if (slots && slots.length > 0) {
          studentId = slots[0].student_id;
        }
      }

      if (!event_id || !studentId) {
        unmapped++;
        continue;
      }

      // Fetch Student Full Name, Roll Number & Cohort for OLED Display + Auto Session Marking
      const stRows = await query(
        `SELECT s.id, s.full_name, s.official_enrollment_no, s.registration_no,
                COALESCE(e.class_roll_no, s.class_roll_no, 0) as class_roll_no,
                COALESCE(e.department_id, ?) as department_id,
                e.year, e.semester
         FROM students s
         LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
         WHERE s.id = ?
         LIMIT 1`,
        [device.department_id, studentId]
      );

      if (!stRows || stRows.length === 0) {
        unmapped++;
        continue;
      }

      const student = stRows[0];
      const scanDateObj = scanned_at
        ? (typeof scanned_at === 'number' ? new Date(scanned_at * 1000) : new Date(scanned_at))
        : new Date();
      const validDate = isNaN(scanDateObj.getTime()) ? new Date() : scanDateObj;
      const scanTimeStr = validDate.toISOString().replace('T', ' ').slice(0, 19);
      const scanDateStr = scanTimeStr.slice(0, 10);

      try {
        await query(
          `INSERT INTO esp32_presence (event_id, device_id, student_id, scan_time, payload_json)
           VALUES (?, ?, ?, ?, ?)`,
          [event_id, device.id, student.id, scanTimeStr, JSON.stringify({ ...scan, student_id: student.id })]
        );

        try {
          await query(
            `INSERT INTO iot_attendance_events
              (student_id, device_id, department_id, scan_time, scan_date, verification_status, event_type, payload_json)
             VALUES (?, ?, ?, ?, ?, 'VERIFIED', ?, ?)`,
            [
              student.id,
              device.id,
              student.department_id || device.department_id,
              scanTimeStr,
              scanDateStr,
              is_offline_sync ? 'W25Q32_OFFLINE_SYNC' : 'FINGERPRINT_LIVE',
              JSON.stringify({ ...scan, full_name: student.full_name, class_roll_no: student.class_roll_no, confidence })
            ]
          );
        } catch (iotErr) {
          logger.warn('Non-fatal error inserting iot_attendance_events', { error: iotErr.message });
        }

        // Auto-mark PRESENT in any active attendance session for this student on that date
        try {
          const activeSessions = await query(
            `SELECT ass.session_id
             FROM attendance_session_students ass
             JOIN attendance_sessions s ON s.id = ass.session_id
             WHERE ass.student_id = ?
               AND (s.session_date = ? OR s.status = 'ACTIVE')`,
            [student.id, scanDateStr]
          );
          for (const sess of (activeSessions || [])) {
            await query(
              `INSERT INTO register_attendance (session_id, student_id, attendance_status, source, teacher_notes)
               VALUES (?, ?, 'PRESENT', 'ESP32_SYNC', ?)
               ON DUPLICATE KEY UPDATE
                 attendance_status = 'PRESENT',
                 source = 'ESP32_SYNC',
                 teacher_notes = VALUES(teacher_notes),
                 updated_at = CURRENT_TIMESTAMP`,
              [
                sess.session_id,
                student.id,
                is_offline_sync ? 'ESP32 W25Q32 Offline Flash Synced' : 'ESP32 AS608 Biometric Verified'
              ]
            );
          }
        } catch (_) {}

        inserted++;
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY' || /Duplicate entry/i.test(err.message)) {
          duplicates++;
        } else {
          logger.error('Error inserting esp32_presence record', { error: err.message, event_id });
        }
      }

      confirmations.push({
        event_id,
        student_id: student.id,
        full_name: student.full_name,
        class_roll_no: student.class_roll_no,
        official_enrollment_no: student.official_enrollment_no,
        status: 'ATTENDANCE_MARKED',
        oled_title: 'ATTENDANCE MARKED',
        oled_line1: student.full_name,
        oled_line2: `Roll No: #${student.class_roll_no || '—'}`,
        oled_line3: `${student.official_enrollment_no || ''} • Verified`
      });
    }

    const resultPayload = {
      device_uid: deviceUid,
      processed: (scans || []).length,
      inserted,
      duplicates,
      unmapped,
      confirmations
    };

    return {
      ...resultPayload,
      encrypted_envelope: encryptEsp32Payload(resultPayload, effectiveSecret)
    };
  }

  /**
   * Get Cohort Biometric Status & Assigned Terminals (Updated to check student_biometric_templates!)
   */
  async getCohortBiometrics(deptId, branchId, year, semester, academicYearId) {
    const devices = await query(
      `SELECT d.id, d.device_uid, d.name, d.is_active, d.last_heartbeat_at,
              d.battery_voltage, d.battery_pct, d.offline_queue_count, d.as608_enrolled_count
       FROM devices d
       WHERE d.department_id = ?`,
      [deptId]
    );

    const formattedDevices = devices.map((d) => {
      let isOnline = false;
      if (d.last_heartbeat_at) {
        const hbTime = new Date(d.last_heartbeat_at).getTime();
        isOnline = Boolean(d.is_active && Math.abs(Date.now() - hbTime) < 5 * 60 * 1000);
      }
      return {
        id: d.id,
        device_uid: d.device_uid,
        name: d.name,
        is_online: isOnline,
        battery_voltage: d.battery_voltage,
        battery_pct: d.battery_pct,
        offline_queue_count: d.offline_queue_count || 0,
        occupied_slots: d.as608_enrolled_count || 0
      };
    });

    const students = await query(
      `SELECT s.id as student_id, s.full_name, s.official_enrollment_no, s.registration_no,
              COALESCE(e.class_roll_no, s.class_roll_no) as class_roll_no,
              e.year, e.semester,
              sbt.finger_index, sbt.template_sha256, sbt.quality_score,
              sbt.captured_by_device_uid, sbt.updated_at as enrolled_at,
              CASE WHEN sbt.id IS NOT NULL AND sbt.is_active = 1 THEN 'ENROLLED' ELSE 'NOT_ENROLLED' END as biometric_status
       FROM enrollments e
       JOIN students s ON e.student_id = s.id
       LEFT JOIN student_biometric_templates sbt ON sbt.student_id = s.id AND sbt.is_active = 1 AND sbt.finger_index = 1
       WHERE e.department_id = ?
         AND (? IS NULL OR e.year = ?)
         AND (? IS NULL OR e.semester = ?)
         AND e.status = 'ENROLLED'
       ORDER BY e.year ASC, COALESCE(e.class_roll_no, s.class_roll_no, 9999) ASC, s.full_name ASC`,
      [deptId, year || null, year || null, semester || null, semester || null]
    );

    return {
      devices: formattedDevices,
      students
    };
  }

  /**
   * Legacy slot correlation helper preserved for backward compatibility
   */
  async assignSlot(deviceId, slotId, studentId) {
    await query(
      `DELETE FROM fingerprint_slots WHERE device_id = ? AND student_id = ? AND slot_id != ?`,
      [deviceId, studentId, slotId]
    );

    await query(
      `INSERT INTO fingerprint_slots (device_id, slot_id, student_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         student_id = VALUES(student_id),
         is_active = 1,
         enrolled_at = CURRENT_TIMESTAMP`,
      [deviceId, slotId, studentId]
    );

    return {
      device_id: deviceId,
      slot_id: slotId,
      student_id: studentId,
      message: 'Fingerprint correlation saved.'
    };
  }
}

module.exports = new DeviceService();
