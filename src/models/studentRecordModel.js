/**
 * Student Record Model
 * Provides queries and aggregations for the Student Records System:
 * - Filter cohorts by Session, Year, Semester, and Dynamic Batch
 * - Full student demographic and academic dossier (Roll, Registration, Enrollment, Profile, Tests, Assignments, Attendance, Documents)
 * - Decoupled historical persistence (remains permanently accessible across classroom deletions)
 * - Bulk cohort exports (Excel, DOC, PDF payloads)
 */

const { query } = require('../config/db');

class StudentRecordModel {
  /**
   * Retrieves available filter criteria for a department (Sessions, Years, Semesters, Batches)
   * @param {number} deptId Department ID
   * @returns {Promise<Object>} Filter options
   */
  static async getFilterOptions(deptId) {
    // 1. Academic Sessions from academic_years (using 'label' column)
    const sessions = await query(
      `SELECT id, label, is_current 
       FROM academic_years 
       ORDER BY is_current DESC, start_date DESC`
    );

    // 2. Department details (degree duration)
    const deptRows = await query(
      `SELECT id, name, code, COALESCE(degree_duration_years, 3) as duration 
       FROM departments WHERE id = ? LIMIT 1`,
      [deptId]
    );
    const duration = deptRows[0]?.duration || 3;

    const years = [];
    for (let y = 1; y <= duration; y++) {
      years.push(y);
    }

    const semesters = [];
    for (let s = 1; s <= duration * 2; s++) {
      semesters.push(s);
    }

    // 3. Batches derived from admission years in students enrolled in this department
    const batchRows = await query(
      `SELECT DISTINCT 
         st.admission_year,
         COALESCE(st.graduation_year, st.admission_year + ?) as passing_year
       FROM students st
       JOIN enrollments e ON e.student_id = st.id
       WHERE e.department_id = ? AND st.admission_year IS NOT NULL AND st.admission_year > 1990
       ORDER BY st.admission_year DESC`,
      [duration, deptId]
    );

    const batches = batchRows.map(b => ({
      admission_year: b.admission_year,
      passing_year: b.passing_year,
      label: `Batch ${b.admission_year} - ${b.passing_year} (Passout ${b.passing_year})`
    }));

    return {
      sessions: sessions.map(s => ({ id: s.id, name: s.label, is_current: s.is_current })),
      years,
      semesters,
      batches,
      degree_duration: duration
    };
  }

