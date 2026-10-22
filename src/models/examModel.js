/**
 * Exam Model — Data access layer for class tests, exam scores, and rosters.
 */

const { query, withTransaction } = require('../config/db');

class ExamModel {
  /**
   * Creates a class test or exam assessment record.
   * 
   * @calledBy ExamController.createExam() (controllers/examController.js)
   * @route POST /api/v1/exams (routes/exams.js)
   * @param {Object} params Test configuration
   * @returns {Promise<number>} Inserted assessment ID
   */
  async create({ teacherId, subjectId, departmentId, groupId, year, semester, academicYearId, name, examDate, maxMarks, unitName }) {
    const res = await query(
      `INSERT INTO assessments (teacher_id, subject_id, department_id, group_id, year, semester, academic_year_id, type, title, due_date, max_marks, unit_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'EXAM', ?, ?, ?, ?)`,
      [teacherId, subjectId || null, departmentId || null, groupId || null, year || null, semester || null, academicYearId || null, name, examDate || null, maxMarks || 100, unitName || null]
    );
    return res.insertId || res.lastInsertRowid;
  }

  /**
   * Retrieves user IDs of all members of a teaching group for notifications.
   * 
   * @calledBy ExamController.createExam() (controllers/examController.js)
   * @route POST /api/v1/exams (routes/exams.js)
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
   * Lists tests and student-specific marks for an authenticated student.
   * 
   * @calledBy ExamController.listExams() (controllers/examController.js)
   * @route GET /api/v1/exams (routes/exams.js)
   * @param {Object} filter { studentId, groupId }
   * @returns {Promise<Array<Object>>} List of tests with student score
   */
  async listForStudent({ studentId, groupId }) {
    if (groupId) {
      return await query(
        `SELECT ex.*, COALESCE(sub.name, tg.subject_name, 'General Subject') as subject_name, t.full_name as teacher_name,
                sc.marks_obtained, sc.remarks
         FROM exams ex
         LEFT JOIN subjects sub ON sub.id = ex.subject_id
         LEFT JOIN teaching_groups tg ON tg.id = ex.group_id
         JOIN teachers t ON t.id = ex.teacher_id
         LEFT JOIN exam_scores sc ON sc.exam_id = ex.id AND sc.student_id = ?
         WHERE ex.group_id = ?
         ORDER BY ex.exam_date IS NULL, ex.exam_date DESC, ex.id DESC`,
        [studentId, groupId]
      );
    }

    const enr = await query(
      `SELECT department_id, year, semester, academic_year_id FROM enrollments WHERE student_id = ? ORDER BY id DESC LIMIT 1`,
      [studentId]
    );
    const c = enr[0] || {};
    return await query(
      `SELECT ex.*, COALESCE(sub.name, tg.subject_name, 'General Subject') as subject_name, t.full_name as teacher_name,
              sc.marks_obtained, sc.remarks
       FROM exams ex
       LEFT JOIN subjects sub ON sub.id = ex.subject_id
       LEFT JOIN teaching_groups tg ON tg.id = ex.group_id
       JOIN teachers t ON t.id = ex.teacher_id
       LEFT JOIN exam_scores sc ON sc.exam_id = ex.id AND sc.student_id = ?
       WHERE ((ex.department_id = ? AND ex.year = ? AND ex.semester = ? AND ex.academic_year_id = ?)
              OR (ex.group_id IN (SELECT group_id FROM teaching_group_members WHERE student_id = ? AND (status = 'ACTIVE' OR status = 'ENROLLED'))))
       ORDER BY ex.exam_date IS NULL, ex.exam_date DESC, ex.id DESC`,
      [studentId, c.department_id || 0, c.year || 0, c.semester || 0, c.academic_year_id || 0, studentId]
    );
  }

