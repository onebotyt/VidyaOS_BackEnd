/**
 * Course File Model — Data access layer for NBA/NAAC 18 Course File artifacts.
 */

const { query } = require('../config/db');

const COURSE_FILE_ITEMS = [
  { key: 'allotment_letter', num: 1, title: 'Course Allotment Letter', type: 'PDF', category: 'curriculum', reqType: 'upload', desc: 'Official appointment / teaching allocation order issued by HOD or Principal' },
  { key: 'approved_syllabus', num: 2, title: 'Approved Syllabus', type: 'PDF', category: 'curriculum', reqType: 'upload', desc: 'University/Board approved curriculum, course code, credit scheme and syllabus' },
  { key: 'course_outcomes', num: 3, title: 'Course Outcomes (COs)', type: 'PDF / Structured', category: 'curriculum', reqType: 'hybrid', desc: 'Defined Course Outcomes (CO1-CO6) with Bloom Taxonomy cognitive domain levels' },
  { key: 'copo_matrix', num: 4, title: 'CO-PO Mapping Matrix', type: 'PDF / Matrix', category: 'curriculum', reqType: 'hybrid', desc: 'Correlation matrix mapping Course Outcomes to Program Outcomes (PO1-PO12, PSO1-PSO2)' },
  { key: 'lesson_plan', num: 5, title: 'Semester Lesson Plan', type: 'PDF', category: 'curriculum', reqType: 'upload', desc: 'Lecture-by-lecture teaching schedule with reference textbooks and delivery modes' },
  { key: 'timetable', num: 6, title: 'Class Timetable', type: 'PDF', category: 'curriculum', reqType: 'upload', desc: 'Faculty individual and departmental classroom/laboratory master timetable' },
  { key: 'student_list', num: 7, title: 'Student List', type: 'Database Auto-Sync', category: 'students', reqType: 'system_sync', desc: 'Verified class roll sheet roster from VidyaOS student lifecycle engine' },
  { key: 'result_analysis', num: 8, title: 'Previous Semester Result Analysis', type: 'PDF', category: 'assessment', reqType: 'upload', desc: 'Statistical pass percentage analysis and grade distribution of prior cohort' },
  { key: 'advanced_learners', num: 9, title: 'List of Advanced Learners & Action Taken', type: 'Auto-Filter / PDF', category: 'students', reqType: 'hybrid', desc: 'Students with >80% turnout / top test grades, with special mentoring activities' },
  { key: 'slow_learners', num: 10, title: 'List of Slow Learners & Remedial Measures', type: 'Auto-Filter / PDF', category: 'students', reqType: 'hybrid', desc: 'Students with <75% attendance / low test scores with remedial class records' },
  { key: 'academic_calendar', num: 11, title: 'Academic Calendar', type: 'PDF', category: 'curriculum', reqType: 'upload', desc: 'Institutional approved semester schedule with working days, holidays, exam weeks' },
  { key: 'internal_assessment_plan', num: 12, title: 'Internal Assessment Plan', type: 'Evaluation Scheme / PDF', category: 'assessment', reqType: 'hybrid', desc: 'Distribution of sessional marks, assignments, practicals, class tests' },
  { key: 'laboratory_plan', num: 13, title: 'Laboratory Plan', type: 'PDF', category: 'curriculum', reqType: 'upload', desc: 'List of standard experiments, lab manual, apparatus specifications, rubrics' },
  { key: 'assignment_schedule', num: 14, title: 'Assignment & Tutorial Schedule', type: 'Auto-Sync / PDF', category: 'assessment', reqType: 'hybrid', desc: 'All assignments issued via VidyaOS with problem statements and submission dates' },
  { key: 'sample_question_papers', num: 15, title: 'Sample Question Papers with CO Mapping', type: 'PDF', category: 'assessment', reqType: 'upload', desc: 'Unit tests, mid-term question papers with marked Bloom Taxonomy levels & COs' },
  { key: 'continuous_assessment_records', num: 16, title: 'Continuous Assessment Records', type: 'Register Summary / PDF', category: 'assessment', reqType: 'hybrid', desc: 'Day-by-day attendance sheets & Class Test Marksheet rosters' },
  { key: 'co_attainment', num: 17, title: 'Course Outcome Attainment Calculations', type: 'Attainment Sheet / PDF', category: 'assessment', reqType: 'hybrid', desc: 'Direct (Internal + External exams) & indirect assessment CO attainment percentages' },
  { key: 'corrective_action_reports', num: 18, title: 'Corrective Action Reports', type: 'PDF', category: 'review', reqType: 'upload', desc: 'Action taken report (ATR) on gaps identified in student feedback & result analysis' }
];

