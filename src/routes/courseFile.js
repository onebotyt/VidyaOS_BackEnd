/**
 * Course File Preparation Routes (/api/v1/course-files/*)
 * Milestone 163: Institutional NBA/NAAC Course File Dossier System
 * 
 * Manages the mandatory 18 Course File documentation artifacts:
 * 1. Course allotment letter PDF
 * 2. Approved syllabus PDF
 * 3. Course Outcomes (COs) PDF / Structured
 * 4. CO-PO Mapping Matrix PDF / Structured
 * 5. Semester lesson plan PDF
 * 6. Class timetable PDF
 * 7. Student list (Live from VidyaOS Database + Optional Signed PDF)
 * 8. Previous semester result analysis PDF
 * 9. List of advanced learners PDF / Data Filter
 * 10. List of slow learners PDF / Data Filter
 * 11. Academic Calendar PDF
 * 12. Internal assessment plan (Evaluation Sheet + PDF)
 * 13. Laboratory plan (where applicable) PDF
 * 14. Assignment and tutorial schedule (Classwork Auto-Sync + PDF)
 * 15. Sample question papers mapped with COs PDF
 * 16. Continuous assessment records PDF / Register Summary
 * 17. CO attainment calculations PDF / Sheet
 * 18. Corrective action reports PDF
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { query } = require('../config/db');
const { makeUploader } = require('../middleware/upload');
const auditService = require('../services/auditService');

const uploadCourseFile = makeUploader('course_files');

router.use(auth);

// 18 Standard NBA/NAAC Course File Artifacts Specification
const COURSE_FILE_ITEMS = [
  {
    key: 'allotment_letter',
    num: 1,
    title: 'Course Allotment Letter',
    type: 'PDF',
    category: 'curriculum',
    reqType: 'upload',
    desc: 'Official appointment / teaching allocation order issued by HOD or Principal'
  },
  {
    key: 'approved_syllabus',
    num: 2,
    title: 'Approved Syllabus',
    type: 'PDF',
    category: 'curriculum',
    reqType: 'upload',
    desc: 'University/Board approved curriculum, course code, credit scheme and syllabus'
  },
  {
    key: 'course_outcomes',
    num: 3,
    title: 'Course Outcomes (COs)',
    type: 'PDF / Structured',
    category: 'curriculum',
    reqType: 'hybrid',
    desc: 'Defined Course Outcomes (CO1-CO6) with Bloom Taxonomy cognitive domain levels'
  },
  {
    key: 'copo_matrix',
    num: 4,
    title: 'CO-PO Mapping Matrix',
    type: 'PDF / Matrix',
    category: 'curriculum',
    reqType: 'hybrid',
    desc: 'Correlation matrix mapping Course Outcomes to Program Outcomes (PO1-PO12, PSO1-PSO2)'
  },
  {
    key: 'lesson_plan',
    num: 5,
    title: 'Semester Lesson Plan',
    type: 'PDF',
    category: 'curriculum',
    reqType: 'upload',
    desc: 'Lecture-by-lecture teaching schedule with reference textbooks and delivery modes'
  },
  {
    key: 'timetable',
    num: 6,
    title: 'Class Timetable',
    type: 'PDF',
    category: 'curriculum',
    reqType: 'upload',
    desc: 'Faculty individual and departmental classroom/laboratory master timetable'
  },
  {
    key: 'student_list',
    num: 7,
    title: 'Student List',
    type: 'Database Auto-Sync',
    category: 'students',
    reqType: 'system',
    desc: 'Live student roster auto-populated from VidyaOS department enrollment database'
  },
  {
    key: 'result_analysis',
    num: 8,
    title: 'Previous Semester Result Analysis',
    type: 'PDF',
    category: 'students',
    reqType: 'upload',
    desc: 'Statistical pass/fail distribution, mean score and prior cohort performance analysis'
  },
  {
    key: 'advanced_learners',
    num: 9,
    title: 'List of Advanced Learners',
    type: 'PDF / Data Filter',
    category: 'students',
    reqType: 'hybrid',
    desc: 'Identified fast learners with special mentoring, research problems or gate guidance'
  },
  {
    key: 'slow_learners',
    num: 10,
    title: 'List of Slow Learners',
    type: 'PDF / Data Filter',
    category: 'students',
    reqType: 'hybrid',
    desc: 'Remedial coaching roster with remedial sessions schedule and counseling notes'
  },
  {
    key: 'academic_calendar',
    num: 11,
    title: 'Academic Calendar',
    type: 'PDF',
    category: 'curriculum',
    reqType: 'upload',
    desc: 'Institutional and University academic calendar with instructional weeks & exams'
  },
  {
    key: 'internal_assessment_plan',
    num: 12,
    title: 'Internal Assessment Plan',
    type: 'Evaluation Sheet',
    category: 'assessment',
    reqType: 'hybrid',
    desc: 'Weightage criteria (Tests, Assignments, Lab, Attendance) and evaluation schedule'
  },
  {
    key: 'laboratory_plan',
    num: 13,
    title: 'Laboratory Plan (where applicable)',
    type: 'PDF (If Applicable)',
    category: 'assessment',
    reqType: 'upload',
    desc: 'List of practical experiments, software/hardware requirements, and lab rubric'
  },
  {
    key: 'assignment_schedule',
    num: 14,
    title: 'Assignment and Tutorial Schedule',
    type: 'Classwork Auto-Sync',
    category: 'assessment',
    reqType: 'system',
    desc: 'Live assignment schedule, submission deadlines and turn-in metrics from Classwork'
  },
  {
    key: 'question_papers_cos',
    num: 15,
    title: 'Sample Question Papers mapped with COs',
    type: 'PDF',
    category: 'assessment',
    reqType: 'upload',
    desc: 'Mid-term & semester question papers tagged with respective Course Outcome levels'
  },
  {
    key: 'continuous_assessment',
    num: 16,
    title: 'Continuous Assessment Records',
    type: 'PDF / Register Summary',
    category: 'assessment',
    reqType: 'hybrid',
    desc: 'Day-to-day continuous evaluation sheets, rubric marks and class test marksheets'
  },
  {
    key: 'co_attainment',
    num: 17,
    title: 'CO Attainment Calculations',
    type: 'PDF / Sheet',
    category: 'review',
    reqType: 'upload',
    desc: 'Direct and indirect CO attainment computation sheets and target attainment levels'
  },
  {
    key: 'corrective_actions',
    num: 18,
    title: 'Corrective Action Reports',
    type: 'PDF',
    category: 'review',
    reqType: 'upload',
    desc: 'Action taken report (ATR) on gaps identified in student feedback & result analysis'
  }
];

// GET /api/v1/course-files/definitions — Return standard 18 items schema
router.get('/definitions', (req, res) => {
  res.json({
    success: true,
    data: COURSE_FILE_ITEMS
  });
});

/**
 * GET /api/v1/course-files
 * Fetch or auto-provision course file dossier for a teaching group or subject
 * Query params: ?group_id=123 (or ?subject_id=456)
 */
