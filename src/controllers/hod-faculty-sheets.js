/**
 * ══════════════════════════════════════════════════════════════
 * HOD-FACULTY SHEETS CONTROLLER (hod-faculty-sheets.js)
 * Shared Controller for Sheet Studio Internal Evaluation & Marks Data
 * Base Route:
 *   - GET /api/v1/faculty/registers/:id/internal-evaluation
 * Access: TEACHER, FACULTY, HOD, SYSTEM_ADMIN
 * Note: All spreadsheet formatting, formula calculation, and
 *       exporting (Excel, PDF, Word, CSV) are handled 100% on the
 *       client-side UI without server bloat.
 * ══════════════════════════════════════════════════════════════
 */

const FacultyModel = require('../models/facultyModel');

class HodFacultySheetsController {
  /**
   * Returns calculated internal evaluation data (attendance %, class test scores, coursework marks, and student list)
   * @route GET /api/v1/faculty/registers/:id/internal-evaluation
   * @access TEACHER, HOD, SYSTEM_ADMIN
   */
  static async getInternalEvaluation(req, res) {
    const registerId = req.params.id;
    const teacherId = req.user.teacher_id;

    try {
      const register = await FacultyModel.getRegisterById(registerId);
      if (!register) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Register not found' } });
      }

      const isAdmin = req.user.roles?.includes('SYSTEM_ADMIN');
      const isDeptHod = req.user.is_hod && req.user.hod_department_id === register.department_id;
      if (teacherId && register.teacher_id !== teacherId && !isAdmin && !isDeptHod) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You do not have access to this register' } });
      }

      const evalData = await FacultyModel.getInternalEvaluationData(registerId, register);
      res.json({
        success: true,
        data: {
          register,
          institution_name: evalData.institution_name,
          assignments: evalData.assignments,
          exams: evalData.exams,
          roster: evalData.roster
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = HodFacultySheetsController;