  /**
   * Lists tests scheduled by or visible to faculty/admins.
   * 
   * @calledBy ExamController.listExams() (controllers/examController.js)
   * @route GET /api/v1/exams (routes/exams.js)
   * @param {Object} filter Filters for teacher, group, subject, dept, year, sem, AY
   * @returns {Promise<Array<Object>>} List of tests
   */
  async listForTeacher({ teacherId, isSystemAdmin, groupId, subjectId, departmentId, year, semester, academicYearId }) {
    let sql = `
      SELECT ex.*, COALESCE(sub.name, tg.subject_name, 'General Subject') as subject_name,
             (SELECT COUNT(*) FROM exam_scores sc WHERE sc.exam_id = ex.id) as scores_entered,
             CASE
               WHEN ex.group_id IS NOT NULL THEN
                 (SELECT COUNT(*) FROM teaching_group_members tgm WHERE tgm.group_id = ex.group_id AND (tgm.status = 'ACTIVE' OR tgm.status = 'ENROLLED'))
               ELSE
                 (SELECT COUNT(*) FROM enrollments e WHERE e.department_id = ex.department_id
                    AND e.year = ex.year AND e.semester = ex.semester AND e.academic_year_id = ex.academic_year_id AND e.status = 'ENROLLED')
             END as class_size
      FROM exams ex
      LEFT JOIN subjects sub ON sub.id = ex.subject_id
      LEFT JOIN teaching_groups tg ON tg.id = ex.group_id
      WHERE 1=1
    `;
    const params = [];

    if (teacherId && !isSystemAdmin) {
      sql += ` AND ex.teacher_id = ?`;
      params.push(teacherId);
    }
    if (groupId) {
      sql += ` AND ex.group_id = ?`;
      params.push(Number(groupId));
    }
    if (subjectId) {
      sql += ` AND ex.subject_id = ?`;
      params.push(Number(subjectId));
    }
    if (departmentId) {
      sql += ` AND ex.department_id = ?`;
      params.push(Number(departmentId));
    }
    if (year) {
      sql += ` AND ex.year = ?`;
      params.push(Number(year));
    }
    if (semester) {
      sql += ` AND ex.semester = ?`;
      params.push(Number(semester));
    }
    if (academicYearId) {
      sql += ` AND ex.academic_year_id = ?`;
      params.push(Number(academicYearId));
    }

    sql += ` ORDER BY ex.id DESC`;
    return await query(sql, params);
  }

  /**
   * Retrieves single exam row by ID.
   * 
   * @calledBy ExamController.getRoster() (controllers/examController.js)
   * @route GET /api/v1/exams/:id/roster (routes/exams.js)
   * @param {number|string} id Exam ID
   * @returns {Promise<Object|null>} Exam row or null
   */
  async getById(id) {
    const rows = await query(`SELECT * FROM exams WHERE id = ?`, [id]);
    return rows[0] || null;
  }

  /**
   * Parses test JSON metadata (questions, instructions, duration, mode).
   * 
   * @calledBy ExamController.getRoster() (controllers/examController.js)
   * @calledBy ExamController.exportExcel() (controllers/examController.js)
   * @route GET /api/v1/exams/:id/roster, GET /api/v1/exams/:id/export/excel (routes/exams.js)
   * @param {number|string} id Exam ID
   * @returns {Promise<Object>} Meta object
   */
  async getMeta(id) {
    const rows = await query(`SELECT description FROM assessments WHERE id = ?`, [id]);
    let meta = {};
    try {
      if (rows[0]?.description && rows[0].description.startsWith('{')) {
        meta = JSON.parse(rows[0].description);
      }
    } catch { /* ignore */ }
    return meta;
  }

  /**
   * Retrieves roster with entered marks, absence state, and question score breakdown.
   * 
   * @calledBy ExamController.getRoster() (controllers/examController.js)
   * @calledBy ExamController.exportExcel() (controllers/examController.js)
   * @route GET /api/v1/exams/:id/roster, GET /api/v1/exams/:id/export/excel (routes/exams.js)
   * @param {Object} ex Exam row
   * @returns {Promise<Array<Object>>} Parsed student roster
   */
  async getRoster(ex) {
    let rows;
    if (ex.group_id) {
      rows = await query(
        `SELECT COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no, s.id as student_id,
                s.official_enrollment_no, s.registration_no, s.full_name,
                sc.marks_obtained, sc.feedback as remarks, sc.status
         FROM teaching_group_members tgm
         JOIN students s ON tgm.student_id = s.id
         LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
         LEFT JOIN assessment_submissions sc ON sc.assessment_id = ? AND sc.student_id = s.id
         WHERE tgm.group_id = ? AND (tgm.status = 'ACTIVE' OR tgm.status = 'ENROLLED')
         ORDER BY COALESCE(s.class_roll_no, e.class_roll_no) ASC`,
        [ex.id, ex.group_id]
      );
    } else {
      rows = await query(
        `SELECT COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no, s.id as student_id,
                s.official_enrollment_no, s.registration_no, s.full_name,
                sc.marks_obtained, sc.feedback as remarks, sc.status
         FROM enrollments e
         JOIN students s ON e.student_id = s.id
         LEFT JOIN assessment_submissions sc ON sc.assessment_id = ? AND sc.student_id = s.id
         WHERE e.department_id = ? AND e.year = ? AND e.semester = ? AND e.academic_year_id = ? AND e.status = 'ENROLLED'
         ORDER BY COALESCE(s.class_roll_no, e.class_roll_no) ASC`,
        [ex.id, ex.department_id, ex.year, ex.semester, ex.academic_year_id]
      );
    }

    return rows.map(r => {
      let isAbsent = r.status === 'ABSENT';
      let qScores = null;
      let note = r.remarks;

      if (r.remarks && typeof r.remarks === 'string' && r.remarks.startsWith('{')) {
        try {
          const parsed = JSON.parse(r.remarks);
          if (parsed.is_absent !== undefined) isAbsent = Boolean(parsed.is_absent);
          if (Array.isArray(parsed.question_scores)) qScores = parsed.question_scores;
          if (parsed.remarks) note = parsed.remarks;
        } catch { /* raw string */ }
      }

      return {
        class_roll_no: r.class_roll_no,
        student_id: r.student_id,
        official_enrollment_no: r.official_enrollment_no,
        enrollment_no: r.official_enrollment_no,
        registration_no: r.registration_no,
        full_name: r.full_name,
        marks_obtained: r.marks_obtained,
        is_absent: isAbsent,
        question_scores: qScores,
        remarks: note
      };
    });
  }

