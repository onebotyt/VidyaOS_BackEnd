/**
 * Exam Controller — HTTP request/response handlers for tests, exams, and marks.
 */

const examModel = require('../models/examModel');
const notificationService = require('../services/notificationService');
const auditService = require('../services/auditService');
const excelExportService = require('../services/excelExportService');
const { query } = require('../config/db');
const logger = require('../utils/logger');

class ExamController {
  /**
   * Schedules a new class test or internal evaluation.
   * 
   * @route POST /api/v1/exams (routes/exams.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel ExamModel.create() (models/examModel.js)
   * @usesModel ExamModel.getGroupMemberUserIds() (models/examModel.js)
   * @usesService AuditService.logAudit() (services/auditService.js)
   * @usesService NotificationService.sendBatchNotification() (services/notificationService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async createExam(req, res) {
    try {
      const { name, subject_id, department_id, year, semester, academic_year_id, exam_date, max_marks, group_id, unit_name, unit, instructions, questions } = req.body;
      
      let parsedQuestions = questions;
      if (typeof parsedQuestions === 'string') {
        try { parsedQuestions = JSON.parse(parsedQuestions); } catch (_) {}
      }
      if (Array.isArray(parsedQuestions) && parsedQuestions.length > 0 && max_marks) {
        const splitMark = Math.round((Number(max_marks) / parsedQuestions.length) * 10) / 10;
        parsedQuestions = parsedQuestions.map((q, idx) => ({
          num: q.num || idx + 1,
          label: q.label || `Q${idx + 1}`,
          text: q.text || '',
          max: (q.max !== undefined && q.max !== null && q.max !== '') ? Number(q.max) : splitMark
        }));
      }

      const examId = await examModel.create({
        teacherId: req.user.teacher_id,
        subjectId: subject_id,
        departmentId: department_id,
        groupId: group_id,
        year,
        semester,
        academicYearId: academic_year_id,
        name,
        examDate: exam_date,
        maxMarks: max_marks,
        unitName: (unit_name || unit || '').trim() || null,
        instructions,
        questions: parsedQuestions
      });

      await auditService.logAudit({
        eventType: 'TEST_SCHEDULED',
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'TEACHER',
        targetType: 'exams',
        targetId: examId,
        details: { name, group_id, exam_date, max_marks },
        ipAddress: req.ip
      });

      if (group_id) {
        const userIds = await examModel.getGroupMemberUserIds(group_id);
        if (userIds.length > 0) {
          await notificationService.sendBatchNotification({
            userIds,
            type: notificationService.NOTIFICATION_TYPES.ADMIN_NOTICE,
            title: `Upcoming Test: ${name}`,
            message: `A new test "${name}" has been scheduled for ${exam_date || 'TBD'}. Max Marks: ${max_marks || 100}.`,
            linkUrl: `/student/groups.html?id=${group_id}&tab=tests`
          });
        }
      }

      return res.status(201).json({ success: true, data: { id: examId } });
    } catch (err) {
      logger.error('[ExamController] createExam error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves tests scheduled for the student's cohort or teacher's classes.
   * 
   * @route GET /api/v1/exams (routes/exams.js)
   * @access Protected (All Authenticated Users)
   * @usesModel ExamModel.listForStudent() (models/examModel.js)
   * @usesModel ExamModel.listForTeacher() (models/examModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async listExams(req, res) {
    try {
      if (req.user.roles.includes('STUDENT')) {
        const rows = await examModel.listForStudent({
          studentId: req.user.student_id,
          groupId: req.query.group_id
        });
        return res.json({ success: true, data: rows });
      }

      const rows = await examModel.listForTeacher({
        teacherId: req.user.teacher_id,
        isSystemAdmin: req.user.roles?.includes('SYSTEM_ADMIN'),
        groupId: req.query.group_id,
        subjectId: req.query.subject_id,
        departmentId: req.query.department_id,
        year: req.query.year,
        semester: req.query.semester,
        academicYearId: req.query.academic_year_id
      });
      return res.json({ success: true, data: rows });
    } catch (err) {
      logger.error('[ExamController] listExams error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves student marks roster and test blueprint metadata.
   * 
   * @route GET /api/v1/exams/:id/roster (routes/exams.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel ExamModel.getById() (models/examModel.js)
   * @usesModel ExamModel.getMeta() (models/examModel.js)
   * @usesModel ExamModel.getRoster() (models/examModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async getRoster(req, res) {
    try {
      const ex = await examModel.getById(req.params.id);
      if (!ex) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Test not found' } });
      }
      const meta = await examModel.getMeta(req.params.id);
      const parsedRoster = await examModel.getRoster(ex);
      return res.json({ success: true, data: { exam: ex, meta, roster: parsedRoster } });
    } catch (err) {
      logger.error('[ExamController] getRoster error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Bulk-saves student test scores, absence records, and exam blueprint.
   * 
   * @route POST /api/v1/exams/:id/scores (routes/exams.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel ExamModel.saveScores() (models/examModel.js)
   * @usesService AuditService.logAudit() (services/auditService.js)
   * @usesService NotificationService.sendNotification() (services/notificationService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async saveScores(req, res) {
    try {
      await examModel.saveScores(req.params.id, req.body.scores, req.body.meta, req.user.id);

      try {
        await auditService.logAudit({
          eventType: auditService.AUDIT_EVENTS.TEST_MARK_UPDATED,
          actorId: req.user.id,
          actorRole: req.user.roles?.[0] || 'TEACHER',
          targetType: 'exams',
          targetId: req.params.id,
          details: { count: req.body.scores?.length },
          ipAddress: req.ip
        });

        const examDetails = await query('SELECT title, group_id, max_marks FROM assessments WHERE id = ?', [req.params.id]);
        const exTitle = examDetails[0]?.title || 'Class Test';
        const exGroupId = examDetails[0]?.group_id;
        const exMaxMarks = examDetails[0]?.max_marks || 100;

        for (const s of req.body.scores) {
          if (s.marks_obtained !== undefined && s.marks_obtained !== null && s.marks_obtained !== '') {
            const studentUsers = await query('SELECT user_id FROM students WHERE id = ?', [s.student_id]);
            if (studentUsers[0]?.user_id) {
              await notificationService.sendNotification({
                userId: studentUsers[0].user_id,
                type: notificationService.NOTIFICATION_TYPES.TEST_MARKS_PUBLISHED,
                title: `Test Score Published: ${exTitle}`,
                message: `Your score for "${exTitle}" is ${s.marks_obtained}/${exMaxMarks}.`,
                linkUrl: exGroupId ? `/student/groups.html?id=${exGroupId}&tab=tests` : `/student/tests.html`
              });
            }
          }
        }
      } catch (auditErr) {
        // Non-fatal
      }

      return res.json({ success: true, message: 'Marks and evaluation details saved.' });
    } catch (err) {
      logger.error('[ExamController] saveScores error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Generates and downloads official class test marksheet Excel workbook (.xlsx).
   * 
   * @route GET /api/v1/exams/:id/export/excel (routes/exams.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel ExamModel.getExportDetails() (models/examModel.js)
   * @usesModel ExamModel.getInstitutionName() (models/examModel.js)
   * @usesModel ExamModel.getMeta() (models/examModel.js)
   * @usesModel ExamModel.getRoster() (models/examModel.js)
   * @usesService ExcelExportService.generateClassTestExcel() (services/excelExportService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async exportExcel(req, res) {
    try {
      const ex = await examModel.getExportDetails(req.params.id);
      if (!ex) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Test not found' } });

      const instName = await examModel.getInstitutionName();
      const meta = await examModel.getMeta(req.params.id);
      const roster = await examModel.getRoster(ex);

      const exportPayload = {
        institution_name: instName,
        session_label: `Internal Evaluation Sheet ${ex.academic_year_label || '2026-27 (Odd Semester)'}`,
        department_name: ex.department_name,
        department_code: ex.department_code,
        subject_name: ex.subject_name,
        year: ex.year,
        semester: ex.semester,
        title: ex.name,
        max_marks: ex.max_marks,
        exam_date: ex.exam_date,
        duration: meta.duration || '50 minutes',
        mode: meta.mode || 'OFFLINE',
        questions: meta.questions,
        instructions: meta.instructions,
        question_texts: meta.question_texts,
        roster
      };

      const buffer = await excelExportService.generateClassTestExcel(exportPayload);
      const safeTitle = (ex.name || 'Class_Test').replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeSubj = (ex.subject_name || 'Subject').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${safeTitle}_${safeSubj}_Marksheet.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } catch (err) {
      logger.error('[ExamController] exportExcel error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Generates and downloads customized class test marksheet Excel workbook (.xlsx).
   * 
   * @route POST /api/v1/exams/:id/export/excel (routes/exams.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel ExamModel.getExportDetails() (models/examModel.js)
   * @usesModel ExamModel.getInstitutionName() (models/examModel.js)
   * @usesService ExcelExportService.generateClassTestExcel() (services/excelExportService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async exportCustomExcel(req, res) {
    try {
      const ex = (await examModel.getExportDetails(req.params.id)) || {};
      const instName = await examModel.getInstitutionName();
      const customData = req.body || {};

      const exportPayload = {
        institution_name: customData.institution_name || instName,
        session_label: customData.session_label || `Internal Evaluation Sheet ${ex.academic_year_label || '2026-27 (Odd Semester)'}`,
        department_name: customData.department_name || ex.department_name,
        department_code: customData.department_code || ex.department_code,
        subject_name: customData.subject_name || ex.subject_name,
        year: customData.year || ex.year || (ex.semester ? Math.ceil(ex.semester / 2) : 1),
        semester: customData.semester || ex.semester || 1,
        title: customData.title || ex.name || 'Unit Test',
        max_marks: customData.max_marks || ex.max_marks || 10,
        exam_date: customData.exam_date || ex.exam_date,
        duration: customData.duration || '50 minutes',
        mode: customData.mode || 'OFFLINE',
        questions: customData.questions,
        instructions: customData.instructions,
        question_texts: customData.question_texts,
        roster: customData.roster || []
      };

      const buffer = await excelExportService.generateClassTestExcel(exportPayload);
      const safeTitle = (exportPayload.title || 'Class_Test').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${safeTitle}_Custom_Marksheet.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } catch (err) {
      logger.error('[ExamController] exportCustomExcel error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Deletes a class test and its associated student scores.
   * 
   * @route DELETE /api/v1/exams/:id (routes/exams.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel ExamModel.deleteExam() (models/examModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async deleteExam(req, res) {
    try {
      const [exam] = await query('SELECT * FROM assessments WHERE id = ? AND type != ?', [req.params.id, 'ASSIGNMENT']);
      if (!exam) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Class test not found' } });
      if (req.user.role !== 'SYSTEM_ADMIN' && exam.created_by !== req.user.id) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You can only delete your own class tests' } });
      }
      await examModel.deleteExam(req.params.id);
      return res.json({ success: true, message: 'Class test deleted.' });
    } catch (err) {
      logger.error('[ExamController] deleteExam error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = new ExamController();
