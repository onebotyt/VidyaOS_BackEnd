/**
 * Theory Class Controller — HTTP request/response handlers for 7-record Theory Class Academic Dossier.
 * Location: src/controllers/theoryClassController.js
 */

const path = require('path');
const fs = require('fs');
const theoryClassModel = require('../models/theoryClassModel');
const auditService = require('../services/auditService');
const logger = require('../utils/logger');

class TheoryClassController {
  /**
   * Returns definitions for the 7 Theory Class records.
   * @route GET /api/v1/theory-classes/definitions
   */
  getDefinitions(req, res) {
    return res.json({
      success: true,
      data: theoryClassModel.getItemsDefinition()
    });
  }

  /**
   * Retrieves or auto-provisions Theory Class dossier for a teaching group.
   * @route GET /api/v1/theory-classes
   */
  async getTheoryClass(req, res) {
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
        group = await theoryClassModel.getGroupDetails(groupId);
      }

      if (!group) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Teaching group not found' }
        });
      }

      const theoryClass = await theoryClassModel.getOrCreateTheoryClass({
        groupId,
        subjectId,
        teacherId: group.teacher_id,
        academicYearId: group.academic_year_id,
        departmentId: group.department_id,
        semester: group.semester
      });

      const docs = await theoryClassModel.getDocuments(theoryClass.id);
      const docMap = {};
      docs.forEach(d => { docMap[d.item_key] = d; });

      const students = await theoryClassModel.getGroupStudentsWithAttendance(group);
      const assignments = await theoryClassModel.getGroupAssignments(group);

      const itemsDef = theoryClassModel.getItemsDefinition();
      let completedCount = 0;

      const items = itemsDef.map(itemDef => {
        const doc = docMap[itemDef.key] || null;
        let hasData = false;

        if (itemDef.key === 'attendance_register' && (group.register_id || students.length > 0)) {
          hasData = true;
        }
        if (itemDef.key === 'assignment_records' && assignments.length > 0) {
          hasData = true;
        }

        const isCompleted = !!doc || (itemDef.reqType === 'hybrid' && hasData);
        if (isCompleted) completedCount++;

        return {
          ...itemDef,
          is_completed: isCompleted,
          document: doc,
          has_system_data: hasData
        };
      });

      const completionPct = Math.round((completedCount / itemsDef.length) * 100);

      return res.json({
        success: true,
        data: {
          theory_class: {
            ...theoryClass,
            total_items: itemsDef.length,
            completed_items: completedCount,
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
          items,
          system_data: {
            total_students: students.length,
            students,
            assignments,
            register_id: group.register_id
          }
        }
      });
    } catch (err) {
      logger.error('[TheoryClassController] getTheoryClass error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Uploads or updates a document for one of the 7 Theory Class items.
   * @route POST /api/v1/theory-classes/:id/documents
   */
  async uploadDocument(req, res) {
    try {
      const theoryClassId = parseInt(req.params.id, 10);
      const { item_key, title, notes } = req.body;

      if (!req.file) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No document file uploaded' } });
      }
      if (!item_key) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'item_key is required' } });
      }

      const tc = await theoryClassModel.getById(theoryClassId);
      if (!tc) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Theory class dossier not found' } });
      }

      const isTeacher = req.user.teacher_id && req.user.teacher_id === tc.teacher_id;
      const isHod = req.user.roles?.includes('HOD') || req.user.roles?.includes('DEPT_HEAD');
      const isAdmin = req.user.roles?.includes('SYSTEM_ADMIN');

      if (!isTeacher && !isHod && !isAdmin) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to modify this theory class dossier' } });
      }

      const filePath = `/uploads/theory_classes/${req.file.filename}`;
      const fileName = req.file.originalname;
      const fileSize = req.file.size;
      const mimeType = req.file.mimetype;
      const docTitle = title || item_key.replace(/_/g, ' ').toUpperCase();

      const { doc, oldFilePath } = await theoryClassModel.upsertDocument({
        theoryClassId,
        itemKey: item_key,
        docTitle,
        filePath,
        fileName,
        fileSize,
        mimeType,
        userId: req.user.id || 1,
        notes: notes || null
      });

      // Cleanup prior version file on disk if overwriting
      if (oldFilePath && oldFilePath !== filePath) {
        try {
          const uploadsRoot = path.join(__dirname, '../../');
          const absOld = path.join(uploadsRoot, oldFilePath.replace(/^\//, ''));
          if (fs.existsSync(absOld)) fs.unlinkSync(absOld);
        } catch (cleanupErr) {
          logger.warn('[TheoryClassController] Failed to remove previous file version:', { error: cleanupErr.message });
        }
      }

      try {
        await auditService.logAudit({
          action: 'THEORY_CLASS_DOC_UPLOADED',
          entityType: 'THEORY_CLASS',
          entityId: theoryClassId,
          userId: req.user.id,
          meta: { item_key, file_name: fileName, version: doc.version }
        });
      } catch (_) {}

      return res.status(201).json({
        success: true,
        data: doc,
        message: 'Document uploaded successfully'
      });
    } catch (err) {
      logger.error('[TheoryClassController] uploadDocument error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Deletes an uploaded document from the theory class dossier.
   * @route DELETE /api/v1/theory-classes/:id/documents/:item_key
   */
  async deleteDocument(req, res) {
    try {
      const theoryClassId = parseInt(req.params.id, 10);
      const { item_key } = req.params;

      const tc = await theoryClassModel.getById(theoryClassId);
      if (!tc) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Theory class dossier not found' } });
      }

      const isTeacher = req.user.teacher_id && req.user.teacher_id === tc.teacher_id;
      const isHod = req.user.roles?.includes('HOD') || req.user.roles?.includes('DEPT_HEAD');
      const isAdmin = req.user.roles?.includes('SYSTEM_ADMIN');

      if (!isTeacher && !isHod && !isAdmin) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to modify this theory class dossier' } });
      }

      const deletedDoc = await theoryClassModel.deleteDocument(theoryClassId, item_key);
      if (!deletedDoc) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No document found for the specified item' } });
      }

      // Cleanup file from disk
      if (deletedDoc.file_path) {
        try {
          const uploadsRoot = path.join(__dirname, '../../');
          const absPath = path.join(uploadsRoot, deletedDoc.file_path.replace(/^\//, ''));
          if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
        } catch (cleanupErr) {
          logger.warn('[TheoryClassController] Failed to remove file from disk:', { error: cleanupErr.message });
        }
      }

      try {
        await auditService.logAudit({
          action: 'THEORY_CLASS_DOC_DELETED',
          entityType: 'THEORY_CLASS',
          entityId: theoryClassId,
          userId: req.user.id,
          meta: { item_key, file_name: deletedDoc.file_name }
        });
      } catch (_) {}

      return res.json({
        success: true,
        data: deletedDoc,
        message: 'Document deleted successfully'
      });
    } catch (err) {
      logger.error('[TheoryClassController] deleteDocument error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * HOD/Admin review and status audit.
   * @route POST /api/v1/theory-classes/:id/audit
   */
  async auditTheoryClass(req, res) {
    try {
      const theoryClassId = parseInt(req.params.id, 10);
      const { status, remarks } = req.body;

      const tc = await theoryClassModel.getById(theoryClassId);
      if (!tc) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Theory class dossier not found' } });
      }

      const validStatuses = ['APPROVED', 'REVISION_REQUESTED', 'AUDITED', 'IN_PROGRESS'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` } });
      }

      await theoryClassModel.auditTheoryClass(theoryClassId, {
        status,
        hodRemarks: remarks,
        auditorId: req.user.id
      });

      return res.json({
        success: true,
        message: `Theory class dossier marked as ${status}`
      });
    } catch (err) {
      logger.error('[TheoryClassController] auditTheoryClass error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = new TheoryClassController();
