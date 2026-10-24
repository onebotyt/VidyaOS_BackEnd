/**
 * Assignment Model — Data access layer for coursework, assessments, and student submissions.
 */

const { query } = require('../config/db');

class AssignmentModel {
  /**
   * Creates a coursework assignment record.
   * 
   * @calledBy AssignmentController.createAssignment() (controllers/assignmentController.js)
   * @route POST /api/v1/assignments (routes/assignments.js)
   * @param {Object} params Assignment details
   * @returns {Promise<number>} Inserted assignment ID
   */
  async create({ teacherId, subjectId, departmentId, groupId, year, semester, academicYearId, title, description, attachmentPath, attachmentName, dueDate, maxMarks, unitName }) {
    const res = await query(
      `INSERT INTO assessments
       (teacher_id, subject_id, department_id, group_id, year, semester, academic_year_id, type, title, description, attachment_path, attachment_name, due_date, max_marks, unit_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ASSIGNMENT', ?, ?, ?, ?, ?, ?, ?)`,
      [teacherId, subjectId || null, departmentId, groupId || null, year, semester, academicYearId, title, description || null, attachmentPath, attachmentName, dueDate || null, maxMarks || 100, unitName || null]
    );
    return res.insertId || res.lastInsertRowid;
  }

  /**
   * Retrieves user IDs of all enrolled members of a teaching group for notifications.
   * 
   * @calledBy AssignmentController.createAssignment() (controllers/assignmentController.js)
   * @route POST /api/v1/assignments (routes/assignments.js)
   * @param {number} groupId Teaching group ID
   * @returns {Promise<Array<number>>} List of user IDs
   */
  async getGroupMemberUserIds(groupId) {
    const rows = await query(
      `SELECT s.user_id FROM teaching_group_members tgm
       JOIN students s ON s.id = tgm.student_id
       WHERE tgm.group_id = ? AND (tgm.status = 'ACTIVE' OR tgm.status = 'ENROLLED')`,
      [groupId]
    );
    return rows.map(m => m.user_id).filter(Boolean);
  }

  /**
   * Lists assignments available to a student, including personal submission state.
   * 
   * @calledBy AssignmentController.listAssignments() (controllers/assignmentController.js)
   * @route GET /api/v1/assignments (routes/assignments.js)
   * @param {Object} filter { studentId, groupId }
   * @returns {Promise<Array<Object>>} Assignment list with submission status
   */
  async listForStudent({ studentId, groupId }) {
    if (groupId) {
      return await query(
        `SELECT a.*, COALESCE(sub.name, tg.subject_name, 'General Subject') as subject_name, t.full_name as teacher_name,
                sub2.file_path as my_file_path, sub2.status as my_status, sub2.marks_obtained as my_marks, sub2.feedback as my_feedback, sub2.submitted_at as my_submitted_at
         FROM assessments a
         LEFT JOIN subjects sub ON sub.id = a.subject_id
         LEFT JOIN teaching_groups tg ON tg.id = a.group_id
         JOIN teachers t ON t.id = a.teacher_id
         LEFT JOIN assessment_submissions sub2 ON sub2.assessment_id = a.id AND sub2.student_id = ?
         WHERE a.group_id = ? AND a.type IN ('ASSIGNMENT', 'PRACTICAL', 'FINAL_DOCS')
         ORDER BY a.due_date IS NULL, a.due_date ASC, a.id DESC`,
        [studentId, groupId]
      );
    }

    const enr = await query(
      `SELECT department_id, year, semester, academic_year_id FROM enrollments WHERE student_id = ? ORDER BY id DESC LIMIT 1`,
      [studentId]
    );
    const c = enr[0] || {};

    return await query(
      `SELECT a.*, COALESCE(sub.name, tg.subject_name, 'General Subject') as subject_name, t.full_name as teacher_name,
              sub2.file_path as my_file_path, sub2.status as my_status, sub2.marks_obtained as my_marks, sub2.feedback as my_feedback, sub2.submitted_at as my_submitted_at
       FROM assessments a
       LEFT JOIN subjects sub ON sub.id = a.subject_id
       LEFT JOIN teaching_groups tg ON tg.id = a.group_id
       JOIN teachers t ON t.id = a.teacher_id
       LEFT JOIN assessment_submissions sub2 ON sub2.assessment_id = a.id AND sub2.student_id = ?
       WHERE ((a.department_id = ? AND a.year = ? AND a.semester = ? AND a.academic_year_id = ?)
              OR (a.group_id IN (SELECT group_id FROM teaching_group_members WHERE student_id = ? AND (status = 'ACTIVE' OR status = 'ENROLLED'))))
             AND a.type IN ('ASSIGNMENT', 'PRACTICAL', 'FINAL_DOCS')
       ORDER BY a.due_date IS NULL, a.due_date ASC, a.id DESC`,
      [studentId, c.department_id || 0, c.year || 0, c.semester || 0, c.academic_year_id || 0, studentId]
    );
  }

