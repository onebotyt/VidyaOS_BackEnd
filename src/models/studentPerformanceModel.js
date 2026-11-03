/**
 * Student Performance Monitoring Model — Data access layer for 8 Student Performance Monitoring artifacts.
 * Location: src/models/studentPerformanceModel.js
 * VidyaOS Institutional Campus Operating System
 */

const { query } = require('../config/db');

const PERFORMANCE_MONITORING_ITEMS = [
  {
    key: 'identify_advanced_learners',
    num: 1,
    title: 'Identify Advanced Learners',
    section: 'Section 1 – Advanced Learners',
    section_num: 1,
    category: 'advanced_learners',
    category_label: 'Advanced Learners',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload PDF documentation containing the list and academic performance details of advanced learners.'
  },
  {
    key: 'identify_slow_learners',
    num: 2,
    title: 'Identify Slow Learners',
    section: 'Section 2 – Slow Learners',
    section_num: 2,
    category: 'slow_learners',
    category_label: 'Slow Learners',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload PDF documentation containing the list and academic performance details of slow learners.'
  },
  {
    key: 'remedial_classes',
    num: 3,
    title: 'Remedial Classes',
    section: 'Section 3 – Remedial Measures',
    section_num: 3,
    category: 'remedial_measures',
    category_label: 'Remedial Measures',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload attendance records, schedules, and supporting documents.'
  },
  {
    key: 'tutorial_sessions',
    num: 4,
    title: 'Tutorial Sessions',
    section: 'Section 3 – Remedial Measures',
    section_num: 3,
    category: 'remedial_measures',
    category_label: 'Remedial Measures',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload tutorial schedules, participation records, and reports.'
  },
  {
    key: 'extra_assignments',
    num: 5,
    title: 'Extra Assignments',
    section: 'Section 3 – Remedial Measures',
    section_num: 3,
    category: 'remedial_measures',
    category_label: 'Remedial Measures',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload additional assignments and student performance records.'
  },
  {
    key: 'mentoring_counselling',
    num: 6,
    title: 'Mentoring and Counselling',
    section: 'Section 3 – Remedial Measures',
    section_num: 3,
    category: 'remedial_measures',
    category_label: 'Remedial Measures',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload mentoring records and counselling activity reports.'
  },
  {
    key: 'enrichment_programmes',
    num: 7,
    title: 'Enrichment Programmes for Advanced Learners',
    section: 'Section 3 – Remedial Measures',
    section_num: 3,
    category: 'remedial_measures',
    category_label: 'Remedial Measures',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload enrichment activities and supporting evidence.'
  },
  {
    key: 'evidence_of_interventions',
    num: 8,
    title: 'Evidence of Interventions',
    section: 'Section 4 – Evidence of Interventions',
    section_num: 4,
    category: 'evidence',
    category_label: 'Evidence of Interventions',
    type: 'PDF',
    reqType: 'upload',
    can_upload: true,
    desc: 'Upload photographs converted into PDF, activity reports, attendance records, and supporting documentation.'
  }
];

