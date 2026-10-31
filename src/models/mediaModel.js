/**
 * Media Model — Data access layer for faculty drive assets, media files, and global omnisearch.
 */

const { query } = require('../config/db');

class MediaModel {
  /**
   * Resolves faculty ID and department context for the calling user.
   * 
   * @calledBy MediaController.listAssets() (controllers/mediaController.js)
   * @calledBy MediaController.uploadAsset() (controllers/mediaController.js)
   * @route GET /api/v1/media, POST /api/v1/media/upload (routes/media.js)
   * @param {number} userId User ID
   * @param {number} fallbackDeptId Fallback department ID
   * @returns {Promise<{teacherId: number|null, deptId: number}>} Context
   */
  async getTeacherContext(userId, fallbackDeptId) {
    const rows = await query(`SELECT id, department_id FROM teachers WHERE user_id = ?`, [userId]);
    if (rows.length > 0) {
      return {
        teacherId: rows[0].id,
        deptId: rows[0].department_id || fallbackDeptId
      };
    }
    return {
      teacherId: null,
      deptId: fallbackDeptId || 1
    };
  }

  /**
   * Lists media assets visible to department faculty along with storage category statistics.
   * 
   * @calledBy MediaController.listAssets() (controllers/mediaController.js)
   * @route GET /api/v1/media (routes/media.js)
   * @param {Object} filter Filters for dept, teacher, category, type, search, pagination
   * @returns {Promise<{assets: Array<Object>, stats: Object}>} Media list and stats
   */
  async listAssets({ deptId, teacherId, category, fileType, subjectId, studentId, search, limit = 50, offset = 0 }) {
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
    if (fileType && fileType !== 'ALL') {
      sql += ` AND m.file_type = ?`;
      params.push(fileType);
    }
    if (subjectId) {
      sql += ` AND m.subject_id = ?`;
      params.push(parseInt(subjectId, 10));
    }
    if (studentId) {
      sql += ` AND m.student_id = ?`;
      params.push(parseInt(studentId, 10));
    }
    if (search && search.trim()) {
      const term = `%${search.trim().toLowerCase()}%`;
      sql += ` AND (LOWER(m.title) LIKE ? OR LOWER(m.original_name) LIKE ? OR LOWER(COALESCE(m.tags, '')) LIKE ? OR LOWER(COALESCE(m.description, '')) LIKE ? OR LOWER(COALESCE(s.name, '')) LIKE ? OR LOWER(COALESCE(s.code, '')) LIKE ?)`;
      params.push(term, term, term, term, term, term);
    }

    sql += ` ORDER BY m.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const assets = await query(sql, params);

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

    return {
      assets,
      stats: statsRows[0] || { total_count: 0, doc_count: 0, video_count: 0, image_count: 0, student_doc_count: 0, total_bytes: 0 }
    };
  }

  /**
   * Catalogs a new media file upload record.
   * 
   * @calledBy MediaController.uploadAsset() (controllers/mediaController.js)
   * @route POST /api/v1/media/upload (routes/media.js)
   * @param {Object} params File metadata and associations
   * @returns {Promise<Object>} Created media asset row
   */
  async createAsset({ teacherId, deptId, subjectId, studentId, title, description, filename, originalname, filePath, fileType, mimetype, size, category, tags, isPublic }) {
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
      subjectId ? parseInt(subjectId, 10) : null,
      studentId ? parseInt(studentId, 10) : null,
      title,
      description || null,
      filename,
      originalname,
      filePath,
      fileType,
      mimetype,
      size,
      category || 'LECTURE_NOTES',
      tags ? tags.trim() : null,
      isPublic ? 1 : 0
    ]);

    const newId = insertRes.insertId || insertRes.lastInsertRowid;
    const inserted = await query(`SELECT * FROM faculty_media_assets WHERE id = ?`, [newId]);
    return inserted[0];
  }

  /**
   * Retrieves single media asset row by ID with joined teacher, subject, student data.
   * 
   * @calledBy MediaController.getAsset() (controllers/mediaController.js)
   * @calledBy MediaController.updateAsset() (controllers/mediaController.js)
   * @calledBy MediaController.deleteAsset() (controllers/mediaController.js)
   * @route GET/PUT/DELETE /api/v1/media/:id (routes/media.js)
   * @param {number} id Asset ID
   * @returns {Promise<Object|null>} Asset row or null
   */
  async getById(id) {
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
    `, [id]);
    return rows[0] || null;
  }

  /**
   * Updates media asset metadata and associations.
   * 
   * @calledBy MediaController.updateAsset() (controllers/mediaController.js)
   * @route PUT /api/v1/media/:id (routes/media.js)
   * @param {number} id Asset ID
   * @param {Object} data Updates
   * @param {Object} existing Existing asset row
   * @returns {Promise<Object>} Updated asset row
   */
  async updateAsset(id, data, existing) {
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
      data.title ? data.title.trim() : null,
      data.description !== undefined ? data.description : existing.description,
      data.category || null,
      data.subject_id !== undefined ? (data.subject_id ? parseInt(data.subject_id, 10) : null) : existing.subject_id,
      data.student_id !== undefined ? (data.student_id ? parseInt(data.student_id, 10) : null) : existing.student_id,
      data.tags !== undefined ? data.tags : existing.tags,
      data.is_public_to_students !== undefined ? (data.is_public_to_students ? 1 : 0) : null,
      id
    ]);

    const updated = await query(`SELECT * FROM faculty_media_assets WHERE id = ?`, [id]);
    return updated[0];
  }

  /**
   * Deletes a media asset record from the database.
   * 
   * @calledBy MediaController.deleteAsset() (controllers/mediaController.js)
   * @route DELETE /api/v1/media/:id (routes/media.js)
   * @param {number} id Asset ID
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteAsset(id) {
    const res = await query(`DELETE FROM faculty_media_assets WHERE id = ?`, [id]);
    return res.affectedRows > 0 || res.changes > 0;
  }

  /**
   * Executes unified omnisearch across media assets, students, and courses.
   * 
   * @calledBy MediaController.searchOmni() (controllers/mediaController.js)
   * @route GET /api/v1/media/search/omni (routes/media.js)
   * @param {string} term Wildcard SQL search query pattern
   * @returns {Promise<{mediaResults: Array, studentResults: Array, courseResults: Array}>} Search hits
   */
  async searchOmni(term) {
    const [mediaResults, studentResults, courseResults] = await Promise.all([
      query(`
        SELECT m.id, m.title, m.original_name, m.file_path, m.file_type, m.category, m.file_size, m.tags,
               s.name as subject_name, s.code as subject_code
        FROM faculty_media_assets m
        LEFT JOIN subjects s ON m.subject_id = s.id
        WHERE (LOWER(m.title) LIKE ? OR LOWER(m.original_name) LIKE ? OR LOWER(COALESCE(m.tags, '')) LIKE ? OR LOWER(COALESCE(s.name, '')) LIKE ? OR LOWER(COALESCE(s.code, '')) LIKE ?)
        ORDER BY m.created_at DESC
        LIMIT 8
      `, [term, term, term, term, term]),

      query(`
        SELECT s.id, s.full_name, s.class_roll_no, s.official_enrollment_no, s.registration_no, s.phone,
               MAX(d.name) as department_name, MAX(d.code) as department_code,
               MAX(e.year) as year, MAX(e.semester) as semester
        FROM students s
        LEFT JOIN enrollments e ON e.student_id = s.id AND (e.status = 'ENROLLED' OR e.status = 'ACTIVE')
        LEFT JOIN departments d ON d.id = e.department_id
        WHERE (LOWER(s.full_name) LIKE ? OR LOWER(COALESCE(s.class_roll_no, '')) LIKE ? OR LOWER(COALESCE(s.official_enrollment_no, '')) LIKE ? OR LOWER(COALESCE(s.registration_no, '')) LIKE ? OR s.phone LIKE ?)
        GROUP BY s.id, s.full_name, s.class_roll_no, s.official_enrollment_no, s.registration_no, s.phone
        LIMIT 8
      `, [term, term, term, term, term]),

      query(`
        SELECT MAX(ar.id) as register_id, MAX(ar.name) as register_name, MAX(ar.session_type_scope) as component,
               s.id as subject_id, s.name as subject_name, s.code as subject_code
        FROM subjects s
        LEFT JOIN attendance_registers ar ON ar.subject_id = s.id AND ar.is_active = 1
        WHERE (LOWER(s.name) LIKE ? OR LOWER(s.code) LIKE ? OR LOWER(COALESCE(ar.name, '')) LIKE ?)
        GROUP BY s.id, s.name, s.code
        LIMIT 6
      `, [term, term, term])
    ]);

    return { mediaResults, studentResults, courseResults };
  }
}

module.exports = new MediaModel();