  /**
   * Retrieves list of students matching filter parameters
   * @param {Object} params Filter criteria
   * @returns {Promise<Array>} List of students with aggregated attendance and academic summary
   */
  static async getStudents({ deptId, academicYearId, year, semester, batch, search, status = 'active', limit = 100, offset = 0 }) {
    let sql = `
      SELECT 
        st.id,
        st.user_id,
        st.full_name,
        COALESCE(st.class_roll_no, e.class_roll_no) as class_roll_no,
        st.official_enrollment_no,
        st.registration_no,
        e.semester as current_semester,
        e.year as current_year,
        e.department_id,
        e.academic_year_id,
        st.admission_year,
        COALESCE(st.graduation_year, st.admission_year + COALESCE(d.degree_duration_years, 3)) as passing_year,
        CONCAT(st.admission_year, ' - ', COALESCE(st.graduation_year, st.admission_year + COALESCE(d.degree_duration_years, 3))) as batch_label,
        st.gender,
        st.category,
        st.father_name,
        st.mother_name,
        st.phone,
        st.dob,
        st.address,
        st.aadhar_number,
        COALESCE(e.status, 'ENROLLED') as status,
        st.deleted_at,
        u.email,
        d.name as department_name,
        d.code as department_code,
        (
          SELECT COUNT(ra.id) 
          FROM register_attendance ra 
          WHERE ra.student_id = st.id AND ra.attendance_status IN ('PRESENT', 'LATE')
        ) as total_attended_sessions,
        (
          SELECT COUNT(ra.id) 
          FROM register_attendance ra 
          WHERE ra.student_id = st.id
        ) as total_attendance_sessions,
        (
          SELECT COUNT(sub.id) 
          FROM assessment_submissions sub 
          WHERE sub.student_id = st.id
        ) as total_submissions,
        (
          SELECT COUNT(sd.id) 
          FROM student_documents sd 
          WHERE sd.student_id = st.id
        ) as document_count
      FROM students st
      JOIN users u ON st.user_id = u.id
      JOIN enrollments e ON e.student_id = st.id
      JOIN departments d ON e.department_id = d.id
      WHERE e.department_id = ?
    `;

    const params = [deptId];

    // Status filter
    if (status === 'trash' || status === 'trashed') {
      sql += ` AND st.deleted_at IS NOT NULL`;
    } else if (status === 'all') {
      sql += ` AND st.deleted_at IS NULL`;
    } else if (status === 'inactive') {
      sql += ` AND st.deleted_at IS NULL AND e.status IN ('INACTIVE', 'TRANSFERRED', 'WITHDRAWN')`;
    } else if (status === 'transferred') {
      sql += ` AND st.deleted_at IS NULL AND e.status = 'TRANSFERRED'`;
    } else if (status === 'withdrawn') {
      sql += ` AND st.deleted_at IS NULL AND e.status = 'WITHDRAWN'`;
    } else {
      // default 'active'
      sql += ` AND st.deleted_at IS NULL AND e.status NOT IN ('WITHDRAWN', 'TRANSFERRED', 'INACTIVE')`;
    }

    // Academic Year / Session filter
    if (academicYearId) {
      sql += ` AND e.academic_year_id = ?`;
      params.push(Number(academicYearId));
    }

    // Year filter
    if (year) {
      sql += ` AND e.year = ?`;
      params.push(Number(year));
    }

    // Semester filter
    if (semester) {
      sql += ` AND e.semester = ?`;
      params.push(Number(semester));
    }

    // Batch filter
    if (batch) {
      const matchYear = parseInt(batch, 10);
      if (!isNaN(matchYear)) {
        sql += ` AND (st.admission_year = ? OR (st.admission_year + COALESCE(d.degree_duration_years, 3)) = ?)`;
        params.push(matchYear, matchYear);
      }
    }

    // Search query
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      sql += ` AND (st.full_name LIKE ? OR st.official_enrollment_no LIKE ? OR st.registration_no LIKE ? OR u.email LIKE ?)`;
      params.push(term, term, term, term);
    }

