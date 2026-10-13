/**
 * Timetable Routes (/api/v1/timetable/*)
 * Teachers build a simple weekly schedule per class; students view
 * the schedule for their own cohort.
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { query } = require('../config/db');

router.use(auth);

const SELECT_BASE = `
  SELECT t.*, sub.name as subject_name, sub.code as subject_code,
         te.full_name as teacher_name, d.name as department_name, d.name as branch_name
  FROM timetable_slots t
  LEFT JOIN subjects sub ON sub.id = t.subject_id
  LEFT JOIN teachers te ON te.id = t.teacher_id
  JOIN departments d ON d.id = t.department_id
`;

/**
 * View timetable.
 * - Student: their own cohort's timetable
 * - Teacher/Admin: pass department_id, year, semester, academic_year_id
 * GET /api/v1/timetable
 */
router.get('/', async (req, res) => {
  try {
    let cohort;
    if (req.user.roles.includes('STUDENT')) {
      const enr = await query(
        `SELECT department_id, year, semester, academic_year_id FROM enrollments WHERE student_id = ? ORDER BY id DESC LIMIT 1`,
        [req.user.student_id]
      );
      if (!enr.length) return res.json({ success: true, data: [] });
      cohort = enr[0];
    } else {
      const effDeptId = req.query.department_id || req.query.branch_id;
      const { year, semester, academic_year_id } = req.query;
      if (!effDeptId || !year || !semester || !academic_year_id) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'department_id, year, semester, academic_year_id are all required' } });
      }
      cohort = { department_id: effDeptId, year, semester, academic_year_id };
    }

    const rows = await query(
      `${SELECT_BASE}
       WHERE t.department_id = ? AND t.year = ? AND t.semester = ? AND t.academic_year_id = ?
       ORDER BY t.day_of_week ASC, t.start_time ASC`,
      [cohort.department_id, cohort.year, cohort.semester, cohort.academic_year_id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Add a class slot to the timetable.
 * POST /api/v1/timetable
 */
router.post(
  '/',
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('department_id').isInt(),
    body('branch_id').optional(),
    body('year').isInt(),
    body('semester').isInt(),
    body('academic_year_id').isInt(),
    body('day_of_week').isInt({ min: 1, max: 7 }),
    body('start_time').matches(/^\d{2}:\d{2}$/).withMessage('start_time must be HH:MM'),
    body('end_time').matches(/^\d{2}:\d{2}$/).withMessage('end_time must be HH:MM'),
    validate
  ],
  async (req, res) => {
    try {
      const { department_id, year, semester, academic_year_id, subject_id, day_of_week, start_time, end_time, room, session_type } = req.body;
      const rRes = await query(
        `INSERT INTO timetable_slots
         (department_id, year, semester, academic_year_id, subject_id, teacher_id, day_of_week, start_time, end_time, room, session_type, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [department_id, year, semester, academic_year_id, subject_id || null, req.user.teacher_id || null, day_of_week, start_time, end_time, room || null, session_type || 'THEORY', req.user.id]
      );
      res.status(201).json({ success: true, data: { id: rRes.insertId || rRes.lastInsertRowid } });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * Remove a class slot.
 * DELETE /api/v1/timetable/:id
 */
router.delete('/:id', requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    await query(`DELETE FROM timetable_slots WHERE id = ?`, [req.params.id]);
    res.json({ success: true, message: 'Slot removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;