  /**
   * Lists assignments created by or visible to a teacher/admin with submission counts.
   * 
   * @calledBy AssignmentController.listAssignments() (controllers/assignmentController.js)
   * @route GET /api/v1/assignments (routes/assignments.js)
   * @param {Object} filter Filters for teacher, group, subject, dept, year, sem, AY
   * @returns {Promise<Array<Object>>} Assignment rows
   */
  async listForTeacher({ teacherId, isSystemAdmin, groupId, subjectId, departmentId, year, semester, academicYearId }) {
    let sql = `
      SELECT a.*, COALESCE(sub.name, tg.subject_name, 'General Subject') as subject_name, d.name as department_name, d.name as branch_name,
             (SELECT COUNT(*) FROM assessment_submissions s WHERE s.assessment_id = a.id) as submission_count,
             CASE
               WHEN a.group_id IS NOT NULL THEN
                 (SELECT COUNT(*) FROM teaching_group_members tgm WHERE tgm.group_id = a.group_id AND (tgm.status = 'ACTIVE' OR tgm.status = 'ENROLLED'))
               ELSE
                 (SELECT COUNT(*) FROM enrollments e WHERE e.department_id = a.department_id
                    AND e.year = a.year AND e.semester = a.semester AND e.academic_year_id = a.academic_year_id AND e.status = 'ENROLLED')
             END as class_size
      FROM assessments a
      LEFT JOIN subjects sub ON sub.id = a.subject_id
      LEFT JOIN teaching_groups tg ON tg.id = a.group_id
      LEFT JOIN departments d ON d.id = a.department_id
      WHERE 1=1
    `;
    const params = [];

    if (teacherId && !isSystemAdmin) {
      sql += ` AND a.teacher_id = ?`;
      params.push(teacherId);
    }
    if (groupId) {
      sql += ` AND a.group_id = ?`;
      params.push(Number(groupId));
    }
    if (subjectId) {
      sql += ` AND a.subject_id = ?`;
      params.push(Number(subjectId));
    }
    if (departmentId) {
      sql += ` AND a.department_id = ?`;
      params.push(Number(departmentId));
    }
    if (year) {
      sql += ` AND a.year = ?`;
      params.push(Number(year));
    }
    if (semester) {
      sql += ` AND a.semester = ?`;
      params.push(Number(semester));
    }
    if (academicYearId) {
      sql += ` AND a.academic_year_id = ?`;
      params.push(Number(academicYearId));
    }

    sql += ` ORDER BY a.id DESC`;
    return await query(sql, params);
  }

  /**
   * Retrieves a single assessment by ID.
   * 
   * @calledBy AssignmentController.getSubmissions() (controllers/assignmentController.js)
   * @calledBy AssignmentController.submitAssignment() (controllers/assignmentController.js)
   * @calledBy AssignmentController.submitFinalDocs() (controllers/assignmentController.js)
   * @calledBy AssignmentController.deleteAssignment() (controllers/assignmentController.js)
   * @route GET/POST/DELETE /api/v1/assignments/:id (routes/assignments.js)
   * @param {number|string} id Assessment ID
   * @returns {Promise<Object|null>} Assessment row or null
   */
  async getById(id) {
    const rows = await query(`SELECT * FROM assessments WHERE id = ?`, [id]);
    return rows[0] || null;
  }

  /**
   * Retrieves class roster with submission files and grades for an assignment.
   * 
   * @calledBy AssignmentController.getSubmissions() (controllers/assignmentController.js)
   * @route GET /api/v1/assignments/:id/submissions (routes/assignments.js)
   * @param {Object} a Assessment row
   * @returns {Promise<Array<Object>>} Submissions roster
   */
  async getSubmissionsRoster(a) {
    if (a.group_id) {
      return await query(
        `SELECT COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no, s.id as student_id,
                s.official_enrollment_no, s.registration_no, s.full_name,
                sub.id as submission_id, sub.file_path, sub.original_filename, sub.submitted_at,
                sub.status, sub.marks_obtained, sub.feedback
         FROM teaching_group_members tgm
         JOIN students s ON tgm.student_id = s.id
         LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
         LEFT JOIN assessment_submissions sub ON sub.assessment_id = ? AND sub.student_id = s.id
         WHERE tgm.group_id = ? AND (tgm.status = 'ACTIVE' OR tgm.status = 'ENROLLED')
         ORDER BY COALESCE(s.class_roll_no, e.class_roll_no) ASC`,
        [a.id, a.group_id]
      );
    }
    return await query(
      `SELECT COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no, s.id as student_id,
              s.official_enrollment_no, s.registration_no, s.full_name,
              sub.id as submission_id, sub.file_path, sub.original_filename, sub.submitted_at,
              sub.status, sub.marks_obtained, sub.feedback
       FROM enrollments e
       JOIN students s ON e.student_id = s.id
       LEFT JOIN assessment_submissions sub ON sub.assessment_id = ? AND sub.student_id = s.id
       WHERE e.department_id = ? AND e.year = ? AND e.semester = ? AND e.academic_year_id = ? AND e.status = 'ENROLLED'
       ORDER BY COALESCE(s.class_roll_no, e.class_roll_no) ASC`,
      [a.id, a.department_id, a.year, a.semester, a.academic_year_id]
    );
  }

