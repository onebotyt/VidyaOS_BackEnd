/**
 * Device Model — Data access layer for hardware biometric terminals and IoT events.
 */

const { query } = require('../config/db');

class DeviceModel {
  /**
   * Lists all registered hardware devices with computed online status and enrolled slot counts.
   * 
   * @calledBy DeviceController.getDevices() (controllers/deviceController.js)
   * @route GET /api/v1/devices (routes/devices.js)
   * @returns {Promise<Array<Object>>} Device list with online metrics
   */
  async listDevices() {
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
    return devices.map(d => {
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
  }

  /**
   * Retrieves a single device record by its database ID.
   * 
   * @calledBy DeviceController.assignSlot() (controllers/deviceController.js)
   * @calledBy DeviceService.assignSlot() (services/deviceService.js)
   * @route POST /api/v1/devices/:id/slots (routes/devices.js)
   * @param {number|string} id Device ID
   * @returns {Promise<Object|null>} Device row or null
   */
  async getById(id) {
    const rows = await query('SELECT * FROM devices WHERE id = ?', [id]);
    return rows[0] || null;
  }

  /**
   * Inserts a new biometric device terminal record.
   * 
   * @calledBy DeviceController.registerDevice() (controllers/deviceController.js)
   * @route POST /api/v1/devices (routes/devices.js)
   * @param {Object} params Device details
   * @returns {Promise<number>} Inserted device ID
   */
  async createDevice({ deviceUid, name, departmentId, year, semester, assignedYearsStr, assignedSemestersStr, academicYearId, secretKey }) {
    const [res] = await query(
      `INSERT INTO devices (device_uid, name, department_id, year, semester, assigned_years, assigned_semesters, academic_year_id, secret_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [deviceUid, name, departmentId, year, semester, assignedYearsStr, assignedSemestersStr, academicYearId, secretKey || 'default_secret']
    );
    return res.insertId || res.lastInsertRowid;
  }

  /**
   * Retrieves a fingerprint slot assignment by device ID and slot ID.
   * 
   * @calledBy DeviceController.removeSlot() (controllers/deviceController.js)
   * @route DELETE /api/v1/devices/:id/slots/:slot_id (routes/devices.js)
   * @param {number} deviceId Device ID
   * @param {number} slotId Fingerprint slot number
   * @returns {Promise<Object|null>} Slot mapping or null
   */
  async getSlot(deviceId, slotId) {
    const [row] = await query(
      'SELECT student_id FROM fingerprint_slots WHERE device_id = ? AND slot_id = ?',
      [deviceId, slotId]
    );
    return row || null;
  }

  /**
   * Deletes a student fingerprint slot mapping from a device.
   * 
   * @calledBy DeviceController.removeSlot() (controllers/deviceController.js)
   * @route DELETE /api/v1/devices/:id/slots/:slot_id (routes/devices.js)
   * @param {number} deviceId Device ID
   * @param {number} slotId Fingerprint slot number
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteSlot(deviceId, slotId) {
    const res = await query(
      'DELETE FROM fingerprint_slots WHERE device_id = ? AND slot_id = ?',
      [deviceId, slotId]
    );
    return res.affectedRows > 0 || res.changes > 0;
  }

  /**
   * Updates the active/inactive operational status of a hardware terminal.
   * 
   * @calledBy DeviceController.updateDeviceStatus() (controllers/deviceController.js)
   * @route PUT /api/v1/devices/:id/status (routes/devices.js)
   * @param {number} id Device ID
   * @param {boolean|number} isActive Status flag
   * @returns {Promise<boolean>} True if updated
   */
  async updateStatus(id, isActive) {
    const res = await query('UPDATE devices SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, id]);
    return res.affectedRows > 0 || res.changes > 0;
  }

  /**
   * Fetches raw immutable IoT attendance events with optional filtering.
   * 
   * @calledBy DeviceController.getRawEvents() (controllers/deviceController.js)
   * @route GET /api/v1/devices/events/raw (routes/devices.js)
   * @param {Object} filters Query parameters (deptId, deviceId, studentId, date, limit, etc.)
   * @returns {Promise<Array<Object>>} Raw event records
   */
  async getRawIotEvents({ deptId, deviceId, studentId, date, fromDate, toDate, limit = 100 }) {
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
    if (deviceId) {
      sql += ` AND ie.device_id = ?`;
      params.push(Number(deviceId));
    }
    if (studentId) {
      sql += ` AND ie.student_id = ?`;
      params.push(Number(studentId));
    }
    if (date) {
      sql += ` AND ie.scan_date = ?`;
      params.push(date);
    }
    if (fromDate) {
      sql += ` AND ie.scan_date >= ?`;
      params.push(fromDate);
    }
    if (toDate) {
      sql += ` AND ie.scan_date <= ?`;
      params.push(toDate);
    }

    sql += ` ORDER BY ie.scan_time DESC LIMIT ?`;
    params.push(Math.min(parseInt(limit, 10) || 100, 500));

    return await query(sql, params);
  }
}

module.exports = new DeviceModel();
