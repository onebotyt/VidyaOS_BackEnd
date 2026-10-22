/**
 * Assignment Controller — HTTP request/response handlers for coursework assignments.
 */

const assignmentModel = require('../models/assignmentModel');
const notificationService = require('../services/notificationService');
const auditService = require('../services/auditService');
const logger = require('../utils/logger');

class AssignmentController {
  /**
   * Creates a new coursework assignment with optional attachment.
   * 
   * @route POST /api/v1/assignments (routes/assignments.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel AssignmentModel.create() (models/assignmentModel.js)
   * @usesModel AssignmentModel.getGroupMemberUserIds() (models/assignmentModel.js)
   * @usesService AuditService.logAudit() (services/auditService.js)
   * @usesService NotificationService.sendBatchNotification() (services/notificationService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async createAssignment(req, res) {
    try {
      const { title, description, subject_id, department_id, year, semester, academic_year_id, due_date, max_marks, group_id, unit_name, unit } = req.body;
      const attachmentPath = req.file ? `/uploads/assignments/${req.file.filename}` : null;
      const attachmentName = req.file ? req.file.originalname : null;

      const assignmentId = await assignmentModel.create({
        teacherId: req.user.teacher_id,
        subjectId: subject_id,
        departmentId: department_id,
        groupId: group_id,
        year,
        semester,
        academicYearId: academic_year_id,
        title,
        description,
        attachmentPath,
        attachmentName,
        dueDate: due_date,
        maxMarks: max_marks,
        unitName: (unit_name || unit || '').trim() || null
      });

      await auditService.logAudit({
        eventType: 'ASSIGNMENT_CREATED',
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'TEACHER',
        targetType: 'assignments',
        targetId: assignmentId,
        details: { title, group_id, due_date, max_marks }
      });

      if (group_id) {
        const userIds = await assignmentModel.getGroupMemberUserIds(group_id);
        if (userIds.length > 0) {
          await notificationService.sendBatchNotification({
            userIds,
            type: notificationService.NOTIFICATION_TYPES.ASSIGNMENT_POSTED,
            title: `New Assignment: ${title}`,
            message: `A new assignment "${title}" has been posted. Due: ${due_date || 'No due date'}.`,
            linkUrl: `/student/groups.html?id=${group_id}&tab=classwork`
          });
        }
      }

      return res.status(201).json({ success: true, data: { id: assignmentId } });
    } catch (err) {
      logger.error('[AssignmentController] createAssignment error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves assignments list for the calling student or teacher.
   * 
   * @route GET /api/v1/assignments (routes/assignments.js)
   * @access Protected (All Authenticated Users)
   * @usesModel AssignmentModel.listForStudent() (models/assignmentModel.js)
   * @usesModel AssignmentModel.listForTeacher() (models/assignmentModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async listAssignments(req, res) {
    try {
      if (req.user.roles.includes('STUDENT')) {
        const rows = await assignmentModel.listForStudent({
          studentId: req.user.student_id,
          groupId: req.query.group_id
        });
        return res.json({ success: true, data: rows });
      }

      const rows = await assignmentModel.listForTeacher({
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
      logger.error('[AssignmentController] listAssignments error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves submission roster and grading overview for an assignment.
   * 
   * @route GET /api/v1/assignments/:id/submissions (routes/assignments.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel AssignmentModel.getById() (models/assignmentModel.js)
   * @usesModel AssignmentModel.getSubmissionsRoster() (models/assignmentModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async getSubmissions(req, res) {
    try {
      const a = await assignmentModel.getById(req.params.id);
      if (!a) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Assignment not found' } });
      }
      const roster = await assignmentModel.getSubmissionsRoster(a);
      return res.json({ success: true, data: { assignment: a, roster } });
    } catch (err) {
      logger.error('[AssignmentController] getSubmissions error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Uploads an arbitrary document file for an assignment or submission.
   * 
   * @route POST /api/v1/assignments/upload-document (routes/assignments.js)
   * @access Protected (STUDENT, TEACHER, SYSTEM_ADMIN)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async uploadDocument(req, res) {
    if (!req.file) {
      return res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'Please select a file to upload' } });
    }
    const filePath = `/uploads/submissions/${req.file.filename}`;
    return res.json({
      success: true,
      data: {
        file_path: filePath,
        original_filename: req.file.originalname,
        size: req.file.size
      }
    });
  }

  /**
   * Submits student file for an assignment assessment.
   * 
   * @route POST /api/v1/assignments/:id/submit (routes/assignments.js)
   * @access Protected (STUDENT)
   * @usesModel AssignmentModel.getById() (models/assignmentModel.js)
   * @usesModel AssignmentModel.upsertSubmission() (models/assignmentModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async submitAssignment(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Please choose a file to upload (PDF, DOCX, ZIP, etc.)' } });
      }
      const a = await assignmentModel.getById(req.params.id);
      if (!a) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Work item not found' } });
      }

      const isLate = a.due_date && new Date() > new Date(a.due_date);
      const filePath = `/uploads/submissions/${req.file.filename}`;

      await assignmentModel.upsertSubmission({
        assessmentId: req.params.id,
        studentId: req.user.student_id,
        filePath,
        originalFilename: req.file.originalname,
        status: isLate ? 'LATE' : 'SUBMITTED'
      });

      return res.json({ success: true, message: 'Submission uploaded successfully.' });
    } catch (err) {
      logger.error('[AssignmentController] submitAssignment error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Submits bundle of finalized documents for institutional evaluation.
   * 
   * @route POST /api/v1/assignments/:id/submit-final-docs (routes/assignments.js)
   * @access Protected (STUDENT)
   * @usesModel AssignmentModel.getById() (models/assignmentModel.js)
   * @usesModel AssignmentModel.upsertSubmission() (models/assignmentModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async submitFinalDocs(req, res) {
    try {
      const { documents } = req.body;
      if (!Array.isArray(documents) || documents.length === 0) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_DOCUMENTS', message: 'Please upload all required documents before submitting' } });
      }
      const a = await assignmentModel.getById(req.params.id);
      if (!a) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Work item not found' } });
      }

      const isLate = a.due_date && new Date() > new Date(a.due_date);
      const docsJson = JSON.stringify(documents);

      await assignmentModel.upsertSubmission({
        assessmentId: req.params.id,
        studentId: req.user.student_id,
        filePath: docsJson,
        originalFilename: 'Final Documents Bundle',
        status: isLate ? 'LATE' : 'SUBMITTED'
      });

      return res.json({ success: true, message: 'All final documents submitted successfully for evaluation!' });
    } catch (err) {
      logger.error('[AssignmentController] submitFinalDocs error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Grades a student submission with score marks and comments.
   * 
   * @route PUT /api/v1/assignments/submissions/:submissionId/grade (routes/assignments.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel AssignmentModel.gradeSubmission() (models/assignmentModel.js)
   * @usesModel AssignmentModel.getSubmissionDetails() (models/assignmentModel.js)
   * @usesService AuditService.logAudit() (services/auditService.js)
   * @usesService NotificationService.sendNotification() (services/notificationService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async gradeSubmission(req, res) {
    try {
      const { marks_obtained, feedback } = req.body;
      const updated = await assignmentModel.gradeSubmission({
        submissionId: req.params.submissionId,
        marksObtained: marks_obtained,
        feedback,
        gradedBy: req.user.id
      });

      if (!updated) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Submission not found' } });
      }

      try {
        const sInfo = await assignmentModel.getSubmissionDetails(req.params.submissionId);
        if (sInfo && sInfo.user_id) {
          await notificationService.sendNotification({
            userId: sInfo.user_id,
            type: notificationService.NOTIFICATION_TYPES.ASSIGNMENT_GRADED,
            title: `Assignment Graded: ${sInfo.title}`,
            message: `Your submission for "${sInfo.title}" has been graded: ${marks_obtained !== undefined ? marks_obtained : 'N/A'}/${sInfo.max_marks || 100}.`,
            linkUrl: sInfo.group_id ? `/student/groups.html?id=${sInfo.group_id}&tab=classwork` : `/student/assignments.html`
          });
        }

        await auditService.logAudit({
          eventType: auditService.AUDIT_EVENTS.ASSIGNMENT_GRADED,
          actorId: req.user.id,
          actorRole: req.user.roles?.[0] || 'TEACHER',
          targetType: 'assessment_submissions',
          targetId: req.params.submissionId,
          details: { marks_obtained, feedback },
          ipAddress: req.ip
        });
      } catch (auditErr) {
        // Non-fatal
      }

      return res.json({ success: true, message: 'Grade saved.' });
    } catch (err) {
      logger.error('[AssignmentController] gradeSubmission error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Deletes an assignment and its associated student submissions.
   * 
   * @route DELETE /api/v1/assignments/:id (routes/assignments.js)
   * @access Protected (TEACHER, SYSTEM_ADMIN)
   * @usesModel AssignmentModel.getById() (models/assignmentModel.js)
   * @usesModel AssignmentModel.deleteAssignment() (models/assignmentModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async deleteAssignment(req, res) {
    try {
      const asgn = await assignmentModel.getById(req.params.id);
      if (!asgn || asgn.type !== 'ASSIGNMENT') {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Assignment not found' } });
      }
      if (req.user.role !== 'SYSTEM_ADMIN' && asgn.created_by !== req.user.id) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You can only delete your own assignments' } });
      }
      await assignmentModel.deleteAssignment(req.params.id);
      return res.json({ success: true, message: 'Assignment deleted.' });
    } catch (err) {
      logger.error('[AssignmentController] deleteAssignment error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = new AssignmentController();
