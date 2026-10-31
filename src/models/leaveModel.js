/**
 * Leave Model — Data access layer for student leave requests.
 */

const { query } = require('../config/db');

class LeaveModel {
  /**
   * Creates a new pending student leave application.
   * 
   * @calledBy LeaveController.applyLeave() (controllers/leaveController.js)
   * @route POST /api/v1/leave (routes/leave.js)
   * @param {Object} opts { studentId, fromDate, toDate, reason }
   * @returns {Promise<number>} Inserted leave request ID
   */
  async createApplication({ studentId, fromDate, toDate, reason }) {
    const res = await query(
      `INSERT INTO leave_applications (student_id, from_date, to_date, reason, status)
       VALUES (?, ?, ?, ?, 'PENDING')`,
      [studentId, fromDate, toDate, reason]
    );
    return res.insertId || res.lastInsertRowid;
  }

  /**
   * Retrieves all leave applications filed by a specific student.
   * 
   * @calledBy LeaveController.getMyLeaves() (controllers/leaveController.js)
   * @route GET /api/v1/leave/my (routes/leave.js)
   * @param {number} studentId
   * @returns {Promise<Array<Object>>}
   */
  async getByStudentId(studentId) {
    return await query(
      `SELECT * FROM leave_applications WHERE student_id = ? ORDER BY id DESC`,
      [studentId]
    );
  }

  /**
   * Retrieves leave applications scoped to teacher's assigned classes or department.
   * 
   * @calledBy LeaveController.getLeaveRequests() (controllers/leaveController.js)
   * @route GET /api/v1/leave (routes/leave.js)
   * @param {Object} opts { teacherId, status, departmentId, isHod, isAdmin }
   * @returns {Promise<Array<Object>>}
   */
  async getForTeacher({ teacherId, status, departmentId, isHod, isAdmin }) {
    let where = 'WHERE 1=1';
    const params = [];
    if (status) {
      where += ' AND UPPER(la.status) = ?';
      params.push(status.toUpperCase());
    }

    let teacherFilter = '';
    if (!isAdmin) {
      if (isHod && departmentId) {
        teacherFilter = ' AND (e.department_id = ? OR e.department_id IS NULL)';
        params.push(departmentId);
      } else if (teacherId) {
        teacherFilter = ` AND (
          e.department_id IN (SELECT department_id FROM teacher_assignments WHERE teacher_id = ? AND is_active = 1)
          OR e.department_id = (SELECT department_id FROM teachers WHERE id = ?)
          OR e.department_id IS NULL
        )`;
        params.push(teacherId, teacherId);
      }
    }

    return await query(
      `SELECT la.*,
              COALESCE(la.leave_type, 'Medical') as leave_type,
              s.official_enrollment_no,
              s.full_name as student_name,
              e.class_roll_no,
              COALESCE(d.name, 'Information Technology') as department_name,
              COALESCE(d.name, 'Information Technology') as branch_name,
              COALESCE(e.year, 2) as year,
              COALESCE(e.semester, 3) as semester,
              CASE WHEN e.class_roll_no > 30 THEN 'Section B' ELSE 'Section A' END as section
       FROM leave_applications la
       JOIN students s ON la.student_id = s.id
       LEFT JOIN enrollments e ON e.student_id = s.id
       LEFT JOIN departments d ON e.department_id = d.id
       ${where} ${teacherFilter}
       GROUP BY la.id, s.full_name, e.class_roll_no, d.name, e.year, e.semester
       ORDER BY la.status = 'PENDING' DESC, la.id DESC`,
      params
    );
  }

  /**
   * Updates teacher review decision (APPROVED or REJECTED) and notes on a leave application.
   * 
   * @calledBy LeaveController.decideLeave() (controllers/leaveController.js)
   * @route PUT /api/v1/leave/:id/decision (routes/leave.js)
   * @param {Object} opts { id, decision, reviewNote, reviewedBy }
   * @returns {Promise<boolean>} True if record was updated
   */
  async updateDecision({ id, decision, reviewNote, reviewedBy }) {
    const result = await query(
      `UPDATE leave_applications
       SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [decision, reviewNote || null, reviewedBy, id]
    );
    return result.affectedRows > 0 || result.changes > 0;
  }
}

module.exports = new LeaveModel();
