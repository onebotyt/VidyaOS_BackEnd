/**
 * Assessment Process Model — Data access layer for 13 Direct & Indirect Assessment artifacts.
 * Location: src/models/assessmentProcessModel.js
 * VidyaOS Institutional Campus Operating System
 */

const { query } = require('../config/db');

const ASSESSMENT_PROCESS_ITEMS = [
  // A. Direct Assessment (8 items)
  {
    key: 'internal_examinations',
    num: 1,
    title: 'Internal Examinations',
    section: 'A. Direct Assessment',
    section_code: 'DIRECT',
    category: 'direct_assessment',
    category_label: 'Direct Assessment',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload internal examination question papers, marksheets, and assessment reports.'
  },
  {
    key: 'class_tests',
    num: 2,
    title: 'Class Tests',
    section: 'A. Direct Assessment',
    section_code: 'DIRECT',
    category: 'direct_assessment',
    category_label: 'Direct Assessment',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload class test question papers, marksheets, and evaluation records.'
  },
  {
    key: 'assignments_records',
    num: 3,
    title: 'Assignments',
    section: 'A. Direct Assessment',
    section_code: 'DIRECT',
    category: 'direct_assessment',
    category_label: 'Direct Assessment',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload assignment questions, submitted work samples, and evaluation reports.'
  },
  {
    key: 'laboratory_performance',
    num: 4,
    title: 'Laboratory Performance',
    section: 'A. Direct Assessment',
    section_code: 'DIRECT',
    category: 'direct_assessment',
    category_label: 'Direct Assessment',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload laboratory performance assessment sheets and evaluation records.'
  },
  {
    key: 'practical_examinations',
    num: 5,
    title: 'Practical Examinations',
    section: 'A. Direct Assessment',
    section_code: 'DIRECT',
    category: 'direct_assessment',
    category_label: 'Direct Assessment',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload practical examination records, marksheets, and evaluation reports.'
  },
  {
    key: 'mini_projects',
    num: 6,
    title: 'Mini Projects',
    section: 'A. Direct Assessment',
    section_code: 'DIRECT',
    category: 'direct_assessment',
    category_label: 'Direct Assessment',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload mini-project reports, evaluation sheets, and assessment records.'
  },
  {
    key: 'end_sem_examinations',
    num: 7,
    title: 'End-Semester Examinations',
    section: 'A. Direct Assessment',
    section_code: 'DIRECT',
    category: 'direct_assessment',
    category_label: 'Direct Assessment',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload end-semester examination marksheets and assessment reports.'
  },
  {
    key: 'co_mapping',
    num: 8,
    title: 'Course Outcome (CO) Mapping',
    section: 'A. Direct Assessment',
    section_code: 'DIRECT',
    category: 'direct_assessment',
    category_label: 'Direct Assessment',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Map each assessment component with its corresponding Course Outcomes (COs). Upload CO mapping documents, attainment calculations, and supporting reports.'
  },

  // B. Indirect Assessment (5 items)
  {
    key: 'course_exit_survey',
    num: 9,
    title: 'Course Exit Survey',
    section: 'B. Indirect Assessment',
    section_code: 'INDIRECT',
    category: 'indirect_assessment',
    category_label: 'Indirect Assessment',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload course exit survey forms, responses, and analysis reports.'
  },
  {
    key: 'student_feedback',
    num: 10,
    title: 'Student Feedback',
    section: 'B. Indirect Assessment',
    section_code: 'INDIRECT',
    category: 'indirect_assessment',
    category_label: 'Indirect Assessment',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload student feedback forms and feedback analysis reports.'
  },
  {
    key: 'alumni_feedback',
    num: 11,
    title: 'Alumni Feedback',
    section: 'B. Indirect Assessment',
    section_code: 'INDIRECT',
    category: 'indirect_assessment',
    category_label: 'Indirect Assessment',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload alumni feedback forms, responses, and analysis reports.'
  },
  {
    key: 'employer_feedback',
    num: 12,
    title: 'Employer Feedback',
    section: 'B. Indirect Assessment',
    section_code: 'INDIRECT',
    category: 'indirect_assessment',
    category_label: 'Indirect Assessment',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload employer feedback forms and analysis reports.'
  },
  {
    key: 'graduate_exit_survey',
    num: 13,
    title: 'Graduate Exit Survey',
    section: 'B. Indirect Assessment',
    section_code: 'INDIRECT',
    category: 'indirect_assessment',
    category_label: 'Indirect Assessment',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload graduate exit survey forms and analysis reports.'
  }
];

class AssessmentProcessModel {
  /**
   * Returns standard 13 items definitions array.
   */
  getItemsDefinition() {
    return ASSESSMENT_PROCESS_ITEMS;
  }

  /**
   * Retrieves teaching group metadata including department, faculty, register, and academic year.
   */
  async getGroupDetails(groupId) {
    const rows = await query(
      `SELECT tg.*, 
              d.name as department_name, d.code as department_code, d.id as department_id,
              t.full_name as teacher_name, t.employee_id as teacher_code,
              ay.label as academic_year_label,
              ar.id as register_id, ar.name as register_name
       FROM teaching_groups tg
       LEFT JOIN teachers t ON tg.teacher_id = t.id
       LEFT JOIN departments d ON t.department_id = d.id
       LEFT JOIN academic_years ay ON tg.academic_year_id = ay.id
       LEFT JOIN attendance_registers ar ON ar.group_id = tg.id
       WHERE tg.id = ?`,
      [groupId]
    );
    return rows[0] || null;
  }