class CourseFileModel {
  /**
   * Returns standard NBA 18-item definitions array.
   * 
   * @calledBy CourseFileController.getDefinitions() (controllers/courseFileController.js)
   * @calledBy CourseFileController.getCourseFile() (controllers/courseFileController.js)
   * @route GET /api/v1/course-files/definitions, GET /api/v1/course-files (routes/courseFile.js)
   * @returns {Array<Object>} 18 artifact definitions
   */
  getItemsDefinition() {
    return COURSE_FILE_ITEMS;
  }

  /**
   * Retrieves teaching group metadata including department, faculty, and academic year.
   * 
   * @calledBy CourseFileController.getCourseFile() (controllers/courseFileController.js)
   * @route GET /api/v1/course-files (routes/courseFile.js)
   * @param {number} groupId Teaching group ID
   * @returns {Promise<Object|null>} Group details or null
   */
  async getGroupDetails(groupId) {
    const rows = await query(
      `SELECT tg.*, 
              d.name as department_name, d.code as department_code, d.id as department_id,
              t.full_name as teacher_name, t.employee_id as teacher_code,
              ay.label as academic_year_label
       FROM teaching_groups tg
       LEFT JOIN teachers t ON tg.teacher_id = t.id
       LEFT JOIN departments d ON t.department_id = d.id
       LEFT JOIN academic_years ay ON tg.academic_year_id = ay.id
       WHERE tg.id = ?`,
      [groupId]
    );
    return rows[0] || null;
  }

  /**
   * Finds existing course file or provisions a new one for a group/subject.
   * 
   * @calledBy CourseFileController.getCourseFile() (controllers/courseFileController.js)
   * @route GET /api/v1/course-files (routes/courseFile.js)
   * @param {Object} params { groupId, subjectId, teacherId, academicYearId }
   * @returns {Promise<Object>} Course file row
   */
  async getOrCreateCourseFile({ groupId, subjectId, teacherId, academicYearId, departmentId, semester }) {
    let where = 'WHERE 1=1';
    const params = [];
    if (groupId) {
      where += ' AND teaching_group_id = ?';
      params.push(groupId);
    } else if (subjectId) {
      where += ' AND subject_id = ? AND teacher_id = ?';
      params.push(subjectId, teacherId);
    }

    const existing = await query(`SELECT * FROM course_files ${where} LIMIT 1`, params);
    if (existing.length > 0) {
      const row = existing[0];
      return { ...row, group_id: row.teaching_group_id };
    }

    const ins = await query(
      `INSERT INTO course_files (teaching_group_id, subject_id, teacher_id, department_id, semester, academic_year_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS')`,
      [groupId || null, subjectId || null, teacherId, departmentId || 1, semester || 1, academicYearId || 1]
    );
    const newId = ins.insertId || ins.lastInsertRowid;
    const created = await query(`SELECT * FROM course_files WHERE id = ?`, [newId]);
    const row = created[0];
    return { ...row, group_id: row.teaching_group_id };
  }

  /**
   * Retrieves all document artifacts uploaded to a course file dossier.
   * 
   * @calledBy CourseFileController.getCourseFile() (controllers/courseFileController.js)
   * @route GET /api/v1/course-files (routes/courseFile.js)
   * @param {number} courseFileId Course file ID
   * @returns {Promise<Array<Object>>} Document rows
   */
  async getDocuments(courseFileId) {
    return await query(`SELECT * FROM course_file_documents WHERE course_file_id = ?`, [courseFileId]);
  }