    sql += ` ORDER BY e.year ASC, e.semester ASC, COALESCE(st.class_roll_no, e.class_roll_no) ASC, st.full_name ASC LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    const rows = await query(sql, params);

    return rows.map(r => {
      const total = Number(r.total_attendance_sessions) || 0;
      const attended = Number(r.total_attended_sessions) || 0;
      const pct = total > 0 ? Math.round((attended * 100) / total) : 100;
      return {
        ...r,
        attendance_percentage: pct
      };
    });
  }

  /**
   * Retrieves a student's complete academic and demographic dossier across all semesters
   * @param {number} studentId Student ID
   * @param {number} deptId Department ID
   * @returns {Promise<Object>} Full dossier
   */
  static async getStudentFullDossier(studentId, deptId = null) {
    // 1. Demographic profile
    let sql = `SELECT 
        st.id,
        st.user_id,
        st.full_name,
        COALESCE(st.class_roll_no, e.class_roll_no) as class_roll_no,
        st.official_enrollment_no,
        st.registration_no,
        e.semester as current_semester,
        e.year as current_year,
        e.department_id,
        e.academic_year_id,
        st.admission_year,
        COALESCE(st.graduation_year, st.admission_year + COALESCE(d.degree_duration_years, 3)) as passing_year,
        CONCAT(st.admission_year, ' - ', COALESCE(st.graduation_year, st.admission_year + COALESCE(d.degree_duration_years, 3))) as batch_label,
        st.gender,
        st.category,
        st.father_name,
        st.mother_name,
        st.phone,
        st.dob,
        st.address,
        st.aadhar_number,
        COALESCE(e.status, 'ENROLLED') as status,
        u.email,
        d.name as department_name,
        d.code as department_code
      FROM students st
      JOIN users u ON st.user_id = u.id
      JOIN enrollments e ON e.student_id = st.id
      JOIN departments d ON e.department_id = d.id
      WHERE st.id = ?`;
    const params = [studentId];
    if (deptId) {
      sql += ` AND e.department_id = ?`;
      params.push(deptId);
    }
    sql += ` LIMIT 1`;
    const studentRows = await query(sql, params);

    if (!studentRows || studentRows.length === 0) {
      return null;
    }
    const profile = studentRows[0];

    // 2. Tests, exams, lab practicals, and coursework assignments
    const assessments = await query(
      `SELECT 
        a.id as assessment_id,
        a.title,
        a.type,
        a.max_marks,
        a.semester,
        a.year,
        sub.marks_obtained,
        COALESCE(sub.status, 'PENDING') as submission_status,
        sub.submitted_at,
        sub.file_path,
        sub.original_filename,
        sub.feedback,
        COALESCE(tg.subject_name, s.name, 'Department Subject') as subject_name,
        COALESCE(tg.subject_code, s.code, 'IT500') as subject_code,
        COALESCE(tg.subject_short_name, s.code, s.name, 'DBMS') as subject_short_name
      FROM assessments a
      LEFT JOIN assessment_submissions sub ON a.id = sub.assessment_id AND sub.student_id = ?
      LEFT JOIN subjects s ON a.subject_id = s.id
      LEFT JOIN teaching_groups tg ON a.group_id = tg.id
      WHERE (sub.student_id = ? OR (a.department_id = ? AND a.semester = ?))
      ORDER BY a.semester ASC, a.created_at DESC`,
      [studentId, studentId, profile.department_id || deptId || 2, profile.current_semester || 5]
    );

    // 3. Attendance broken down by semester & subject
    const attendanceBySemester = await query(
      `SELECT 
        s.semester,
        sub.name as subject_name,
        sub.code as subject_code,
        COUNT(ra.id) as total_sessions,
        SUM(CASE WHEN ra.attendance_status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) as attended_sessions
      FROM register_attendance ra
      JOIN attendance_sessions s ON ra.session_id = s.id
      LEFT JOIN subjects sub ON s.subject_id = sub.id
      WHERE ra.student_id = ?
      GROUP BY s.semester, sub.name, sub.code
      ORDER BY s.semester ASC, sub.name ASC`,
      [studentId]
    );

    // 3b. Detailed daily attendance sessions for Day 1-31 monthly matrix ledger
    const attendanceSessions = await query(
      `SELECT 
        s.id as session_id,
        s.semester,
        s.session_date,
        s.session_type,
        s.period_number,
        COALESCE(sub.name, 'Department Subject') as subject_name,
        COALESCE(sub.code, 'IT500') as subject_code,
        ra.attendance_status
      FROM register_attendance ra
      JOIN attendance_sessions s ON ra.session_id = s.id
      LEFT JOIN subjects sub ON s.subject_id = sub.id
      WHERE ra.student_id = ?
      ORDER BY s.session_date ASC, s.period_number ASC`,
      [studentId]
    );

    // 4. Student Documents
    const documents = await query(
      `SELECT 
        id,
        title,
        document_type,
        file_path,
        file_name,
        file_size,
        mime_type,
        uploader_name,
        notes,
        created_at
      FROM student_documents
      WHERE student_id = ?
      ORDER BY created_at DESC`,
      [studentId]
    );

    return {
      profile,
      assessments,
      attendance: attendanceBySemester,
      attendanceSessions,
      documents
    };
  }

  /**
   * Fetches full cohort export dataset (used by Excel / PDF / Word export generators)
   * @param {Object} params Filter options
   * @returns {Promise<Array>} Complete cohort records
   */
  static async getCohortExportData({ deptId, academicYearId, year, semester, batch }) {
    const students = await this.getStudents({
      deptId,
      academicYearId,
      year,
      semester,
      batch,
      status: 'active',
      limit: 1000,
      offset: 0
    });

    return students;
  }
}

module.exports = StudentRecordModel;
