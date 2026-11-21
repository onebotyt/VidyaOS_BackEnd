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
   * Parses freeform composite search query into structured tokens:
   * e.g. "1 girdhardhami assinment java" -> { rollNo: 1, workType: 'ASSIGNMENT', subjectKeyword: 'java', nameTokens: ['girdhardhami'], isWorkSearch: true }
   */
  static parseSearchQuery(searchStr) {
    if (!searchStr) return { raw: '', tokens: [], isWorkSearch: false };
    const raw = String(searchStr).trim();
    const tokens = raw.split(/\s+/).filter(Boolean);

    let rollNo = null;
    let workType = null;
    let workTypeKeyword = null;
    let subjectKeyword = null;
    const nameTokens = [];

    for (const token of tokens) {
      const lower = token.toLowerCase();

      // Pure digit token (e.g. 1, 01, 12)
      if (/^\d+$/.test(lower) && rollNo === null && parseInt(lower, 10) < 500) {
        rollNo = parseInt(lower, 10);
        continue;
      }

      // Work type match (including assinment, assignment, lab, test, practical, finaldocs)
      if (/^(assign|assin|asgn|asig|homework)/.test(lower)) {
        workType = 'ASSIGNMENT';
        workTypeKeyword = token;
        continue;
      }
      if (/^(test|exam|quiz|mst|paper|question)/.test(lower)) {
        workType = 'TEST';
        workTypeKeyword = token;
        continue;
      }
      if (/^(lab|practical|journal|manual|experiment)/.test(lower)) {
        workType = 'PRACTICAL';
        workTypeKeyword = token;
        continue;
      }
      if (/^(finaldoc|finaldocs|viva|project|microproject)/.test(lower)) {
        workType = 'FINAL_DOCS';
        workTypeKeyword = token;
        continue;
      }

      // Known subject keywords
      if (/^(java|dbms|database|os|operating|system|systems|cn|network|networks|web|webtech|python|cpp|c|ds|dsa|linux|cloud|algorithms|software)/.test(lower)) {
        subjectKeyword = lower;
        continue;
      }

      // Student name / enrollment / registration token
      nameTokens.push(lower);
    }

    return {
      raw,
      tokens,
      rollNo,
      workType,
      workTypeKeyword,
      subjectKeyword,
      nameTokens,
      isWorkSearch: Boolean(workType || subjectKeyword)
    };
  }

  /**
   * Retrieves specific student work items matching composite search criteria:
   * e.g. Roll 1 + Girdhar Dhami + Assignment + Java
   */
  static async searchStudentWorkItems({ deptId, academicYearId, year, semester, batch, searchParsed }) {
    const { rollNo, workType, subjectKeyword, nameTokens } = searchParsed;

    let sql = `
      SELECT 
        st.id as student_id,
        st.id as id,
        st.user_id,
        st.full_name,
        COALESCE(st.class_roll_no, e.class_roll_no) as class_roll_no,
        st.official_enrollment_no,
        COALESCE(st.ubter_roll_no, st.official_enrollment_no) as ubter_roll_no,
        st.registration_no,
        e.semester as current_semester,
        e.year as current_year,
        e.department_id,
        CONCAT(st.admission_year, ' - ', COALESCE(st.graduation_year, st.admission_year + COALESCE(d.degree_duration_years, 3))) as batch_label,
        a.id as assessment_id,
        a.title as assessment_title,
        a.type as assessment_type,
        a.max_marks,
        a.due_date,
        COALESCE(tg.subject_name, s.name, 'Department Subject') as subject_name,
        COALESCE(tg.subject_code, s.code, 'IT500') as subject_code,
        sub.id as submission_id,
        sub.file_path,
        sub.original_filename,
        sub.marks_obtained,
        COALESCE(sub.status, 'PENDING') as submission_status,
        sub.submitted_at,
        sub.feedback,
        1 as is_work_item
      FROM students st
      JOIN users u ON st.user_id = u.id
      JOIN enrollments e ON e.student_id = st.id
      JOIN departments d ON e.department_id = d.id
      JOIN assessments a ON (a.department_id = e.department_id AND a.semester = e.semester)
      LEFT JOIN subjects s ON a.subject_id = s.id
      LEFT JOIN teaching_groups tg ON a.group_id = tg.id
      LEFT JOIN assessment_submissions sub ON a.id = sub.assessment_id AND sub.student_id = st.id
      WHERE e.department_id = ?
        AND st.deleted_at IS NULL
    `;

    const params = [deptId];

    if (academicYearId) {
      sql += ` AND e.academic_year_id = ?`;
      params.push(Number(academicYearId));
    }
    if (year) {
      sql += ` AND e.year = ?`;
      params.push(Number(year));
    }
    if (semester) {
      sql += ` AND e.semester = ?`;
      params.push(Number(semester));
    }

    // Roll number filter
    if (rollNo !== null) {
      sql += ` AND (COALESCE(st.class_roll_no, e.class_roll_no) = ? OR st.class_roll_no = ?)`;
      params.push(rollNo, rollNo);
    }

    // Name tokens filter (supports no-space names like 'girdhardhami')
    if (nameTokens.length > 0) {
      for (const token of nameTokens) {
        const term = `%${token}%`;
        sql += ` AND (
          LOWER(st.full_name) LIKE ? OR
          REPLACE(LOWER(st.full_name), ' ', '') LIKE ? OR
          LOWER(st.official_enrollment_no) LIKE ? OR
          LOWER(st.registration_no) LIKE ? OR
          LOWER(u.email) LIKE ?
        )`;
        params.push(term, term, term, term, term);
      }
    }

    // Work type filter
    if (workType === 'ASSIGNMENT') {
      sql += ` AND a.type = 'ASSIGNMENT'`;
    } else if (workType === 'TEST') {
      sql += ` AND a.type IN ('TEST', 'CLASS_TEST', 'EXAM')`;
    } else if (workType === 'PRACTICAL') {
      sql += ` AND a.type IN ('PRACTICAL', 'LAB_EXPERIMENT')`;
    } else if (workType === 'FINAL_DOCS') {
      sql += ` AND (a.type = 'FINAL_DOCS' OR a.type = 'ASSIGNMENT')`;
    }

    // Subject keyword filter
    if (subjectKeyword) {
      const sTerm = `%${subjectKeyword}%`;
      sql += ` AND (
        LOWER(s.name) LIKE ? OR
        LOWER(s.code) LIKE ? OR
        LOWER(tg.subject_name) LIKE ? OR
        LOWER(tg.subject_code) LIKE ? OR
        LOWER(a.title) LIKE ?
      )`;
      params.push(sTerm, sTerm, sTerm, sTerm, sTerm);
    }

    sql += ` ORDER BY COALESCE(st.class_roll_no, e.class_roll_no) ASC, a.created_at ASC`;

    return await query(sql, params);
  }

  /**
   * Retrieves list of students matching filter parameters
   * @param {Object} params Filter criteria
   * @returns {Promise<Object>} List of students or matched work items
   */
  static async getStudents({ deptId, academicYearId, year, semester, batch, search, status = 'active', limit = 100, offset = 0 }) {
    const searchParsed = StudentRecordModel.parseSearchQuery(search);

    // If search is a work item query, delegate to searchStudentWorkItems
    if (searchParsed.isWorkSearch) {
      const workItems = await StudentRecordModel.searchStudentWorkItems({
        deptId,
        academicYearId,
        year,
        semester,
        batch,
        searchParsed
      });

      // Extract unique student profiles for Section 1 (Showing students)
      const studentMap = new Map();
      workItems.forEach((w, idx) => {
        if (!studentMap.has(w.student_id)) {
          studentMap.set(w.student_id, {
            id: w.student_id,
            user_id: w.user_id,
            full_name: w.full_name,
            class_roll_no: w.class_roll_no || idx + 1,
            official_enrollment_no: w.official_enrollment_no || '--',
            registration_no: w.registration_no || '',
            current_semester: w.current_semester,
            current_year: w.current_year,
            department_id: w.department_id,
            batch_label: w.batch_label || '--',
            attendance_percentage: 100
          });
        }
      });
      const uniqueStudents = Array.from(studentMap.values());

      if (uniqueStudents.length > 0) {
        try {
          const sIds = uniqueStudents.map(s => s.id);
          const placeholders = sIds.map(() => '?').join(',');
          const attStats = await query(
            `SELECT 
              ra.student_id,
              COUNT(ra.id) as total_attendance_sessions,
              SUM(CASE WHEN ra.attendance_status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) as total_attended_sessions
            FROM register_attendance ra
            WHERE ra.student_id IN (${placeholders})
            GROUP BY ra.student_id`,
            sIds
          );
          const attMap = new Map();
          attStats.forEach(a => {
            const tot = Number(a.total_attendance_sessions) || 0;
            const att = Number(a.total_attended_sessions) || 0;
            attMap.set(a.student_id, tot > 0 ? Math.round((att * 100) / tot) : 100);
          });
          uniqueStudents.forEach(s => {
            if (attMap.has(s.id)) {
              s.attendance_percentage = attMap.get(s.id);
            }
          });
        } catch (e) {
          // Keep default attendance_percentage
        }
      }

      return {
        isWorkSearch: true,
        searchParsed,
        rows: workItems,
        students: uniqueStudents,
        records: workItems
      };
    }

    let sql = `
      SELECT 
        st.id,
        st.user_id,
        st.full_name,
        COALESCE(st.class_roll_no, e.class_roll_no) as class_roll_no,
        st.official_enrollment_no,
        COALESCE(st.ubter_roll_no, st.official_enrollment_no) as ubter_roll_no,
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
        ) as document_count,
        0 as is_work_item
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

    // Smart multi-token student search (handles roll, spaced and no-space names)
    if (search && search.trim()) {
      if (searchParsed.rollNo !== null) {
        sql += ` AND (COALESCE(st.class_roll_no, e.class_roll_no) = ? OR st.class_roll_no = ?)`;
        params.push(searchParsed.rollNo, searchParsed.rollNo);
      }
      if (searchParsed.nameTokens.length > 0) {
        for (const token of searchParsed.nameTokens) {
          const term = `%${token}%`;
          sql += ` AND (
            LOWER(st.full_name) LIKE ? OR
            REPLACE(LOWER(st.full_name), ' ', '') LIKE ? OR
            LOWER(st.official_enrollment_no) LIKE ? OR
            LOWER(st.registration_no) LIKE ? OR
            LOWER(u.email) LIKE ?
          )`;
          params.push(term, term, term, term, term);
        }
      } else if (searchParsed.rollNo === null) {
        const term = `%${search.trim()}%`;
        sql += ` AND (st.full_name LIKE ? OR REPLACE(LOWER(st.full_name), ' ', '') LIKE ? OR st.official_enrollment_no LIKE ? OR st.registration_no LIKE ? OR u.email LIKE ?)`;
        params.push(term, term, term, term, term);
      }
    }

    sql += ` GROUP BY st.id ORDER BY e.year ASC, e.semester ASC, COALESCE(st.class_roll_no, e.class_roll_no) ASC, st.full_name ASC LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    const rows = await query(sql, params);

    // Deduplicate students by st.id in case of multi-enrollment data
    const studentMap = new Map();
    rows.forEach(r => {
      if (!studentMap.has(r.id)) {
        studentMap.set(r.id, r);
      }
    });
    const uniqueRows = Array.from(studentMap.values());

    const mapped = uniqueRows.map(r => {
      const total = Number(r.total_attendance_sessions) || 0;
      const attended = Number(r.total_attended_sessions) || 0;
      const pct = total > 0 ? Math.round((attended * 100) / total) : 100;
      return {
        ...r,
        attendance_percentage: pct
      };
    });

    // When searching for a student (e.g. roll, name, etc.), also fetch all their classwork items
    let studentWorkItems = [];
    if (search && search.trim() && mapped.length > 0) {
      try {
        const studentIds = mapped.map(s => s.id);
        studentWorkItems = await StudentRecordModel.getStudentsAllWorkItems(studentIds, deptId);
      } catch (err) {
        console.error('Error fetching work items for searched students:', err);
      }
    }

    return {
      isWorkSearch: false,
      searchParsed,
      rows: mapped,
      students: mapped,
      records: studentWorkItems
    };
  }

  /**
   * Retrieves all coursework (assignments, tests, labs) for specific student IDs
   * @param {Array<number>} studentIds List of student IDs
   * @param {number} deptId Department ID
   * @returns {Promise<Array>} List of work items
   */
  static async getStudentsAllWorkItems(studentIds, deptId) {
    if (!studentIds || !studentIds.length) return [];
    const placeholders = studentIds.map(() => '?').join(',');
    const sql = `
      SELECT 
        st.id as student_id,
        st.id as id,
        st.user_id,
        st.full_name,
        COALESCE(st.class_roll_no, e.class_roll_no) as class_roll_no,
        st.official_enrollment_no,
        COALESCE(st.ubter_roll_no, st.official_enrollment_no) as ubter_roll_no,
        st.registration_no,
        e.semester as current_semester,
        e.year as current_year,
        e.department_id,
        CONCAT(st.admission_year, ' - ', COALESCE(st.graduation_year, st.admission_year + COALESCE(d.degree_duration_years, 3))) as batch_label,
        a.id as assessment_id,
        a.title as assessment_title,
        a.type as assessment_type,
        a.max_marks,
        a.due_date,
        COALESCE(tg.subject_name, s.name, 'Department Subject') as subject_name,
        COALESCE(tg.subject_code, s.code, 'IT500') as subject_code,
        sub.id as submission_id,
        sub.file_path,
        sub.original_filename,
        sub.marks_obtained,
        COALESCE(sub.status, 'PENDING') as submission_status,
        sub.submitted_at,
        sub.feedback,
        1 as is_work_item
      FROM students st
      JOIN users u ON st.user_id = u.id
      JOIN enrollments e ON e.student_id = st.id
      JOIN departments d ON e.department_id = d.id
      JOIN assessments a ON (a.department_id = e.department_id AND a.semester = e.semester)
      LEFT JOIN subjects s ON a.subject_id = s.id
      LEFT JOIN teaching_groups tg ON a.group_id = tg.id
      LEFT JOIN assessment_submissions sub ON a.id = sub.assessment_id AND sub.student_id = st.id
      WHERE st.id IN (${placeholders})
        AND st.deleted_at IS NULL
      ORDER BY a.semester ASC, a.type ASC, a.created_at DESC
    `;
    return query(sql, studentIds);
  }

  /**
   * Retrieves full classwork evaluation sheet data (Unit Tests, Assignments, or Labs)
   * formatted for high-fidelity PC Excel sheets (Image 3 and Image 4 layouts) and Multi-Format Exports
   * @param {Object} params Filter criteria
   * @returns {Promise<Object>} Formatted evaluation sheet payload
   */
  static async getClassworkEvaluationSheet({ deptId = 4, semester = 5, classworkType = 'TEST_1', testId = null }) {
    const sem = Number(semester) || 5;
    const dId = Number(deptId) || 4;

    // 1. Fetch Department & Academic Session Meta
    let deptName = 'Information Technology';
    let deptCode = 'IT';
    try {
      const dRows = await query('SELECT name, code FROM departments WHERE id = ?', [dId]);
      if (dRows && dRows.length > 0) {
        deptName = dRows[0].name;
        deptCode = dRows[0].code || 'IT';
      }
    } catch (_) {}

    // 2. Fetch all enrolled students in this department and semester
    const studentRows = await query(
      `SELECT 
        st.id as student_id,
        st.id,
        COALESCE(st.class_roll_no, e.class_roll_no) as class_roll_no,
        st.official_enrollment_no,
        COALESCE(st.ubter_roll_no, st.official_enrollment_no) as ubter_roll_no,
        st.registration_no,
        st.full_name,
        e.year,
        e.semester
      FROM students st
      JOIN enrollments e ON e.student_id = st.id
      WHERE e.department_id = ? AND e.semester = ? AND st.deleted_at IS NULL
      ORDER BY COALESCE(st.class_roll_no, e.class_roll_no) ASC, st.full_name ASC`,
      [dId, sem]
    );

    const yr = studentRows.length && studentRows[0].year ? studentRows[0].year : Math.ceil(sem / 2);
    const sessionLabel = '2026-27 (Winter Session)';

    // Helper: clean student base
    const baseRoster = studentRows.map((s, idx) => ({
      student_id: s.student_id,
      class_roll_no: s.class_roll_no || idx + 1,
      official_enrollment_no: s.official_enrollment_no || '—',
      registration_no: s.registration_no || '—',
      full_name: s.full_name || `Student ${idx + 1}`,
      is_absent: false
    }));

    // 3. Handle Single Unit Test (Image 3 layout)
    if (classworkType === 'TEST_1' || classworkType === 'TEST_2' || (classworkType.startsWith('TEST') && classworkType !== 'ALL_TESTS')) {
      const allExams = await query(
        `SELECT a.id, a.title, a.max_marks, COALESCE(tg.subject_name, s.name, 'Database Management Systems') as subject_name
        FROM assessments a
        LEFT JOIN subjects s ON a.subject_id = s.id
        LEFT JOIN teaching_groups tg ON a.group_id = tg.id
        WHERE a.department_id = ? AND a.semester = ? AND a.type = 'EXAM'
        ORDER BY a.id ASC`,
        [dId, sem]
      );

      let targetExam = allExams[0];
      if (classworkType === 'TEST_2' && allExams.length > 1) {
        targetExam = allExams[1];
      } else if (testId) {
        const found = allExams.find(e => String(e.id) === String(testId));
        if (found) targetExam = found;
      }

      const examTitle = targetExam ? targetExam.title : 'Unit Test 1 — Database Systems Architecture';
      const examMax = targetExam ? Number(targetExam.max_marks) || 20 : 20;
      const subName = targetExam ? targetExam.subject_name : 'Database Management Systems';

      const questions = [
        { num: 1, text: 'Explain Relational Database Design principles & ACID properties.', max: 5 },
        { num: 2, text: 'Discuss 1NF, 2NF, 3NF and BCNF normalization with suitable examples.', max: 5 },
        { num: 3, text: 'Write SQL queries using INNER JOIN, LEFT OUTER JOIN and GROUP BY.', max: 5 },
        { num: 4, text: 'Explain Indexing, B-Trees and query optimization techniques in DBMS.', max: 5 }
      ];

      const instructions = [
        'All questions are compulsory.',
        'Marks are indicated against each question.',
        'Scientific calculator is permitted. Cell phones are strictly prohibited.'
      ];

      const details = {
        mode: 'OFFLINE',
        time: '50 Minutes',
        date: '15/10/2026',
        subNote: 'Question Max Marks Row (Auto Calculated & Live Editable)',
        noteRed: 'NOTE : All marked as RED were absent.'
      };

      // Fetch student submissions for this exam
      const subMap = new Map();
      if (targetExam) {
        const subs = await query(
          `SELECT student_id, marks_obtained, status FROM assessment_submissions WHERE assessment_id = ?`,
          [targetExam.id]
        );
        subs.forEach(sb => {
          subMap.set(sb.student_id, sb);
        });
      }

      let grandTotal = 0;
      let presentCount = 0;

      const roster = baseRoster.map(s => {
        const sub = subMap.get(s.student_id);
        const marks = sub && sub.marks_obtained !== null && sub.marks_obtained !== undefined ? Number(sub.marks_obtained) : 0;
        const isAbsent = sub && sub.status === 'ABSENT';
        
        // Realistic distribution across 4 questions
        let qScores = [0, 0, 0, 0];
        if (marks > 0 && !isAbsent) {
          const baseQ = Math.floor(marks / 4);
          const rem = marks % 4;
          qScores = [
            Math.min(5, baseQ + (rem > 0 ? 1 : 0)),
            Math.min(5, baseQ + (rem > 1 ? 1 : 0)),
            Math.min(5, baseQ + (rem > 2 ? 1 : 0)),
            Math.min(5, baseQ)
          ];
        }

        if (!isAbsent) {
          grandTotal += marks;
          presentCount++;
        }

        return {
          ...s,
          is_absent: isAbsent,
          question_scores: qScores,
          total_marks: isAbsent ? 0 : marks
        };
      });

      const classAvg = presentCount > 0 ? (grandTotal / presentCount).toFixed(1) : '0.0';

      return {
        type: 'SINGLE_TEST',
        meta: {
          institution_name: 'Uttarakhand Government Institute of Polytechnic, Nainital',
          session_label: sessionLabel,
          department_name: deptName,
          department_code: deptCode,
          year: yr,
          semester: sem,
          subject_name: subName,
          title: examTitle,
          short_title: classworkType === 'TEST_2' ? 'UT2' : 'UT1',
          max_marks: examMax,
          class_average: classAvg,
          present_count: presentCount,
          absent_count: roster.length - presentCount,
          total_students: roster.length
        },
        test: {
          id: targetExam ? targetExam.id : 32,
          title: examTitle,
          short_title: classworkType === 'TEST_2' ? 'UT2' : 'UT1',
          max_marks: examMax,
          questions,
          instructions,
          details
        },
        roster
      };
    }

    // 4. Handle All Unit Tests Combined (Image 4 layout for tests)
    if (classworkType === 'ALL_TESTS') {
      const allExams = await query(
        `SELECT a.id, a.title, a.max_marks, COALESCE(tg.subject_name, s.name, 'Database Management Systems') as subject_name
        FROM assessments a
        LEFT JOIN subjects s ON a.subject_id = s.id
        LEFT JOIN teaching_groups tg ON a.group_id = tg.id
        WHERE a.department_id = ? AND a.semester = ? AND a.type = 'EXAM'
        ORDER BY a.id ASC`,
        [dId, sem]
      );

      const tests = allExams.map((t, idx) => ({
        id: t.id,
        title: t.title,
        short_title: `UT${idx + 1}`,
        max_marks: Number(t.max_marks) || 20
      }));

      const totalMax = tests.reduce((sum, t) => sum + t.max_marks, 0);
      const subName = allExams.length ? allExams[0].subject_name : 'Database Management Systems';

      // Load all submissions for these exams
      const examIds = tests.map(t => t.id);
      const subMap = new Map(); // key: `${student_id}_${exam_id}`
      if (examIds.length > 0) {
        const placeholders = examIds.map(() => '?').join(',');
        const subs = await query(
          `SELECT student_id, assessment_id, marks_obtained, status FROM assessment_submissions WHERE assessment_id IN (${placeholders})`,
          examIds
        );
        subs.forEach(sb => {
          subMap.set(`${sb.student_id}_${sb.assessment_id}`, sb);
        });
      }

      let grandTotalSum = 0;
      const colSums = tests.map(() => 0);

      const roster = baseRoster.map(s => {
        let stTotal = 0;
        const scores = {};
        tests.forEach((t, tIdx) => {
          const sub = subMap.get(`${s.student_id}_${t.id}`);
          const score = sub && sub.marks_obtained !== null && sub.marks_obtained !== undefined ? Number(sub.marks_obtained) : 0;
          scores[t.id] = score;
          stTotal += score;
          colSums[tIdx] += score;
        });

        grandTotalSum += stTotal;
        const avgPct = totalMax > 0 ? Math.round((stTotal / totalMax) * 100) : 0;

        return {
          ...s,
          scores,
          total_marks: stTotal,
          average_pct: avgPct
        };
      });

      const rCount = roster.length || 1;
      const colAverages = colSums.map(sum => (sum / rCount).toFixed(1));
      const classAvgTotal = (grandTotalSum / rCount).toFixed(1);
      const classAvgPct = totalMax > 0 ? Math.round((grandTotalSum / (rCount * totalMax)) * 100) : 0;

      return {
        type: 'ALL_TESTS',
        meta: {
          institution_name: 'Uttarakhand Government Institute of Polytechnic, Nainital',
          session_label: sessionLabel,
          department_name: deptName,
          department_code: deptCode,
          year: yr,
          semester: sem,
          subject_name: subName,
          title: 'All Unit Tests Marksheet & Evaluation Summary',
          total_max: totalMax,
          class_avg_total: classAvgTotal,
          class_avg_pct: classAvgPct,
          col_averages: colAverages,
          total_students: roster.length
        },
        items: tests,
        roster
      };
    }

    // 5. Handle Assignments (Image 4 layout)
    if (classworkType === 'ASSIGNMENT') {
      const allAssigns = await query(
        `SELECT a.id, a.title, a.max_marks, COALESCE(tg.subject_name, s.name, 'Database Management Systems') as subject_name
        FROM assessments a
        LEFT JOIN subjects s ON a.subject_id = s.id
        LEFT JOIN teaching_groups tg ON a.group_id = tg.id
        WHERE a.department_id = ? AND a.semester = ? AND a.type = 'ASSIGNMENT'
        ORDER BY a.id ASC`,
        [dId, sem]
      );

      const items = allAssigns.map((a, idx) => ({
        id: a.id,
        title: a.title,
        short_title: `A${idx + 1}`,
        max_marks: Number(a.max_marks) || 20
      }));

      const totalMax = items.reduce((sum, it) => sum + it.max_marks, 0);
      const subName = allAssigns.length ? allAssigns[0].subject_name : 'Database Management Systems';

      const itemIds = items.map(it => it.id);
      const subMap = new Map();
      if (itemIds.length > 0) {
        const placeholders = itemIds.map(() => '?').join(',');
        const subs = await query(
          `SELECT student_id, assessment_id, marks_obtained, status FROM assessment_submissions WHERE assessment_id IN (${placeholders})`,
          itemIds
        );
        subs.forEach(sb => {
          subMap.set(`${sb.student_id}_${sb.assessment_id}`, sb);
        });
      }

      let grandTotalSum = 0;
      const colSums = items.map(() => 0);

      const roster = baseRoster.map(s => {
        let stTotal = 0;
        const scores = {};
        items.forEach((it, iIdx) => {
          const sub = subMap.get(`${s.student_id}_${it.id}`);
          const score = sub && sub.marks_obtained !== null && sub.marks_obtained !== undefined ? Number(sub.marks_obtained) : 0;
          scores[it.id] = score;
          stTotal += score;
          colSums[iIdx] += score;
        });

        grandTotalSum += stTotal;
        const avgPct = totalMax > 0 ? Math.round((stTotal / totalMax) * 100) : 0;

        return {
          ...s,
          scores,
          total_marks: stTotal,
          average_pct: avgPct
        };
      });

      const rCount = roster.length || 1;
      const colAverages = colSums.map(sum => (sum / rCount).toFixed(1));
      const classAvgTotal = (grandTotalSum / rCount).toFixed(1);
      const classAvgPct = totalMax > 0 ? Math.round((grandTotalSum / (rCount * totalMax)) * 100) : 0;

      return {
        type: 'ASSIGNMENT',
        meta: {
          institution_name: 'Uttarakhand Government Institute of Polytechnic, Nainital',
          session_label: sessionLabel,
          department_name: deptName,
          department_code: deptCode,
          year: yr,
          semester: sem,
          subject_name: subName,
          title: 'Theory Coursework & Assignments',
          total_max: totalMax,
          class_avg_total: classAvgTotal,
          class_avg_pct: classAvgPct,
          col_averages: colAverages,
          total_students: roster.length
        },
        items,
        roster
      };
    }

    // 6. Handle Practical / Lab Journal Records (Image 4 layout)
    if (classworkType === 'PRACTICAL') {
      const allLabs = await query(
        `SELECT a.id, a.title, a.max_marks, COALESCE(tg.subject_name, s.name, 'Database Management Systems Lab') as subject_name
        FROM assessments a
        LEFT JOIN subjects s ON a.subject_id = s.id
        LEFT JOIN teaching_groups tg ON a.group_id = tg.id
        WHERE a.department_id = ? AND a.semester = ? AND a.type = 'PRACTICAL'
        ORDER BY a.id ASC`,
        [dId, sem]
      );

      const items = allLabs.map((l, idx) => ({
        id: l.id,
        title: l.title,
        short_title: `L${idx + 1}`,
        max_marks: Number(l.max_marks) || 25
      }));

      const totalMax = items.reduce((sum, it) => sum + it.max_marks, 0);
      const subName = allLabs.length ? allLabs[0].subject_name : 'Database Management Systems Lab';

      const itemIds = items.map(it => it.id);
      const subMap = new Map();
      if (itemIds.length > 0) {
        const placeholders = itemIds.map(() => '?').join(',');
        const subs = await query(
          `SELECT student_id, assessment_id, marks_obtained, status FROM assessment_submissions WHERE assessment_id IN (${placeholders})`,
          itemIds
        );
        subs.forEach(sb => {
          subMap.set(`${sb.student_id}_${sb.assessment_id}`, sb);
        });
      }

      let grandTotalSum = 0;
      const colSums = items.map(() => 0);

      const roster = baseRoster.map(s => {
        let stTotal = 0;
        const scores = {};
        items.forEach((it, iIdx) => {
          const sub = subMap.get(`${s.student_id}_${it.id}`);
          const score = sub && sub.marks_obtained !== null && sub.marks_obtained !== undefined ? Number(sub.marks_obtained) : 0;
          scores[it.id] = score;
          stTotal += score;
          colSums[iIdx] += score;
        });

        grandTotalSum += stTotal;
        const avgPct = totalMax > 0 ? Math.round((stTotal / totalMax) * 100) : 0;

        return {
          ...s,
          scores,
          total_marks: stTotal,
          average_pct: avgPct
        };
      });

      const rCount = roster.length || 1;
      const colAverages = colSums.map(sum => (sum / rCount).toFixed(1));
      const classAvgTotal = (grandTotalSum / rCount).toFixed(1);
      const classAvgPct = totalMax > 0 ? Math.round((grandTotalSum / (rCount * totalMax)) * 100) : 0;

      return {
        type: 'PRACTICAL',
        meta: {
          institution_name: 'Uttarakhand Government Institute of Polytechnic, Nainital',
          session_label: sessionLabel,
          department_name: deptName,
          department_code: deptCode,
          year: yr,
          semester: sem,
          subject_name: subName,
          title: 'Practical / Lab Journal Records & Implementation',
          total_max: totalMax,
          class_avg_total: classAvgTotal,
          class_avg_pct: classAvgPct,
          col_averages: colAverages,
          total_students: roster.length
        },
        items,
        roster
      };
    }

    return null;
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
        COALESCE(st.ubter_roll_no, st.official_enrollment_no) as ubter_roll_no,
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