  /**
   * Computes student roster and attendance percentage stats for teaching group.
   * 
   * @calledBy CourseFileController.getCourseFile() (controllers/courseFileController.js)
   * @route GET /api/v1/course-files (routes/courseFile.js)
   * @param {Object} group Teaching group row
   * @returns {Promise<Array<Object>>} Student roster with attendance percentages
   */
  async getGroupStudentsWithAttendance(group) {
    const stRows = await query(
      `SELECT s.id, s.full_name, s.official_enrollment_no, s.registration_no,
              COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no
       FROM teaching_group_members tgm
       JOIN students s ON tgm.student_id = s.id
       LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
       WHERE tgm.group_id = ? AND (tgm.status = 'ACTIVE' OR tgm.status = 'ENROLLED')
       ORDER BY COALESCE(s.class_roll_no, e.class_roll_no) ASC`,
      [group.id]
    );

    const attRows = await query(
      `SELECT s.id as session_id, ra.student_id, ra.attendance_status
       FROM attendance_sessions s
       JOIN attendance_registers ar ON s.register_id = ar.id
       LEFT JOIN register_attendance ra ON ra.session_id = s.id
       WHERE ar.group_id = ? AND s.state = 'FINALIZED'`,
      [group.id]
    );

    const studentAttMap = {};
    let totalSessions = new Set();
    attRows.forEach(r => {
      totalSessions.add(r.session_id);
      if (!studentAttMap[r.student_id]) studentAttMap[r.student_id] = { attended: 0, total: 0 };
      studentAttMap[r.student_id].total++;
      if (r.attendance_status === 'PRESENT' || r.attendance_status === 'LATE') {
        studentAttMap[r.student_id].attended++;
      }
    });

    const totalConducted = totalSessions.size;

    return stRows.map(st => {
      const att = studentAttMap[st.id] || { attended: 0, total: 0 };
      const total = totalConducted || att.total;
      const attended = att.attended;
      const pct = total > 0 ? Number(((attended / total) * 100).toFixed(1)) : 100;
      return {
        ...st,
        total_sessions: total,
        attended_sessions: attended,
        attendance_pct: pct
      };
    });
  }

  /**
   * Retrieves assignments and class tests linked to group/teacher.
   * 
   * @calledBy CourseFileController.getCourseFile() (controllers/courseFileController.js)
   * @route GET /api/v1/course-files (routes/courseFile.js)
   * @param {Object} group Teaching group row
   * @returns {Promise<Array<Object>>} Assessment rows
   */
  async getGroupAssignments(group) {
    return await query(
      `SELECT a.id, a.title, a.description, a.due_date, a.max_marks, a.type, a.created_at,
              COUNT(asub.id) as submission_count
       FROM assessments a
       LEFT JOIN assessment_submissions asub ON asub.assessment_id = a.id
       WHERE (a.group_id = ? OR (a.teacher_id = ? AND a.semester = ?))
       GROUP BY a.id
       ORDER BY a.created_at DESC`,
      [group.id, group.teacher_id, group.semester]
    );
  }

  /**
   * Retrieves single course file dossier row by ID.
   * 
   * @calledBy CourseFileController.uploadDocument() (controllers/courseFileController.js)
   * @calledBy CourseFileController.deleteDocument() (controllers/courseFileController.js)
   * @calledBy CourseFileController.updateEvaluationScheme() (controllers/courseFileController.js)
   * @calledBy CourseFileController.updateStructuredData() (controllers/courseFileController.js)
   * @route POST/DELETE/PUT /api/v1/course-files/:id/* (routes/courseFile.js)
   * @param {number|string} id Course file ID
   * @returns {Promise<Object|null>} Dossier row or null
   */
  async getById(id) {
    const rows = await query(`SELECT * FROM course_files WHERE id = ?`, [id]);
    return rows[0] || null;
  }

