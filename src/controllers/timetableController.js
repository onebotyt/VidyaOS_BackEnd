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

  /**
   * Retrieves uploaded PDF timetables by year or department.
   * Auto-detects student's year when accessed by student.
   * @route GET /api/v1/timetable/pdf
   */
  async getPdfTimetables(req, res) {
    try {
      let year = req.query.year ? parseInt(req.query.year, 10) : null;
      let departmentId = req.query.department_id ? parseInt(req.query.department_id, 10) : null;

      // Auto-detect student year & department if student is requesting
      const isStudent = Boolean(
        req.user &&
        ((Array.isArray(req.user.roles) && req.user.roles.includes('STUDENT')) || req.user.role === 'STUDENT')
      );

      if (isStudent) {
        const studentId = req.user.student_id || req.user.id;
        const cohort = await timetableModel.getStudentCohort(studentId);
        if (cohort) {
          if (!year) year = cohort.year;
          if (!departmentId) departmentId = cohort.department_id;
        }
      }

      const rows = await timetableModel.getPdfTimetables({ year, departmentId });
      return res.json({
        success: true,
        data: rows,
        student_year: isStudent ? year : null
      });
    } catch (err) {
      logger.error('[TimetableController] getPdfTimetables error:', { error: err.message });
      return res.status(500).json({ success: false, error: { message: err.message } });
    }
  }

  /**
   * Uploads a Timetable PDF according to Year.
   * @route POST /api/v1/timetable/pdf
   */
  async uploadPdfTimetable(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: { message: 'PDF file is required' } });
      }

      const year = parseInt(req.body.year, 10);
      if (!year || isNaN(year) || year < 1 || year > 6) {
        return res.status(400).json({
          success: false,
          error: { message: 'Please select a valid academic year (1, 2, 3, or 4)' }
        });
      }

      const yearLabels = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year' };
      const defaultTitle = `${yearLabels[year] || year + 'th Year'} Academic Timetable`;
      const title = (req.body.title || '').trim() || defaultTitle;
      const departmentId = req.body.department_id ? parseInt(req.body.department_id, 10) : (req.user.department_id || null);
      const filePath = `/uploads/timetable/${req.file.filename}`;
      const fileName = req.file.originalname;
      const fileSize = req.file.size;
      const uploadedBy = req.user.id;
      const uploaderName = req.user.full_name || req.user.username || 'Faculty Member';

      const saved = await timetableModel.createPdfTimetable({
        departmentId,
        year,
        semester: req.body.semester ? parseInt(req.body.semester, 10) : null,
        academicYearId: req.body.academic_year_id ? parseInt(req.body.academic_year_id, 10) : null,
        title,
        filePath,
        fileName,
        fileSize,
        uploadedBy,
        uploaderName
      });

      return res.status(201).json({
        success: true,
        message: `${yearLabels[year] || 'Year ' + year} Timetable PDF uploaded successfully`,
        data: saved
      });
    } catch (err) {
      logger.error('[TimetableController] uploadPdfTimetable error:', { error: err.message });
      return res.status(500).json({ success: false, error: { message: err.message } });
    }
  }

  /**
   * Deletes an uploaded PDF timetable.
   * @route DELETE /api/v1/timetable/pdf/:id
   */
  async deletePdfTimetable(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const deleted = await timetableModel.deletePdfTimetable(id);
      if (!deleted) {
        return res.status(404).json({ success: false, error: { message: 'Timetable PDF not found' } });
      }
      return res.json({ success: true, message: 'Timetable PDF deleted successfully' });
    } catch (err) {
      logger.error('[TimetableController] deletePdfTimetable error:', { error: err.message });
      return res.status(500).json({ success: false, error: { message: err.message } });
    }
  }
}

module.exports = new TimetableController();
