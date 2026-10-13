/**
 * Hardware Device & ESP32 Presence Service
 * Manages sensor slot correlation, event deduplication, and presence telemetry.
 */

const { query, withTransaction } = require('../config/db');
const logger = require('../utils/logger');

class DeviceService {
  /**
   * Process ESP32 Hardware Webhook (Batch or Single Scan)
   * Deduplicates scans via UNIQUE(event_id) in esp32_presence.
   */
  async processScanWebhook(deviceUid, scans, secretKey) {
    // 1. Verify Device UID
    const devices = await query(
      `SELECT id, name, department_id, is_active FROM devices WHERE device_uid = ?`,
      [deviceUid]
    );

    if (!devices || devices.length === 0) {
      throw { status: 404, code: 'NOT_FOUND', message: `Device '${deviceUid}' not registered in institutional directory` };
    }

    const device = devices[0];
    if (!device.is_active) {
      throw { status: 403, code: 'FORBIDDEN', message: `Device '${deviceUid}' is deactivated` };
    }

    // 2. Update Heartbeat
    await query(`UPDATE devices SET last_heartbeat_at = CURRENT_TIMESTAMP WHERE id = ?`, [device.id]);

    let inserted = 0;
    let duplicates = 0;
    let unmapped = 0;

    // 3. Process Scans
    for (const scan of scans) {
      const { slot_id, event_id, scanned_at } = scan;

      if (!event_id || !slot_id) continue;

      // Check slot mapping
      const slots = await query(
        `SELECT student_id FROM fingerprint_slots 
         WHERE device_id = ? AND slot_id = ? AND is_active = TRUE`,
        [device.id, slot_id]
      );

      if (!slots || slots.length === 0) {
        unmapped++;
        logger.warn(`Unmapped slot scan received: Device ${deviceUid}, Slot ${slot_id}`);
        continue;
      }

      const studentId = slots[0].student_id;
      const scanDateObj = scanned_at ? new Date(scanned_at) : new Date();
      const scanTimeStr = scanDateObj.toISOString().replace('T', ' ').slice(0, 19);
      const scanDateStr = scanTimeStr.slice(0, 10);

      try {
        await query(
          `INSERT INTO esp32_presence (event_id, device_id, student_id, scan_time, payload_json)
           VALUES (?, ?, ?, ?, ?)`,
          [event_id, device.id, studentId, scanTimeStr, JSON.stringify(scan)]
        );

        // Record in dedicated raw immutable iot_attendance_events table (redesign.md Section 32)
        try {
          await query(
            `INSERT INTO iot_attendance_events 
             (student_id, device_id, department_id, scan_time, scan_date, verification_status, event_type, payload_json)
             VALUES (?, ?, ?, ?, ?, 'VERIFIED', 'FINGERPRINT', ?)`,
            [studentId, device.id, device.department_id || null, scanTimeStr, scanDateStr, JSON.stringify(scan)]
          );
        } catch (iotErr) {
          logger.warn('Non-fatal error inserting iot_attendance_events', { error: iotErr.message });
        }

        inserted++;
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY' || err.message.includes('Duplicate entry') || err.message.includes('UNIQUE constraint failed')) {
          duplicates++;
          // Safe deduplication: duplicate retry acknowledged without error
        } else {
          logger.error('Error inserting esp32_presence record', { error: err.message, event_id });
        }
      }
    }

    return {
      device_uid: deviceUid,
      processed: scans.length,
      inserted,
      duplicates,
      unmapped
    };
  }

  /**
   * Get Cohort Biometric Status & Assigned Terminals
   */
  async getCohortBiometrics(deptId, branchId, year, semester, academicYearId) {
    // Fetch devices assigned to this department cohort
    const devices = await query(
      `SELECT d.id, d.device_uid, d.name, d.is_active, d.last_heartbeat_at,
              (SELECT COUNT(*) FROM fingerprint_slots fs WHERE fs.device_id = d.id AND fs.is_active = TRUE) as occupied_slots
       FROM devices d
       WHERE d.department_id = ? 
         AND d.year = ? 
         AND d.semester = ? 
         AND d.academic_year_id = ?`,
      [deptId, year, semester, academicYearId]
    );

    const formattedDevices = devices.map(d => {
      let isOnline = false;
      if (d.last_heartbeat_at) {
        const hbStr = d.last_heartbeat_at.includes('Z') ? d.last_heartbeat_at : (d.last_heartbeat_at.replace(' ', 'T') + 'Z');
        isOnline = Boolean(d.is_active && (Math.abs(Date.now() - new Date(hbStr).getTime()) < 5 * 60 * 1000));
      }
      return {
        id: d.id,
        device_uid: d.device_uid,
        name: d.name,
        is_online: isOnline,
        total_slots: 1000,
        occupied_slots: d.occupied_slots,
        next_available_slot: d.occupied_slots + 1
      };
    });

    // Fetch student biometric status
    const students = await query(
      `SELECT s.id as student_id, s.full_name, s.official_enrollment_no, e.class_roll_no,
              fs.slot_id, fs.device_id, fs.enrolled_at,
              CASE WHEN fs.id IS NOT NULL THEN 'ENROLLED' ELSE 'NOT_ENROLLED' END as biometric_status
       FROM enrollments e
       JOIN students s ON e.student_id = s.id
       LEFT JOIN fingerprint_slots fs ON fs.student_id = s.id AND fs.is_active = TRUE
       WHERE e.department_id = ? 
         AND e.year = ? 
         AND e.semester = ? 
         AND e.academic_year_id = ? 
         AND e.status = 'ENROLLED'
       ORDER BY e.class_roll_no ASC`,
      [deptId, year, semester, academicYearId]
    );

    return {
      devices: formattedDevices,
      students
    };
  }

  /**
   * Assign / Confirm Fingerprint Slot
   */
  async assignSlot(deviceId, slotId, studentId) {
    // If student already occupies another slot on this device, free that slot to prevent UNIQUE(device_id, student_id) conflict
    await query(
      `DELETE FROM fingerprint_slots WHERE device_id = ? AND student_id = ? AND slot_id != ?`,
      [deviceId, studentId, slotId]
    );

    await query(
      `INSERT INTO fingerprint_slots (device_id, slot_id, student_id)
       VALUES (?, ?, ?)
       ON CONFLICT(device_id, slot_id) DO UPDATE SET 
         student_id = excluded.student_id,
         is_active = 1,
         enrolled_at = CURRENT_TIMESTAMP`,
      [deviceId, slotId, studentId]
    );

    return {
      device_id: deviceId,
      slot_id: slotId,
      student_id: studentId,
      message: 'Fingerprint slot successfully correlated.'
    };
  }
}

module.exports = new DeviceService();