class StudentPerformanceModel {
  /**
   * Returns standard 8 items definitions array.
   */
  getItemsDefinition() {
    return PERFORMANCE_MONITORING_ITEMS;
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
   * Finds existing performance file or provisions a new one for a group/subject.
   */
  async getOrCreatePerformanceFile({ groupId, subjectId, teacherId, academicYearId, departmentId, semester }) {
    let where = 'WHERE 1=1';
    const params = [];
    if (groupId) {
      where += ' AND teaching_group_id = ?';
      params.push(groupId);
    } else if (subjectId) {
      where += ' AND subject_id = ? AND teacher_id = ?';
      params.push(subjectId, teacherId);
    }

    const existing = await query(`SELECT * FROM student_performance_files ${where} LIMIT 1`, params);
    if (existing.length > 0) {
      const row = existing[0];
      return { ...row, group_id: row.teaching_group_id };
    }

    let targetDeptId = departmentId;
    if (!targetDeptId) {
      const dRow = await query('SELECT id FROM departments ORDER BY id ASC LIMIT 1');
      targetDeptId = dRow[0]?.id || null;
    }
    let targetAyId = academicYearId;
    if (!targetAyId) {
      const ayRow = await query('SELECT id FROM academic_years ORDER BY id ASC LIMIT 1');
      targetAyId = ayRow[0]?.id || null;
    }

    const ins = await query(
      `INSERT INTO student_performance_files (teaching_group_id, subject_id, teacher_id, department_id, semester, academic_year_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS')`,
      [groupId || null, subjectId || null, teacherId, targetDeptId, semester || 1, targetAyId]
    );
    const newId = ins.insertId || ins.lastInsertRowid;
    const created = await query(`SELECT * FROM student_performance_files WHERE id = ?`, [newId]);
    const row = created[0];
    return { ...row, group_id: row.teaching_group_id };
  }

  /**
   * Retrieves all document artifacts uploaded to a performance dossier.
   */
  async getDocuments(performanceFileId) {
    return await query(`SELECT * FROM student_performance_documents WHERE performance_file_id = ?`, [performanceFileId]);
  }

  /**
   * Retrieves single performance monitoring file row by ID.
   */
  async getById(id) {
    const rows = await query(`SELECT * FROM student_performance_files WHERE id = ?`, [id]);
    return rows[0] || null;
  }

  /**
   * Upserts a document artifact for an item key and increments version.
   */
  async upsertDocument({ performanceFileId, itemKey, docTitle, filePath, fileName, fileSize, mimeType, userId, notes }) {
    const existing = await query(
      `SELECT id, file_path, version FROM student_performance_documents WHERE performance_file_id = ? AND item_key = ?`,
      [performanceFileId, itemKey]
    );

    let docId = null;
    let oldFilePath = null;
    if (existing && existing.length > 0) {
      const prev = existing[0];
      oldFilePath = prev.file_path;
      await query(
        `UPDATE student_performance_documents 
         SET title = ?, file_path = ?, file_name = ?, file_size = ?, mime_type = ?,
             version = version + 1, uploaded_by = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [docTitle, filePath, fileName, fileSize, mimeType, userId, notes || null, prev.id]
      );
      docId = prev.id;
    } else {
      const ins = await query(
        `INSERT INTO student_performance_documents 
         (performance_file_id, item_key, title, file_path, file_name, file_size, mime_type, uploaded_by, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [performanceFileId, itemKey, docTitle, filePath, fileName, fileSize, mimeType, userId, notes || null]
      );
      docId = ins.insertId || ins.lastInsertRowid;
    }

    await query(`UPDATE student_performance_files SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [performanceFileId]);
    const updated = await query(`SELECT * FROM student_performance_documents WHERE id = ?`, [docId]);
    return { doc: updated[0], oldFilePath };
  }

  /**
   * Deletes a document artifact associated with an item key.
   */
  async deleteDocument(performanceFileId, itemKey) {
    const docRows = await query(
      `SELECT * FROM student_performance_documents WHERE performance_file_id = ? AND item_key = ?`,
      [performanceFileId, itemKey]
    );
    if (docRows && docRows.length > 0) {
      await query(`DELETE FROM student_performance_documents WHERE id = ?`, [docRows[0].id]);
      await query(`UPDATE student_performance_files SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [performanceFileId]);
      return docRows[0];
    }
    return null;
  }

  /**
   * HOD/Admin audit verification and remarks update.
   */
  async auditPerformance(performanceFileId, { status, hodRemarks, auditorId }) {
    await query(
      `UPDATE student_performance_files 
       SET status = ?, hod_remarks = ?, audited_by = ?, audited_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, hodRemarks || null, auditorId, performanceFileId]
    );
  }
}

module.exports = new StudentPerformanceModel();
