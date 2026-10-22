/**
 * Timetable Controller — HTTP request/response handlers for class schedules.
 */

const timetableModel = require('../models/timetableModel');
const logger = require('../utils/logger');

class TimetableController {
  /**
   * Retrieves timetable slots for student or cohort.
   * 
   * @route GET /api/v1/timetable (routes/timetable.js)
   * @access Protected (All Authenticated Users)
   * @usesModel TimetableModel.getStudentCohort() (models/timetableModel.js)
   * @usesModel TimetableModel.getSlots() (models/timetableModel.js)
   */
  async getTimetable(req, res) {
    try {
      let cohort;
      if (req.user.roles.includes('STUDENT')) {
        cohort = await timetableModel.getStudentCohort(req.user.student_id);
        if (!cohort) return res.json({ success: true, data: [] });
      } else {
        const effDeptId = req.query.department_id || req.query.branch_id;
        const { year, semester, academic_year_id } = req.query;
        if (!effDeptId || !year || !semester || !academic_year_id) {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'department_id, year, semester, academic_year_id are all required' }
          });
        }
        cohort = { department_id: effDeptId, year, semester, academic_year_id };
      }

      const rows = await timetableModel.getSlots({
        departmentId: cohort.department_id,
        year: cohort.year,
        semester: cohort.semester,
        academicYearId: cohort.academic_year_id
      });

      return res.json({ success: true, data: rows });
    } catch (err) {
      logger.error('[TimetableController] getTimetable error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Schedules a new timetable slot.
   * 
   * @route POST /api/v1/timetable (routes/timetable.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel TimetableModel.createSlot() (models/timetableModel.js)
   */
  async addSlot(req, res) {
    try {
      const { department_id, year, semester, academic_year_id, subject_id, day_of_week, start_time, end_time, room, session_type } = req.body;
      const id = await timetableModel.createSlot({
        departmentId: department_id,
        year,
        semester,
        academicYearId: academic_year_id,
        subjectId: subject_id,
        teacherId: req.user.teacher_id,
        dayOfWeek: day_of_week,
        startTime: start_time,
        endTime: end_time,
        room,
        sessionType: session_type,
        createdBy: req.user.id
      });
      return res.status(201).json({ success: true, data: { id } });
    } catch (err) {
      logger.error('[TimetableController] addSlot error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Removes a scheduled timetable slot.
   * 
   * @route DELETE /api/v1/timetable/:id (routes/timetable.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel TimetableModel.deleteSlot() (models/timetableModel.js)
   */
  async removeSlot(req, res) {
    try {
      await timetableModel.deleteSlot(req.params.id);
      return res.json({ success: true, message: 'Slot removed' });
    } catch (err) {
      logger.error('[TimetableController] removeSlot error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = new TimetableController();
