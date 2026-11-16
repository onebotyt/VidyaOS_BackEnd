/**
 * Device Model — MySQL 8.x data access layer for ESP32 biometric terminals,
 * portable student fingerprint templates, remote command queue, and IoT events.
 */

const { query } = require('../config/db');
const { generateDeviceSecretKey } = require('../utils/esp32Crypto');

class DeviceModel {
  /**
   * Lists all registered hardware devices with online status, 2S battery telemetry,
   * W25Q32 offline flash queue depth, and department biometric template counts.
   */
  async listDevices(departmentId = null) {
    const params = [];
    let whereSql = '';
    if (departmentId) {
      whereSql = 'WHERE d.department_id = ?';
      params.push(departmentId);
    }

    const devices = await query(
      `SELECT d.id, d.device_uid, d.name, d.is_active, d.last_heartbeat_at,
              d.department_id, d.department_id as branch_id, d.year, d.semester,
              d.assigned_years, d.assigned_semesters, d.secret_key, d.secret_hash,
              d.firmware_version, d.battery_voltage, d.battery_pct, d.is_charging,
              d.offline_queue_count, d.w25q32_used_kb, d.as608_enrolled_count,
              d.wifi_rssi, d.ip_address,
              dept.name as department_name, dept.code as department_code, dept.code as branch_code,
              (SELECT COUNT(DISTINCT sbt.student_id)
               FROM student_biometric_templates sbt
               JOIN enrollments e ON e.student_id = sbt.student_id AND e.status = 'ENROLLED'
               WHERE e.department_id = d.department_id AND sbt.is_active = 1) as enrolled_count
       FROM devices d
       LEFT JOIN departments dept ON d.department_id = dept.id
       ${whereSql}
       ORDER BY d.name ASC`,
      params
    );

    const now = Date.now();
    return devices.map((d) => {
      let isOnline = false;
      let minutesSinceHeartbeat = null;
      if (d.last_heartbeat_at) {
        const hbTime = new Date(d.last_heartbeat_at).getTime();
        minutesSinceHeartbeat = Math.max(0, Math.round((now - hbTime) / 60000));
        isOnline = Boolean(d.is_active && minutesSinceHeartbeat <= 5);
      }
      return {
        ...d,
        is_online: isOnline,
        minutes_since_heartbeat: minutesSinceHeartbeat,
        encryption_mode: 'AES-256-GCM',
        total_slots: 300
      };
    });
  }

  async getById(id) {
    const rows = await query('SELECT * FROM devices WHERE id = ?', [id]);
    return rows[0] || null;
  }

  async getByUid(deviceUid) {
    const rows = await query('SELECT * FROM devices WHERE device_uid = ?', [deviceUid]);
    return rows[0] || null;
  }

  async createDevice({
    deviceUid,
    name,
    departmentId,
    year = 1,
    semester = 1,
    assignedYearsStr = '1,2,3',
    assignedSemestersStr = '1,2,3,4,5,6',
    academicYearId = 1,
    secretKey
  }) {
    const rawSecret = secretKey && String(secretKey).trim().length >= 8
      ? String(secretKey).trim()
      : generateDeviceSecretKey();

    const res = await query(
      `INSERT INTO devices
        (device_uid, name, department_id, branch_id, year, semester, assigned_years, assigned_semesters, academic_year_id, secret_key, secret_hash, firmware_version, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'v3.0-AES256-GCM', 1)`,
      [
        deviceUid,
        name,
        departmentId,
        departmentId,
        year || 1,
        semester || 1,
        assignedYearsStr,
        assignedSemestersStr,
        academicYearId,
        rawSecret,
        rawSecret
      ]
    );
    const insertId = res.insertId || res[0]?.insertId || res.lastID;
    return { id: insertId, secret_key: rawSecret };
  }

  async getSlot(deviceId, slotId) {
    const rows = await query(
      'SELECT student_id FROM fingerprint_slots WHERE device_id = ? AND slot_id = ?',
      [deviceId, slotId]
    );
    return rows[0] || null;
  }

  async deleteSlot(deviceId, slotId) {
    const res = await query(
      'DELETE FROM fingerprint_slots WHERE device_id = ? AND slot_id = ?',
      [deviceId, slotId]
    );
    return (res.affectedRows ?? res.changes) > 0;
  }

  async updateStatus(id, isActive) {
    const res = await query(
      'UPDATE devices SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [isActive ? 1 : 0, id]
    );
    return (res.affectedRows ?? res.changes) > 0;
  }

  async getRawIotEvents({ deptId, deviceId, studentId, date, fromDate, toDate, limit = 100 }) {
    const where = ['1=1'];
    const params = [];

    if (deptId) {
      where.push('ie.department_id = ?');
      params.push(deptId);
    }
    if (deviceId) {
      where.push('ie.device_id = ?');
      params.push(deviceId);
    }
    if (studentId) {
      where.push('ie.student_id = ?');
      params.push(studentId);
    }
    if (date) {
      where.push('ie.scan_date = ?');
      params.push(date);
    } else {
      if (fromDate) {
        where.push('ie.scan_date >= ?');
        params.push(fromDate);
      }
      if (toDate) {
        where.push('ie.scan_date <= ?');
        params.push(toDate);
      }
    }

    const lim = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
    return await query(
      `SELECT ie.id, ie.student_id, ie.device_id, ie.department_id,
              ie.scan_time, ie.scan_date, ie.verification_status, ie.event_type, ie.payload_json,
              s.full_name as student_name, s.official_enrollment_no, s.registration_no,
              COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no,
              e.year, e.semester,
              d.device_uid, d.name as device_name,
              dept.code as department_code, dept.name as department_name
       FROM iot_attendance_events ie
       JOIN students s ON ie.student_id = s.id
       JOIN devices d ON ie.device_id = d.id
       LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
       LEFT JOIN departments dept ON ie.department_id = dept.id
       WHERE ${where.join(' AND ')}
       ORDER BY ie.scan_time DESC
       LIMIT ${lim}`,
      params
    );
  }
}

module.exports = new DeviceModel();