  /**
   * Upserts a document artifact for an item key and increments version.
   * 
   * @calledBy CourseFileController.uploadDocument() (controllers/courseFileController.js)
   * @route POST /api/v1/course-files/:id/documents (routes/courseFile.js)
   * @param {Object} params Document metadata
   * @returns {Promise<{doc: Object, oldFilePath: string|null}>}
   */
  async upsertDocument({ courseFileId, itemKey, docTitle, filePath, fileName, fileSize, mimeType, userId, notes }) {
    const existing = await query(
      `SELECT id, file_path, version FROM course_file_documents WHERE course_file_id = ? AND item_key = ?`,
      [courseFileId, itemKey]
    );

    let docId = null;
    let oldFilePath = null;
    if (existing && existing.length > 0) {
      const prev = existing[0];
      oldFilePath = prev.file_path;
      await query(
        `UPDATE course_file_documents 
         SET title = ?, file_path = ?, file_name = ?, file_size = ?, mime_type = ?,
             version = version + 1, uploaded_by = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [docTitle, filePath, fileName, fileSize, mimeType, userId, notes || null, prev.id]
      );
      docId = prev.id;
    } else {
      const ins = await query(
        `INSERT INTO course_file_documents 
         (course_file_id, item_key, title, file_path, file_name, file_size, mime_type, uploaded_by, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [courseFileId, itemKey, docTitle, filePath, fileName, fileSize, mimeType, userId, notes || null]
      );
      docId = ins.insertId || ins.lastInsertRowid;
    }

    await query(`UPDATE course_files SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [courseFileId]);
    const updated = await query(`SELECT * FROM course_file_documents WHERE id = ?`, [docId]);
    return { doc: updated[0], oldFilePath };
  }

  /**
   * Deletes a document artifact associated with an item key.
   * 
   * @calledBy CourseFileController.deleteDocument() (controllers/courseFileController.js)
   * @route DELETE /api/v1/course-files/:id/documents/:item_key (routes/courseFile.js)
   * @param {number} courseFileId Course file ID
   * @param {string} itemKey Item key
   * @returns {Promise<Object|null>} Deleted document row
   */
  async deleteDocument(courseFileId, itemKey) {
    const docRows = await query(
      `SELECT * FROM course_file_documents WHERE course_file_id = ? AND item_key = ?`,
      [courseFileId, itemKey]
    );
    if (docRows && docRows.length > 0) {
      await query(`DELETE FROM course_file_documents WHERE id = ?`, [docRows[0].id]);
      await query(`UPDATE course_files SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [courseFileId]);
      return docRows[0];
    }
    return null;
  }

  /**
   * Stores internal assessment evaluation criteria JSON.
   * 
   * @calledBy CourseFileController.updateEvaluationScheme() (controllers/courseFileController.js)
   * @route PUT /api/v1/course-files/:id/evaluation-scheme (routes/courseFile.js)
   * @param {number} courseFileId Course file ID
   * @param {Object} scheme Evaluation scheme
   */
  async updateEvaluationScheme(courseFileId, scheme) {
    await query(
      `UPDATE course_files 
       SET evaluation_scheme = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [JSON.stringify(scheme), courseFileId]
    );
  }

  /**
   * Stores COs, CO-PO matrix, and learners structured JSON data.
   * 
   * @calledBy CourseFileController.updateStructuredData() (controllers/courseFileController.js)
   * @route PUT /api/v1/course-files/:id/structured-data (routes/courseFile.js)
   * @param {number} courseFileId Course file ID
   * @param {Object} data { cos, copo_matrix, advanced_learners, slow_learners }
   */
  async updateStructuredData(courseFileId, { cos, copo_matrix, advanced_learners, slow_learners }) {
    const updates = [];
    const params = [];

    if (cos !== undefined) {
      updates.push('cos_json = ?');
      params.push(JSON.stringify(cos));
    }
    if (copo_matrix !== undefined) {
      updates.push('copo_matrix_json = ?');
      params.push(JSON.stringify(copo_matrix));
    }
    if (advanced_learners !== undefined) {
      updates.push('advanced_learners_json = ?');
      params.push(JSON.stringify(advanced_learners));
    }
    if (slow_learners !== undefined) {
      updates.push('slow_learners_json = ?');
      params.push(JSON.stringify(slow_learners));
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(courseFileId);
      await query(`UPDATE course_files SET ${updates.join(', ')} WHERE id = ?`, params);
    }
  }

  /**
   * Records audit status decision (APPROVED / REVISION_REQUESTED) and HOD remarks.
   * 
   * @calledBy CourseFileController.auditCourseFile() (controllers/courseFileController.js)
   * @route POST /api/v1/course-files/:id/audit (routes/courseFile.js)
   * @param {number} courseFileId Course file ID
   * @param {string} status Audit status
   * @param {string} remarks Auditor remarks
   * @param {number} auditorId Auditor user ID
   */
  async auditCourseFile(courseFileId, status, remarks, auditorId) {
    await query(
      `UPDATE course_files 
       SET status = ?, hod_remarks = ?, audited_by = ?, audited_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, remarks || null, auditorId, courseFileId]
    );
  }
}

module.exports = new CourseFileModel();
