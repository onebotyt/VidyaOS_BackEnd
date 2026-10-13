/**
 * Faculty Drive & Media Asset Hub API + Omnisearch
 * Location: /src/routes/media.js
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const { query } = require('../config/db');
const { makeUploader, UPLOAD_ROOT } = require('../middleware/upload');
const auditService = require('../services/auditService');

const uploadMedia = makeUploader('media', 100); // 100MB max for lecture recordings/videos

router.use(auth);

/**
 * Determine file category and type from mimetype / extension
 */
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

/**
 * GET /api/v1/media
 * List media assets with search & filtering
 */
router.get('/', async (req, res) => {
  try {
    const { category, file_type, subject_id, student_id, search, limit = 50, offset = 0 } = req.query;

    let teacherId = null;
    let deptId = req.department_id || req.user.department_id;

    const teacherRows = await query(`SELECT id, department_id FROM teachers WHERE user_id = ?`, [req.user.id]);
    if (teacherRows.length > 0) {
      teacherId = teacherRows[0].id;
      deptId = teacherRows[0].department_id || deptId;
    }

    let sql = `
      SELECT m.*,
             t.full_name as faculty_name,
             s.name as subject_name,
             s.code as subject_code,
             st.full_name as student_name,
             st.class_roll_no as student_roll_no,
             st.official_enrollment_no as student_enrollment_no
      FROM faculty_media_assets m
      LEFT JOIN teachers t ON m.faculty_id = t.id
      LEFT JOIN subjects s ON m.subject_id = s.id
      LEFT JOIN students st ON m.student_id = st.id
      WHERE (m.department_id = ? OR m.faculty_id = ?)
    `;
    const params = [deptId || 0, teacherId || 0];

    if (category && category !== 'ALL') {
      sql += ` AND m.category = ?`;
      params.push(category);
    }

    if (file_type && file_type !== 'ALL') {
      sql += ` AND m.file_type = ?`;
      params.push(file_type);
    }

    if (subject_id) {
      sql += ` AND m.subject_id = ?`;
      params.push(parseInt(subject_id, 10));
    }

    if (student_id) {
      sql += ` AND m.student_id = ?`;
      params.push(parseInt(student_id, 10));
    }

    if (search && search.trim()) {
      const term = `%${search.trim().toLowerCase()}%`;
      sql += ` AND (LOWER(m.title) LIKE ? OR LOWER(m.original_name) LIKE ? OR LOWER(COALESCE(m.tags, '')) LIKE ? OR LOWER(COALESCE(m.description, '')) LIKE ? OR LOWER(COALESCE(s.name, '')) LIKE ? OR LOWER(COALESCE(s.code, '')) LIKE ?)`;
      params.push(term, term, term, term, term, term);
    }

    sql += ` ORDER BY m.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const assets = await query(sql, params);

    // Get asset category statistics for filter tabs
    const statsRows = await query(`
      SELECT 
        COUNT(*) as total_count,
        SUM(CASE WHEN file_type = 'DOCUMENT' THEN 1 ELSE 0 END) as doc_count,
        SUM(CASE WHEN file_type = 'VIDEO' THEN 1 ELSE 0 END) as video_count,
        SUM(CASE WHEN file_type = 'IMAGE' THEN 1 ELSE 0 END) as image_count,
        SUM(CASE WHEN category = 'STUDENT_DOC' THEN 1 ELSE 0 END) as student_doc_count,
        COALESCE(SUM(file_size), 0) as total_bytes
      FROM faculty_media_assets
      WHERE (department_id = ? OR faculty_id = ?)
    `, [deptId || 0, teacherId || 0]);

    res.json({
      success: true,
      data: assets,
      stats: statsRows[0] || { total_count: 0, doc_count: 0, video_count: 0, image_count: 0, student_doc_count: 0, total_bytes: 0 }
    });
  } catch (err) {
    console.error('Error listing faculty media assets:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/media/upload
 * Upload and catalog a new media asset
 */
router.post('/upload', uploadMedia.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No file was uploaded' } });
    }

    let teacherId = null;
    let deptId = req.department_id || req.user.department_id;
    const teacherRows = await query(`SELECT id, department_id FROM teachers WHERE user_id = ?`, [req.user.id]);
    if (teacherRows.length > 0) {
      teacherId = teacherRows[0].id;
      deptId = teacherRows[0].department_id || deptId;
    }

    if (!teacherId) {
      // Fallback for admin or HOD user
      teacherId = 1;
    }

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

    const insertRes = await query(`
      INSERT INTO faculty_media_assets (
        faculty_id, department_id, subject_id, student_id,
        title, description, file_name, original_name, file_path,
        file_type, mime_type, file_size, category, tags,
        is_public_to_students, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      teacherId,
      deptId || 1,
      subject_id ? parseInt(subject_id, 10) : null,
      student_id ? parseInt(student_id, 10) : null,
      displayTitle,
      description || null,
      req.file.filename,
      req.file.originalname,
      filePath,
      fileType,
      req.file.mimetype,
      req.file.size,
      category || 'LECTURE_NOTES',
      tags ? tags.trim() : null,
      is_public_to_students ? 1 : 0
    ]);

    const newId = insertRes.insertId;
    const inserted = await query(`SELECT * FROM faculty_media_assets WHERE id = ?`, [newId]);

    // Audit Log
    await auditService.logAudit({
      eventType: 'FACULTY_MEDIA_UPLOADED',
      actorId: req.user.id,
      actorRole: req.user.roles?.[0] || 'TEACHER',
      targetType: 'faculty_media_assets',
      targetId: newId,
      details: { title: displayTitle, fileType, size: req.file.size, category }
    });

    res.status(201).json({
      success: true,
      message: 'Media asset uploaded and organized successfully',
      data: inserted[0]
    });
  } catch (err) {
    console.error('Error uploading faculty media asset:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * GET /api/v1/media/search/omni & GET /api/v1/search/omni
 * Unified Global Omnisearch for Ctrl+K Bar
 * Fast search across Teacher Media, Students, Courses & Quick Actions
 */
router.get(['/search/omni', '/omni'], async (req, res) => {
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
    const deptId = req.department_id || req.user.department_id || 1;

    // 1. Search Media & Documents
    const mediaResults = await query(`
      SELECT m.id, m.title, m.original_name, m.file_path, m.file_type, m.category, m.file_size, m.tags,
             s.name as subject_name, s.code as subject_code
      FROM faculty_media_assets m
      LEFT JOIN subjects s ON m.subject_id = s.id
      WHERE (LOWER(m.title) LIKE ? OR LOWER(m.original_name) LIKE ? OR LOWER(COALESCE(m.tags, '')) LIKE ? OR LOWER(COALESCE(s.name, '')) LIKE ? OR LOWER(COALESCE(s.code, '')) LIKE ?)
      ORDER BY m.created_at DESC
      LIMIT 8
    `, [term, term, term, term, term]);

    // 2. Search Students (by Name, Roll #, Enrollment #, Phone)
    const studentResults = await query(`
      SELECT s.id, s.full_name, s.class_roll_no, s.official_enrollment_no, s.registration_no, s.phone,
             d.name as department_name, d.code as department_code,
             e.year, e.semester
      FROM students s
      LEFT JOIN enrollments e ON e.student_id = s.id AND (e.status = 'ENROLLED' OR e.status = 'ACTIVE')
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE (LOWER(s.full_name) LIKE ? OR LOWER(COALESCE(s.class_roll_no, '')) LIKE ? OR LOWER(COALESCE(s.official_enrollment_no, '')) LIKE ? OR LOWER(COALESCE(s.registration_no, '')) LIKE ? OR s.phone LIKE ?)
      GROUP BY s.id
      LIMIT 8
    `, [term, term, term, term, term]);

    // 3. Search Courses / Registers
    const courseResults = await query(`
      SELECT ar.id as register_id, ar.name as register_name, ar.session_type_scope as component,
             s.id as subject_id, s.name as subject_name, s.code as subject_code
      FROM subjects s
      LEFT JOIN attendance_registers ar ON ar.subject_id = s.id AND ar.is_active = 1
      WHERE (LOWER(s.name) LIKE ? OR LOWER(s.code) LIKE ? OR LOWER(COALESCE(ar.name, '')) LIKE ?)
      GROUP BY s.id
      LIMIT 6
    `, [term, term, term]);

    // 4. Contextual Actions
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

    res.json({
      success: true,
      data: {
        media: mediaResults,
        students: studentResults,
        courses: courseResults,
        actions
      }
    });
  } catch (err) {
    console.error('Error in omnisearch:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * GET /api/v1/media/:id
 * Fetch single media asset
 */
router.get('/:id', async (req, res) => {
  try {
    const assetId = parseInt(req.params.id, 10);
    const rows = await query(`
      SELECT m.*,
             t.full_name as faculty_name,
             s.name as subject_name,
             s.code as subject_code,
             st.full_name as student_name,
             st.class_roll_no as student_roll_no
      FROM faculty_media_assets m
      LEFT JOIN teachers t ON m.faculty_id = t.id
      LEFT JOIN subjects s ON m.subject_id = s.id
      LEFT JOIN students st ON m.student_id = st.id
      WHERE m.id = ?
    `, [assetId]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Asset not found' } });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * PUT /api/v1/media/:id
 * Edit asset details (title, tags, category, visibility)
 */
router.put('/:id', async (req, res) => {
  try {
    const assetId = parseInt(req.params.id, 10);
    const { title, description, category, subject_id, student_id, tags, is_public_to_students } = req.body;

    const existing = await query(`SELECT * FROM faculty_media_assets WHERE id = ?`, [assetId]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Asset not found' } });
    }

    await query(`
      UPDATE faculty_media_assets
      SET title = COALESCE(?, title),
          description = ?,
          category = COALESCE(?, category),
          subject_id = ?,
          student_id = ?,
          tags = ?,
          is_public_to_students = COALESCE(?, is_public_to_students),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      title ? title.trim() : null,
      description !== undefined ? description : existing[0].description,
      category || null,
      subject_id !== undefined ? (subject_id ? parseInt(subject_id, 10) : null) : existing[0].subject_id,
      student_id !== undefined ? (student_id ? parseInt(student_id, 10) : null) : existing[0].student_id,
      tags !== undefined ? tags : existing[0].tags,
      is_public_to_students !== undefined ? (is_public_to_students ? 1 : 0) : null,
      assetId
    ]);

    const updated = await query(`SELECT * FROM faculty_media_assets WHERE id = ?`, [assetId]);
    res.json({ success: true, message: 'Asset updated successfully', data: updated[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * DELETE /api/v1/media/:id
 * Delete media asset and remove file from disk
 */
router.delete('/:id', async (req, res) => {
  try {
    const assetId = parseInt(req.params.id, 10);
    const rows = await query(`SELECT * FROM faculty_media_assets WHERE id = ?`, [assetId]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Asset not found' } });
    }

    const asset = rows[0];

    // Remove file from disk
    try {
      const diskPath = path.join(UPLOAD_ROOT, 'media', asset.file_name);
      if (fs.existsSync(diskPath)) {
        fs.unlinkSync(diskPath);
      }
    } catch (diskErr) {
      console.warn('Could not remove file from disk:', diskErr.message);
    }

    await query(`DELETE FROM faculty_media_assets WHERE id = ?`, [assetId]);

    await auditService.logAudit({
      eventType: 'FACULTY_MEDIA_DELETED',
      actorId: req.user.id,
      actorRole: req.user.roles?.[0] || 'TEACHER',
      targetType: 'faculty_media_assets',
      targetId: assetId,
      details: { title: asset.title, fileName: asset.file_name }
    });

    res.json({ success: true, message: 'Asset deleted permanently' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;
