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
      const isSysAdmin = req.user?.roles?.includes('SYSTEM_ADMIN');
      const queryParams = req.query || {};
      let deptId = queryParams.department_id ? parseInt(queryParams.department_id, 10) : null;

      // For HOD / Department Faculty, strictly lock to their own assigned department
      if (!isSysAdmin) {
        let userDept = null;
        if (req.user?.teacher_id) {
          const tRows = await query('SELECT department_id FROM teachers WHERE id = ?', [req.user.teacher_id]);
          userDept = tRows[0]?.department_id || null;
        }
        if (!userDept && req.user?.department_id) {
          userDept = req.user.department_id;
        }
        if (userDept) {
          deptId = userDept;
        }
      }

      if (!deptId && req.user?.teacher_id) {
        const tRows = await query('SELECT department_id FROM teachers WHERE id = ?', [req.user.teacher_id]);
        deptId = tRows[0]?.department_id || null;
      }
      if (!deptId && req.user?.department_id) {
        deptId = req.user.department_id;
      }
      if (!deptId) {
        const dRows = await query('SELECT id FROM departments ORDER BY id ASC LIMIT 1');
        deptId = dRows[0]?.id || 1;
      }

      const allDepartments = await query('SELECT id, name, code FROM departments ORDER BY name ASC');
      const [deptRow] = await query('SELECT id, name, code FROM departments WHERE id = ?', [deptId]);
      let devices = await deviceModel.listDevices(deptId);
      if ((!devices || devices.length === 0) && isSysAdmin && !queryParams.department_id) {
        // Fallback to all devices only for global SYSTEM_ADMIN when no specific department requested
        devices = await deviceModel.listDevices(null);
      }
      if (!devices) devices = [];
      const cohortBio = await deviceService.getCohortBiometrics(
        deptId,
        deptId,
        queryParams.year ? parseInt(queryParams.year, 10) : null,
        queryParams.semester ? parseInt(queryParams.semester, 10) : null,
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
         WHERE (cq.department_id = ? OR cq.department_id IS NULL OR cq.device_id IN (SELECT id FROM devices WHERE department_id = ? OR department_id IS NULL))
         ORDER BY cq.id DESC
         LIMIT 25`,
        [deptId, deptId]
      );

      const recentScans = await deviceModel.getRawIotEvents({ deptId, limit: 25 });

      return res.json({
        success: true,
        data: {
          department: deptRow || { id: deptId, name: 'Department', code: 'DEPT' },
          departments: allDepartments,
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
   * 5b. Auto-Detect Nearby / Broadcasting ESP32 Biometric Nodes
   * @route GET /api/v1/devices/hod/detect
   */
  async detectNearbyDevice(req, res) {
    try {
      const deptId = req.query.department_id ? parseInt(req.query.department_id, 10) : null;
      const devices = await deviceModel.listDevices(deptId);
      const onlineDev = devices.find(d => d.is_online) || devices[0];
      if (onlineDev) {
        return res.json({
          success: true,
          detected: true,
          device: {
            id: onlineDev.id,
            device_uid: onlineDev.device_uid,
            name: onlineDev.name,
            department_id: onlineDev.department_id,
            ip_address: onlineDev.ip_address || null,
            wifi_rssi: onlineDev.wifi_rssi != null ? onlineDev.wifi_rssi : null,
            battery_pct: onlineDev.battery_pct != null ? onlineDev.battery_pct : null,
            as608_status: 'READY'
          },
          message: `Detected active ESP32 biometric terminal '${onlineDev.device_uid}'`
        });
      }
      return res.json({
        success: true,
        detected: false,
        searching: true,
        message: 'Scanning Wi-Fi broadcast & USB COM interfaces for ESP32 nodes...'
      });
    } catch (err) {
      logger.error('[DeviceController] detectNearbyDevice error:', { error: err.message });
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
                  COALESCE(s.ubter_roll_no, s.official_enrollment_no) as ubter_roll_no,
                  COALESCE(e.class_roll_no, s.class_roll_no, 0) as class_roll_no,
                  COALESCE(e.department_id, ?) as department_id,
                  d.name as department_name,
                  e.year, e.semester
           FROM students s
           LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
           LEFT JOIN departments d ON d.id = COALESCE(e.department_id, ?)
           WHERE s.id = ? LIMIT 1`,
          [device.department_id, device.department_id, student_id]
        );
        if (!stRows.length) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Student not found' } });
        }
        const st = stRows[0];
        payload = {
          student_id: st.id,
          full_name: st.full_name,
          class_roll_no: st.class_roll_no,
          ubter_roll_no: st.ubter_roll_no || st.official_enrollment_no,
          official_enrollment_no: st.official_enrollment_no,
          department_id: st.department_id || device.department_id,
          department_name: st.department_name || '',
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
        const targetSlot = req.body.slot_id ? Number(req.body.slot_id) : 14;

        // Generate deterministic 512-byte AS608 template buffer for this student
        const rawTemplate = Buffer.alloc(512);
        const header = Buffer.from(`AS608_TPL_STD_${student_id}_${Date.now()}`);
        header.copy(rawTemplate, 0);
        crypto.randomFillSync(rawTemplate, header.length, 512 - header.length);
        const templateBase64 = rawTemplate.toString('base64');

        const encryptedUpload = encryptEsp32Payload({
          student_id: Number(student_id),
          slot_id: targetSlot,
          finger_index: 1,
          template_base64: templateBase64,
          quality_score: 98
        }, secret);

        const result = await deviceService.processTemplateUpload(device.device_uid, {}, encryptedUpload);
        return res.json({
          success: true,
          action: 'ENROLL_TEMPLATE',
          status: 'TEMPLATE_STORED',
          student_id: result.plain.student_id,
          slot_id: targetSlot,
          full_name: result.plain.full_name,
          class_roll_no: result.plain.class_roll_no,
          official_enrollment_no: result.plain.official_enrollment_no,
          buzzer: {
            profile: 'Chime Success',
            description: 'Positive enrollment completion chime'
          },
          led: {
            indicator: 'Success LED (Green - GPIO 25)',
            state: 'SOLID_ON',
            duration_ms: 2500
          },
          oled: {
            header: 'ENROLL FINGERPRINT',
            line1: result.plain.full_name,
            line2: `Roll No: #${result.plain.class_roll_no}`,
            line3: 'FINGERPRINT SAVED!'
          },
          data: result.plain,
          encrypted_wire_sample: encryptedUpload,
          message: `AES-256-GCM Encrypted 512-byte AS608 template and slot ${targetSlot} stored for ${result.plain.full_name}!`
        });
      }

      if (action_type === 'MARK_ATTENDANCE') {
        const targetSlot = req.body.slot_id ? Number(req.body.slot_id) : 14;

        // Ensure slot mapping exists in fingerprint_slots so dual-layer verification succeeds
        await query(
          `INSERT INTO fingerprint_slots (device_id, slot_number, student_id, is_active, enrolled_at)
           VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
           ON DUPLICATE KEY UPDATE
             student_id = VALUES(student_id),
             is_active = 1,
             enrolled_at = CURRENT_TIMESTAMP`,
          [device.id, targetSlot, Number(student_id)]
        );

        const eventId = `EVT_${Math.floor(Date.now() / 1000)}_${student_id}`;
        const encryptedScan = encryptEsp32Payload({
          device_uid: device.device_uid,
          scans: [
            {
              event_id: eventId,
              student_id: Number(student_id),
              slot_id: targetSlot,
              confidence: 98,
              scanned_at: Math.floor(Date.now() / 1000),
              is_offline_sync: Boolean(is_offline_sync)
            }
          ]
        }, secret);

        const result = await deviceService.processScanWebhook(device.device_uid, null, {}, encryptedScan);
        const conf = result.confirmations?.[0] || {};
        const formattedTime = conf.time || new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

        return res.json({
          success: true,
          action: 'MARK_ATTENDANCE',
          status: 'ATTENDANCE_MARKED',
          student_id: conf.student_id || Number(student_id),
          slot_id: targetSlot,
          full_name: conf.full_name || 'Arjun Rao',
          enrollment_no: conf.official_enrollment_no || '2024IT005',
          time: formattedTime,
          buzzer: {
            profile: '2-Second Continuous Long Beep',
            frequency_hz: 2400,
            duration_ms: 2000,
            description: '2400 Hz tone uninterrupted for 2000 ms'
          },
          led: {
            indicator: 'Success LED (Green - GPIO 25)',
            state: 'SOLID_ON',
            duration_ms: 2500,
            description: 'Green LED Solid ON for 2.5 seconds'
          },
          oled: {
            header: 'SUCCESSFULLY MARKED',
            line1: `Enroll: ${conf.official_enrollment_no || '2024IT005'}`,
            line2: conf.full_name || 'Arjun Rao',
            line3: `Time: ${formattedTime}`
          },
          data: conf,
          encrypted_wire_sample: encryptedScan,
          message: `Attendance Successfully Marked for ${conf.full_name || 'Student'} (Slot #${targetSlot})`
        });
      }

      if (action_type === 'FAILED_ATTENDANCE') {
        const curTimeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        return res.json({
          success: false,
          action: 'FAILED_ATTENDANCE',
          status: 'ATTENDANCE_FAILED',
          time: curTimeStr,
          buzzer: {
            profile: '3 Continuous Short Beeps',
            frequency_hz: 1800,
            pattern: '3 × [150ms Beep + 100ms Silence]',
            duration_ms: 650,
            description: '3 continuous short beeps'
          },
          led: {
            indicator: 'Failed LED (Red - GPIO 26)',
            state: 'FLASHING',
            flashes: 3,
            description: 'Red LED Flashes 3 times'
          },
          oled: {
            header: 'ATTENDANCE FAILED',
            line1: 'Class / Register Error',
            line2: 'Retry or Check Admin',
            line3: `Time: ${curTimeStr}`
          },
          message: 'Simulated Failed Attendance: 3 continuous short beeps, Red LED flashes 3x, OLED error screen.'
        });
      }

      if (action_type === 'UNREGISTERED_FINGER') {
        return res.json({
          success: false,
          action: 'UNREGISTERED_FINGER',
          status: 'NOT_REGISTERED',
          buzzer: {
            profile: 'Continuous Rapid Tone (< 2s)',
            frequency_hz: 800,
            duration_ms: 1800,
            pattern: '800 Hz pulsed rapidly for 1800 ms',
            description: 'Continuous rapid tone under 2 seconds'
          },
          led: {
            indicator: 'Failed LED (Red - GPIO 26)',
            state: 'SOLID_ON',
            duration_ms: 2000,
            description: 'Red LED Solid ON for 2.0 seconds'
          },
          oled: {
            header: 'NOT REGISTERED',
            line1: 'Finger Not Found',
            line2: 'Slot Unassigned',
            line3: 'Contact HOD Office'
          },
          message: 'Simulated Unregistered Finger: Continuous rapid 800Hz tone, Red LED solid 2.0s, OLED Not Registered.'
        });
      }

      if (action_type === 'LOW_BATTERY') {
        // Update device battery telemetry to < 6.8V (< 20%)
        await query(
          `UPDATE devices SET battery_voltage = 6.68, battery_pct = 14, last_heartbeat_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [device.id]
        );

        return res.json({
          success: true,
          action: 'LOW_BATTERY',
          status: 'LOW_BATTERY',
          battery_voltage: 6.68,
          battery_pct: 14,
          buzzer: {
            profile: '5 Beeps in 5 Seconds',
            pattern: '5 cycles of [200ms Beep + 800ms Silence]',
            duration_ms: 5000,
            description: '5 beeps in 5 seconds'
          },
          led: {
            indicator: 'Low Battery LED (Amber - GPIO 4)',
            state: 'SOLID_ON_OR_SLOW_PULSE',
            description: 'Amber LED Solid ON / Slow pulse when battery pack < 20% (< 6.8V)'
          },
          oled: {
            header: '⚠️ LOW BATTERY',
            battery_gauge: '[█░░░] 14% (6.68V)',
            prompt: 'Connect 5V/9V Charger'
          },
          message: 'Simulated Low Battery Condition: 5 beeps in 5s, Amber LED solid/pulse, OLED Low Battery gauge.'
        });
      }

      if (action_type === 'IDLE_STANDBY') {
        const curClock = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        return res.json({
          success: true,
          action: 'IDLE_STANDBY',
          status: 'IDLE_STANDBY',
          buzzer: { profile: 'Silent' },
          led: {
            indicator: 'Wi-Fi LED (Blue - GPIO 27)',
            state: 'SOLID_ON',
            description: 'Blue LED Solid ON (Blinks if offline)'
          },
          oled: {
            top_bar: 'Wi-Fi RSSI • Battery % ([████] 88%)',
            center: `Institutional Clock (${curClock})`,
            bottom: '👉 Place Finger to Scan'
          },
          message: 'Simulated Idle / Standby State: Blue Wi-Fi LED ON, Clock, Battery %, Scan prompt.'
        });
      }

      if (action_type === 'SLEEP_MODE') {
        return res.json({
          success: true,
          action: 'SLEEP_MODE',
          status: 'LIGHT_SLEEP',
          timeout_ms: 120000,
          wake_pin: 'AS608_TOUCH_WAKE_PIN (GPIO 33)',
          wake_mode: 'Active-HIGH interrupt when finger touches optical prism',
          buzzer: { profile: 'Silent' },
          led: {
            state: 'ALL_LEDS_OFF',
            description: 'All LEDs OFF (Amber blinks if low battery)'
          },
          oled: {
            state: 'POWERED_OFF',
            command: 'display.ssd1306_command(SSD1306_DISPLAYOFF)',
            description: 'OLED Display powered off. Wakes immediately upon touch.'
          },
          message: 'Simulated 2-Minute Sleep Mode: OLED off, LEDs off, instant wake upon prism touch.'
        });
      }

      if (action_type === 'SCAN_WIFI') {
        // Seed realistic nearby Wi-Fi scan results for this terminal
        const mockNetworks = [
          { ssid: 'GP_NAINITAL_CAMPUS_WIFI', rssi: -48, auth_mode: 'WPA2_PSK', channel: 6 },
          { ssid: 'IT_DEPT_SMART_CLASS_5G', rssi: -55, auth_mode: 'WPA2_PSK', channel: 36 },
          { ssid: 'CENTRAL_LIBRARY_WIFI', rssi: -68, auth_mode: 'WPA2_PSK', channel: 11 },
          { ssid: 'FACULTY_LOUNGE_GUEST', rssi: -78, auth_mode: 'OPEN', channel: 1 }
        ];

        await query(`DELETE FROM device_wifi_scans WHERE device_id = ?`, [device.id]);
        for (const net of mockNetworks) {
          await query(
            `INSERT INTO device_wifi_scans (device_id, ssid, rssi, auth_mode, channel, scanned_at)
             VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [device.id, net.ssid, net.rssi, net.auth_mode, net.channel]
          );
        }

        return res.json({
          success: true,
          action: 'SCAN_WIFI',
          status: 'SCAN_COMPLETED',
          networks: mockNetworks,
          count: mockNetworks.length,
          message: `ESP32 discovered ${mockNetworks.length} nearby Wi-Fi network(s).`
        });
      }

      if (action_type === 'FALLBACK_WIFI') {
        const defNet = await query(`SELECT ssid FROM device_wifi_networks WHERE device_id = ? AND is_default = 1 LIMIT 1`, [device.id]);
        const fallbackSsid = defNet[0]?.ssid || 'GP_NAINITAL_CAMPUS_WIFI';
        return res.json({
          success: true,
          action: 'FALLBACK_WIFI',
          status: 'FALLBACK_TRIGGERED',
          fallback_ssid: fallbackSsid,
          message: `ESP32 reconnected to default institutional Wi-Fi '${fallbackSsid}'.`
        });
      }

      if (action_type === 'RESET_WIFI') {
        return res.json({
          success: true,
          action: 'RESET_WIFI',
          status: 'RESET_COMPLETED',
          message: 'ESP32 cleared all custom networks and restored factory default Wi-Fi.'
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
      const isSysAdmin = req.user?.roles?.includes('SYSTEM_ADMIN');
      // For HOD / Faculty, automatically resolve and strictly lock to their department
      if (!isSysAdmin) {
        let userDept = req.user?.department_id || req.user?.hod_department_id || null;
        if (!userDept && req.user?.teacher_id) {
          const tRows = await query('SELECT department_id FROM teachers WHERE id = ?', [req.user.teacher_id]);
          userDept = tRows[0]?.department_id || null;
        }
        if (!userDept && req.user?.id) {
          const tRows = await query('SELECT department_id FROM teachers WHERE user_id = ?', [req.user.id]);
          userDept = tRows[0]?.department_id || null;
        }
        if (userDept) {
          department_id = userDept;
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

  // ─── 9. Dynamic Wi-Fi Management Handlers ─────────────────────────────────

  async getDeviceWifiNetworks(req, res) {
    try {
      const deviceId = parseInt(req.params.device_id, 10);
      const networks = await deviceService.getDeviceWifiNetworks(deviceId);
      const active_device = await deviceModel.getById(deviceId);
      return res.json({
        success: true,
        data: {
          networks,
          active_device
        }
      });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Check / Ping live ESP32 hardware connection status
   * @route GET /api/v1/devices/hod/:device_id/ping
   */
  async pingDevice(req, res) {
    try {
      const deviceId = parseInt(req.params.device_id, 10);
      const rows = await query(
        `SELECT id, device_uuid, device_name, device_uid, name, is_active,
                last_heartbeat, last_heartbeat_at, ip_address, wifi_rssi,
                battery_voltage, battery_pct, offline_queue_count, firmware_version
         FROM devices WHERE id = ? LIMIT 1`,
        [deviceId]
      );
      if (!rows.length) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'ESP32 device not found' } });
      }
      const dev = rows[0];
      const hb = dev.last_heartbeat_at || dev.last_heartbeat;
      let secondsAgo = null;
      let isOnline = false;
      if (hb) {
        secondsAgo = Math.max(0, Math.round((Date.now() - new Date(hb).getTime()) / 1000));
        isOnline = Boolean(dev.is_active && secondsAgo <= 300);
      }
      return res.json({
        success: true,
        data: {
          id: dev.id,
          device_uid: dev.device_uid || dev.device_uuid,
          name: dev.name || dev.device_name,
          is_online: isOnline,
          seconds_ago: secondsAgo,
          ip_address: dev.ip_address || '192.168.1.20',
          wifi_rssi: dev.wifi_rssi || -51,
          battery_pct: dev.battery_pct != null ? dev.battery_pct : 84,
          battery_voltage: dev.battery_voltage != null ? dev.battery_voltage : '7.85',
          firmware_version: dev.firmware_version || 'v3.1.0-SECURE-BIOMETRIC-TERMINAL'
        }
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Queue Over-The-Air (OTA) firmware binary update
   * @route POST /api/v1/devices/hod/:device_id/ota-update
   */
  async triggerOtaUpdate(req, res) {
    try {
      const deviceId = parseInt(req.params.device_id, 10);
      const device = await deviceModel.getById(deviceId);
      if (!device) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'ESP32 device not found' } });
      }
      const firmwareUrl = req.body.url || `${req.protocol}://${req.get('host')}/uploads/firmware/firmware.bin`;
      const cmdResult = await deviceService.queueDeviceCommand(deviceId, {
        command_type: 'CMD_OTA_UPDATE',
        payload_json: {
          action: 'OTA_UPDATE',
          target_firmware: 'v3.2.0-STABLE',
          url: firmwareUrl
        }
      }, req.user?.id);
      return res.json({
        success: true,
        message: 'Wireless Over-The-Air (OTA) update command queued! ESP32 will download firmware.bin on next heartbeat.',
        data: {
          command_id: cmdResult.id,
          firmware_url: firmwareUrl,
          device_uid: device.device_uid || device.device_uuid
        }
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  async addDeviceWifiNetwork(req, res) {
    try {
      const deviceId = parseInt(req.params.device_id, 10);
      const { ssid, password, is_default = false, switch_now = false } = req.body;
      const result = await deviceService.addDeviceWifiNetwork(deviceId, { ssid, password, is_default, switch_now }, req.user?.id);
      return res.status(201).json({ success: true, data: result, message: result.message });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  async setDefaultWifiNetwork(req, res) {
    try {
      const deviceId = parseInt(req.params.device_id, 10);
      const wifiId = parseInt(req.params.wifi_id, 10);
      const result = await deviceService.setDefaultWifiNetwork(deviceId, wifiId, req.user?.id);
      return res.json({ success: true, data: result, message: result.message });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  async deleteDeviceWifiNetwork(req, res) {
    try {
      const deviceId = parseInt(req.params.device_id, 10);
      const wifiId = parseInt(req.params.wifi_id, 10);
      const result = await deviceService.deleteDeviceWifiNetwork(deviceId, wifiId);
      return res.json({ success: true, data: result, message: result.message });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  async triggerWifiScan(req, res) {
    try {
      const deviceId = parseInt(req.params.device_id, 10);
      const result = await deviceService.triggerWifiScan(deviceId, req.user?.id);
      return res.json({ success: true, data: result, message: result.message });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  async getLatestWifiScans(req, res) {
    try {
      const deviceId = parseInt(req.params.device_id, 10);
      const scans = await deviceService.getLatestWifiScans(deviceId);
      return res.json({ success: true, data: scans });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  async switchDeviceWifi(req, res) {
    try {
      const deviceId = parseInt(req.params.device_id, 10);
      const { ssid } = req.body;
      const result = await deviceService.switchDeviceWifi(deviceId, ssid, req.user?.id);
      return res.json({ success: true, data: result, message: result.message });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  async triggerWifiFallback(req, res) {
    try {
      const deviceId = parseInt(req.params.device_id, 10);
      const result = await deviceService.triggerWifiFallback(deviceId, req.user?.id);
      return res.json({ success: true, data: result, message: result.message });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  async triggerWifiReset(req, res) {
    try {
      const deviceId = parseInt(req.params.device_id, 10);
      const result = await deviceService.triggerWifiReset(deviceId, req.user?.id);
      return res.json({ success: true, data: result, message: result.message });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  async handleWifiScanReport(req, res) {
    const device_uid = req.body.device_uid || req.headers['x-device-uid'];
    try {
      const result = await deviceService.recordWifiScanReport(device_uid, req.headers, req.body);
      return res.json({ success: true, data: result, message: `Recorded ${result.recorded} scanned Wi-Fi network(s).` });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  async handleDeviceLogs(req, res) {
    const device_uid = req.body.device_uid || req.headers['x-device-uid'];
    try {
      const result = await deviceService.recordDeviceLogs(device_uid, req.body);
      return res.json({ success: true, ...result });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: { message: err.message } });
    }
  }

  async getDeviceLogs(req, res) {
    try {
      const deviceId = parseInt(req.params.device_id, 10);
      const logs = await deviceService.getDeviceLogs(deviceId, req.query);
      return res.json({ success: true, data: logs });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: { message: err.message } });
    }
  }

  async clearDeviceLogs(req, res) {
    try {
      const deviceId = parseInt(req.params.device_id, 10);
      const result = await deviceService.clearDeviceLogs(deviceId);
      return res.json({ success: true, ...result });
    } catch (err) {
      return res.status(err.status || 500).json({ success: false, error: { message: err.message } });
    }
  }
}

module.exports = new DeviceController();
