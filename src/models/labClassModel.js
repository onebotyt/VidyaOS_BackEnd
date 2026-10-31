/**
 * Laboratory Class Model — Data access layer for 7 Laboratory Class Academic Dossier artifacts.
 * Location: src/models/labClassModel.js
 */

const { query } = require('../config/db');

const LAB_CLASS_ITEMS = [
  {
    key: 'lab_attendance',
    num: 1,
    title: 'Laboratory Attendance',
    type: 'Hybrid (Live + PDF)',
    category: 'attendance',
    reqType: 'hybrid',
    can_upload: true,
    desc: 'Lab batch turnout, attendance matrix ledger, and session-wise student practical attendance.'
  },
  {
    key: 'lab_manuals',
    num: 2,
    title: 'Laboratory Manuals',
    type: 'PDF',
    category: 'attendance',
    reqType: 'upload',
    can_upload: true,
    desc: 'Official laboratory manuals, experiment list, apparatus specifications, and safety precautions.'
  },
  {
    key: 'job_cards_experiment_sheets',
    num: 3,
    title: 'Job Cards / Experiment Sheets',
    type: 'PDF',
    category: 'experimentation',
    reqType: 'upload',
    can_upload: true,
    desc: 'Standard student job cards, workshop instruction sheets, and observation data recording templates.'
  },
  {
    key: 'practical_notebooks',
    num: 4,
    title: 'Practical Notebooks',
    type: 'PDF',
    category: 'experimentation',
    reqType: 'upload',
    can_upload: true,
    desc: 'Evaluated sample laboratory write-ups, student experiment records, and signed index sheets.'
  },
  {
    key: 'continuous_lab_assessment',
    num: 5,
    title: 'Continuous Laboratory Assessment',
    type: 'Hybrid (Live + PDF)',
    category: 'assessment',
    reqType: 'hybrid',
    can_upload: true,
    desc: 'Day-to-day practical performance marks, viva-voce rubrics, and continuous assessment registers.'
  },
  {
    key: 'equipment_utilization_records',
    num: 6,
    title: 'Equipment Utilization Records',
    type: 'PDF',
    category: 'assessment',
    reqType: 'upload',
    can_upload: true,
    desc: 'Equipment logbook, machine utilization records, workstation allocation, and running hour sheets.'
  },
  {
    key: 'lab_maintenance_records',
    num: 7,
    title: 'Laboratory Maintenance Records',
    type: 'PDF',
    category: 'assessment',
    reqType: 'upload',
    can_upload: true,
    desc: 'Preventive maintenance logs, calibration certificates, breakdown/repair reports, and stock register.'
  }
];

class LabClassModel {
  /**
   * Returns standard 7 items definitions array.
   */
  getItemsDefinition() {
    return LAB_CLASS_ITEMS;
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
   * Finds existing lab class dossier or provisions a new one for a group/subject.
   */
  async getOrCreateLabClass({ groupId, subjectId, teacherId, academicYearId, departmentId, semester }) {
    let where = 'WHERE 1=1';
    const params = [];
    if (groupId) {
      where += ' AND teaching_group_id = ?';
      params.push(groupId);
    } else if (subjectId) {
      where += ' AND subject_id = ? AND teacher_id = ?';
      params.push(subjectId, teacherId);
    }

    const existing = await query(`SELECT * FROM lab_class_files ${where} LIMIT 1`, params);
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
      `INSERT INTO lab_class_files (teaching_group_id, subject_id, teacher_id, department_id, semester, academic_year_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS')`,
      [groupId || null, subjectId || null, teacherId, targetDeptId, semester || 1, targetAyId]
    );
    const newId = ins.insertId || ins.lastInsertRowid;
    const created = await query(`SELECT * FROM lab_class_files WHERE id = ?`, [newId]);
    const row = created[0];
    return { ...row, group_id: row.teaching_group_id };
  }

  /**
   * Retrieves all document artifacts uploaded to a lab class dossier.
   */
  async getDocuments(labClassId) {
    return await query(`SELECT * FROM lab_class_documents WHERE lab_class_id = ?`, [labClassId]);
  }

  /**
   * Computes student roster and attendance summary for teaching group.
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
   * Retrieves assignments / practical tasks linked to group/teacher.
   */
  async getGroupAssignments(group) {
    return await query(
      `SELECT a.id, a.title, a.description, a.due_date, a.max_marks, a.type, a.created_at,
              COUNT(asub.id) as submission_count
       FROM assessments a
       LEFT JOIN assessment_submissions asub ON asub.assessment_id = a.id
       WHERE (a.group_id = ? OR (a.teacher_id = ? AND a.semester = ?))
       GROUP BY a.id, a.title, a.description, a.due_date, a.max_marks, a.type, a.created_at
       ORDER BY a.created_at DESC`,
      [group.id, group.teacher_id, group.semester]
    );
  }

  /**
   * Retrieves single lab class dossier row by ID.
   */
  async getById(id) {
    const rows = await query(`SELECT * FROM lab_class_files WHERE id = ?`, [id]);
    return rows[0] || null;
  }

  /**
   * Upserts a document artifact for an item key and increments version.
   */
  async upsertDocument({ labClassId, itemKey, docTitle, filePath, fileName, fileSize, mimeType, userId, notes }) {
    const existing = await query(
      `SELECT id, file_path, version FROM lab_class_documents WHERE lab_class_id = ? AND item_key = ?`,
      [labClassId, itemKey]
    );

    let docId = null;
    let oldFilePath = null;
    if (existing && existing.length > 0) {
      const prev = existing[0];
      oldFilePath = prev.file_path;
      await query(
        `UPDATE lab_class_documents 
         SET title = ?, file_path = ?, file_name = ?, file_size = ?, mime_type = ?,
             version = version + 1, uploaded_by = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [docTitle, filePath, fileName, fileSize, mimeType, userId, notes || null, prev.id]
      );
      docId = prev.id;
    } else {
      const ins = await query(
        `INSERT INTO lab_class_documents 
         (lab_class_id, item_key, title, file_path, file_name, file_size, mime_type, uploaded_by, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [labClassId, itemKey, docTitle, filePath, fileName, fileSize, mimeType, userId, notes || null]
      );
      docId = ins.insertId || ins.lastInsertRowid;
    }

    await query(`UPDATE lab_class_files SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [labClassId]);
    const updated = await query(`SELECT * FROM lab_class_documents WHERE id = ?`, [docId]);
    return { doc: updated[0], oldFilePath };
  }

  /**
   * Deletes a document artifact associated with an item key.
   */
  async deleteDocument(labClassId, itemKey) {
    const docRows = await query(
      `SELECT * FROM lab_class_documents WHERE lab_class_id = ? AND item_key = ?`,
      [labClassId, itemKey]
    );
    if (docRows && docRows.length > 0) {
      await query(`DELETE FROM lab_class_documents WHERE id = ?`, [docRows[0].id]);
      await query(`UPDATE lab_class_files SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [labClassId]);
      return docRows[0];
    }
    return null;
  }

  /**
   * HOD/Admin review and status update.
   */
  async auditLabClass(labClassId, { status, hodRemarks, auditorId }) {
    await query(
      `UPDATE lab_class_files 
       SET status = ?, hod_remarks = ?, audited_by = ?, audited_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, hodRemarks || null, auditorId, labClassId]
    );
  }
}

module.exports = new LabClassModel();

