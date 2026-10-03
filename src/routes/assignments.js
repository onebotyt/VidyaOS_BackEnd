/**
 * Assignment Routes (/api/v1/assignments/*)
 * Teacher gives an assignment (with an optional question-paper file)
 * to a class; students upload their work (PPT/DOC/PDF/etc); teacher
 * grades each submission.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { query } = require('../config/db');
const { makeUploader } = require('../middleware/upload');
const auditService = require('../services/auditService');
const notificationService = require('../services/notificationService');

const uploadAttachment = makeUploader('assignments');
const uploadSubmission = makeUploader('submissions');

router.use(auth);

/**
 * Teacher: create an assignment for one of their classes.
 * POST /api/v1/assignments  (multipart/form-data, field name: attachment)
 */
router.post(
  '/',
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  uploadAttachment.single('attachment'),
  [
    body('title').trim().isLength({ min: 2 }).withMessage('Title is required'),
    body('department_id').isInt(),
    body('year').isInt(),
    body('semester').isInt(),
    body('academic_year_id').isInt(),
    validate
  ],
  async (req, res) => {
    try {
      const { title, description, subject_id, department_id, year, semester, academic_year_id, due_date, max_marks, group_id } = req.body;
      const attachmentPath = req.file ? `/uploads/assignments/${req.file.filename}` : null;
      const attachmentName = req.file ? req.file.originalname : null;

      const rRes = await query(
        `INSERT INTO assessments
         (teacher_id, subject_id, department_id, group_id, year, semester, academic_year_id, type, title, description, attachment_path, attachment_name, due_date, max_marks)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ASSIGNMENT', ?, ?, ?, ?, ?, ?)`,
        [req.user.teacher_id, subject_id || null, department_id, group_id || null, year, semester, academic_year_id, title, description || null, attachmentPath, attachmentName, due_date || null, max_marks || 100]
      );
      const assignmentId = rRes.insertId;

      // Log audit
      await auditService.logAudit({
        eventType: 'ASSIGNMENT_CREATED',
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'TEACHER',
        targetType: 'assignments',
        targetId: assignmentId,
        details: { title, group_id, due_date, max_marks }
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
            type: notificationService.NOTIFICATION_TYPES.ASSIGNMENT_POSTED,
            title: `New Assignment: ${title}`,
            message: `A new assignment "${title}" has been posted. Due: ${due_date || 'No due date'}.`,
            linkUrl: `/student/groups.html?id=${group_id}&tab=classwork`
          });
        }
      }

      res.status(201).json({ success: true, data: { id: assignmentId } });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * List assignments.
 * - Teacher: assignments they created, with submission counts
 * - Student: assignments for their cohort, with their own submission status
 * GET /api/v1/assignments
 */
router.get('/', async (req, res) => {
  try {
    if (req.user.roles.includes('STUDENT')) {
      if (req.query.group_id) {
        const rows = await query(
          `SELECT a.*, COALESCE(sub.name, tg.subject_name, 'General Subject') as subject_name, t.full_name as teacher_name,
                  sub2.file_path as my_file_path, sub2.status as my_status, sub2.marks_obtained as my_marks, sub2.feedback as my_feedback, sub2.submitted_at as my_submitted_at
           FROM assignments a
           LEFT JOIN subjects sub ON sub.id = a.subject_id
           LEFT JOIN teaching_groups tg ON tg.id = a.group_id
           JOIN teachers t ON t.id = a.teacher_id
           LEFT JOIN assignment_submissions sub2 ON sub2.assignment_id = a.id AND sub2.student_id = ?
           WHERE a.group_id = ?
           ORDER BY a.due_date IS NULL, a.due_date ASC, a.id DESC`,
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
        `SELECT a.*, COALESCE(sub.name, tg.subject_name, 'General Subject') as subject_name, t.full_name as teacher_name,
                sub2.file_path as my_file_path, sub2.status as my_status, sub2.marks_obtained as my_marks, sub2.feedback as my_feedback, sub2.submitted_at as my_submitted_at
         FROM assignments a
         LEFT JOIN subjects sub ON sub.id = a.subject_id
         LEFT JOIN teaching_groups tg ON tg.id = a.group_id
         JOIN teachers t ON t.id = a.teacher_id
         LEFT JOIN assignment_submissions sub2 ON sub2.assignment_id = a.id AND sub2.student_id = ?
         WHERE ((a.department_id = ? AND a.year = ? AND a.semester = ? AND a.academic_year_id = ?)
                OR (a.group_id IN (SELECT group_id FROM teaching_group_members WHERE student_id = ? AND (status = 'ACTIVE' OR status = 'ENROLLED'))))
         ORDER BY a.due_date IS NULL, a.due_date ASC, a.id DESC`,
        [req.user.student_id, c.department_id || 0, c.year || 0, c.semester || 0, c.academic_year_id || 0, req.user.student_id]
      );
      return res.json({ success: true, data: rows });
    }

    // Teacher / Admin view
    let sql = `
      SELECT a.*, COALESCE(sub.name, tg.subject_name, 'General Subject') as subject_name, d.name as department_name, d.name as branch_name,
             (SELECT COUNT(*) FROM assignment_submissions s WHERE s.assignment_id = a.id) as submission_count,
             CASE
               WHEN a.group_id IS NOT NULL THEN
                 (SELECT COUNT(*) FROM teaching_group_members tgm WHERE tgm.group_id = a.group_id AND (tgm.status = 'ACTIVE' OR tgm.status = 'ENROLLED'))
               ELSE
                 (SELECT COUNT(*) FROM enrollments e WHERE e.department_id = a.department_id
                    AND e.year = a.year AND e.semester = a.semester AND e.academic_year_id = a.academic_year_id AND e.status = 'ENROLLED')
             END as class_size
      FROM assignments a
      LEFT JOIN subjects sub ON sub.id = a.subject_id
      LEFT JOIN teaching_groups tg ON tg.id = a.group_id
      LEFT JOIN departments d ON d.id = a.department_id
      WHERE 1=1
    `;
    const params = [];

    if (req.user.teacher_id && !req.user.roles?.includes('SYSTEM_ADMIN')) {
      sql += ` AND a.teacher_id = ?`;
      params.push(req.user.teacher_id);
    }

    if (req.query.group_id) {
      sql += ` AND a.group_id = ?`;
      params.push(Number(req.query.group_id));
    }
    if (req.query.subject_id) {
      sql += ` AND a.subject_id = ?`;
      params.push(Number(req.query.subject_id));
    }
    if (req.query.department_id) {
      sql += ` AND a.department_id = ?`;
      params.push(Number(req.query.department_id));
    }
    if (req.query.year) {
      sql += ` AND a.year = ?`;
      params.push(Number(req.query.year));
    }
    if (req.query.semester) {
      sql += ` AND a.semester = ?`;
      params.push(Number(req.query.semester));
    }
    if (req.query.academic_year_id) {
      sql += ` AND a.academic_year_id = ?`;
      params.push(Number(req.query.academic_year_id));
    }

    sql += ` ORDER BY a.id DESC`;
    const rows = await query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Teacher: view submissions for one assignment (for grading).
 * GET /api/v1/assignments/:id/submissions
 */
router.get('/:id/submissions', requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const aRows = await query(`SELECT * FROM assignments WHERE id = ?`, [req.params.id]);
    if (!aRows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Assignment not found' } });
    const a = aRows[0];

    let rows;
    if (a.group_id) {
      rows = await query(
        `SELECT COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no, s.id as student_id,
                s.official_enrollment_no, s.registration_no, s.full_name,
                sub.id as submission_id, sub.file_path, sub.original_filename, sub.submitted_at,
                sub.status, sub.marks_obtained, sub.feedback
         FROM teaching_group_members tgm
         JOIN students s ON tgm.student_id = s.id
         LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
         LEFT JOIN assignment_submissions sub ON sub.assignment_id = ? AND sub.student_id = s.id
         WHERE tgm.group_id = ? AND (tgm.status = 'ACTIVE' OR tgm.status = 'ENROLLED')
         ORDER BY COALESCE(s.class_roll_no, e.class_roll_no) ASC`,
        [a.id, a.group_id]
      );
    } else {
      rows = await query(
        `SELECT COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no, s.id as student_id,
                s.official_enrollment_no, s.registration_no, s.full_name,
                sub.id as submission_id, sub.file_path, sub.original_filename, sub.submitted_at,
                sub.status, sub.marks_obtained, sub.feedback
         FROM enrollments e
         JOIN students s ON e.student_id = s.id
         LEFT JOIN assignment_submissions sub ON sub.assignment_id = ? AND sub.student_id = s.id
         WHERE e.department_id = ? AND e.year = ? AND e.semester = ? AND e.academic_year_id = ? AND e.status = 'ENROLLED'
         ORDER BY COALESCE(s.class_roll_no, e.class_roll_no) ASC`,
        [a.id, a.department_id, a.year, a.semester, a.academic_year_id]
      );
    }
    res.json({ success: true, data: { assignment: a, roster: rows } });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Student: submit (or replace) their file for an assignment.
 * POST /api/v1/assignments/:id/submit  (multipart/form-data, field name: file)
 */
router.post('/:id/submit', requireRole('STUDENT'), uploadSubmission.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Please choose a file to upload (PPT, DOC, PDF, etc.)' } });
    }
    const aRows = await query(`SELECT due_date FROM assignments WHERE id = ?`, [req.params.id]);
    if (!aRows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Assignment not found' } });

    const isLate = aRows[0].due_date && new Date() > new Date(aRows[0].due_date);
    const filePath = `/uploads/submissions/${req.file.filename}`;

    await query(
      `INSERT INTO assessment_submissions (assessment_id, student_id, file_path, original_filename, status)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE file_path = VALUES(file_path), original_filename = VALUES(original_filename),
         status = VALUES(status), submitted_at = CURRENT_TIMESTAMP`,
      [req.params.id, req.user.student_id, filePath, req.file.originalname, isLate ? 'LATE' : 'SUBMITTED']
    );

    res.json({ success: true, message: 'Submission uploaded successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Teacher: grade one submission.
 * PUT /api/v1/assignments/submissions/:submissionId/grade  { marks_obtained, feedback }
 */
router.put('/submissions/:submissionId/grade', requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const { marks_obtained, feedback } = req.body;
    const result = await query(
      `UPDATE assessment_submissions
       SET marks_obtained = ?, feedback = ?, status = 'GRADED', graded_at = CURRENT_TIMESTAMP, graded_by = ?
       WHERE id = ?`,
      [marks_obtained ?? null, feedback || null, req.user.id, req.params.submissionId]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Submission not found' } });

    // Fetch submission details for student notification
    try {
      const subDetails = await query(
        `SELECT sub.student_id, s.user_id, a.id as assignment_id, a.title, a.group_id, a.max_marks
         FROM assessment_submissions sub
         JOIN students s ON s.id = sub.student_id
         JOIN assessments a ON a.id = sub.assessment_id
         WHERE sub.id = ?`,
        [req.params.submissionId]
      );
      if (subDetails.length && subDetails[0].user_id) {
        const sInfo = subDetails[0];
        await notificationService.sendNotification({
          userId: sInfo.user_id,
          type: notificationService.NOTIFICATION_TYPES.ASSIGNMENT_GRADED,
          title: `Assignment Graded: ${sInfo.title}`,
          message: `Your submission for "${sInfo.title}" has been graded: ${marks_obtained !== undefined ? marks_obtained : 'N/A'}/${sInfo.max_marks || 100}.`,
          linkUrl: sInfo.group_id ? `/student/groups.html?id=${sInfo.group_id}&tab=classwork` : `/student/assignments.html`
        });
      }

      await auditService.logAudit({
        eventType: auditService.AUDIT_EVENTS.ASSIGNMENT_GRADED,
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'TEACHER',
        targetType: 'assessment_submissions',
        targetId: req.params.submissionId,
        details: { marks_obtained, feedback },
        ipAddress: req.ip
      });
    } catch (auditErr) {
      // Non-fatal
    }

    res.json({ success: true, message: 'Grade saved.' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Teacher: delete an assignment and all its submissions.
 * DELETE /api/v1/assignments/:id
 */
router.delete('/:id', requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const [asgn] = await query('SELECT * FROM assessments WHERE id = ? AND type = ?', [req.params.id, 'ASSIGNMENT']);
    if (!asgn) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Assignment not found' } });
    if (req.user.role !== 'SYSTEM_ADMIN' && asgn.created_by !== req.user.id) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You can only delete your own assignments' } });
    }
    await query('DELETE FROM assessment_submissions WHERE assessment_id = ?', [req.params.id]);
    await query('DELETE FROM assessments WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Assignment deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;