router.get('/', async (req, res) => {
  try {
    const groupId = parseInt(req.query.group_id || req.query.teaching_group_id, 10);
    const subjectId = req.query.subject_id ? parseInt(req.query.subject_id, 10) : null;

    if (!groupId && !subjectId) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'group_id or subject_id is required' }
      });
    }

    // 1. Resolve Teaching Group & Subject Details
    let group = null;
    if (groupId) {
      const gRows = await query(
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
      if (gRows && gRows.length > 0) {
        group = gRows[0];
      }
    }

    if (!group && subjectId) {
      // Find active teaching group for this subject or teacher
      const gRows = await query(
        `SELECT tg.*, 
                d.name as department_name, d.code as department_code, d.id as department_id,
                t.full_name as teacher_name, t.employee_id as teacher_code,
                ay.label as academic_year_label
         FROM teaching_groups tg
         LEFT JOIN teachers t ON tg.teacher_id = t.id
         LEFT JOIN departments d ON t.department_id = d.id
         LEFT JOIN academic_years ay ON tg.academic_year_id = ay.id
         WHERE (tg.subject_code = (SELECT code FROM subjects WHERE id = ?) OR tg.subject_name = (SELECT name FROM subjects WHERE id = ?))
         ORDER BY tg.id DESC LIMIT 1`,
        [subjectId, subjectId]
      );
      if (gRows && gRows.length > 0) {
        group = gRows[0];
      }
    }

    if (!group) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Class or Subject group not found' }
      });
    }

    // RBAC: Teacher can access their own classes. HOD can access department classes. Admin can access all. Faculty can view.
    const isTeacher = req.user.teacher_id && req.user.teacher_id === group.teacher_id;
    const isHod = req.user.roles?.includes('HOD') || req.user.roles?.includes('DEPT_HEAD');
    const isAdmin = req.user.roles?.includes('SYSTEM_ADMIN');
    const isFaculty = req.user.roles?.includes('TEACHER') || req.user.roles?.includes('FACULTY') || req.user.roles?.includes('CLASS_TEACHER');

    if (!isTeacher && !isHod && !isAdmin && !isFaculty) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You do not have permission to view this Course File' }
      });
    }

    // 2. Fetch or Create course_files record
    let courseFileRows = await query(
      `SELECT cf.*, 
              COALESCE(t.full_name, u.username, u.email) as auditor_name,
              d.name as department_name
       FROM course_files cf
       LEFT JOIN users u ON cf.audited_by = u.id
       LEFT JOIN teachers t ON u.id = t.user_id
       LEFT JOIN departments d ON cf.department_id = d.id
       WHERE cf.teaching_group_id = ?`,
      [group.id]
    );

    let courseFile = null;
    if (courseFileRows && courseFileRows.length > 0) {
      courseFile = courseFileRows[0];
    } else {
      // Auto-provision Course File record
      const defaultScheme = JSON.stringify({
        mid_sem: 20,
        assignments: 10,
        lab_work: 15,
        attendance: 5,
        total: 50
      });
      const insertRes = await query(
        `INSERT INTO course_files 
         (teaching_group_id, subject_id, teacher_id, department_id, academic_year_id, semester, status, evaluation_scheme)
         VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?)`,
        [
          group.id,
          subjectId || null,
          group.teacher_id,
          group.department_id || 1,
          group.academic_year_id || 1,
          group.semester || 1,
          defaultScheme
        ]
      );
      const newId = insertRes.insertId;
      const refetched = await query(`SELECT * FROM course_files WHERE id = ?`, [newId]);
      courseFile = refetched[0];
    }

    // 3. Fetch uploaded documents
    const docRows = await query(
      `SELECT cfd.*, COALESCE(t.full_name, u.username, u.email) as uploader_name
       FROM course_file_documents cfd
       LEFT JOIN users u ON cfd.uploaded_by = u.id
       LEFT JOIN teachers t ON u.id = t.user_id
       WHERE cfd.course_file_id = ?`,
      [courseFile.id]
    );

    const docMap = {};
    docRows.forEach(doc => {
      docMap[doc.item_key] = doc;
    });

    // 4. Fetch System Data:
    // (a) Enrolled Students with Attendance %
    let students = [];
    try {
      students = await query(
        `SELECT s.id, 
                s.class_roll_no as roll_no, 
                s.official_enrollment_no as enrollment_no, 
                s.full_name, 
                u.email, 
                s.phone,
                COUNT(DISTINCT sess.id) as total_sessions,
                SUM(CASE WHEN ra.attendance_status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) as attended_sessions
         FROM teaching_group_members tgm
         JOIN students s ON tgm.student_id = s.id
         LEFT JOIN users u ON s.user_id = u.id
         LEFT JOIN attendance_registers ar ON ar.group_id = tgm.group_id
         LEFT JOIN attendance_sessions sess ON sess.register_id = ar.id
         LEFT JOIN register_attendance ra ON (ra.session_id = sess.id AND ra.student_id = s.id)
         WHERE tgm.group_id = ?
         GROUP BY s.id
         ORDER BY s.class_roll_no ASC, s.full_name ASC`,
        [group.id]
      );

      // If no members directly in teaching_group_members, fallback to department/semester roster
      if (!students || students.length === 0) {
        students = await query(
          `SELECT s.id, 
                  s.class_roll_no as roll_no, 
                  s.official_enrollment_no as enrollment_no, 
                  s.full_name, 
                  u.email, 
                  s.phone,
                  0 as total_sessions, 
                  0 as attended_sessions
           FROM students s
           LEFT JOIN users u ON s.user_id = u.id
           LEFT JOIN student_department_enrollments sde ON sde.student_id = s.id
           WHERE (sde.department_id = ? OR sde.department_id IS NULL) AND sde.semester = ?
           ORDER BY s.class_roll_no ASC, s.full_name ASC`,
          [group.department_id, group.semester]
        );
      }

      students = students.map(st => {
        const total = Number(st.total_sessions || 0);
        const attended = Number(st.attended_sessions || 0);
        const pct = total > 0 ? Math.round((attended / total) * 100) : null;
        return {
          ...st,
          total_sessions: total,
          attended_sessions: attended,
          attendance_pct: pct
        };
      });
    } catch (err) {
      console.error('Error fetching students for course file:', err);
    }

    // (b) Advanced Learners (> 80% attendance or manually tagged)
    const advancedLearners = students.filter(s => s.attendance_pct != null && s.attendance_pct >= 80);

    // (c) Slow Learners (< 75% attendance)
    const slowLearners = students.filter(s => s.attendance_pct != null && s.attendance_pct < 75);

    // (d) Classwork Assignments & Tutorial Schedule
    let assignments = [];
    try {
      assignments = await query(
        `SELECT a.id, a.title, a.description, a.due_date, a.max_marks, a.type, a.created_at,
                COUNT(asub.id) as submission_count
         FROM assessments a
         LEFT JOIN assessment_submissions asub ON asub.assessment_id = a.id
         WHERE (a.group_id = ? OR (a.teacher_id = ? AND a.semester = ?))
         GROUP BY a.id
         ORDER BY a.created_at DESC`,
        [group.id, group.teacher_id, group.semester]
      );
    } catch (err) {
      console.error('Error fetching assignments for course file:', err);
    }

    // (e) Continuous Assessment Records (Class tests / exams)
    const classTests = assignments.filter(a => a.type === 'EXAM' || a.title?.toLowerCase().includes('test'));

    // 5. Construct items array with live completion status
    let completedCount = 0;
    const items = COURSE_FILE_ITEMS.map(itemDef => {
      const doc = docMap[itemDef.key] || null;
      let hasData = false;

      // Check system auto-data availability
      if (itemDef.key === 'student_list' && students.length > 0) hasData = true;
      if (itemDef.key === 'assignment_schedule' && assignments.length > 0) hasData = true;
      if (itemDef.key === 'internal_assessment_plan' && courseFile.evaluation_scheme) hasData = true;
      if (itemDef.key === 'advanced_learners' && (advancedLearners.length > 0 || courseFile.advanced_learners_json)) hasData = true;
      if (itemDef.key === 'slow_learners' && (slowLearners.length > 0 || courseFile.slow_learners_json)) hasData = true;
      if (itemDef.key === 'course_outcomes' && courseFile.cos_json) hasData = true;
      if (itemDef.key === 'copo_matrix' && courseFile.copo_matrix_json) hasData = true;

      const isCompleted = !!doc || hasData;
      if (isCompleted) completedCount++;

      return {
        ...itemDef,
        is_completed: isCompleted,
        document: doc,
        has_system_data: hasData
      };
    });

    const completionPct = Math.round((completedCount / COURSE_FILE_ITEMS.length) * 100);

    res.json({
      success: true,
      data: {
        course_file: {
          ...courseFile,
          evaluation_scheme: courseFile.evaluation_scheme ? JSON.parse(courseFile.evaluation_scheme) : null,
          copo_matrix: courseFile.copo_matrix_json ? JSON.parse(courseFile.copo_matrix_json) : null,
          course_outcomes: courseFile.cos_json ? JSON.parse(courseFile.cos_json) : null,
          advanced_learners_notes: courseFile.advanced_learners_json ? JSON.parse(courseFile.advanced_learners_json) : null,
          slow_learners_notes: courseFile.slow_learners_json ? JSON.parse(courseFile.slow_learners_json) : null,
          total_items: COURSE_FILE_ITEMS.length,
          completed_items: completedCount,
          completion_pct: completionPct
        },
        group: {
          id: group.id,
          name: group.name,
          subject_name: group.subject_name,
          subject_code: group.subject_code,
          component: group.component,
          semester: group.semester,
          academic_year_label: group.academic_year_label || '2026-27',
          teacher_name: group.teacher_name,
          teacher_code: group.teacher_code,
          department_name: group.department_name,
          department_code: group.department_code,
          invite_code: group.invite_code
        },
        items,
        system_data: {
          total_students: students.length,
          students,
          advanced_learners: advancedLearners,
          slow_learners: slowLearners,
          assignments,
          class_tests: classTests
        }
      }
    });

  } catch (err) {
    console.error('Error fetching course file:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: err.message }
    });
  }
});