  /**
   * Inserts or updates a student's submission for an assignment.
   * 
   * @calledBy AssignmentController.submitAssignment() (controllers/assignmentController.js)
   * @calledBy AssignmentController.submitFinalDocs() (controllers/assignmentController.js)
   * @route POST /api/v1/assignments/:id/submit, POST /api/v1/assignments/:id/submit-final-docs (routes/assignments.js)
   * @param {Object} params Submission data
   * @returns {Promise<number>} Submission ID
   */
  async upsertSubmission({ assessmentId, studentId, filePath, originalFilename, status }) {
    const existing = await query(
      'SELECT id FROM assessment_submissions WHERE assessment_id = ? AND student_id = ?',
      [assessmentId, studentId]
    );
    if (existing.length > 0) {
      await query(
        `UPDATE assessment_submissions
         SET file_path = ?, original_filename = ?, status = ?, submitted_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [filePath, originalFilename, status, existing[0].id]
      );
      return existing[0].id;
    }
    const res = await query(
      `INSERT INTO assessment_submissions (assessment_id, student_id, file_path, original_filename, status)
       VALUES (?, ?, ?, ?, ?)`,
      [assessmentId, studentId, filePath, originalFilename, status]
    );
    return res.insertId || res.lastInsertRowid;
  }

  /**
   * Deletes a student's submission for an assignment (Unsubmit).
   * 
   * @calledBy AssignmentController.unsubmitAssignment() (controllers/assignmentController.js)
   * @route POST /api/v1/assignments/:id/unsubmit (routes/assignments.js)
   * @param {number} assessmentId Assignment ID
   * @param {number} studentId Student ID
   * @returns {Promise<boolean>} True if removed
   */
  async deleteSubmission(assessmentId, studentId) {
    const res = await query(
      'DELETE FROM assessment_submissions WHERE assessment_id = ? AND student_id = ?',
      [assessmentId, studentId]
    );
    return (res.affectedRows > 0 || res.changes > 0);
  }

  /**
   * Updates grade marks and feedback on a student submission.
   * 
   * @calledBy AssignmentController.gradeSubmission() (controllers/assignmentController.js)
   * @route PUT /api/v1/assignments/submissions/:submissionId/grade (routes/assignments.js)
   * @param {Object} params Grade details
   * @returns {Promise<boolean>} True if updated
   */
  async gradeSubmission({ submissionId, marksObtained, feedback, gradedBy }) {
    const res = await query(
      `UPDATE assessment_submissions
       SET marks_obtained = ?, feedback = ?, status = 'GRADED', graded_at = CURRENT_TIMESTAMP, graded_by = ?
       WHERE id = ?`,
      [marksObtained ?? null, feedback || null, gradedBy, submissionId]
    );
    return res.affectedRows > 0 || res.changes > 0;
  }

  /**
   * Retrieves notification metadata for a graded submission.
   * 
   * @calledBy AssignmentController.gradeSubmission() (controllers/assignmentController.js)
   * @route PUT /api/v1/assignments/submissions/:submissionId/grade (routes/assignments.js)
   * @param {number|string} submissionId Submission ID
   * @returns {Promise<Object|null>} Details or null
   */
  async getSubmissionDetails(submissionId) {
    const rows = await query(
      `SELECT sub.student_id, s.user_id, a.id as assignment_id, a.title, a.group_id, a.max_marks
       FROM assessment_submissions sub
       JOIN students s ON s.id = sub.student_id
       JOIN assessments a ON a.id = sub.assessment_id
       WHERE sub.id = ?`,
      [submissionId]
    );
    return rows[0] || null;
  }

  /**
   * Deletes an assignment and all associated student submissions.
   * 
   * @calledBy AssignmentController.deleteAssignment() (controllers/assignmentController.js)
   * @route DELETE /api/v1/assignments/:id (routes/assignments.js)
   * @param {number|string} id Assessment ID
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteAssignment(id) {
    await query('DELETE FROM assessment_submissions WHERE assessment_id = ?', [id]);
    const res = await query('DELETE FROM assessments WHERE id = ?', [id]);
    return res.affectedRows > 0 || res.changes > 0;
  }
}

module.exports = new AssignmentModel();
