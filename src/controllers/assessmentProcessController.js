/**
 * Assessment Process Controller — Handlers for Direct (8 items) & Indirect (5 items) Assessment artifacts.
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
   * Returns definitions for Direct Assessment records (8 items).
   * @route GET /api/v1/direct-assessment/definitions
   */
  getDirectDefinitions(req, res) {
    return res.json({
      success: true,
      data: assessmentProcessModel.getDirectAssessmentItems()
    });
  }

  /**
   * Returns definitions for Indirect Assessment records (5 items).
   * @route GET /api/v1/indirect-assessment/definitions
   */
  getIndirectDefinitions(req, res) {
    return res.json({
      success: true,
      data: assessmentProcessModel.getIndirectAssessmentItems()
    });
  }

  /**
   * Returns definitions for all 13 records (backward compatibility).
   * @route GET /api/v1/assessment-process/definitions
   */
  getDefinitions(req, res) {
    return res.json({
      success: true,
      data: assessmentProcessModel.getItemsDefinition()
    });
  }

  /**
   * Retrieves or provisions Direct Assessment dossier for a teaching group (8 items).
   * @route GET /api/v1/direct-assessment
   */
  async getDirectAssessmentDossier(req, res) {
    return this._getScopedDossier(req, res, 'DIRECT');
  }

  /**
   * Retrieves or provisions Indirect Assessment dossier for a teaching group (5 items).
   * @route GET /api/v1/indirect-assessment
   */
  async getIndirectAssessmentDossier(req, res) {
    return this._getScopedDossier(req, res, 'INDIRECT');
  }

  /**
   * Combined dossier handler (backward compatibility or full query).
   * @route GET /api/v1/assessment-process
   */
  async getAssessmentDossier(req, res) {
    const scope = (req.query.scope || req.query.type || '').toUpperCase();
    if (scope === 'DIRECT') {
      return this._getScopedDossier(req, res, 'DIRECT');
    }
    if (scope === 'INDIRECT') {
      return this._getScopedDossier(req, res, 'INDIRECT');
    }
    return this._getScopedDossier(req, res, 'ALL');
  }

  /**
   * Internal helper to compute scoped dossier data, readiness score, and items.
   */
  async _getScopedDossier(req, res, scope = 'ALL') {
    try {
      const groupId = parseInt(req.query.group_id || req.query.teaching_group_id || req.query.groupId, 10);
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

      let itemsDef;
      if (scope === 'DIRECT') {
        itemsDef = assessmentProcessModel.getDirectAssessmentItems();
      } else if (scope === 'INDIRECT') {
        itemsDef = assessmentProcessModel.getIndirectAssessmentItems();
      } else {
        itemsDef = assessmentProcessModel.getItemsDefinition();
      }

      let completedCount = 0;
      const items = itemsDef.map((itemDef, idx) => {
        const doc = docMap[itemDef.key] || null;
        const isCompleted = !!doc;
        if (isCompleted) {
          completedCount++;
        }

        return {
          ...itemDef,
          num: idx + 1,
          is_completed: isCompleted,
          document: doc
        };
      });

      const totalItems = itemsDef.length;
      const completionPct = totalItems > 0 ? Math.round((completedCount / totalItems) * 100) : 0;

      return res.json({
        success: true,
        data: {
          assessment_file: {
            ...assessFile,
            scope,
            total_items: totalItems,
            completed_items: completedCount,
            pending_items: totalItems - completedCount,
            completion_pct: completionPct,
            readiness: {
              completed: completedCount,
              total: totalItems,
              pct: completionPct
            }
          },
          group: {
            id: group.id,
            name: group.name,
            subject_name: group.subject_name || group.name,
            subject_code: group.subject_code,
            semester: group.semester,
            component: group.component,
            department_name: group.department_name,
            department_code: group.department_code,
            teacher_name: group.teacher_name,
            teacher_code: group.teacher_code,
            academic_year: group.academic_year_label,
            register_id: group.register_id
          },
          items
        }
      });
    } catch (err) {
      logger.error('AssessmentProcessController._getScopedDossier error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to retrieve assessment dossier' }
      });
    }
  }

  /**
   * Uploads or replaces an assessment PDF document.
   * @route POST /api/v1/direct-assessment/documents or /api/v1/indirect-assessment/documents
   */
  async uploadDocument(req, res) {
    try {
      const groupId = parseInt(req.body.group_id || req.body.groupId, 10);
      const subjectId = req.body.subject_id ? parseInt(req.body.subject_id, 10) : null;
      const itemKey = req.body.item_key;
      const notes = req.body.notes || null;

      if (!itemKey) {
        return res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'item_key is required' }
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: { code: 'NO_FILE', message: 'No PDF file uploaded' }
        });
      }

      // Check item validity across all items
      const allItems = assessmentProcessModel.getItemsDefinition();
      const itemDef = allItems.find(i => i.key === itemKey);
      if (!itemDef) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ITEM', message: `Unknown assessment item key: ${itemKey}` }
        });
      }

      let group = null;
      if (groupId) {
        group = await assessmentProcessModel.getGroupDetails(groupId);
      }

      const assessFile = await assessmentProcessModel.getOrCreateAssessmentFile({
        groupId,
        subjectId,
        teacherId: group?.teacher_id || req.user?.id || 1,
        academicYearId: group?.academic_year_id,
        departmentId: group?.department_id,
        semester: group?.semester || 1
      });

      const filePath = `/uploads/assessment_process/${req.file.filename}`;
      const fileName = req.file.originalname || req.file.filename;
      const fileSize = req.file.size;
      const mimeType = req.file.mimetype || 'application/pdf';
      const userId = req.user?.id || 1;

      const { doc, oldFilePath } = await assessmentProcessModel.upsertDocument({
        assessmentFileId: assessFile.id,
        itemKey,
        docTitle: itemDef.title,
        filePath,
        fileName,
        fileSize,
        mimeType,
        userId,
        notes
      });

      // Cleanup prior file if replaced
      if (oldFilePath && oldFilePath !== filePath) {
        const oldDiskPath = path.join(__dirname, '../../', oldFilePath.replace(/^\//, ''));
        if (fs.existsSync(oldDiskPath)) {
          fs.unlink(oldDiskPath, () => {});
        }
      }

      if (auditService && auditService.logAction) {
        auditService.logAction({
          userId,
          action: 'ASSESSMENT_DOCUMENT_UPLOAD',
          details: `Uploaded ${itemDef.title} for group ${groupId || 'N/A'}`
        }).catch(() => {});
      }

      return res.status(201).json({
        success: true,
        data: {
          document: doc,
          item: itemDef
        }
      });
    } catch (err) {
      logger.error('AssessmentProcessController.uploadDocument error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to upload assessment document' }
      });
    }
  }

  /**
   * Deletes an assessment PDF document.
   * @route DELETE /api/v1/direct-assessment/documents or /api/v1/indirect-assessment/documents
   */
  async deleteDocument(req, res) {
    try {
      const groupId = parseInt(req.body.group_id || req.body.groupId || req.query.group_id, 10);
      const subjectId = req.body.subject_id ? parseInt(req.body.subject_id, 10) : null;
      const itemKey = req.body.item_key || req.query.item_key;

      if (!itemKey) {
        return res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'item_key is required' }
        });
      }

      let where = 'WHERE 1=1';
      const params = [];
      if (groupId) {
        where += ' AND teaching_group_id = ?';
        params.push(groupId);
      } else if (subjectId) {
        where += ' AND subject_id = ?';
        params.push(subjectId);
      }

      const { query } = require('../config/db');
      const files = await query(`SELECT * FROM assessment_process_files ${where} LIMIT 1`, params);
      if (!files || files.length === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Assessment file not found' }
        });
      }

      const assessFile = files[0];
      const deletedDoc = await assessmentProcessModel.deleteDocument(assessFile.id, itemKey);

      if (!deletedDoc) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'No document found to delete' }
        });
      }

      if (deletedDoc.file_path) {
        const diskPath = path.join(__dirname, '../../', deletedDoc.file_path.replace(/^\//, ''));
        if (fs.existsSync(diskPath)) {
          fs.unlink(diskPath, () => {});
        }
      }

      return res.json({
        success: true,
        message: 'Assessment document deleted successfully'
      });
    } catch (err) {
      logger.error('AssessmentProcessController.deleteDocument error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to delete assessment document' }
      });
    }
  }

  /**
   * HOD Audit Verification for Assessment File.
   * @route POST /api/v1/direct-assessment/audit or /api/v1/indirect-assessment/audit
   */
  async auditAssessment(req, res) {
    try {
      const groupId = parseInt(req.body.group_id || req.body.groupId, 10);
      const subjectId = req.body.subject_id ? parseInt(req.body.subject_id, 10) : null;
      const { status, remarks } = req.body;

      let where = 'WHERE 1=1';
      const params = [];
      if (groupId) {
        where += ' AND teaching_group_id = ?';
        params.push(groupId);
      } else if (subjectId) {
        where += ' AND subject_id = ?';
        params.push(subjectId);
      }

      const { query } = require('../config/db');
      const files = await query(`SELECT * FROM assessment_process_files ${where} LIMIT 1`, params);
      if (!files || files.length === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Assessment file not found' }
        });
      }

      const assessFile = files[0];
      await assessmentProcessModel.auditAssessment(assessFile.id, {
        status: status || 'APPROVED',
        hodRemarks: remarks || null,
        auditorId: req.user?.id || 1
      });

      return res.json({
        success: true,
        message: 'Assessment audit status updated successfully'
      });
    } catch (err) {
      logger.error('AssessmentProcessController.auditAssessment error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to save assessment audit' }
      });
    }
  }
}

module.exports = new AssessmentProcessController();
