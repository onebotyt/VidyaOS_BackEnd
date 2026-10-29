/**
 * Leave Application Routes (/api/v1/leave/*)
 * Delegates request processing to LeaveController.
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const leaveController = require('../controllers/leaveController');

router.use(auth);

// @route   POST /api/v1/leave
// @desc    Submit student leave application
// @access  Protected (STUDENT)
// @handler LeaveController.applyLeave -> LeaveModel.createApplication()
router.post(
  '/',
  requireRole('STUDENT'),
  [
    body('from_date').isISO8601().withMessage('from_date is required (YYYY-MM-DD)'),
    body('to_date').isISO8601().withMessage('to_date is required (YYYY-MM-DD)'),
    body('reason').trim().isLength({ min: 3 }).withMessage('Please add a short reason'),
    validate
  ],
  (req, res) => leaveController.applyLeave(req, res)
);

// @route   GET /api/v1/leave/my
// @desc    View leave history for logged-in student
// @access  Protected (STUDENT)
// @handler LeaveController.getMyLeaves -> LeaveModel.getByStudentId()
router.get('/my', requireRole('STUDENT'), (req, res) => leaveController.getMyLeaves(req, res));

// @route   GET /api/v1/leave
// @desc    List leave applications for review by teacher / HOD
// @access  Protected (TEACHER, HOD, SYSTEM_ADMIN)
// @handler LeaveController.getLeaveRequests -> LeaveModel.getForTeacher()
router.get('/', requireRole('TEACHER', 'HOD', 'SYSTEM_ADMIN'), (req, res) => leaveController.getLeaveRequests(req, res));

// @route   PUT /api/v1/leave/:id/decision
// @desc    Adjudicate (approve/reject) student leave application
// @access  Protected (TEACHER, HOD, SYSTEM_ADMIN)
// @handler LeaveController.decideLeave -> LeaveModel.updateDecision()
router.put(
  '/:id/decision',
  requireRole('TEACHER', 'HOD', 'SYSTEM_ADMIN'),
  [body('decision').isIn(['APPROVED', 'REJECTED']).withMessage("decision must be 'APPROVED' or 'REJECTED'"), validate],
  (req, res) => leaveController.decideLeave(req, res)
);

module.exports = router;
