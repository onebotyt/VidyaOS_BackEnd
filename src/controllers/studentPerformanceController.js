/**
 * Student Performance Monitoring Controller — HTTP request/response handlers for 8-artifact Performance Dossier.
 * Location: src/controllers/studentPerformanceController.js
 * VidyaOS Institutional Campus Operating System
 */

const path = require('path');
const fs = require('fs');
const studentPerformanceModel = require('../models/studentPerformanceModel');
const auditService = require('../services/auditService');
const logger = require('../utils/logger');

class StudentPerformanceController {
  /**
   * Returns definitions for the 8 Student Performance Monitoring records.
   * @route GET /api/v1/student-performance/definitions
   */
  getDefinitions(req, res) {
    return res.json({
      success: true,
      data: studentPerformanceModel.getItemsDefinition()
    });
  }

  /**
   * Retrieves or auto-provisions Student Performance Monitoring dossier for a teaching group.
   * @route GET /api/v1/student-performance
   */
  async getPerformanceDossier(req, res) {
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
        group = await studentPerformanceModel.getGroupDetails(groupId);
      }

      if (!group) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Teaching group not found' }
        });
      }

      const perfFile = await studentPerformanceModel.getOrCreatePerformanceFile({
        groupId,
        subjectId,
        teacherId: group.teacher_id,
        academicYearId: group.academic_year_id,
        departmentId: group.department_id,
        semester: group.semester
      });

      const docs = await studentPerformanceModel.getDocuments(perfFile.id);
      const docMap = {};
      docs.forEach(d => { docMap[d.item_key] = d; });

      const itemsDef = studentPerformanceModel.getItemsDefinition();
      let completedCount = 0;

      const items = itemsDef.map(itemDef => {
        const doc = docMap[itemDef.key] || null;
        const isCompleted = !!doc;
        if (isCompleted) completedCount++;

        return {
          ...itemDef,
          is_completed: isCompleted,
          document: doc
        };
      });

      const completionPct = Math.round((completedCount / itemsDef.length) * 100);

      return res.json({
        success: true,
        data: {
          performance_file: {
            ...perfFile,
            total_items: itemsDef.length,
            completed_items: completedCount,
            pending_items: itemsDef.length - completedCount,
            completion_pct: completionPct
          },
          group: {
            id: group.id,
            name: group.name,
            subject_name: group.subject_name,
            subject_code: group.subject_code,
            component: group.component || 'THEORY',
            semester: group.semester,
            academic_year_label: group.academic_year_label || '2026-27',
            teacher_name: group.teacher_name,
            teacher_code: group.teacher_code,
            department_name: group.department_name,
            department_code: group.department_code,
            invite_code: group.invite_code,
            register_id: group.register_id,
            register_name: group.register_name
          },
          items
        }
      });
    } catch (err) {
      logger.error('[StudentPerformanceController] getPerformanceDossier error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Uploads or updates a PDF document for one of the 8 Student Performance items.
   * @route POST /api/v1/student-performance/:id/documents
   */
  async uploadDocument(req, res) {
    try {
      const performanceFileId = parseInt(req.params.id, 10);
      const { item_key, title, notes } = req.body;

      if (!req.file) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No document file uploaded' } });
      }
      if (!item_key) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'item_key is required' } });
      }

      // Strictly validate PDF extension & mimetype
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (ext !== '.pdf') {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_FILE_TYPE', message: 'Only PDF documents (.pdf) are allowed for upload.' }
        });
      }

      const perfFile = await studentPerformanceModel.getById(performanceFileId);
      if (!perfFile) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Performance monitoring record not found' } });
      }

      // Check teacher/HOD authorization
      const isTeacher = req.user && req.user.teacher_id && req.user.teacher_id === perfFile.teacher_id;
      const isPrivileged = req.user && (req.user.is_hod || req.user.role === 'HOD' || req.user.role === 'SYSTEM_ADMIN');
      if (!isTeacher && !isPrivileged) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You are not authorized to upload documents for this class.' } });
      }

      // Standard item definition lookup
      const itemsDef = studentPerformanceModel.getItemsDefinition();
      const itemDef = itemsDef.find(i => i.key === item_key);
      const docTitle = title || (itemDef ? itemDef.title : item_key);

      const filePathRel = `/uploads/student_performance/${path.basename(req.file.path)}`;

      const { doc, oldFilePath } = await studentPerformanceModel.upsertDocument({
        performanceFileId,
        itemKey: item_key,
        docTitle,
        filePath: filePathRel,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype || 'application/pdf',
        userId: req.user ? req.user.id : 1,
        notes: notes || null
      });

      // Cleanup prior version file on disk if replacing
      if (oldFilePath && oldFilePath !== filePathRel) {
        try {
          const absoluteOld = path.join(process.cwd(), oldFilePath.startsWith('/') ? oldFilePath.slice(1) : oldFilePath);
          if (fs.existsSync(absoluteOld)) fs.unlinkSync(absoluteOld);
        } catch (_) {}
      }

      await auditService.log({
        userId: req.user ? req.user.id : 1,
        action: 'PERFORMANCE_DOCUMENT_UPLOAD',
        resourceType: 'student_performance_documents',
        resourceId: doc.id,
        details: { performanceFileId, itemKey: item_key, fileName: req.file.originalname, size: req.file.size }
      });

      return res.status(201).json({
        success: true,
        message: 'Student Performance document uploaded successfully',
        data: doc
      });
    } catch (err) {
      logger.error('[StudentPerformanceController] uploadDocument error:', { error: err.message });
      if (req.file && req.file.path) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Deletes a document artifact associated with an item key.
   * @route DELETE /api/v1/student-performance/:id/documents/:item_key
   */
  async deleteDocument(req, res) {
    try {
      const performanceFileId = parseInt(req.params.id, 10);
      const itemKey = req.params.item_key;

      const perfFile = await studentPerformanceModel.getById(performanceFileId);
      if (!perfFile) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Performance monitoring record not found' } });
      }

      const isTeacher = req.user && req.user.teacher_id && req.user.teacher_id === perfFile.teacher_id;
      const isPrivileged = req.user && (req.user.is_hod || req.user.role === 'HOD' || req.user.role === 'SYSTEM_ADMIN');
      if (!isTeacher && !isPrivileged) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You are not authorized to delete documents from this class.' } });
      }

      const deletedDoc = await studentPerformanceModel.deleteDocument(performanceFileId, itemKey);
      if (!deletedDoc) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Document artifact not found' } });
      }

      // Cleanup file from disk
      if (deletedDoc.file_path) {
        try {
          const absolutePath = path.join(process.cwd(), deletedDoc.file_path.startsWith('/') ? deletedDoc.file_path.slice(1) : deletedDoc.file_path);
          if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
        } catch (_) {}
      }

      await auditService.log({
        userId: req.user ? req.user.id : 1,
        action: 'PERFORMANCE_DOCUMENT_DELETE',
        resourceType: 'student_performance_documents',
        resourceId: deletedDoc.id,
        details: { performanceFileId, itemKey, fileName: deletedDoc.file_name }
      });

      return res.json({
        success: true,
        message: 'Document deleted successfully',
        data: { item_key: itemKey }
      });
    } catch (err) {
      logger.error('[StudentPerformanceController] deleteDocument error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * HOD / Auditor approves or reviews the Student Performance dossier.
   * @route POST /api/v1/student-performance/:id/audit
   */
  async auditPerformance(req, res) {
    try {
      const performanceFileId = parseInt(req.params.id, 10);
      const { status, remarks } = req.body;

      const validStatuses = ['APPROVED', 'REVISION_REQUESTED', 'IN_PROGRESS'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: `Invalid audit status. Must be one of: ${validStatuses.join(', ')}` } });
      }

      await studentPerformanceModel.auditPerformance(performanceFileId, {
        status,
        hodRemarks: remarks,
        auditorId: req.user ? req.user.id : 1
      });

      await auditService.log({
        userId: req.user ? req.user.id : 1,
        action: 'PERFORMANCE_DOSSIER_AUDIT',
        resourceType: 'student_performance_files',
        resourceId: performanceFileId,
        details: { status, remarks }
      });

      return res.json({
        success: true,
        message: `Student Performance dossier audit status updated to ${status}`
      });
    } catch (err) {
      logger.error('[StudentPerformanceController] auditPerformance error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = new StudentPerformanceController();
