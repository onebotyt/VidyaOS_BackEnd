/**
 * Student Record Controller
 * Exposes endpoints for the Student Records System:
 * - GET /api/v1/student-records/filters
 * - GET /api/v1/student-records
 * - GET /api/v1/student-records/:id/dossier
 * - GET /api/v1/student-records/export
 */

const StudentRecordModel = require('../models/studentRecordModel');

function resolveDeptId(req) {
  let deptId = req.hod_department_id || req.user?.hod_department_id || req.user?.department_id || req.query?.department_id;
  if (!deptId) {
    return 4; // Default institutional department (Information Technology)
  }
  return Number(deptId);
}

class StudentRecordController {
  /**
   * Retrieves filter criteria (Sessions, Years, Semesters, Batches)
   * @route GET /api/v1/student-records/filters
   */
  static async getFilters(req, res) {
    try {
      const deptId = resolveDeptId(req);
      const data = await StudentRecordModel.getFilterOptions(deptId);
      res.json({ success: true, data });
    } catch (err) {
      console.error('Error in getFilters:', err);
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  }

  /**
   * Retrieves student records with demographic and academic summaries
   * @route GET /api/v1/student-records
   */
  static async getStudents(req, res) {
    try {
      const deptId = resolveDeptId(req);
      const {
        academic_year_id,
        year,
        semester,
        batch,
        search,
        status = 'active',
        page = 1,
        limit = 100
      } = req.query;

      const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);

      const result = await StudentRecordModel.getStudents({
        deptId,
        academicYearId: academic_year_id ? Number(academic_year_id) : null,
        year: year ? Number(year) : null,
        semester: semester ? Number(semester) : null,
        batch: batch || null,
        search: search || null,
        status,
        limit: parseInt(limit, 10),
        offset
      });

      const isWorkSearch = Boolean(result && result.isWorkSearch);
      const rows = result.rows || result;
      const students = result.students || (isWorkSearch ? [] : rows);
      const records = result.records || (isWorkSearch ? rows : []);

      res.json({
        success: true,
        data: rows,
        students,
        records,
        meta: {
          is_work_search: isWorkSearch,
          work_type: result.searchParsed?.workType || null,
          subject: result.searchParsed?.subjectKeyword || null,
          roll_no: result.searchParsed?.rollNo || null,
          search_query: search || '',
          count: rows.length,
          students_count: students.length,
          records_count: records.length,
          page: parseInt(page, 10),
          limit: parseInt(limit, 10)
        }
      });
    } catch (err) {
      console.error('Error in getStudents:', err);
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  }

  /**
   * Retrieves a student's full historical dossier (Demographics, Tests, Assignments, Attendance, Documents)
   * @route GET /api/v1/student-records/:id/dossier
   */
  static async getStudentDossier(req, res) {
    try {
      const deptId = resolveDeptId(req);
      const studentId = parseInt(req.params.id, 10);

      const dossier = await StudentRecordModel.getStudentFullDossier(studentId, deptId);
      if (!dossier) {
        return res.status(404).json({ success: false, error: { message: 'Student dossier not found' } });
      }

      res.json({ success: true, data: dossier });
    } catch (err) {
      console.error('Error in getStudentDossier:', err);
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  }

  /**
   * Retrieves structured classwork evaluation sheet data for PC Excel view and multi-format export
   * @route GET /api/v1/student-records/classwork-sheet
   */
  static async getClassworkSheet(req, res) {
    try {
      const deptId = resolveDeptId(req);
      const { semester = 5, classwork_type = 'TEST_1', test_id } = req.query;

      const sheetData = await StudentRecordModel.getClassworkEvaluationSheet({
        deptId,
        semester: Number(semester) || 5,
        classworkType: classwork_type,
        testId: test_id || null
      });

      if (!sheetData) {
        return res.status(404).json({ success: false, error: { message: 'Evaluation sheet data not found' } });
      }

      res.json({ success: true, data: sheetData });
    } catch (err) {
      console.error('Error in getClassworkSheet:', err);
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  }

  /**
   * Retrieves full cohort data for export
   * @route GET /api/v1/student-records/export
   */
  static async exportCohort(req, res) {
    try {
      const deptId = resolveDeptId(req);
      const { academic_year_id, year, semester, batch } = req.query;

      const data = await StudentRecordModel.getCohortExportData({
        deptId,
        academicYearId: academic_year_id ? Number(academic_year_id) : null,
        year: year ? Number(year) : null,
        semester: semester ? Number(semester) : null,
        batch: batch || null
      });

      res.json({ success: true, data });
    } catch (err) {
      console.error('Error in exportCohort:', err);
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  }
}

module.exports = StudentRecordController;