  /**
   * Finds existing assessment process dossier or provisions a new one for a group/subject.
   */
  async getOrCreateAssessmentFile({ groupId, subjectId, teacherId, academicYearId, departmentId, semester }) {
    let where = 'WHERE 1=1';
    const params = [];
    if (groupId) {
      where += ' AND teaching_group_id = ?';
      params.push(groupId);
    } else if (subjectId) {
      where += ' AND subject_id = ? AND teacher_id = ?';
      params.push(subjectId, teacherId);
    }

    const existing = await query(`SELECT * FROM assessment_process_files ${where} LIMIT 1`, params);
    if (existing.length > 0) {
      const row = existing[0];
      return { ...row, group_id: row.teaching_group_id };
    }

    let targetTeacherId = teacherId;
    let targetDeptId = departmentId;
    let targetAyId = academicYearId;
    let targetSemester = semester || 1;

    if (groupId) {
      const group = await this.getGroupDetails(groupId);
      if (group) {
        if (!targetTeacherId) targetTeacherId = group.teacher_id;
        if (!targetDeptId) targetDeptId = group.department_id;
        if (!targetAyId) targetAyId = group.academic_year_id;
        if (group.semester) targetSemester = group.semester;
      }
    }

    if (!targetTeacherId) {
      const tRow = await query('SELECT id FROM teachers ORDER BY id ASC LIMIT 1');
      targetTeacherId = tRow[0]?.id || 1;
    }
    if (!targetDeptId) {
      const dRow = await query('SELECT id FROM departments ORDER BY id ASC LIMIT 1');
      targetDeptId = dRow[0]?.id || 1;
    }
    if (!targetAyId) {
      const ayRow = await query('SELECT id FROM academic_years ORDER BY id ASC LIMIT 1');
      targetAyId = ayRow[0]?.id || null;
    }

    const ins = await query(
      `INSERT INTO assessment_process_files (teaching_group_id, subject_id, teacher_id, department_id, semester, academic_year_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS')`,
      [groupId || null, subjectId || null, targetTeacherId, targetDeptId, targetSemester, targetAyId]
    );
    const newId = ins.insertId || ins.lastInsertRowid;
    const created = await query(`SELECT * FROM assessment_process_files WHERE id = ?`, [newId]);
    const row = created[0];
    return { ...row, group_id: row.teaching_group_id };
  }

  /**
   * Retrieves all document artifacts uploaded to an assessment dossier.
   */
  async getDocuments(assessmentFileId) {
    return await query(`SELECT * FROM assessment_process_documents WHERE assessment_file_id = ?`, [assessmentFileId]);
  }

  /**
   * Retrieves single assessment process file row by ID.
   */
  async getById(id) {
    const rows = await query(`SELECT * FROM assessment_process_files WHERE id = ?`, [id]);
    return rows[0] || null;
  }

  /**
   * Upserts a document artifact for an item key and increments version.
   */
  async upsertDocument({ assessmentFileId, itemKey, docTitle, filePath, fileName, fileSize, mimeType, userId, notes }) {
    const existing = await query(
      `SELECT id, file_path, version FROM assessment_process_documents WHERE assessment_file_id = ? AND item_key = ?`,
      [assessmentFileId, itemKey]
    );

    let docId = null;
    let oldFilePath = null;
    if (existing && existing.length > 0) {
      const prev = existing[0];
      oldFilePath = prev.file_path;
      await query(
        `UPDATE assessment_process_documents 
         SET title = ?, file_path = ?, file_name = ?, file_size = ?, mime_type = ?,
             version = version + 1, uploaded_by = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [docTitle, filePath, fileName, fileSize, mimeType, userId, notes || null, prev.id]
      );
      docId = prev.id;
    } else {
      const ins = await query(
        `INSERT INTO assessment_process_documents 
         (assessment_file_id, item_key, title, file_path, file_name, file_size, mime_type, uploaded_by, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [assessmentFileId, itemKey, docTitle, filePath, fileName, fileSize, mimeType, userId, notes || null]
      );
      docId = ins.insertId || ins.lastInsertRowid;
    }

    await query(`UPDATE assessment_process_files SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [assessmentFileId]);
    const updated = await query(`SELECT * FROM assessment_process_documents WHERE id = ?`, [docId]);
    return { doc: updated[0], oldFilePath };
  }

  /**
   * Deletes a document artifact associated with an item key.
   */
  async deleteDocument(assessmentFileId, itemKey) {
    const docRows = await query(
      `SELECT * FROM assessment_process_documents WHERE assessment_file_id = ? AND item_key = ?`,
      [assessmentFileId, itemKey]
    );
    if (docRows && docRows.length > 0) {
      await query(`DELETE FROM assessment_process_documents WHERE id = ?`, [docRows[0].id]);
      await query(`UPDATE assessment_process_files SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [assessmentFileId]);
      return docRows[0];
    }
    return null;
  }

  /**
   * HOD/Admin audit verification and status update.
   */
  async auditAssessment(assessmentFileId, { status, hodRemarks, auditorId }) {
    await query(
      `UPDATE assessment_process_files 
       SET status = ?, hod_remarks = ?, audited_by = ?, audited_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, hodRemarks || null, auditorId, assessmentFileId]
    );
  }
}

module.exports = new AssessmentProcessModel();
