/**
 * Leave Application Routes (/api/v1/leave/*)
 * Students apply for leave; their subject/class teachers approve or reject.
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { query } = require('../config/db');

router.use(auth);

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg } });
  }
  next();
}

/**
 * Student: Apply for leave
 * POST /api/v1/leave
 */
router.post(
  '/',
  requireRole('STUDENT'),
  [
    body('from_date').isISO8601().withMessage('from_date is required (YYYY-MM-DD)'),
    body('to_date').isISO8601().withMessage('to_date is required (YYYY-MM-DD)'),
    body('reason').trim().isLength({ min: 3 }).withMessage('Please add a short reason'),
    validate
  ],
  async (req, res) => {
    try {
      const { from_date, to_date, reason } = req.body;
      const rRes = await query(
        `INSERT INTO leave_applications (student_id, from_date, to_date, reason, status)
         VALUES (?, ?, ?, ?, 'PENDING')`,
        [req.user.student_id, from_date, to_date, reason]
      );
      res.status(201).json({ success: true, data: { id: rRes.insertId } });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * Student: My leave applications
 * GET /api/v1/leave/my
 */
router.get('/my', requireRole('STUDENT'), async (req, res) => {
  try {
    const rows = await query(
      `SELECT * FROM leave_applications WHERE student_id = ? ORDER BY id DESC`,
      [req.user.student_id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Teacher: Leave requests from students in classes I teach
 * GET /api/v1/leave?status=PENDING
 */
router.get('/', requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const teacherId = req.user.teacher_id;
    const status = req.query.status;

    let where = 'WHERE 1=1';
    const params = [];
    if (status) { where += ' AND la.status = ?'; params.push(status); }

    let teacherFilter = '';
    if (teacherId) {
      teacherFilter = `AND e.department_id IN (
          SELECT department_id FROM teacher_assignments WHERE teacher_id = ? AND is_active = 1
        ) AND e.year IN (
          SELECT year FROM teacher_assignments WHERE teacher_id = ? AND is_active = 1
        ) AND e.semester IN (
          SELECT semester FROM teacher_assignments WHERE teacher_id = ? AND is_active = 1
        )`;
      params.push(teacherId, teacherId, teacherId);
    }

    const rows = await query(
      `SELECT la.*, s.official_enrollment_no, s.full_name as student_name, e.class_roll_no,
              d.name as department_name, d.name as branch_name, e.year, e.semester
       FROM leave_applications la
       JOIN students s ON la.student_id = s.id
       JOIN enrollments e ON e.student_id = s.id
       JOIN departments d ON e.department_id = d.id
       ${where} ${teacherFilter}
       ORDER BY la.status = 'PENDING' DESC, la.id DESC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Teacher: Approve / Reject a leave request
 * PUT /api/v1/leave/:id/decision  { decision: 'APPROVED'|'REJECTED', review_note }
 */
router.put(
  '/:id/decision',
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [body('decision').isIn(['APPROVED', 'REJECTED']).withMessage("decision must be 'APPROVED' or 'REJECTED'"), validate],
  async (req, res) => {
    try {
      const { decision, review_note } = req.body;
      const result = await query(
        `UPDATE leave_applications
         SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [decision, review_note || null, req.user.id, req.params.id]
      );
      if (!result.affectedRows) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Leave request not found' } });
      }
      res.json({ success: true, message: `Leave request ${decision.toLowerCase()}.` });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

module.exports = router;