  /**
   * Bulk-saves marks, presence status, and question scores within a transaction.
   * 
   * @calledBy ExamController.saveScores() (controllers/examController.js)
   * @route POST /api/v1/exams/:id/scores (routes/exams.js)
   * @param {number|string} examId Exam ID
   * @param {Array<Object>} scores Array of student score objects
   * @param {Object} meta Exam question/instruction metadata
   * @param {number} teacherUserId Calling user ID
   */
  async saveScores(examId, scores, meta, teacherUserId) {
    await withTransaction(async (conn) => {
      if (meta && typeof meta === 'object') {
        await conn.execute(
          `UPDATE assessments SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [JSON.stringify(meta), examId]
        );
      }

      for (const s of scores) {
        const isAbsent = Boolean(s.is_absent || s.status === 'ABSENT' || String(s.marks_obtained).toUpperCase() === 'AB');
        const finalMarks = isAbsent ? 0 : (s.marks_obtained !== undefined && s.marks_obtained !== null && s.marks_obtained !== '' ? Number(s.marks_obtained) : null);
        const statusVal = isAbsent ? 'ABSENT' : (finalMarks !== null ? 'GRADED' : 'SUBMITTED');

        const feedbackPayload = JSON.stringify({
          is_absent: isAbsent,
          question_scores: s.question_scores || null,
          remarks: s.remarks || null
        });

        await conn.execute(
          `INSERT INTO assessment_submissions (assessment_id, student_id, marks_obtained, feedback, graded_by, status)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE marks_obtained = VALUES(marks_obtained), feedback = VALUES(feedback),
             graded_by = VALUES(graded_by), status = VALUES(status), updated_at = CURRENT_TIMESTAMP`,
          [examId, s.student_id, finalMarks, feedbackPayload, teacherUserId, statusVal]
        );
      }
    });
  }

  /**
   * Retrieves exam, subject, department, and academic year details for Excel export.
   * 
   * @calledBy ExamController.exportExcel() (controllers/examController.js)
   * @calledBy ExamController.exportCustomExcel() (controllers/examController.js)
   * @route GET/POST /api/v1/exams/:id/export/excel (routes/exams.js)
   * @param {number|string} id Exam ID
   * @returns {Promise<Object|null>} Detailed metadata
   */
  async getExportDetails(id) {
    const rows = await query(
      `SELECT ex.*, sub.name as subject_name, sub.code as subject_code,
              d.name as department_name, d.code as department_code,
              ay.label as academic_year_label
       FROM exams ex
       JOIN subjects sub ON sub.id = ex.subject_id
       JOIN departments d ON d.id = ex.department_id
       JOIN academic_years ay ON ay.id = ex.academic_year_id
       WHERE ex.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Retrieves official institution name from system settings.
   * 
   * @calledBy ExamController.exportExcel() (controllers/examController.js)
   * @calledBy ExamController.exportCustomExcel() (controllers/examController.js)
   * @route GET/POST /api/v1/exams/:id/export/excel (routes/exams.js)
   * @returns {Promise<string>} Institution name
   */
  async getInstitutionName() {
    const rows = await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'institution_name'`);
    return rows[0]?.setting_value || 'Uttarakhand Government Institute of Polytechnic, Nainital';
  }

  /**
   * Deletes a test/exam and its recorded student scores.
   * 
   * @calledBy ExamController.deleteExam() (controllers/examController.js)
   * @route DELETE /api/v1/exams/:id (routes/exams.js)
   * @param {number|string} id Exam ID
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteExam(id) {
    await query('DELETE FROM assessment_submissions WHERE assessment_id = ?', [id]);
    const res = await query('DELETE FROM assessments WHERE id = ?', [id]);
    return res.affectedRows > 0 || res.changes > 0;
  }
}

module.exports = new ExamModel();
