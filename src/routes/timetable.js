/**
 * Timetable Routes (/api/v1/timetable/*)
 * Delegates request processing to TimetableController.
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const timetableController = require('../controllers/timetableController');

router.use(auth);

// @route   GET /api/v1/timetable
// @desc    View timetable slots for cohort or student
// @access  Protected (All Authenticated Users)
// @handler TimetableController.getTimetable -> TimetableModel.getSlots()
router.get('/', (req, res) => timetableController.getTimetable(req, res));

// @route   POST /api/v1/timetable
// @desc    Add weekly timetable slot
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler TimetableController.addSlot -> TimetableModel.createSlot()
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
  (req, res) => timetableController.addSlot(req, res)
);

// @route   DELETE /api/v1/timetable/:id
// @desc    Remove scheduled timetable slot
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler TimetableController.removeSlot -> TimetableModel.deleteSlot()
router.delete('/:id', requireRole('TEACHER', 'SYSTEM_ADMIN'), (req, res) => timetableController.removeSlot(req, res));

module.exports = router;
