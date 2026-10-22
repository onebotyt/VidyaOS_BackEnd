/**
 * Media Controller — HTTP request/response handlers for faculty drive assets and omnisearch.
 */

const path = require('path');
const fs = require('fs');
const mediaModel = require('../models/mediaModel');
const auditService = require('../services/auditService');
const { UPLOAD_ROOT } = require('../middleware/upload');
const logger = require('../utils/logger');

function classifyFile(mimetype, filename) {
  const ext = path.extname(filename).toLowerCase();
  if (mimetype.startsWith('video/') || ['.mp4', '.webm', '.mov', '.mkv', '.avi'].includes(ext)) {
    return 'VIDEO';
  }
  if (mimetype.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.svg'].includes(ext)) {
    return 'IMAGE';
  }
  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) {
    return 'ARCHIVE';
  }
  return 'DOCUMENT';
}

class MediaController {
  /**
   * Retrieves faculty media assets filtered by category, file type, or keyword search.
   * 
   * @route GET /api/v1/media (routes/media.js)
   * @access Protected (All Authenticated Users)
   * @usesModel MediaModel.getTeacherContext() (models/mediaModel.js)
   * @usesModel MediaModel.listAssets() (models/mediaModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async listAssets(req, res) {
    try {
      const { category, file_type, subject_id, student_id, search, limit = 50, offset = 0 } = req.query;
      const { teacherId, deptId } = await mediaModel.getTeacherContext(req.user.id, req.department_id || req.user.department_id);

      const { assets, stats } = await mediaModel.listAssets({
        deptId,
        teacherId,
        category,
        fileType: file_type,
        subjectId: subject_id,
        studentId: student_id,
        search,
        limit,
        offset
      });

      return res.json({
        success: true,
        data: assets,
        stats
      });
    } catch (err) {
      logger.error('[MediaController] listAssets error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Uploads and catalogs a media file asset into the faculty drive.
   * 
   * @route POST /api/v1/media/upload (routes/media.js)
   * @access Protected (Faculty/Admin)
   * @usesModel MediaModel.getTeacherContext() (models/mediaModel.js)
   * @usesModel MediaModel.createAsset() (models/mediaModel.js)
   * @usesService AuditService.logAudit() (services/auditService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async uploadAsset(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No file was uploaded' } });
      }

      const { teacherId, deptId } = await mediaModel.getTeacherContext(req.user.id, req.department_id || req.user.department_id);
      const effTeacherId = teacherId || 1;

      const {
        title,
        description = '',
        category = 'LECTURE_NOTES',
        subject_id = null,
        student_id = null,
        tags = '',
        is_public_to_students = 0
      } = req.body;

      const fileType = classifyFile(req.file.mimetype, req.file.originalname);
      const filePath = `/uploads/media/${req.file.filename}`;
      const displayTitle = title ? title.trim() : path.basename(req.file.originalname, path.extname(req.file.originalname));

      const asset = await mediaModel.createAsset({
        teacherId: effTeacherId,
        deptId: deptId || 1,
        subjectId: subject_id,
        studentId: student_id,
        title: displayTitle,
        description,
        filename: req.file.filename,
        originalname: req.file.originalname,
        filePath,
        fileType,
        mimetype: req.file.mimetype,
        size: req.file.size,
        category,
        tags,
        isPublic: is_public_to_students
      });

      await auditService.logAudit({
        eventType: 'FACULTY_MEDIA_UPLOADED',
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'TEACHER',
        targetType: 'faculty_media_assets',
        targetId: asset.id,
        details: { title: displayTitle, fileType, size: req.file.size, category }
      });

      return res.status(201).json({
        success: true,
        message: 'Media asset uploaded and organized successfully',
        data: asset
      });
    } catch (err) {
      logger.error('[MediaController] uploadAsset error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Unified omnisearch engine across media, students, courses, and quick actions.
   * 
   * @route GET /api/v1/media/search/omni (routes/media.js)
   * @access Protected (All Authenticated Users)
   * @usesModel MediaModel.searchOmni() (models/mediaModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async searchOmni(req, res) {
    try {
      const q = (req.query.q || '').trim();
      if (!q || q.length < 2) {
        return res.json({
          success: true,
          data: {
            media: [],
            students: [],
            courses: [],
            actions: [
              { id: 'act_upload', title: 'Upload New Media / Document', icon: 'upload', url: '/faculty/media.html?action=upload', category: 'Action' },
              { id: 'act_registers', title: 'Open Attendance Matrix & Registers', icon: 'book', url: '/faculty/registers.html', category: 'Action' },
              { id: 'act_tests', title: 'Open Class Tests & Marksheets', icon: 'clipboard', url: '/faculty/tests.html', category: 'Action' },
              { id: 'act_assignments', title: 'Coursework & Assignments Studio', icon: 'file-text', url: '/faculty/assignments.html', category: 'Action' },
              { id: 'act_students', title: 'Department Students Roster', icon: 'users', url: '/faculty/students.html', category: 'Action' }
            ]
          }
        });
      }

      const term = `%${q.toLowerCase()}%`;
      const { mediaResults, studentResults, courseResults } = await mediaModel.searchOmni(term);

      const actions = [];
      if ('upload'.includes(q.toLowerCase()) || 'media'.includes(q.toLowerCase()) || 'file'.includes(q.toLowerCase())) {
        actions.push({ id: 'act_upload', title: 'Upload New Media / Document', icon: 'upload', url: '/faculty/media.html?action=upload', category: 'Action' });
      }
      if ('register'.includes(q.toLowerCase()) || 'attendance'.includes(q.toLowerCase())) {
        actions.push({ id: 'act_registers', title: 'Open Attendance Matrix', icon: 'book', url: '/faculty/registers.html', category: 'Action' });
      }
      if ('assignment'.includes(q.toLowerCase()) || 'coursework'.includes(q.toLowerCase())) {
        actions.push({ id: 'act_assignments', title: 'Create Coursework / Assignment', icon: 'file-text', url: '/faculty/assignments.html?action=create', category: 'Action' });
      }
      if ('test'.includes(q.toLowerCase()) || 'exam'.includes(q.toLowerCase()) || 'mark'.includes(q.toLowerCase())) {
        actions.push({ id: 'act_tests', title: 'Open Class Tests Studio', icon: 'clipboard', url: '/faculty/tests.html', category: 'Action' });
      }

      return res.json({
        success: true,
        data: {
          media: mediaResults,
          students: studentResults,
          courses: courseResults,
          actions
        }
      });
    } catch (err) {
      logger.error('[MediaController] searchOmni error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves single media asset metadata by ID.
   * 
   * @route GET /api/v1/media/:id (routes/media.js)
   * @access Protected (All Authenticated Users)
   * @usesModel MediaModel.getById() (models/mediaModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async getAsset(req, res) {
    try {
      const asset = await mediaModel.getById(parseInt(req.params.id, 10));
      if (!asset) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Asset not found' } });
      }
      return res.json({ success: true, data: asset });
    } catch (err) {
      logger.error('[MediaController] getAsset error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Updates metadata, category, and access tags for an existing media asset.
   * 
   * @route PUT /api/v1/media/:id (routes/media.js)
   * @access Protected (Faculty/Admin)
   * @usesModel MediaModel.getById() (models/mediaModel.js)
   * @usesModel MediaModel.updateAsset() (models/mediaModel.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async updateAsset(req, res) {
    try {
      const assetId = parseInt(req.params.id, 10);
      const existing = await mediaModel.getById(assetId);
      if (!existing) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Asset not found' } });
      }

      const updated = await mediaModel.updateAsset(assetId, req.body, existing);
      return res.json({ success: true, message: 'Asset updated successfully', data: updated });
    } catch (err) {
      logger.error('[MediaController] updateAsset error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Permanently deletes a media asset record from the database and removes file from disk.
   * 
   * @route DELETE /api/v1/media/:id (routes/media.js)
   * @access Protected (Faculty/Admin)
   * @usesModel MediaModel.getById() (models/mediaModel.js)
   * @usesModel MediaModel.deleteAsset() (models/mediaModel.js)
   * @usesService AuditService.logAudit() (services/auditService.js)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async deleteAsset(req, res) {
    try {
      const assetId = parseInt(req.params.id, 10);
      const asset = await mediaModel.getById(assetId);
      if (!asset) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Asset not found' } });
      }

      try {
        const diskPath = path.join(UPLOAD_ROOT, 'media', asset.file_name);
        if (fs.existsSync(diskPath)) {
          fs.unlinkSync(diskPath);
        }
      } catch (diskErr) {
        logger.warn('[MediaController] Could not remove file from disk:', { error: diskErr.message });
      }

      await mediaModel.deleteAsset(assetId);

      await auditService.logAudit({
        eventType: 'FACULTY_MEDIA_DELETED',
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'TEACHER',
        targetType: 'faculty_media_assets',
        targetId: assetId,
        details: { title: asset.title, fileName: asset.file_name }
      });

      return res.json({ success: true, message: 'Asset deleted permanently' });
    } catch (err) {
      logger.error('[MediaController] deleteAsset error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = new MediaController();
