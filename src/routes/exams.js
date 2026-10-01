/**
 * Exam / Test Score Routes (/api/v1/exams/*)
 * Teacher creates a test (Unit Test, Mid Sem, etc.) for a class and
 * enters marks in one simple table; students view their own scores.
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { query, withTransaction } = require('../config/db');
const auditService = require('../services/auditService');
const notificationService = require('../services/notificationService');

router.use(auth);

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg } });
  }
  next();
}

/**
 * Teacher: create a test/exam for one of their classes.
 * POST /api/v1/exams
 */
router.post(
  '/',
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('name').trim().isLength({ min: 2 }).withMessage('Test name is required'),
    body('subject_id').optional({ nullable: true }),
    body('department_id').optional({ nullable: true }),
    body('year').optional({ nullable: true }),
    body('semester').optional({ nullable: true }),
    body('academic_year_id').optional({ nullable: true }),
    validate
  ],
  async (req, res) => {
    try {
      const { name, subject_id, department_id, year, semester, academic_year_id, exam_date, max_marks, group_id } = req.body;
      const rRes = await query(
        `INSERT INTO assessments (teacher_id, subject_id, department_id, group_id, year, semester, academic_year_id, type, title, due_date, max_marks)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'EXAM', ?, ?, ?)`,
        [req.user.teacher_id, subject_id || null, department_id || null, group_id || null, year || null, semester || null, academic_year_id || null, name, exam_date || null, max_marks || 100]
      );
      const examId = rRes.insertId;

      // Log audit
      await auditService.logAudit({
        eventType: 'TEST_SCHEDULED',
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'TEACHER',
        targetType: 'exams',
        targetId: examId,
        details: { name, group_id, exam_date, max_marks },
        ipAddress: req.ip
      });

      // Dispatch notifications to enrolled students
      if (group_id) {
        const members = await query(
          `SELECT s.user_id FROM teaching_group_members tgm
           JOIN students s ON s.id = tgm.student_id
           WHERE tgm.group_id = ? AND (tgm.status = 'ACTIVE' OR tgm.status = 'ENROLLED')`,
          [group_id]
        );
        const userIds = members.map(m => m.user_id).filter(Boolean);
        if (userIds.length > 0) {
          await notificationService.sendBatchNotification({
            userIds,
            type: notificationService.NOTIFICATION_TYPES.ADMIN_NOTICE,
            title: `Upcoming Test: ${name}`,
            message: `A new test "${name}" has been scheduled for ${exam_date || 'TBD'}. Max Marks: ${max_marks || 100}.`,
            linkUrl: `/student/groups.html?id=${group_id}&tab=tests`
          });
        }
      }

      res.status(201).json({ success: true, data: { id: examId } });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * List tests.
 * - Teacher: tests they created
 * - Student: tests for their cohort
 * GET /api/v1/exams
 */
router.get('/', async (req, res) => {
  try {
    if (req.user.roles.includes('STUDENT')) {
      if (req.query.group_id) {
        const rows = await query(
          `SELECT ex.*, COALESCE(sub.name, tg.subject_name, 'General Subject') as subject_name, t.full_name as teacher_name,
                  sc.marks_obtained, sc.remarks
           FROM exams ex
           LEFT JOIN subjects sub ON sub.id = ex.subject_id
           LEFT JOIN teaching_groups tg ON tg.id = ex.group_id
           JOIN teachers t ON t.id = ex.teacher_id
           LEFT JOIN exam_scores sc ON sc.exam_id = ex.id AND sc.student_id = ?
           WHERE ex.group_id = ?
           ORDER BY ex.exam_date IS NULL, ex.exam_date DESC, ex.id DESC`,
          [req.user.student_id, req.query.group_id]
        );
        return res.json({ success: true, data: rows });
      }

      const enr = await query(
        `SELECT department_id, year, semester, academic_year_id FROM enrollments WHERE student_id = ? ORDER BY id DESC LIMIT 1`,
        [req.user.student_id]
      );
      const c = enr[0] || {};
      const rows = await query(
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
        [req.user.student_id, c.department_id || 0, c.year || 0, c.semester || 0, c.academic_year_id || 0, req.user.student_id]
      );
      return res.json({ success: true, data: rows });
    }

    // Teacher / Admin view
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

    if (req.user.teacher_id && !req.user.roles?.includes('SYSTEM_ADMIN')) {
      sql += ` AND ex.teacher_id = ?`;
      params.push(req.user.teacher_id);
    }

    if (req.query.group_id) {
      sql += ` AND ex.group_id = ?`;
      params.push(Number(req.query.group_id));
    }
    if (req.query.subject_id) {
      sql += ` AND ex.subject_id = ?`;
      params.push(Number(req.query.subject_id));
    }
    if (req.query.department_id) {
      sql += ` AND ex.department_id = ?`;
      params.push(Number(req.query.department_id));
    }
    if (req.query.year) {
      sql += ` AND ex.year = ?`;
      params.push(Number(req.query.year));
    }
    if (req.query.semester) {
      sql += ` AND ex.semester = ?`;
      params.push(Number(req.query.semester));
    }
    if (req.query.academic_year_id) {
      sql += ` AND ex.academic_year_id = ?`;
      params.push(Number(req.query.academic_year_id));
    }

    sql += ` ORDER BY ex.id DESC`;
    const rows = await query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Teacher: roster for entering marks.
 * GET /api/v1/exams/:id/roster
 */
const excelExportService = require('../services/excelExportService');

/**
 * Teacher: roster for entering marks.
 * GET /api/v1/exams/:id/roster
 */
router.get('/:id/roster', requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const eRows = await query(`SELECT * FROM exams WHERE id = ?`, [req.params.id]);
    if (!eRows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Test not found' } });
    const ex = eRows[0];

    // Fetch assessment description which may contain custom questions/instructions JSON
    const aRows = await query(`SELECT description FROM assessments WHERE id = ?`, [req.params.id]);
    let meta = {};
    try {
      if (aRows[0]?.description && aRows[0].description.startsWith('{')) {
        meta = JSON.parse(aRows[0].description);
      }
    } catch { /* ignore */ }

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

    const parsedRoster = rows.map(r => {
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

    res.json({ success: true, data: { exam: ex, meta, roster: parsedRoster } });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Teacher: bulk-save marks for a test in one tap.
 * POST /api/v1/exams/:id/scores  { scores: [{ student_id, marks_obtained, is_absent, question_scores, remarks }], meta: {...} }
 */
router.post(
  '/:id/scores',
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [body('scores').isArray({ min: 1 }).withMessage('scores array is required'), validate],
  async (req, res) => {
    try {
      await withTransaction(async (conn) => {
        // Optionally save meta (instructions, questions list) in assessments.description
        if (req.body.meta && typeof req.body.meta === 'object') {
          await conn.execute(
            `UPDATE assessments SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [JSON.stringify(req.body.meta), req.params.id]
          );
        }

        for (const s of req.body.scores) {
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
            [req.params.id, s.student_id, finalMarks, feedbackPayload, req.user.id, statusVal]
          );
        }
      });

      // Audit log & student notifications
      try {
        await auditService.logAudit({
          eventType: auditService.AUDIT_EVENTS.TEST_MARK_UPDATED,
          actorId: req.user.id,
          actorRole: req.user.roles?.[0] || 'TEACHER',
          targetType: 'exams',
          targetId: req.params.id,
          details: { count: req.body.scores?.length },
          ipAddress: req.ip
        });

        const examDetails = await query('SELECT title, group_id, max_marks FROM assessments WHERE id = ?', [req.params.id]);
        const exTitle = examDetails[0]?.title || 'Class Test';
        const exGroupId = examDetails[0]?.group_id;
        const exMaxMarks = examDetails[0]?.max_marks || 100;

        for (const s of req.body.scores) {
          if (s.marks_obtained !== undefined && s.marks_obtained !== null && s.marks_obtained !== '') {
            const studentUsers = await query('SELECT user_id FROM students WHERE id = ?', [s.student_id]);
            if (studentUsers[0]?.user_id) {
              await notificationService.sendNotification({
                userId: studentUsers[0].user_id,
                type: notificationService.NOTIFICATION_TYPES.TEST_MARKS_PUBLISHED,
                title: `Test Score Published: ${exTitle}`,
                message: `Your score for "${exTitle}" is ${s.marks_obtained}/${exMaxMarks}.`,
                linkUrl: exGroupId ? `/student/groups.html?id=${exGroupId}&tab=tests` : `/student/tests.html`
              });
            }
          }
        }
      } catch (auditErr) {
        // Non-fatal
      }

      res.json({ success: true, message: 'Marks and evaluation details saved.' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * Teacher/Admin: Export Class Test Marksheet to authentic .xlsx (GET default)
 * GET /api/v1/exams/:id/export/excel
 */
router.get('/:id/export/excel', requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const eRows = await query(
      `SELECT ex.*, sub.name as subject_name, sub.code as subject_code,
              d.name as department_name, d.code as department_code,
              ay.label as academic_year_label
       FROM exams ex
       JOIN subjects sub ON sub.id = ex.subject_id
       JOIN departments d ON d.id = ex.department_id
       JOIN academic_years ay ON ay.id = ex.academic_year_id
       WHERE ex.id = ?`,
      [req.params.id]
    );
    if (!eRows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Test not found' } });
    const ex = eRows[0];

    // Read system settings for institution name
    const setRows = await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'institution_name'`);
    const instName = setRows[0]?.setting_value || 'Uttarakhand Government Institute of Polytechnic, Nainital';

    // Fetch assessment description which may contain custom questions/instructions
    const aRows = await query(`SELECT description FROM assessments WHERE id = ?`, [req.params.id]);
    let meta = {};
    try {
      if (aRows[0]?.description && aRows[0].description.startsWith('{')) {
        meta = JSON.parse(aRows[0].description);
      }
    } catch { /* ignore */ }

    // Fetch roster
    let rows;
    if (ex.group_id) {
      rows = await query(
        `SELECT COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no, s.id as student_id, s.official_enrollment_no, s.full_name,
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
        `SELECT e.class_roll_no, s.id as student_id, s.official_enrollment_no, s.full_name,
                sc.marks_obtained, sc.feedback as remarks, sc.status
         FROM enrollments e
         JOIN students s ON e.student_id = s.id
         LEFT JOIN assessment_submissions sc ON sc.assessment_id = ? AND sc.student_id = s.id
         WHERE e.department_id = ? AND e.year = ? AND e.semester = ? AND e.academic_year_id = ? AND e.status = 'ENROLLED'
         ORDER BY e.class_roll_no ASC`,
        [ex.id, ex.department_id, ex.year, ex.semester, ex.academic_year_id]
      );
    }

    const roster = rows.map(r => {
      let isAbsent = r.status === 'ABSENT';
      let qScores = null;
      if (r.remarks && typeof r.remarks === 'string' && r.remarks.startsWith('{')) {
        try {
          const parsed = JSON.parse(r.remarks);
          if (parsed.is_absent !== undefined) isAbsent = Boolean(parsed.is_absent);
          if (Array.isArray(parsed.question_scores)) qScores = parsed.question_scores;
        } catch { /* ignore */ }
      }
      return {
        class_roll_no: r.class_roll_no,
        official_enrollment_no: r.official_enrollment_no,
        full_name: r.full_name,
        marks_obtained: r.marks_obtained,
        is_absent: isAbsent,
        question_scores: qScores
      };
    });

    const exportPayload = {
      institution_name: instName,
      session_label: `Internal Evaluation Sheet ${ex.academic_year_label || '2026-27 (Winter)'}`,
      department_name: ex.department_name,
      department_code: ex.department_code,
      subject_name: ex.subject_name,
      year: ex.year,
      semester: ex.semester,
      title: ex.name,
      max_marks: ex.max_marks,
      exam_date: ex.exam_date,
      duration: meta.duration || '50 minutes',
      mode: meta.mode || 'OFFLINE',
      questions: meta.questions,
      instructions: meta.instructions,
      question_texts: meta.question_texts,
      roster
    };

    const buffer = await excelExportService.generateClassTestExcel(exportPayload);

    const safeTitle = (ex.name || 'Class_Test').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeSubj = (ex.subject_name || 'Subject').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeTitle}_${safeSubj}_Marksheet.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Teacher/Admin: Export customized Class Test Marksheet (POST with custom columns/rows/instructions)
 * POST /api/v1/exams/:id/export/excel
 */
router.post('/:id/export/excel', requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const eRows = await query(
      `SELECT ex.*, sub.name as subject_name, sub.code as subject_code,
              d.name as department_name, d.code as department_code,
              ay.label as academic_year_label
       FROM exams ex
       JOIN subjects sub ON sub.id = ex.subject_id
       JOIN departments d ON d.id = ex.department_id
       JOIN academic_years ay ON ay.id = ex.academic_year_id
       WHERE ex.id = ?`,
      [req.params.id]
    );
    const ex = eRows[0] || {};

    const setRows = await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'institution_name'`);
    const instName = setRows[0]?.setting_value || 'Uttarakhand Government Institute of Polytechnic, Nainital';

    const customData = req.body || {};

    const exportPayload = {
      institution_name: customData.institution_name || instName,
      session_label: customData.session_label || `Internal Evaluation Sheet ${ex.academic_year_label || '2026-27 (Winter)'}`,
      department_name: customData.department_name || ex.department_name,
      department_code: customData.department_code || ex.department_code,
      subject_name: customData.subject_name || ex.subject_name,
      year: customData.year || ex.year || 3,
      semester: customData.semester || ex.semester || 5,
      title: customData.title || ex.name || 'Unit Test',
      max_marks: customData.max_marks || ex.max_marks || 10,
      exam_date: customData.exam_date || ex.exam_date,
      duration: customData.duration || '50 minutes',
      mode: customData.mode || 'OFFLINE',
      questions: customData.questions,
      instructions: customData.instructions,
      question_texts: customData.question_texts,
      roster: customData.roster || []
    };

    const buffer = await excelExportService.generateClassTestExcel(exportPayload);

    const safeTitle = (exportPayload.title || 'Class_Test').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeTitle}_Custom_Marksheet.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Teacher: delete a class test/exam and all its student scores.
 * DELETE /api/v1/exams/:id
 */
router.delete('/:id', requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const [exam] = await query('SELECT * FROM assessments WHERE id = ? AND type != ?', [req.params.id, 'ASSIGNMENT']);
    if (!exam) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Class test not found' } });
    if (req.user.role !== 'SYSTEM_ADMIN' && exam.created_by !== req.user.id) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You can only delete your own class tests' } });
    }
    await query('DELETE FROM assessment_submissions WHERE assessment_id = ?', [req.params.id]);
    await query('DELETE FROM assessments WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Class test deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;

