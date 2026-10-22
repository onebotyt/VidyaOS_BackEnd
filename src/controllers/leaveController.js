/**
 * Leave Controller — HTTP request/response handlers for student leave applications.
 */

const leaveModel = require('../models/leaveModel');
const logger = require('../utils/logger');

class LeaveController {
  /**
   * Submits a student leave application.
   * 
   * @route POST /api/v1/leave (routes/leave.js)
   * @access Protected (STUDENT)
   * @usesModel LeaveModel.createApplication() (models/leaveModel.js)
   */
  async applyLeave(req, res) {
    try {
      const { from_date, to_date, reason } = req.body;
      const id = await leaveModel.createApplication({
        studentId: req.user.student_id,
        fromDate: from_date,
        toDate: to_date,
        reason
      });
      return res.status(201).json({ success: true, data: { id } });
    } catch (err) {
      logger.error('[LeaveController] applyLeave error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves past and pending leave applications submitted by the logged-in student.
   * 
   * @route GET /api/v1/leave/my (routes/leave.js)
   * @access Protected (STUDENT)
   * @usesModel LeaveModel.getByStudentId() (models/leaveModel.js)
   */
  async getMyLeaves(req, res) {
    try {
      const rows = await leaveModel.getByStudentId(req.user.student_id);
      return res.json({ success: true, data: rows });
    } catch (err) {
      logger.error('[LeaveController] getMyLeaves error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves leave applications filed by students in teacher's assigned classes.
   * 
   * @route GET /api/v1/leave (routes/leave.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel LeaveModel.getForTeacher() (models/leaveModel.js)
   */
  async getLeaveRequests(req, res) {
    try {
      const teacherId = req.user.teacher_id;
      const status = req.query.status;
      const rows = await leaveModel.getForTeacher({ teacherId, status });
      return res.json({ success: true, data: rows });
    } catch (err) {
      logger.error('[LeaveController] getLeaveRequests error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Adjudicates (approves or rejects) a student leave application.
   * 
   * @route PUT /api/v1/leave/:id/decision (routes/leave.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel LeaveModel.updateDecision() (models/leaveModel.js)
   */
  async decideLeave(req, res) {
    try {
      const { decision, review_note } = req.body;
      const updated = await leaveModel.updateDecision({
        id: req.params.id,
        decision,
        reviewNote: review_note,
        reviewedBy: req.user.id
      });

      if (!updated) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Leave request not found' } });
      }
      return res.json({ success: true, message: `Leave request ${decision.toLowerCase()}.` });
    } catch (err) {
      logger.error('[LeaveController] decideLeave error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = new LeaveController();
