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
   * Unifies direct media uploads, master timetables, course files, assignment attachments,
   * exam question papers, classroom post materials, and student record submissions.
   * 
   * @calledBy MediaController.listAssets() (controllers/mediaController.js)
   * @route GET /api/v1/media (routes/media.js)
   * @param {Object} filter Filters for dept, teacher, category, type, search, pagination
   * @returns {Promise<{assets: Array<Object>, stats: Object}>} Media list and stats
   */
  async listAssets({ deptId, teacherId, category, fileType, subjectId, studentId, search, limit = 50, offset = 0 }) {
    const dId = deptId || 0;
    const tId = teacherId || 0;

    // 1. Direct Faculty Media Assets
    const p1 = query(`
      SELECT m.id,
             'media' as source_type,
             m.id as source_id,
             m.faculty_id,
             m.department_id,
             m.subject_id,
             m.student_id,
             m.title,
             m.description,
             m.file_name,
             m.original_name,
             m.file_path,
             m.file_type,
             m.mime_type,
             COALESCE(m.file_size, 0) as file_size,
             m.category,
             m.tags,
             m.is_public_to_students,
             m.created_at,
             m.updated_at,
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
      WHERE (m.department_id = ? OR m.faculty_id = ? OR ? = 0)
    `, [dId, tId, dId]);

    // 2. Departmental Master Timetables
    const p2 = query(`
      SELECT (1000000 + tf.id) as id,
             'timetable' as source_type,
             tf.id as source_id,
             NULL as faculty_id,
             tf.department_id,
             NULL as subject_id,
             NULL as student_id,
             COALESCE(tf.title, tf.file_name) as title,
             CONCAT('Official Master Timetable • Year ', tf.year, ' • Sem ', COALESCE(tf.semester, 1)) as description,
             tf.file_name as file_name,
             tf.file_name as original_name,
             tf.file_path as file_path,
             'DOCUMENT' as file_type,
             'application/pdf' as mime_type,
             COALESCE(tf.file_size, 102400) as file_size,
             'TIMETABLE' as category,
             'timetable, schedule, official, routine' as tags,
             1 as is_public_to_students,
             tf.created_at,
             tf.updated_at,
             COALESCE(tf.uploader_name, 'Department Administration') as faculty_name,
             'Master Academic Timetable' as subject_name,
             'TIMETABLE' as subject_code,
             NULL as student_name,
             NULL as student_roll_no,
             NULL as student_enrollment_no
      FROM timetable_files tf
      WHERE (tf.department_id = ? OR ? = 0)
    `, [dId, dId]);

    // 3. Course File Documents (Syllabus, Lesson Plans, Lab Manuals, Outcomes)
    const p3 = query(`
      SELECT (2000000 + cfd.id) as id,
             'course_file' as source_type,
             cfd.id as source_id,
             cf.teacher_id as faculty_id,
             cf.department_id,
             cf.subject_id,
             NULL as student_id,
             COALESCE(cfd.title, cfd.file_name) as title,
             COALESCE(cfd.notes, CONCAT('Course File Document [', cfd.item_key, ']')) as description,
             cfd.file_name as file_name,
             cfd.file_name as original_name,
             cfd.file_path as file_path,
             'DOCUMENT' as file_type,
             COALESCE(cfd.mime_type, 'application/pdf') as mime_type,
             COALESCE(cfd.file_size, 102400) as file_size,
             CASE 
               WHEN cfd.item_key LIKE '%syllabus%' THEN 'SYLLABUS'
               WHEN cfd.item_key LIKE '%plan%' THEN 'LECTURE_NOTES'
               WHEN cfd.item_key LIKE '%question%' THEN 'QUESTION_PAPER'
               WHEN cfd.item_key LIKE '%lab%' THEN 'LAB_MANUAL'
               ELSE 'SYLLABUS'
             END as category,
             CONCAT('course_file, ', cfd.item_key, ', syllabus') as tags,
             0 as is_public_to_students,
             cfd.created_at,
             cfd.updated_at,
             t.full_name as faculty_name,
             s.name as subject_name,
             s.code as subject_code,
             NULL as student_name,
             NULL as student_roll_no,
             NULL as student_enrollment_no
      FROM course_file_documents cfd
      JOIN course_files cf ON cfd.course_file_id = cf.id
      LEFT JOIN subjects s ON cf.subject_id = s.id
      LEFT JOIN teachers t ON cf.teacher_id = t.id
      WHERE (cf.department_id = ? OR cf.teacher_id = ? OR ? = 0)
    `, [dId, tId, dId]);

    // 4. Assignments with attachments
    const p4 = query(`
      SELECT (3000000 + a.id) as id,
             'assignment' as source_type,
             a.id as source_id,
             a.teacher_id as faculty_id,
             a.department_id,
             a.subject_id,
             NULL as student_id,
             a.title as title,
             COALESCE(a.description, 'Coursework Assignment Brief & Instructions') as description,
             COALESCE(a.attachment_name, 'Assignment_Brief.pdf') as file_name,
             COALESCE(a.attachment_name, 'Assignment_Brief.pdf') as original_name,
             a.attachment_path as file_path,
             'DOCUMENT' as file_type,
             'application/pdf' as mime_type,
             102400 as file_size,
             'ASSIGNMENT' as category,
             'assignment, coursework, task' as tags,
             1 as is_public_to_students,
             a.created_at,
             a.updated_at,
             t.full_name as faculty_name,
             s.name as subject_name,
             s.code as subject_code,
             NULL as student_name,
             NULL as student_roll_no,
             NULL as student_enrollment_no
      FROM assignments a
      LEFT JOIN subjects s ON a.subject_id = s.id
      LEFT JOIN teachers t ON a.teacher_id = t.id
      WHERE a.attachment_path IS NOT NULL AND a.attachment_path != ''
        AND (a.department_id = ? OR a.teacher_id = ? OR ? = 0)
    `, [dId, tId, dId]);

    // 5. Assessments / Exam Question Papers with attachments
    const p5 = query(`
      SELECT (4000000 + asm.id) as id,
             'assessment' as source_type,
             asm.id as source_id,
             asm.teacher_id as faculty_id,
             asm.department_id,
             asm.subject_id,
             NULL as student_id,
             asm.title as title,
             COALESCE(asm.description, 'Official Class Test / Exam Question Paper') as description,
             COALESCE(asm.attachment_name, 'Question_Paper.pdf') as file_name,
             COALESCE(asm.attachment_name, 'Question_Paper.pdf') as original_name,
             asm.attachment_path as file_path,
             'DOCUMENT' as file_type,
             'application/pdf' as mime_type,
             102400 as file_size,
             'QUESTION_PAPER' as category,
             'exam, test, question_paper, evaluation' as tags,
             1 as is_public_to_students,
             asm.created_at,
             asm.updated_at,
             t.full_name as faculty_name,
             s.name as subject_name,
             s.code as subject_code,
             NULL as student_name,
             NULL as student_roll_no,
             NULL as student_enrollment_no
      FROM assessments asm
      LEFT JOIN subjects s ON asm.subject_id = s.id
      LEFT JOIN teachers t ON asm.teacher_id = t.id
      WHERE asm.attachment_path IS NOT NULL AND asm.attachment_path != ''
        AND (asm.department_id = ? OR asm.teacher_id = ? OR ? = 0)
    `, [dId, tId, dId]);

    // 6. Classroom Stream Posts with attachments
    const p6 = query(`
      SELECT (5000000 + cp.id) as id,
             'classroom_post' as source_type,
             cp.id as source_id,
             tg.teacher_id as faculty_id,
             tg.department_id,
             NULL as subject_id,
             NULL as student_id,
             COALESCE(cp.attachment_name, 'Classroom Resource') as title,
             COALESCE(cp.content, 'Instructional Resource posted to Classroom Stream') as description,
             COALESCE(cp.attachment_name, 'Resource.pdf') as file_name,
             COALESCE(cp.attachment_name, 'Resource.pdf') as original_name,
             cp.attachment_path as file_path,
             'DOCUMENT' as file_type,
             'application/pdf' as mime_type,
             102400 as file_size,
             'LECTURE_NOTES' as category,
             'stream, notes, lecture, material' as tags,
             1 as is_public_to_students,
             cp.created_at,
             cp.updated_at,
             t.full_name as faculty_name,
             tg.subject_name as subject_name,
             tg.subject_code as subject_code,
             NULL as student_name,
             NULL as student_roll_no,
             NULL as student_enrollment_no
      FROM classroom_posts cp
      JOIN teaching_groups tg ON cp.group_id = tg.id
      LEFT JOIN teachers t ON tg.teacher_id = t.id
      WHERE cp.attachment_path IS NOT NULL AND cp.attachment_path != ''
        AND (tg.department_id = ? OR tg.teacher_id = ? OR ? = 0)
    `, [dId, tId, dId]);

    // 7. Student Verified Documents (KYC/Dossier)
    const p7 = query(`
      SELECT (6000000 + sd.id) as id,
             'student_document' as source_type,
             sd.id as source_id,
             NULL as faculty_id,
             sd.department_id,
             NULL as subject_id,
             sd.student_id,
             COALESCE(sd.title, sd.file_name) as title,
             CONCAT('Student Verified Document • Type: ', sd.document_type) as description,
             sd.file_name as file_name,
             sd.file_name as original_name,
             sd.file_path as file_path,
             'STUDENT_DOC' as file_type,
             COALESCE(sd.mime_type, 'application/pdf') as mime_type,
             COALESCE(sd.file_size, 102400) as file_size,
             'STUDENT_DOC' as category,
             'student_document, kyc, credential, verified' as tags,
             0 as is_public_to_students,
             sd.created_at,
             sd.updated_at,
             COALESCE(sd.uploader_name, 'Student / Administration') as faculty_name,
             'Student Credentials' as subject_name,
             'DOC' as subject_code,
             st.full_name as student_name,
             st.class_roll_no as student_roll_no,
             st.official_enrollment_no as student_enrollment_no
      FROM student_documents sd
      LEFT JOIN students st ON sd.student_id = st.id
      WHERE (sd.department_id = ? OR ? = 0)
    `, [dId, dId]);

    // 8. Assignment Submissions (Student Coursework Submissions)
    const p8 = query(`
      SELECT (7000000 + asub.id) as id,
             'student_submission' as source_type,
             asub.id as source_id,
             a.teacher_id as faculty_id,
             a.department_id,
             a.subject_id,
             asub.student_id,
             CONCAT(a.title, ' — ', COALESCE(st.full_name, 'Student')) as title,
             CONCAT('Student Assignment Submission • Status: ', asub.status, CASE WHEN asub.marks_obtained IS NOT NULL THEN CONCAT(' • Marks: ', asub.marks_obtained) ELSE '' END) as description,
             COALESCE(asub.original_filename, 'submission.pdf') as file_name,
             COALESCE(asub.original_filename, 'submission.pdf') as original_name,
             asub.file_path as file_path,
             'STUDENT_DOC' as file_type,
             'application/pdf' as mime_type,
             102400 as file_size,
             'STUDENT_DOC' as category,
             'assignment, submission, student_record' as tags,
             0 as is_public_to_students,
             COALESCE(asub.submitted_at, asub.created_at) as created_at,
             asub.updated_at,
             t.full_name as faculty_name,
             s.name as subject_name,
             s.code as subject_code,
             st.full_name as student_name,
             st.class_roll_no as student_roll_no,
             st.official_enrollment_no as student_enrollment_no
      FROM assignment_submissions asub
      JOIN assignments a ON asub.assignment_id = a.id
      LEFT JOIN subjects s ON a.subject_id = s.id
      LEFT JOIN teachers t ON a.teacher_id = t.id
      LEFT JOIN students st ON asub.student_id = st.id
      WHERE asub.file_path IS NOT NULL AND asub.file_path != ''
        AND (a.department_id = ? OR a.teacher_id = ? OR ? = 0)
    `, [dId, tId, dId]);

    // 9. Assessment Submissions (Student Exam/Test Submissions)
    const p9 = query(`
      SELECT (8000000 + asb.id) as id,
             'assessment_submission' as source_type,
             asb.id as source_id,
             asm.teacher_id as faculty_id,
             asm.department_id,
             asm.subject_id,
             asb.student_id,
             CONCAT(asm.title, ' — ', COALESCE(st.full_name, 'Student')) as title,
             CONCAT('Class Test / Exam Submission • Status: ', asb.status, CASE WHEN asb.marks_obtained IS NOT NULL THEN CONCAT(' • Marks: ', asb.marks_obtained) ELSE '' END) as description,
             COALESCE(asb.original_filename, 'exam_submission.pdf') as file_name,
             COALESCE(asb.original_filename, 'exam_submission.pdf') as original_name,
             asb.file_path as file_path,
             'STUDENT_DOC' as file_type,
             'application/pdf' as mime_type,
             102400 as file_size,
             'STUDENT_DOC' as category,
             'exam, test, submission, student_record' as tags,
             0 as is_public_to_students,
             COALESCE(asb.submitted_at, asb.created_at) as created_at,
             asb.updated_at,
             t.full_name as faculty_name,
             s.name as subject_name,
             s.code as subject_code,
             st.full_name as student_name,
             st.class_roll_no as student_roll_no,
             st.official_enrollment_no as student_enrollment_no
      FROM assessment_submissions asb
      JOIN assessments asm ON asb.assessment_id = asm.id
      LEFT JOIN subjects s ON asm.subject_id = s.id
      LEFT JOIN teachers t ON asm.teacher_id = t.id
      LEFT JOIN students st ON asb.student_id = st.id
      WHERE asb.file_path IS NOT NULL AND asb.file_path != ''
        AND (asm.department_id = ? OR asm.teacher_id = ? OR ? = 0)
    `, [dId, tId, dId]);

    const [m1, m2, m3, m4, m5, m6, m7, m8, m9] = await Promise.all([p1, p2, p3, p4, p5, p6, p7, p8, p9]);
    let all = [...m1, ...m2, ...m3, ...m4, ...m5, ...m6, ...m7, ...m8, ...m9];

    // Calculate baseline counts before category filters
    let stats = {
      total_count: all.length,
      doc_count: 0,
      video_count: 0,
      image_count: 0,
      student_doc_count: 0,
      total_bytes: 0
    };

    all.forEach(item => {
      const ft = (item.file_type || '').toUpperCase();
      const cat = (item.category || '').toUpperCase();
      if (ft === 'VIDEO') stats.video_count++;
      else if (ft === 'IMAGE') stats.image_count++;
      else stats.doc_count++;

      if (cat === 'STUDENT_DOC' || ft === 'STUDENT_DOC') stats.student_doc_count++;
      stats.total_bytes += (item.file_size || 0);
    });

    // Apply Subject Filter
    if (subjectId) {
      const subNum = parseInt(subjectId, 10);
      all = all.filter(item => item.subject_id === subNum);
    }

    // Apply Student Filter
    if (studentId) {
      const stuNum = parseInt(studentId, 10);
      all = all.filter(item => item.student_id === stuNum);
    }

    // Apply Category Filter
    if (category && category !== 'ALL') {
      const catUpper = category.toUpperCase();
      if (catUpper === 'DOCUMENT') {
        all = all.filter(item => (item.file_type || '').toUpperCase() === 'DOCUMENT' || ['LECTURE_NOTES', 'QUESTION_PAPER', 'SYLLABUS', 'LAB_MANUAL', 'TIMETABLE', 'ASSIGNMENT'].includes((item.category || '').toUpperCase()));
      } else if (catUpper === 'VIDEO') {
        all = all.filter(item => (item.file_type || '').toUpperCase() === 'VIDEO');
      } else if (catUpper === 'IMAGE') {
        all = all.filter(item => (item.file_type || '').toUpperCase() === 'IMAGE');
      } else if (catUpper === 'STUDENT_DOC') {
        all = all.filter(item => (item.category || '').toUpperCase() === 'STUDENT_DOC' || (item.file_type || '').toUpperCase() === 'STUDENT_DOC');
      } else {
        all = all.filter(item => (item.category || '').toUpperCase() === catUpper);
      }
    }

    // Apply File Type Filter
    if (fileType && fileType !== 'ALL') {
      const ftUpper = fileType.toUpperCase();
      all = all.filter(item => (item.file_type || '').toUpperCase() === ftUpper);
    }

    // Apply Search Filter
    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      all = all.filter(item => {
        return (item.title && item.title.toLowerCase().includes(term)) ||
               (item.original_name && item.original_name.toLowerCase().includes(term)) ||
               (item.description && item.description.toLowerCase().includes(term)) ||
               (item.tags && item.tags.toLowerCase().includes(term)) ||
               (item.subject_name && item.subject_name.toLowerCase().includes(term)) ||
               (item.subject_code && item.subject_code.toLowerCase().includes(term)) ||
               (item.student_name && item.student_name.toLowerCase().includes(term)) ||
               (item.student_roll_no && item.student_roll_no.toLowerCase().includes(term)) ||
               (item.student_enrollment_no && item.student_enrollment_no.toLowerCase().includes(term)) ||
               (item.faculty_name && item.faculty_name.toLowerCase().includes(term));
      });
    }

    // Sort by created_at DESC
    all.sort((a, b) => {
      const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tB - tA;
    });

    const paginated = all.slice(parseInt(offset, 10), parseInt(offset, 10) + parseInt(limit, 10));

    return {
      assets: paginated,
      stats
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
