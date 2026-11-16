/**
 * Timetable Model — Data access layer for weekly schedule slots.
 */

const { query } = require('../config/db');

const SELECT_BASE = `
  SELECT t.*, sub.name as subject_name, sub.code as subject_code,
         te.full_name as teacher_name, d.name as department_name, d.name as branch_name
  FROM timetable_slots t
  LEFT JOIN subjects sub ON sub.id = t.subject_id
  LEFT JOIN teachers te ON te.id = t.teacher_id
  JOIN departments d ON d.id = t.department_id
`;

class TimetableModel {
  /**
   * Retrieves active enrollment cohort for a student.
   * 
   * @calledBy TimetableController.getTimetable() (controllers/timetableController.js)
   * @route GET /api/v1/timetable (routes/timetable.js)
   * @param {number} studentId
   * @returns {Promise<Object|null>}
   */
  async getStudentCohort(studentId) {
    const enr = await query(
      `SELECT department_id, year, semester, academic_year_id FROM enrollments WHERE student_id = ? ORDER BY id DESC LIMIT 1`,
      [studentId]
    );
    return enr[0] || null;
  }

  /**
   * Retrieves weekly schedule slots matching cohort specifications.
   * 
   * @calledBy TimetableController.getTimetable() (controllers/timetableController.js)
   * @route GET /api/v1/timetable (routes/timetable.js)
   * @param {Object} opts { departmentId, year, semester, academicYearId }
   * @returns {Promise<Array<Object>>}
   */
  async getSlots({ departmentId, year, semester, academicYearId }) {
    return await query(
      `${SELECT_BASE}
       WHERE t.department_id = ? AND t.year = ? AND t.semester = ? AND t.academic_year_id = ?
       ORDER BY t.day_of_week ASC, t.start_time ASC`,
      [departmentId, year, semester, academicYearId]
    );
  }

  /**
   * Inserts a new weekly timetable class slot.
   * 
   * @calledBy TimetableController.addSlot() (controllers/timetableController.js)
   * @route POST /api/v1/timetable (routes/timetable.js)
   * @param {Object} opts Slot details
   * @returns {Promise<number>} Inserted slot ID
   */
  async createSlot({ departmentId, year, semester, academicYearId, subjectId, teacherId, dayOfWeek, startTime, endTime, room, sessionType, createdBy }) {
    const res = await query(
      `INSERT INTO timetable_slots
       (department_id, year, semester, academic_year_id, subject_id, teacher_id, day_of_week, start_time, end_time, room, session_type, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [departmentId, year, semester, academicYearId, subjectId || null, teacherId || null, dayOfWeek, startTime, endTime, room || null, sessionType || 'THEORY', createdBy]
    );
    return res.insertId || res.lastInsertRowid;
  }

  /**
   * Deletes a timetable slot by ID.
   * 
   * @calledBy TimetableController.removeSlot() (controllers/timetableController.js)
   * @route DELETE /api/v1/timetable/:id (routes/timetable.js)
   * @param {number} id
   * @returns {Promise<boolean>}
   */
  async deleteSlot(id) {
    const res = await query(`DELETE FROM timetable_slots WHERE id = ?`, [id]);
    return res.affectedRows > 0 || res.changes > 0;
  }

  /**
   * Retrieves uploaded PDF timetables filtered by year and department.
   */
  async getPdfTimetables({ year, departmentId } = {}) {
    let sql = `
      SELECT tf.*, d.name as department_name, d.code as department_code
      FROM timetable_files tf
      LEFT JOIN departments d ON d.id = tf.department_id
      WHERE 1=1
    `;
    const params = [];
    if (year) {
      sql += ' AND tf.year = ?';
      params.push(year);
    }
    if (departmentId) {
      sql += ' AND (tf.department_id = ? OR tf.department_id IS NULL)';
      params.push(departmentId);
    }
    sql += ' ORDER BY tf.year ASC, tf.created_at DESC';
    return await query(sql, params);
  }

  /**
   * Saves a newly uploaded PDF timetable record.
   */
  async createPdfTimetable({ departmentId, year, semester, academicYearId, title, filePath, fileName, fileSize, uploadedBy, uploaderName }) {
    const res = await query(
      `INSERT INTO timetable_files 
       (department_id, year, semester, academic_year_id, title, file_path, file_name, file_size, uploaded_by, uploader_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [departmentId || null, year, semester || null, academicYearId || null, title, filePath, fileName, fileSize || 0, uploadedBy || null, uploaderName || null]
    );
    const newId = res.insertId || res.lastInsertRowid;
    const rows = await query(`SELECT * FROM timetable_files WHERE id = ?`, [newId]);
    return rows[0] || null;
  }

  /**
   * Deletes an uploaded PDF timetable by ID.
   */
  async deletePdfTimetable(id) {
    const rows = await query(`SELECT * FROM timetable_files WHERE id = ?`, [id]);
    if (!rows || rows.length === 0) return null;
    await query(`DELETE FROM timetable_files WHERE id = ?`, [id]);
    return rows[0];
  }
}

module.exports = new TimetableModel();