/**
 * POST /api/v1/course-files/:id/documents
 * Upload a document for one of the 18 Course File artifacts
 */
router.post(
  '/:id/documents',
  uploadCourseFile.single('file'),
  async (req, res) => {
    try {
      const courseFileId = parseInt(req.params.id, 10);
      const { item_key, title, notes } = req.body;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'No document file uploaded' }
        });
      }

      if (!item_key) {
        return res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'item_key is required' }
        });
      }

      // Check course file exists and authorization
      const cfRows = await query(`SELECT * FROM course_files WHERE id = ?`, [courseFileId]);
      if (!cfRows || cfRows.length === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Course file dossier not found' }
        });
      }
      const cf = cfRows[0];

      const isTeacher = req.user.teacher_id && req.user.teacher_id === cf.teacher_id;
      const isHod = req.user.roles?.includes('HOD') || req.user.roles?.includes('DEPT_HEAD');
      const isAdmin = req.user.roles?.includes('SYSTEM_ADMIN');

      if (!isTeacher && !isHod && !isAdmin) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Not authorized to modify this course file' }
        });
      }

      const filePath = `/uploads/course_files/${req.file.filename}`;
      const fileName = req.file.originalname;
      const fileSize = req.file.size;
      const mimeType = req.file.mimetype;
      const docTitle = title || item_key.replace(/_/g, ' ').toUpperCase();

      // Upsert document
      const existing = await query(
        `SELECT id, file_path, version FROM course_file_documents WHERE course_file_id = ? AND item_key = ?`,
        [courseFileId, item_key]
      );

      let docId = null;
      if (existing && existing.length > 0) {
        const prev = existing[0];
        // Delete previous file from disk if exists
        try {
          const oldDiskPath = path.join(__dirname, '../../', prev.file_path);
          if (fs.existsSync(oldDiskPath)) fs.unlinkSync(oldDiskPath);
        } catch (_) {}

        await query(
          `UPDATE course_file_documents 
           SET title = ?, file_path = ?, file_name = ?, file_size = ?, mime_type = ?,
               version = version + 1, uploaded_by = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [docTitle, filePath, fileName, fileSize, mimeType, req.user.id, notes || null, prev.id]
        );
        docId = prev.id;
      } else {
        const ins = await query(
          `INSERT INTO course_file_documents 
           (course_file_id, item_key, title, file_path, file_name, file_size, mime_type, uploaded_by, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [courseFileId, item_key, docTitle, filePath, fileName, fileSize, mimeType, req.user.id, notes || null]
        );
        docId = ins.insertId;
      }

      // Update course file timestamp
      await query(`UPDATE course_files SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [courseFileId]);

      // Audit log
      await auditService.logAudit({
        eventType: 'COURSE_FILE_DOCUMENT_UPLOADED',
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'TEACHER',
        targetType: 'course_files',
        targetId: courseFileId,
        details: { item_key, fileName, fileSize }
      });

      const updatedDoc = await query(`SELECT * FROM course_file_documents WHERE id = ?`, [docId]);

      res.status(201).json({
        success: true,
        data: updatedDoc[0],
        message: `${docTitle} uploaded successfully`
      });

    } catch (err) {
      console.error('Error uploading course file document:', err);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }
);

/**
 * DELETE /api/v1/course-files/:id/documents/:item_key
 * Remove an uploaded document from the course file
 */
router.delete('/:id/documents/:item_key', async (req, res) => {
  try {
    const courseFileId = parseInt(req.params.id, 10);
    const itemKey = req.params.item_key;

    const cfRows = await query(`SELECT * FROM course_files WHERE id = ?`, [courseFileId]);
    if (!cfRows || cfRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Course file dossier not found' }
      });
    }
    const cf = cfRows[0];

    const isTeacher = req.user.teacher_id && req.user.teacher_id === cf.teacher_id;
    const isHod = req.user.roles?.includes('HOD') || req.user.roles?.includes('DEPT_HEAD');
    const isAdmin = req.user.roles?.includes('SYSTEM_ADMIN');

    if (!isTeacher && !isHod && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Not authorized to modify this course file' }
      });
    }

    const docRows = await query(
      `SELECT * FROM course_file_documents WHERE course_file_id = ? AND item_key = ?`,
      [courseFileId, itemKey]
    );

    if (docRows && docRows.length > 0) {
      const doc = docRows[0];
      try {
        const diskPath = path.join(__dirname, '../../', doc.file_path);
        if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
      } catch (_) {}

      await query(`DELETE FROM course_file_documents WHERE id = ?`, [doc.id]);
    }

    await query(`UPDATE course_files SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [courseFileId]);

    res.json({
      success: true,
      message: 'Document deleted successfully'
    });

  } catch (err) {
    console.error('Error deleting course file document:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: err.message }
    });
  }
});

