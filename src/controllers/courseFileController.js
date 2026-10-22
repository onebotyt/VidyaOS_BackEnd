/**
 * Course File Controller — HTTP request/response handlers for Course File preparation dossier.
 */

const path = require('path');
const fs = require('fs');
const courseFileModel = require('../models/courseFileModel');
const auditService = require('../services/auditService');
const logger = require('../utils/logger');

class CourseFileController {
  /**
   * Retrieves NBA/NAAC 18 standard course file item definitions.
   * 
   * @route GET /api/v1/course-files/definitions (routes/courseFile.js)
   * @access Protected (All Authenticated Users)
   * @usesModel CourseFileModel.getItemsDefinition() (models/courseFileModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  getDefinitions(req, res) {
    return res.json({
      success: true,
      data: courseFileModel.getItemsDefinition()
    });
  }

  /**
   * Retrieves or auto-provisions course file dossier for a teaching group, compiling completion stats.
   * 
   * @route GET /api/v1/course-files (routes/courseFile.js)
   * @access Protected (All Authenticated Users)
   * @usesModel CourseFileModel.getGroupDetails() (models/courseFileModel.js)
   * @usesModel CourseFileModel.getOrCreateCourseFile() (models/courseFileModel.js)
   * @usesModel CourseFileModel.getDocuments() (models/courseFileModel.js)
   * @usesModel CourseFileModel.getGroupStudentsWithAttendance() (models/courseFileModel.js)
   * @usesModel CourseFileModel.getGroupAssignments() (models/courseFileModel.js)
   * @usesModel CourseFileModel.getItemsDefinition() (models/courseFileModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async getCourseFile(req, res) {
    try {
      const groupId = parseInt(req.query.group_id || req.query.teaching_group_id, 10);
      const subjectId = req.query.subject_id ? parseInt(req.query.subject_id, 10) : null;

      if (!groupId && !subjectId) {
        return res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'group_id or subject_id is required' }
        });
      }

      let group = null;
      if (groupId) {
        group = await courseFileModel.getGroupDetails(groupId);
      }

      if (!group) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Teaching group not found' }
        });
      }

      const courseFile = await courseFileModel.getOrCreateCourseFile({
        groupId,
        subjectId,
        teacherId: group.teacher_id,
        academicYearId: group.academic_year_id,
        departmentId: group.department_id,
        semester: group.semester
      });

      const docs = await courseFileModel.getDocuments(courseFile.id);
      const docMap = {};
      docs.forEach(d => { docMap[d.item_key] = d; });

      const students = await courseFileModel.getGroupStudentsWithAttendance(group);
      const advancedLearners = students.filter(s => s.attendance_pct != null && s.attendance_pct >= 80);
      const slowLearners = students.filter(s => s.attendance_pct != null && s.attendance_pct < 75);

      const assignments = await courseFileModel.getGroupAssignments(group);
      const classTests = assignments.filter(a => a.type === 'EXAM' || a.title?.toLowerCase().includes('test'));

      const courseFileItems = courseFileModel.getItemsDefinition();
      let completedCount = 0;
      const items = courseFileItems.map(itemDef => {
        const doc = docMap[itemDef.key] || null;
        let hasData = false;

        if (itemDef.key === 'student_list' && students.length > 0) hasData = true;
        if (itemDef.key === 'assignment_schedule' && assignments.length > 0) hasData = true;
        if (itemDef.key === 'internal_assessment_plan' && courseFile.evaluation_scheme) hasData = true;
        if (itemDef.key === 'advanced_learners' && (advancedLearners.length > 0 || courseFile.advanced_learners_json)) hasData = true;
        if (itemDef.key === 'slow_learners' && (slowLearners.length > 0 || courseFile.slow_learners_json)) hasData = true;
        if (itemDef.key === 'course_outcomes' && courseFile.cos_json) hasData = true;
        if (itemDef.key === 'copo_matrix' && courseFile.copo_matrix_json) hasData = true;

        const isCompleted = !!doc || hasData;
        if (isCompleted) completedCount++;

        return {
          ...itemDef,
          is_completed: isCompleted,
          document: doc,
          has_system_data: hasData
        };
      });

      const completionPct = Math.round((completedCount / courseFileItems.length) * 100);

      return res.json({
        success: true,
        data: {
          course_file: {
            ...courseFile,
            evaluation_scheme: courseFile.evaluation_scheme ? JSON.parse(courseFile.evaluation_scheme) : null,
            copo_matrix: courseFile.copo_matrix_json ? JSON.parse(courseFile.copo_matrix_json) : null,
            course_outcomes: courseFile.cos_json ? JSON.parse(courseFile.cos_json) : null,
            advanced_learners_notes: courseFile.advanced_learners_json ? JSON.parse(courseFile.advanced_learners_json) : null,
            slow_learners_notes: courseFile.slow_learners_json ? JSON.parse(courseFile.slow_learners_json) : null,
            total_items: courseFileItems.length,
            completed_items: completedCount,
            completion_pct: completionPct
          },
          group: {
            id: group.id,
            name: group.name,
            subject_name: group.subject_name,
            subject_code: group.subject_code,
            component: group.component,
            semester: group.semester,
            academic_year_label: group.academic_year_label || '2026-27',
            teacher_name: group.teacher_name,
            teacher_code: group.teacher_code,
            department_name: group.department_name,
            department_code: group.department_code,
            invite_code: group.invite_code
          },
          items,
          system_data: {
            total_students: students.length,
            students,
            advanced_learners: advancedLearners,
            slow_learners: slowLearners,
            assignments,
            class_tests: classTests
          }
        }
      });
    } catch (err) {
      logger.error('[CourseFileController] getCourseFile error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Uploads an artifact file for one of the 18 Course File dossier items.
   * 
   * @route POST /api/v1/course-files/:id/documents (routes/courseFile.js)
   * @access Protected (Faculty/HOD/Admin)
   * @usesModel CourseFileModel.getById() (models/courseFileModel.js)
   * @usesModel CourseFileModel.upsertDocument() (models/courseFileModel.js)
   * @usesService AuditService.logAudit() (services/auditService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async uploadDocument(req, res) {
    try {
      const courseFileId = parseInt(req.params.id, 10);
      const { item_key, title, notes } = req.body;

      if (!req.file) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No document file uploaded' } });
      }
      if (!item_key) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'item_key is required' } });
      }

      const cf = await courseFileModel.getById(courseFileId);
      if (!cf) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Course file dossier not found' } });
      }

      const isTeacher = req.user.teacher_id && req.user.teacher_id === cf.teacher_id;
      const isHod = req.user.roles?.includes('HOD') || req.user.roles?.includes('DEPT_HEAD');
      const isAdmin = req.user.roles?.includes('SYSTEM_ADMIN');

      if (!isTeacher && !isHod && !isAdmin) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to modify this course file' } });
      }

      const filePath = `/uploads/course_files/${req.file.filename}`;
      const fileName = req.file.originalname;
      const fileSize = req.file.size;
      const mimeType = req.file.mimetype;
      const docTitle = title || item_key.replace(/_/g, ' ').toUpperCase();

      const { doc, oldFilePath } = await courseFileModel.upsertDocument({
        courseFileId,
        itemKey: item_key,
        docTitle,
        filePath,
        fileName,
        fileSize,
        mimeType,
        userId: req.user.id,
        notes
      });

      if (oldFilePath) {
        try {
          const oldDiskPath = path.join(__dirname, '../../', oldFilePath);
          if (fs.existsSync(oldDiskPath)) fs.unlinkSync(oldDiskPath);
        } catch (_) {}
      }

      await auditService.logAudit({
        eventType: 'COURSE_FILE_DOCUMENT_UPLOADED',
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'TEACHER',
        targetType: 'course_files',
        targetId: courseFileId,
        details: { item_key, fileName, fileSize }
      });

      return res.status(201).json({
        success: true,
        data: doc,
        message: `${docTitle} uploaded successfully`
      });
    } catch (err) {
      logger.error('[CourseFileController] uploadDocument error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Deletes an uploaded document artifact from the course file.
   * 
   * @route DELETE /api/v1/course-files/:id/documents/:item_key (routes/courseFile.js)
   * @access Protected (Faculty/HOD/Admin)
   * @usesModel CourseFileModel.getById() (models/courseFileModel.js)
   * @usesModel CourseFileModel.deleteDocument() (models/courseFileModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async deleteDocument(req, res) {
    try {
      const courseFileId = parseInt(req.params.id, 10);
      const itemKey = req.params.item_key;

      const cf = await courseFileModel.getById(courseFileId);
      if (!cf) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Course file dossier not found' } });
      }

      const isTeacher = req.user.teacher_id && req.user.teacher_id === cf.teacher_id;
      const isHod = req.user.roles?.includes('HOD') || req.user.roles?.includes('DEPT_HEAD');
      const isAdmin = req.user.roles?.includes('SYSTEM_ADMIN');

      if (!isTeacher && !isHod && !isAdmin) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to modify this course file' } });
      }

      const deletedDoc = await courseFileModel.deleteDocument(courseFileId, itemKey);
      if (deletedDoc) {
        try {
          const diskPath = path.join(__dirname, '../../', deletedDoc.file_path);
          if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
        } catch (_) {}
      }

      return res.json({ success: true, message: 'Document deleted successfully' });
    } catch (err) {
      logger.error('[CourseFileController] deleteDocument error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Saves internal assessment plan evaluation criteria.
   * 
   * @route PUT /api/v1/course-files/:id/evaluation-scheme (routes/courseFile.js)
   * @access Protected (Faculty/HOD/Admin)
   * @usesModel CourseFileModel.getById() (models/courseFileModel.js)
   * @usesModel CourseFileModel.updateEvaluationScheme() (models/courseFileModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async updateEvaluationScheme(req, res) {
    try {
      const courseFileId = parseInt(req.params.id, 10);
      const scheme = req.body;

      const cf = await courseFileModel.getById(courseFileId);
      if (!cf) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Course file dossier not found' } });
      }

      await courseFileModel.updateEvaluationScheme(courseFileId, scheme);
      return res.json({ success: true, message: 'Evaluation scheme updated successfully', data: scheme });
    } catch (err) {
      logger.error('[CourseFileController] updateEvaluationScheme error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Updates Course Outcomes (COs), CO-PO mapping matrix, and learners metadata.
   * 
   * @route PUT /api/v1/course-files/:id/structured-data (routes/courseFile.js)
   * @access Protected (Faculty/HOD/Admin)
   * @usesModel CourseFileModel.getById() (models/courseFileModel.js)
   * @usesModel CourseFileModel.updateStructuredData() (models/courseFileModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async updateStructuredData(req, res) {
    try {
      const courseFileId = parseInt(req.params.id, 10);
      const { cos, copo_matrix, advanced_learners, slow_learners } = req.body;

      const cf = await courseFileModel.getById(courseFileId);
      if (!cf) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Course file dossier not found' } });
      }

      await courseFileModel.updateStructuredData(courseFileId, { cos, copo_matrix, advanced_learners, slow_learners });
      return res.json({ success: true, message: 'Course file structured data updated successfully' });
    } catch (err) {
      logger.error('[CourseFileController] updateStructuredData error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Adjudicates audit status (APPROVED / REVISION_REQUESTED) with HOD comments.
   * 
   * @route POST /api/v1/course-files/:id/audit (routes/courseFile.js)
   * @access Protected (HOD, DEPT_HEAD, SYSTEM_ADMIN)
   * @usesModel CourseFileModel.auditCourseFile() (models/courseFileModel.js)
   * @usesService AuditService.logAudit() (services/auditService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async auditCourseFile(req, res) {
    try {
      const courseFileId = parseInt(req.params.id, 10);
      const { status, remarks } = req.body;

      const validStatuses = ['IN_PROGRESS', 'SUBMITTED', 'AUDITED', 'APPROVED', 'REVISION_REQUESTED'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: `Status must be one of: ${validStatuses.join(', ')}` }
        });
      }

      await courseFileModel.auditCourseFile(courseFileId, status, remarks, req.user.id);

      await auditService.logAudit({
        eventType: 'COURSE_FILE_AUDITED',
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'HOD',
        targetType: 'course_files',
        targetId: courseFileId,
        details: { status, remarks }
      });

      return res.json({
        success: true,
        message: `Course file marked as ${status}`,
        data: { status, remarks, audited_at: new Date().toISOString() }
      });
    } catch (err) {
      logger.error('[CourseFileController] auditCourseFile error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = new CourseFileController();
