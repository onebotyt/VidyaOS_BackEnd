/**
 * Assessment Process Controller — HTTP request/response handlers for 13 Direct & Indirect Assessment artifacts.
 * Location: src/controllers/assessmentProcessController.js
 * VidyaOS Institutional Campus Operating System
 */

const path = require('path');
const fs = require('fs');
const assessmentProcessModel = require('../models/assessmentProcessModel');
const auditService = require('../services/auditService');
const logger = require('../utils/logger');

class AssessmentProcessController {
  /**
   * Returns definitions for the 13 Assessment Process records.
   * @route GET /api/v1/assessment-process/definitions
   */
  getDefinitions(req, res) {
    return res.json({
      success: true,
      data: assessmentProcessModel.getItemsDefinition()
    });
  }

  /**
   * Retrieves or auto-provisions Assessment Process dossier for a teaching group.
   * @route GET /api/v1/assessment-process
   */
  async getAssessmentDossier(req, res) {
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
        group = await assessmentProcessModel.getGroupDetails(groupId);
      }

      if (!group) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Teaching group not found' }
        });
      }

      const assessFile = await assessmentProcessModel.getOrCreateAssessmentFile({
        groupId,
        subjectId,
        teacherId: group.teacher_id,
        academicYearId: group.academic_year_id,
        departmentId: group.department_id,
        semester: group.semester
      });

      const docs = await assessmentProcessModel.getDocuments(assessFile.id);
      const docMap = {};
      docs.forEach(d => { docMap[d.item_key] = d; });

      const itemsDef = assessmentProcessModel.getItemsDefinition();
      let completedCount = 0;
      let directCompleted = 0;
      let indirectCompleted = 0;

      const items = itemsDef.map(itemDef => {
        const doc = docMap[itemDef.key] || null;
        const isCompleted = !!doc;
        if (isCompleted) {
          completedCount++;
          if (itemDef.section_code === 'DIRECT') directCompleted++;
          if (itemDef.section_code === 'INDIRECT') indirectCompleted++;
        }

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
          assessment_file: {
            ...assessFile,
            total_items: itemsDef.length,
            completed_items: completedCount,
            pending_items: itemsDef.length - completedCount,
            direct_total: 8,
            direct_completed: directCompleted,
            indirect_total: 5,
            indirect_completed: indirectCompleted,
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
      logger.error('[AssessmentProcessController] getAssessmentDossier error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Uploads or updates a PDF document for one of the 13 Assessment Process items.
   * @route POST /api/v1/assessment-process/:id/documents
   */
  async uploadDocument(req, res) {
    try {
      const assessmentFileId = parseInt(req.params.id, 10);
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

      const assessFile = await assessmentProcessModel.getById(assessmentFileId);
      if (!assessFile) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Assessment process record not found' } });
      }

      // Check teacher/HOD authorization
      const isTeacher = req.user && req.user.teacher_id && req.user.teacher_id === assessFile.teacher_id;
      const isPrivileged = req.user && (req.user.is_hod || req.user.role === 'HOD' || req.user.role === 'SYSTEM_ADMIN');
      if (!isTeacher && !isPrivileged) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You are not authorized to upload documents for this class.' } });
      }

      // Standard item definition lookup
      const itemsDef = assessmentProcessModel.getItemsDefinition();
      const itemDef = itemsDef.find(i => i.key === item_key);
      const docTitle = title || (itemDef ? itemDef.title : item_key);

      const filePathRel = `/uploads/assessment_process/${path.basename(req.file.path)}`;

      const { doc, oldFilePath } = await assessmentProcessModel.upsertDocument({
        assessmentFileId,
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
        action: 'ASSESSMENT_DOCUMENT_UPLOAD',
        resourceType: 'assessment_process_documents',
        resourceId: doc.id,
        details: { assessmentFileId, itemKey: item_key, fileName: req.file.originalname, size: req.file.size }
      });

      return res.status(201).json({
        success: true,
        message: 'Assessment Process document uploaded successfully',
        data: doc
      });
    } catch (err) {
      logger.error('[AssessmentProcessController] uploadDocument error:', { error: err.message });
      if (req.file && req.file.path) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Deletes a document artifact associated with an item key.
   * @route DELETE /api/v1/assessment-process/:id/documents/:item_key
   */
  async deleteDocument(req, res) {
    try {
      const assessmentFileId = parseInt(req.params.id, 10);
      const itemKey = req.params.item_key;

      const assessFile = await assessmentProcessModel.getById(assessmentFileId);
      if (!assessFile) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Assessment process record not found' } });
      }

      const isTeacher = req.user && req.user.teacher_id && req.user.teacher_id === assessFile.teacher_id;
      const isPrivileged = req.user && (req.user.is_hod || req.user.role === 'HOD' || req.user.role === 'SYSTEM_ADMIN');
      if (!isTeacher && !isPrivileged) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You are not authorized to delete documents from this class.' } });
      }

      const deletedDoc = await assessmentProcessModel.deleteDocument(assessmentFileId, itemKey);
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
        action: 'ASSESSMENT_DOCUMENT_DELETE',
        resourceType: 'assessment_process_documents',
        resourceId: deletedDoc.id,
        details: { assessmentFileId, itemKey, fileName: deletedDoc.file_name }
      });

      return res.json({
        success: true,
        message: 'Document deleted successfully',
        data: { item_key: itemKey }
      });
    } catch (err) {
      logger.error('[AssessmentProcessController] deleteDocument error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * HOD / Auditor approves or reviews the Assessment Process dossier.
   * @route POST /api/v1/assessment-process/:id/audit
   */
  async auditAssessment(req, res) {
    try {
      const assessmentFileId = parseInt(req.params.id, 10);
      const { status, remarks } = req.body;

      const validStatuses = ['APPROVED', 'REVISION_REQUESTED', 'IN_PROGRESS'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: `Invalid audit status. Must be one of: ${validStatuses.join(', ')}` } });
      }

      await assessmentProcessModel.auditAssessment(assessmentFileId, {
        status,
        hodRemarks: remarks,
        auditorId: req.user ? req.user.id : 1
      });

      await auditService.log({
        userId: req.user ? req.user.id : 1,
        action: 'ASSESSMENT_DOSSIER_AUDIT',
        resourceType: 'assessment_process_files',
        resourceId: assessmentFileId,
        details: { status, remarks }
      });

      return res.json({
        success: true,
        message: `Assessment Process dossier audit status updated to ${status}`
      });
    } catch (err) {
      logger.error('[AssessmentProcessController] auditAssessment error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = new AssessmentProcessController();