/**
 * PUT /api/v1/course-files/:id/evaluation-scheme
 * Save internal assessment plan evaluation criteria
 */
router.put('/:id/evaluation-scheme', async (req, res) => {
  try {
    const courseFileId = parseInt(req.params.id, 10);
    const scheme = req.body;

    const cfRows = await query(`SELECT * FROM course_files WHERE id = ?`, [courseFileId]);
    if (!cfRows || cfRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Course file dossier not found' }
      });
    }

    await query(
      `UPDATE course_files 
       SET evaluation_scheme = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [JSON.stringify(scheme), courseFileId]
    );

    res.json({
      success: true,
      message: 'Evaluation scheme updated successfully',
      data: scheme
    });

  } catch (err) {
    console.error('Error updating evaluation scheme:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: err.message }
    });
  }
});

/**
 * PUT /api/v1/course-files/:id/structured-data
 * Update Course Outcomes (COs), CO-PO matrix, or learner notes
 */
router.put('/:id/structured-data', async (req, res) => {
  try {
    const courseFileId = parseInt(req.params.id, 10);
    const { cos, copo_matrix, advanced_learners, slow_learners } = req.body;

    const cfRows = await query(`SELECT * FROM course_files WHERE id = ?`, [courseFileId]);
    if (!cfRows || cfRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Course file dossier not found' }
      });
    }

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

    res.json({
      success: true,
      message: 'Course file structured data updated successfully'
    });

  } catch (err) {
    console.error('Error updating structured data:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: err.message }
    });
  }
});

/**
 * POST /api/v1/course-files/:id/audit
 * HOD / Auditor approves or requests revision on the Course File
 */
router.post('/:id/audit', requireRole('HOD', 'DEPT_HEAD', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const courseFileId = parseInt(req.params.id, 10);
    const { status, remarks } = req.body;

    const validStatuses = ['IN_PROGRESS', 'SUBMITTED', 'AUDITED', 'APPROVED', 'REVISION_REQUESTED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: `Status must be one of: ${validStatuses.join(', ')}` }
      });
    }

    await query(
      `UPDATE course_files 
       SET status = ?, hod_remarks = ?, audited_by = ?, audited_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, remarks || null, req.user.id, courseFileId]
    );

    await auditService.logAudit({
      eventType: 'COURSE_FILE_AUDITED',
      actorId: req.user.id,
      actorRole: req.user.roles?.[0] || 'HOD',
      targetType: 'course_files',
      targetId: courseFileId,
      details: { status, remarks }
    });

    res.json({
      success: true,
      message: `Course file marked as ${status}`,
      data: { status, remarks, audited_at: new Date().toISOString() }
    });

  } catch (err) {
    console.error('Error auditing course file:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: err.message }
    });
  }
});

module.exports = router;
