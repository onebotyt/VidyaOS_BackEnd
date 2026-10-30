/**
 * Teaching Group Model
 * Encapsulates SQLite queries and transactions for classroom groups, memberships, stream posts, classwork, and tests.
 *
 * Architecture Role: Model (Data Access Layer)
 * Interacts With:
 *   - Controllers: controllers/teachingGroupController.js
 *   - Routes: routes/teachingGroups.js
 * Database Tables: teaching_groups, teaching_group_members, classroom_posts, classroom_post_comments, assessments, assessment_submissions, attendance_registers, attendance_sessions, register_attendance, teachers, students, enrollments, departments, academic_years, system_settings
 */

const { query, withTransaction } = require('../config/db');

class TeachingGroupModel {
  /**
   * Resolves the teacher profile associated with a user or fallback for system admin.
   * @calledBy TeachingGroupController.createGroup() (controllers/teachingGroupController.js)
   * @route POST /api/v1/teaching-groups (routes/teachingGroups.js)
   * @param {Object} user - Authenticated user token payload
   * @returns {Promise<Object|null>} Teacher profile { id, department_id, full_name } or null
   */
  static async resolveTeacher(user) {
    if (user?.teacher_id) {
      const rows = await query(`SELECT id, department_id, full_name FROM teachers WHERE id = ?`, [user.teacher_id]);
      if (rows && rows.length > 0) {
        return { id: rows[0].id, department_id: rows[0].department_id, full_name: rows[0].full_name };
      }
    }

    if (user?.id) {
      const rows = await query(`SELECT id, department_id, full_name FROM teachers WHERE user_id = ?`, [user.id]);
      if (rows && rows.length > 0) {
        user.teacher_id = rows[0].id;
        return { id: rows[0].id, department_id: rows[0].department_id, full_name: rows[0].full_name };
      }
    }

    if (user?.roles && user.roles.includes('SYSTEM_ADMIN')) {
      const rows = await query(`SELECT id, department_id, full_name FROM teachers ORDER BY id ASC LIMIT 1`);
      if (rows && rows.length > 0) {
        user.teacher_id = rows[0].id;
        return { id: rows[0].id, department_id: rows[0].department_id, full_name: rows[0].full_name };
      }
    }

    return null;
  }

  /**
   * Retrieves current active academic year ID.
   * @calledBy TeachingGroupController.createGroup(), promoteCohort() (controllers/teachingGroupController.js)
   * @route POST /api/v1/teaching-groups, POST /api/v1/teaching-groups/:id/promote (routes/teachingGroups.js)
   * @returns {Promise<number>} Academic year ID
   */
  static async getCurrentAcademicYearId() {
    const rows = await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`);
    return rows[0]?.id || 1;
  }

  /**
   * Aggregates dashboard overview metrics for teacher teaching groups.
   * @calledBy TeachingGroupController.getOverview() (controllers/teachingGroupController.js)
   * @route GET /api/v1/teaching-groups/overview (routes/teachingGroups.js)
   * @param {number} teacherId - Teacher ID
   * @returns {Promise<Object>} Overview payload
   */
  static async getOverviewData(teacherId) {
    const teacherParams = [teacherId || -1];

    const groups = await query(`
      SELECT tg.id, tg.name, tg.subject_name, tg.subject_code, tg.component, tg.total_units, tg.semester,
             ar.id as register_id,
             (SELECT COUNT(*) FROM teaching_group_members tgm WHERE tgm.group_id = tg.id AND tgm.status = 'ENROLLED') as member_count,
             (SELECT COUNT(DISTINCT s.id) FROM attendance_sessions s WHERE s.register_id = ar.id AND s.state != 'DRAFT') as session_count,
             (SELECT ROUND(COUNT(CASE WHEN ra.attendance_status IN ('PRESENT', 'LATE') THEN 1 END) * 100.0 / NULLIF(COUNT(ra.id), 0), 1)
              FROM attendance_sessions s
              JOIN register_attendance ra ON ra.session_id = s.id
              WHERE s.register_id = ar.id AND s.state != 'DRAFT') as avg_attendance_pct
      FROM teaching_groups tg
      LEFT JOIN attendance_registers ar ON ar.group_id = tg.id
      WHERE tg.teacher_id = ? AND tg.status = 'ACTIVE' AND tg.deleted_at IS NULL
      ORDER BY tg.created_at DESC
    `, teacherParams);

    const recentDue = await query(`
      SELECT a.id, a.title, a.type, a.due_date, a.max_marks, a.created_at,
             tg.id as group_id, tg.name as group_name, tg.subject_name,
             (SELECT COUNT(*) FROM assessment_submissions sub WHERE sub.assessment_id = a.id) as turned_in_count,
             (SELECT COUNT(*) FROM teaching_group_members tgm WHERE tgm.group_id = tg.id AND tgm.status = 'ENROLLED') as total_students
      FROM assessments a
      JOIN teaching_groups tg ON a.group_id = tg.id
      WHERE tg.teacher_id = ? AND tg.status = 'ACTIVE' AND tg.deleted_at IS NULL
      ORDER BY 
        CASE WHEN a.due_date >= CURDATE() THEN 0 ELSE 1 END,
        a.due_date ASC,
        a.created_at DESC
      LIMIT 8
    `, teacherParams);

    const trashRows = await query(`
      SELECT COUNT(*) as cnt FROM teaching_groups tg
      WHERE tg.teacher_id = ? AND (tg.status = 'TRASHED' OR tg.deleted_at IS NOT NULL)
    `, teacherParams);

    const overallAttRows = await query(`
      SELECT COUNT(CASE WHEN ra.attendance_status IN ('PRESENT', 'LATE') THEN 1 END) as presents,
             COUNT(ra.id) as total
      FROM attendance_sessions s
      JOIN register_attendance ra ON ra.session_id = s.id
      JOIN attendance_registers ar ON s.register_id = ar.id
      JOIN teaching_groups tg ON ar.group_id = tg.id
      WHERE tg.teacher_id = ? AND tg.status = 'ACTIVE' AND tg.deleted_at IS NULL AND s.state != 'DRAFT'
    `, teacherParams);

    const totalRecords = overallAttRows[0]?.total || 0;
    const overallPct = totalRecords > 0
      ? Number((overallAttRows[0].presents * 100.0 / totalRecords).toFixed(1))
      : 86.4;

    return {
      classes: groups,
      recent_due: recentDue,
      trash_count: trashRows[0]?.cnt || 0,
      overall_attendance_pct: overallPct,
      total_classes: groups.length
    };
  }

  /**
   * Lists teaching groups filtered by status and access scope.
   * @calledBy TeachingGroupController.listGroups() (controllers/teachingGroupController.js)
   * @route GET /api/v1/teaching-groups (routes/teachingGroups.js)
   * @param {Object} options - User and status filter
   * @returns {Promise<Array>} List of teaching groups
   */
  static async listGroups({ user, statusFilter }) {
    let sql = `
      SELECT tg.id, tg.name, tg.subject_name, tg.subject_code, tg.component, tg.total_units, tg.syllabus_units, tg.teacher_id,
             tg.academic_year_id, ay.label as academic_year_label,
             tg.semester, tg.invite_code, tg.status, tg.created_at, tg.archived_at, tg.deleted_at,
             t.full_name as teacher_name, t.department_id as teacher_department_id,
             d.name as department_name, d.code as department_code,
             ar.id as register_id,
             (SELECT COUNT(*) FROM teaching_group_members tgm WHERE tgm.group_id = tg.id AND tgm.status = 'ENROLLED') as member_count,
             (SELECT COUNT(*) FROM assessments a WHERE a.group_id = tg.id AND a.type = 'ASSIGNMENT') as assignment_count,
             (SELECT COUNT(*) FROM assessments a WHERE a.group_id = tg.id AND a.type = 'EXAM') as exam_count,
             (SELECT ROUND(COUNT(CASE WHEN ra.attendance_status IN ('PRESENT', 'LATE') THEN 1 END) * 100.0 / NULLIF(COUNT(ra.id), 0), 1)
              FROM attendance_sessions s
              JOIN register_attendance ra ON ra.session_id = s.id
              WHERE s.register_id = ar.id AND s.state != 'DRAFT') as avg_attendance_pct,
             (SELECT CONCAT(a.title, ':::', COALESCE(a.due_date, ''), ':::', a.type)
              FROM assessments a
              WHERE a.group_id = tg.id AND (a.due_date IS NULL OR a.due_date >= DATE_SUB(CURDATE(), INTERVAL 2 DAY))
              ORDER BY a.due_date ASC LIMIT 1) as upcoming_work,
             GREATEST(0, 7 - DATEDIFF(NOW(), COALESCE(tg.deleted_at, NOW()))) as days_remaining
      FROM teaching_groups tg
      JOIN teachers t ON tg.teacher_id = t.id
      LEFT JOIN departments d ON t.department_id = d.id
      JOIN academic_years ay ON tg.academic_year_id = ay.id
      LEFT JOIN attendance_registers ar ON ar.id = (
        SELECT id FROM attendance_registers
        WHERE group_id = tg.id
        ORDER BY CASE WHEN session_type_scope = 'THEORY' THEN 0 ELSE 1 END, id ASC
        LIMIT 1
      )
    `;
    const params = [];
    const conditions = [];

    if (!user.roles.includes('SYSTEM_ADMIN')) {
      conditions.push('tg.teacher_id = ?');
      params.push(user.teacher_id || -1);
    }

    if (statusFilter === 'TRASH' || statusFilter === 'TRASHED') {
      conditions.push("(tg.status = 'TRASHED' OR tg.deleted_at IS NOT NULL)");
    } else if (statusFilter === 'ALL') {
      conditions.push("(tg.status != 'TRASHED' AND tg.deleted_at IS NULL)");
    } else if (statusFilter === 'ARCHIVED') {
      conditions.push("tg.status = 'ARCHIVED' AND tg.deleted_at IS NULL");
    } else {
      conditions.push("tg.status = 'ACTIVE' AND tg.deleted_at IS NULL");
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY tg.created_at DESC';
    return await query(sql, params);
  }

  /**
   * Verifies if an invite code already exists.
   * @calledBy TeachingGroupController.createGroup(), promoteCohort() (controllers/teachingGroupController.js)
   * @route POST /api/v1/teaching-groups, POST /api/v1/teaching-groups/:id/promote (routes/teachingGroups.js)
   * @param {string} code - Generated invite code
   * @returns {Promise<boolean>} True if code is already used
   */
  static async checkInviteCode(code) {
    const rows = await query(`SELECT id FROM teaching_groups WHERE invite_code = ?`, [code]);
    return rows.length > 0;
  }

  /**
   * Executes atomic transaction to create teaching group, linked official register, and welcome post.
   * @calledBy TeachingGroupController.createGroup() (controllers/teachingGroupController.js)
   * @route POST /api/v1/teaching-groups (routes/teachingGroups.js)
   * @param {Object} params - Group creation attributes
   * @returns {Promise<Object>} Created group and register IDs
   */
  static async createGroupTransaction({
    name,
    subjectName,
    subjectCode,
    component,
    effTeacherId,
    ayId,
    semester,
    inviteCode,
    targetDeptId,
    enrollmentMode,
    userId,
    totalUnits
  }) {
    return await withTransaction(async (conn) => {
      const finalCode = (subjectCode || '').trim() || (subjectName || '').split(/[\s-]+/).map(w => w[0]).join('').toUpperCase().slice(0, 8);
      const groupInsert = await conn.query(
        `INSERT INTO teaching_groups 
          (name, subject_name, subject_code, component, total_units, teacher_id, academic_year_id, semester, invite_code, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP)`,
        [name, subjectName, finalCode, component, totalUnits || 5, effTeacherId, ayId, semester, inviteCode]
      );
      const groupId = groupInsert.insertId || groupInsert.lastInsertRowid;

      const year = Math.ceil(semester / 2);
      const isDual = (component === 'THEORY_PRACTICAL' || component === 'THEORY + PRACTICAL' || component === 'BOTH');
      let registerId;

      let targetSubjectId = null;
      if (subjectName || finalCode) {
        const subRows = await conn.query(
          `SELECT id FROM subjects WHERE (name = ? OR code = ?) LIMIT 1`,
          [subjectName, finalCode]
        );
        if (subRows && subRows[0]) {
          targetSubjectId = subRows[0].id;
        } else {
          const newSub = await conn.query(
            `INSERT INTO subjects (name, code, department_id, year, semester, credits, is_active, created_at)
             VALUES (?, ?, ?, ?, ?, 3, 1, CURRENT_TIMESTAMP)`,
            [subjectName || name, finalCode || 'SUB101', targetDeptId, year, semester]
          );
          targetSubjectId = newSub.insertId || newSub.lastInsertRowid;
        }
      }

      if (isDual) {
        const reg1 = await conn.query(
          `INSERT INTO attendance_registers 
            (teacher_id, name, subject_id, department_id, year, semester, academic_year_id, session_type_scope, is_official, is_active, group_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'THEORY', 1, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [effTeacherId, `${subjectName || name} (Theory)`, targetSubjectId, targetDeptId, year, semester, ayId, groupId]
        );
        registerId = reg1.insertId || reg1.lastInsertRowid;
        await conn.query(
          `INSERT INTO attendance_registers 
            (teacher_id, name, subject_id, department_id, year, semester, academic_year_id, session_type_scope, is_official, is_active, group_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'PRACTICAL', 1, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [effTeacherId, `${subjectName || name} (Practical)`, targetSubjectId, targetDeptId, year, semester, ayId, groupId]
        );
      } else {
        const regInsert = await conn.query(
          `INSERT INTO attendance_registers 
            (teacher_id, name, subject_id, department_id, year, semester, academic_year_id, session_type_scope, is_official, is_active, group_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [effTeacherId, name, targetSubjectId, targetDeptId, year, semester, ayId, component, groupId]
        );
        registerId = regInsert.insertId || regInsert.lastInsertRowid;
      }

      let autoEnrolledCount = 0;
      if (enrollmentMode === 'COHORT' && targetDeptId) {
        const cohortStudents = await conn.query(
          `SELECT DISTINCT s.id, s.user_id
           FROM students s
           JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
           WHERE e.department_id = ? AND (e.semester = ? OR e.year = ?)`,
          [targetDeptId, semester, year]
        );
        for (const st of cohortStudents) {
          await conn.query(
            `INSERT OR IGNORE INTO teaching_group_members (group_id, student_id, joined_at, status)
             VALUES (?, ?, CURRENT_TIMESTAMP, 'ENROLLED')`,
            [groupId, st.id]
          );
          autoEnrolledCount++;
        }
      }

      await conn.query(
        `INSERT INTO classroom_posts (group_id, author_id, content, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [groupId, userId, `Welcome to ${name} (${subjectName} • ${component})! Official Register #${registerId} has been linked.`]
      );

      await conn.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
         VALUES (?, 'TEACHING_GROUP_CREATED', 'teaching_groups', ?, ?, CURRENT_TIMESTAMP)`,
        [userId, String(groupId), JSON.stringify({ name, subject_name: subjectName, component, semester, register_id: registerId, invite_code: inviteCode, enrollment_mode: enrollmentMode, auto_enrolled_count: autoEnrolledCount })]
      );

      return { groupId, registerId, inviteCode, autoEnrolledCount, subjectCode: finalCode };
    });
  }

  /**
   * Retrieves full details of a specific teaching group by ID.
   * @calledBy TeachingGroupController.getGroupDetails(), editGroup(), trashGroup(), restoreGroup(), permanentDelete(), getUnenrolledStudents(), promoteCohort(), archiveGroup(), unarchiveGroup(), createAssignment(), scheduleTest(), exportTest() (controllers/teachingGroupController.js)
   * @route GET /api/v1/teaching-groups/:id (routes/teachingGroups.js)
   * @param {number} groupId - Group primary key
   * @returns {Promise<Object|null>} Teaching group object or null
   */
  static async getGroupById(groupId) {
    const rows = await query(
      `SELECT tg.id, tg.name, tg.subject_name, tg.subject_code, tg.component, tg.total_units, tg.syllabus_units, tg.teacher_id,
              tg.academic_year_id, ay.label as academic_year_label,
              tg.semester, tg.invite_code, tg.status, tg.created_at, tg.archived_at,
              t.full_name as teacher_name, t.department_id as teacher_department_id,
              d.name as department_name, d.code as department_code,
              (SELECT COUNT(*) FROM teaching_group_members tgm WHERE tgm.group_id = tg.id AND tgm.status = 'ENROLLED') as member_count,
              (SELECT COUNT(*) FROM assessments a WHERE a.group_id = tg.id AND a.type = 'ASSIGNMENT') as assignment_count,
              (SELECT COUNT(*) FROM assessments a WHERE a.group_id = tg.id AND a.type = 'EXAM') as exam_count
       FROM teaching_groups tg
       JOIN teachers t ON tg.teacher_id = t.id
       LEFT JOIN departments d ON t.department_id = d.id
       JOIN academic_years ay ON tg.academic_year_id = ay.id
       WHERE tg.id = ?`,
      [groupId]
    );
    if (!rows[0]) return null;
    const group = rows[0];
    const linkedRegisters = await query(
      `SELECT id, name, session_type_scope, is_official FROM attendance_registers WHERE group_id = ? ORDER BY id ASC`,
      [groupId]
    );
    group.registers = linkedRegisters;
    group.register_id = linkedRegisters[0]?.id || null;
    return group;
  }

  /**
   * Retrieves enrolled student members for a teaching group roster.
   * @calledBy TeachingGroupController.getGroupDetails(), getMembers(), createAssignment() (controllers/teachingGroupController.js)
   * @route GET /api/v1/teaching-groups/:id/members (routes/teachingGroups.js)
   * @param {number} groupId - Group primary key
   * @returns {Promise<Array>} List of enrolled student members
   */
  static async getGroupMembers(groupId) {
    return await query(
      `SELECT tgm.id as membership_id, tgm.status as membership_status, tgm.joined_at,
              s.id as student_id, s.full_name, s.full_name as student_name,
              s.official_enrollment_no, s.official_enrollment_no as enrollment_no,
              s.registration_no,
              COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no,
              d.id as department_id, d.name as department_name, d.code as department_code
       FROM teaching_group_members tgm
       JOIN students s ON tgm.student_id = s.id
       LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
       LEFT JOIN departments d ON e.department_id = d.id
       WHERE tgm.group_id = ?
       ORDER BY COALESCE(s.class_roll_no, e.class_roll_no, 9999) ASC, s.full_name ASC`,
      [groupId]
    );
  }

  /**
   * Finds an active teaching group by invite code.
   * @calledBy TeachingGroupController.joinGroup() (controllers/teachingGroupController.js)
   * @route POST /api/v1/teaching-groups/join (routes/teachingGroups.js)
   * @param {string} code - Uppercase invite code
   * @returns {Promise<Object|null>} Group record or null
   */
  static async findGroupByInviteCode(code) {
    const rows = await query(
      `SELECT tg.id, tg.name, tg.subject_name, tg.component, tg.status,
              t.full_name as teacher_name
       FROM teaching_groups tg
       JOIN teachers t ON tg.teacher_id = t.id
       WHERE UPPER(tg.invite_code) = ?`,
      [code]
    );
    return rows[0] || null;
  }

  /**
   * Checks if student is already enrolled in a teaching group.
   * @calledBy TeachingGroupController.joinGroup() (controllers/teachingGroupController.js)
   * @route POST /api/v1/teaching-groups/join (routes/teachingGroups.js)
   * @param {number} groupId - Group primary key
   * @param {number} studentId - Student primary key
   * @returns {Promise<boolean>} True if already member
   */
  static async checkMembership(groupId, studentId) {
    const rows = await query(
      `SELECT id, status FROM teaching_group_members WHERE group_id = ? AND student_id = ?`,
      [groupId, studentId]
    );
    return rows.length > 0;
  }

  /**
   * Enrolls a student into a teaching group.
   * @calledBy TeachingGroupController.joinGroup(), addMembers() (controllers/teachingGroupController.js)
   * @route POST /api/v1/teaching-groups/join, POST /api/v1/teaching-groups/:id/members (routes/teachingGroups.js)
   * @param {number} groupId - Group ID
   * @param {number} studentId - Student ID
   * @returns {Promise<void>}
   */
  static async addMember(groupId, studentId) {
    await query(
      `INSERT OR IGNORE INTO teaching_group_members (group_id, student_id, joined_at, status)
       VALUES (?, ?, CURRENT_TIMESTAMP, 'ENROLLED')`,
      [groupId, studentId]
    );
  }

  /**
   * Looks up student ID by enrollment or registration number.
   * @calledBy TeachingGroupController.addMembers() (controllers/teachingGroupController.js)
   * @route POST /api/v1/teaching-groups/:id/members (routes/teachingGroups.js)
   * @param {string} eno - Enrollment or registration number
   * @returns {Promise<number|null>} Student ID or null
   */
  static async findStudentIdByEnrollment(eno) {
    const rows = await query(
      `SELECT id FROM students WHERE UPPER(official_enrollment_no) = UPPER(?) OR UPPER(registration_no) = UPPER(?) LIMIT 1`,
      [eno, eno]
    );
    return rows[0]?.id || null;
  }

  /**
   * Removes a student member from a teaching group.
   * @calledBy TeachingGroupController.removeMember() (controllers/teachingGroupController.js)
   * @route DELETE /api/v1/teaching-groups/:id/members/:studentId (routes/teachingGroups.js)
   * @param {number} groupId - Group ID
   * @param {number} studentId - Student ID
   * @returns {Promise<void>}
   */
  static async removeMember(groupId, studentId) {
    await query(
      `DELETE FROM teaching_group_members WHERE group_id = ? AND student_id = ?`,
      [groupId, studentId]
    );
  }

  /**
   * Retrieves all teaching groups a student is enrolled in.
   * @calledBy TeachingGroupController.getStudentGroups() (controllers/teachingGroupController.js)
   * @route GET /api/v1/teaching-groups/student/my-groups (routes/teachingGroups.js)
   * @param {number} studentId - Student ID
   * @returns {Promise<Array>} List of enrolled groups
   */
  static async getStudentEnrolledGroups(studentId) {
    return await query(
      `SELECT tg.id, tg.name, tg.subject_name, tg.subject_code, tg.component, tg.semester,
              ay.label as academic_year_label, tg.status, tgm.joined_at,
              t.full_name as teacher_name, d.name as department_name, d.code as department_code,
              (SELECT COUNT(*) FROM assessments a WHERE a.group_id = tg.id AND a.type IN ('ASSIGNMENT', 'PRACTICAL', 'FINAL_DOCS')) as assignment_count,
              (SELECT COUNT(*) FROM assessments a WHERE a.group_id = tg.id AND a.type = 'EXAM') as exam_count,
              (SELECT COUNT(*) FROM assessments a 
               WHERE a.group_id = tg.id 
                 AND a.type IN ('ASSIGNMENT', 'PRACTICAL', 'FINAL_DOCS')
                 AND NOT EXISTS (
                   SELECT 1 FROM assessment_submissions sub 
                   WHERE sub.assessment_id = a.id AND sub.student_id = tgm.student_id AND sub.status IN ('SUBMITTED', 'GRADED')
                 )
              ) as pending_work_count
       FROM teaching_group_members tgm
       JOIN teaching_groups tg ON tgm.group_id = tg.id
       JOIN teachers t ON tg.teacher_id = t.id
       LEFT JOIN departments d ON t.department_id = d.id
       JOIN academic_years ay ON tg.academic_year_id = ay.id
       WHERE tgm.student_id = ? AND (tgm.status = 'ENROLLED' OR tgm.status = 'ACTIVE')
       ORDER BY tg.status ASC, tg.created_at DESC`,
      [studentId]
    );
  }

  /**
   * Retrieves stream announcements/posts for a teaching group.
   * @calledBy TeachingGroupController.getStreamPosts() (controllers/teachingGroupController.js)
   * @route GET /api/v1/teaching-groups/:id/stream (routes/teachingGroups.js)
   * @param {number} groupId - Group ID
   * @returns {Promise<Array>} List of stream posts
   */
  static async getStreamPosts(groupId) {
    return await query(
      `SELECT cp.id, cp.content, cp.attachment_path, cp.attachment_name, cp.created_at,
              u.username as author_username, u.email as author_email,
              COALESCE(t.full_name, s.full_name, u.username) as author_name,
              ur.role as author_role,
              (SELECT COUNT(*) FROM classroom_post_comments WHERE post_id = cp.id) as comment_count
       FROM classroom_posts cp
       JOIN users u ON cp.author_id = u.id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN teachers t ON t.user_id = u.id
       LEFT JOIN students s ON s.user_id = u.id
       WHERE cp.group_id = ?
       ORDER BY cp.created_at DESC`,
      [groupId]
    );
  }

  /**
   * Publishes a new announcement post to the classroom stream.
   * @calledBy TeachingGroupController.createStreamPost(), broadcastNotice() (controllers/teachingGroupController.js)
   * @route POST /api/v1/teaching-groups/:id/stream, POST /api/v1/teaching-groups/broadcast-notice (routes/teachingGroups.js)
   * @param {number} groupId - Group ID
   * @param {number} authorId - Author user ID
   * @param {string} content - Post message text
   * @param {string|null} attachmentPath - Uploaded file path
   * @param {string|null} attachmentName - Original file name
   * @returns {Promise<number>} Inserted post ID
   */
  static async createStreamPost(groupId, authorId, content, attachmentPath, attachmentName) {
    const result = await query(
      `INSERT INTO classroom_posts (group_id, author_id, content, attachment_path, attachment_name, created_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [groupId, authorId, content, attachmentPath, attachmentName]
    );
    return result.insertId || result.lastInsertRowid;
  }

  /**
   * Deletes a stream post and its associated comments.
   * @calledBy TeachingGroupController.deleteStreamPost() (controllers/teachingGroupController.js)
   * @route DELETE /api/v1/teaching-groups/:id/stream/:postId (routes/teachingGroups.js)
   * @param {number} groupId - Group ID
   * @param {number} postId - Post ID
   * @returns {Promise<void>}
   */
  static async deleteStreamPost(groupId, postId) {
    await query('DELETE FROM classroom_post_comments WHERE post_id = ?', [postId]);
    await query('DELETE FROM classroom_posts WHERE id = ? AND group_id = ?', [postId, groupId]);
  }

  /**
   * Retrieves comments on a classroom stream post.
   * @calledBy TeachingGroupController.getPostComments() (controllers/teachingGroupController.js)
   * @route GET /api/v1/teaching-groups/posts/:postId/comments (routes/teachingGroups.js)
   * @param {number} postId - Post ID
   * @returns {Promise<Array>} List of comments
   */
  static async getPostComments(postId) {
    return await query(
      `SELECT cpc.id, cpc.content, cpc.created_at,
              u.id as author_id, u.email as author_email,
              COALESCE(t.full_name, s.full_name, u.username) as author_name,
              ur.role as author_role
       FROM classroom_post_comments cpc
       JOIN users u ON cpc.author_id = u.id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN teachers t ON t.user_id = u.id
       LEFT JOIN students s ON s.user_id = u.id
       WHERE cpc.post_id = ?
       ORDER BY cpc.created_at ASC`,
      [postId]
    );
  }

  /**
   * Adds a comment to a classroom stream post.
   * @calledBy TeachingGroupController.createPostComment() (controllers/teachingGroupController.js)
   * @route POST /api/v1/teaching-groups/posts/:postId/comments (routes/teachingGroups.js)
   * @param {number} postId - Post ID
   * @param {number} authorId - User ID
   * @param {string} content - Comment text
   * @returns {Promise<number>} Inserted comment ID
   */
  static async createPostComment(postId, authorId, content) {
    const result = await query(
      `INSERT INTO classroom_post_comments (post_id, author_id, content, created_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [postId, authorId, content]
    );
    return result.insertId || result.lastInsertRowid;
  }

  /**
   * Archives or unarchives a teaching group and updates linked register status.
   * @calledBy TeachingGroupController.archiveGroup(), unarchiveGroup() (controllers/teachingGroupController.js)
   * @route POST /api/v1/teaching-groups/:id/archive, POST /api/v1/teaching-groups/:id/unarchive (routes/teachingGroups.js)
   * @param {number} groupId - Group ID
   * @param {boolean} isArchived - Archive flag
   * @returns {Promise<void>}
   */
  static async setArchiveStatus(groupId, isArchived) {
    const status = isArchived ? 'ARCHIVED' : 'ACTIVE';
    const archivedAt = isArchived ? 'CURRENT_TIMESTAMP' : 'NULL';
    const regActive = isArchived ? 0 : 1;
    await query(`UPDATE teaching_groups SET status = ?, archived_at = ${archivedAt} WHERE id = ?`, [status, groupId]);
    await query(`UPDATE attendance_registers SET is_active = ? WHERE group_id = ?`, [regActive, groupId]);
  }

  /**
   * Moves a teaching group to or restores from the trash bin.
   * @calledBy TeachingGroupController.trashGroup(), restoreGroup() (controllers/teachingGroupController.js)
   * @route POST /api/v1/teaching-groups/:id/trash, POST /api/v1/teaching-groups/:id/restore (routes/teachingGroups.js)
   * @param {number} groupId - Group ID
   * @param {boolean} isTrashed - Trash flag
   * @returns {Promise<void>}
   */
  static async setTrashStatus(groupId, isTrashed) {
    const status = isTrashed ? 'TRASHED' : 'ACTIVE';
    const deletedAt = isTrashed ? 'CURRENT_TIMESTAMP' : 'NULL';
    const regActive = isTrashed ? 0 : 1;
    await query(`UPDATE teaching_groups SET status = ?, deleted_at = ${deletedAt} WHERE id = ?`, [status, groupId]);
    await query(`UPDATE attendance_registers SET is_active = ? WHERE group_id = ?`, [regActive, groupId]);
  }

  /**
   * Updates basic metadata for a teaching group and its linked register.
   * @calledBy TeachingGroupController.editGroup() (controllers/teachingGroupController.js)
   * @route PUT /api/v1/teaching-groups/:id (routes/teachingGroups.js)
   * @param {number} groupId - Group ID
   * @param {Object} fields - Updated attributes
   * @returns {Promise<void>}
   */
  static async updateGroup(groupId, { name, subject_name, subject_code, component, total_units, syllabus_units }) {
    const unitsJson = syllabus_units !== undefined ? (typeof syllabus_units === 'string' ? syllabus_units : JSON.stringify(syllabus_units)) : undefined;
    if (total_units !== undefined && unitsJson !== undefined) {
      await query(
        `UPDATE teaching_groups SET name = ?, subject_name = ?, subject_code = ?, component = ?, total_units = ?, syllabus_units = ? WHERE id = ?`,
        [name, subject_name, subject_code, component, total_units, unitsJson, groupId]
      );
    } else if (total_units !== undefined) {
      await query(
        `UPDATE teaching_groups SET name = ?, subject_name = ?, subject_code = ?, component = ?, total_units = ? WHERE id = ?`,
        [name, subject_name, subject_code, component, total_units, groupId]
      );
    } else if (unitsJson !== undefined) {
      await query(
        `UPDATE teaching_groups SET name = ?, subject_name = ?, subject_code = ?, component = ?, syllabus_units = ? WHERE id = ?`,
        [name, subject_name, subject_code, component, unitsJson, groupId]
      );
    } else {
      await query(
        `UPDATE teaching_groups SET name = ?, subject_name = ?, subject_code = ?, component = ? WHERE id = ?`,
        [name, subject_name, subject_code, component, groupId]
      );
    }
    const isDual = (component === 'THEORY_PRACTICAL' || component === 'THEORY + PRACTICAL' || component === 'BOTH');
    if (isDual) {
      const existing = await query(`SELECT id, session_type_scope FROM attendance_registers WHERE group_id = ?`, [groupId]);
      const hasTheory = existing.some(r => r.session_type_scope === 'THEORY');
      const hasPractical = existing.some(r => r.session_type_scope === 'PRACTICAL');
      if (hasTheory && hasPractical) {
        await query(`UPDATE attendance_registers SET name = ? WHERE group_id = ? AND session_type_scope = 'THEORY'`, [`${subject_name || name} (Theory)`, groupId]);
        await query(`UPDATE attendance_registers SET name = ? WHERE group_id = ? AND session_type_scope = 'PRACTICAL'`, [`${subject_name || name} (Practical)`, groupId]);
      } else if (existing.length === 1) {
        await query(`UPDATE attendance_registers SET name = ?, session_type_scope = 'THEORY' WHERE id = ?`, [`${subject_name || name} (Theory)`, existing[0].id]);
        const grp = (await query(`SELECT * FROM teaching_groups WHERE id = ?`, [groupId]))[0];
        const teacher = (await query(`SELECT department_id FROM teachers WHERE id = ?`, [grp.teacher_id]))[0];
        const year = Math.ceil((grp.semester || 1) / 2);
        await query(
          `INSERT INTO attendance_registers 
            (teacher_id, name, subject_id, department_id, year, semester, academic_year_id, session_type_scope, is_official, is_active, group_id, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, 'PRACTICAL', 1, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [grp.teacher_id, `${subject_name || name} (Practical)`, teacher?.department_id, year, grp.semester, grp.academic_year_id, groupId]
        );
      }
    } else {
      await query(
        `UPDATE attendance_registers SET name = ?, session_type_scope = ? WHERE group_id = ?`,
        [name, component, groupId]
      );
    }
  }

  static async updateGroupSyllabusUnits(groupId, syllabusUnits, totalUnits) {
    const unitsJson = typeof syllabusUnits === 'string' ? syllabusUnits : JSON.stringify(syllabusUnits);
    if (totalUnits !== undefined) {
      await query(
        `UPDATE teaching_groups SET syllabus_units = ?, total_units = ? WHERE id = ?`,
        [unitsJson, totalUnits, groupId]
      );
    } else {
      await query(
        `UPDATE teaching_groups SET syllabus_units = ? WHERE id = ?`,
        [unitsJson, groupId]
      );
    }
  }

  /**
   * Executes atomic transaction to permanently remove teaching group records while preserving register attendance history.
   * @calledBy TeachingGroupController.permanentDelete() (controllers/teachingGroupController.js)
   * @route DELETE /api/v1/teaching-groups/:id/permanent (routes/teachingGroups.js)
   * @param {number} groupId - Group ID
   * @returns {Promise<void>}
   */
  static async permanentDeleteGroupTransaction(groupId) {
    return await withTransaction(async (conn) => {
      await conn.execute(`DELETE FROM teaching_group_members WHERE group_id = ?`, [groupId]);
      await conn.execute(`DELETE FROM classroom_posts WHERE group_id = ?`, [groupId]);
      await conn.execute(`UPDATE attendance_registers SET group_id = NULL, is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE group_id = ?`, [groupId]);
      await conn.execute(`DELETE FROM teaching_groups WHERE id = ?`, [groupId]);
    });
  }

  /**
   * Searches unenrolled students in the cohort for manual group enrollment.
   * @calledBy TeachingGroupController.getUnenrolledStudents() (controllers/teachingGroupController.js)
   * @route GET /api/v1/teaching-groups/:id/unenrolled-students (routes/teachingGroups.js)
   * @param {number} groupId - Group ID
   * @param {Object} group - Group entity
   * @param {number|null} targetDeptId - Department filter
   * @param {string|null} search - Search query
   * @returns {Promise<Array>} Unenrolled student candidates
   */
  static async getUnenrolledStudents(groupId, group, targetDeptId, search) {
    let sql = `
      SELECT DISTINCT s.id as student_id, s.full_name, s.official_enrollment_no, s.official_enrollment_no as enrollment_no,
             s.registration_no,
             COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no,
             e.semester, e.year,
             d.id as department_id, d.name as department_name, d.code as department_code
      FROM students s
      JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
      LEFT JOIN departments d ON e.department_id = d.id
      WHERE s.id NOT IN (SELECT student_id FROM teaching_group_members WHERE group_id = ?)
    `;
    const params = [groupId];

    if (targetDeptId) {
      sql += ` AND e.department_id = ?`;
      params.push(targetDeptId);
    }
    sql += ` AND (e.semester = ? OR e.year = ?)`;
    params.push(group.semester, Math.ceil(group.semester / 2));

    if (search) {
      sql += ` AND (s.full_name LIKE ? OR s.official_enrollment_no LIKE ? OR s.registration_no LIKE ?)`;
      params.push(search, search, search);
    }

    sql += ` ORDER BY COALESCE(s.class_roll_no, e.class_roll_no, 9999) ASC, s.full_name ASC LIMIT 100`;
    return await query(sql, params);
  }

  /**
   * Promotes student cohort to a new semester group and archives the previous group.
   * @calledBy TeachingGroupController.promoteCohort() (controllers/teachingGroupController.js)
   * @route POST /api/v1/teaching-groups/:id/promote (routes/teachingGroups.js)
   * @param {Object} params - Promotion attributes
   * @returns {Promise<Object>} Outcome details
   */
  static async promoteCohortTransaction({
    oldGroupId,
    oldGroup,
    newName,
    newSemester,
    studentIds,
    ayId,
    deptId,
    inviteCode,
    userId
  }) {
    return await withTransaction(async (conn) => {
      const grpRes = await conn.query(
        `INSERT INTO teaching_groups (name, subject_name, component, teacher_id, academic_year_id, semester, invite_code, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP)`,
        [newName, oldGroup.subject_name, oldGroup.component, oldGroup.teacher_id, ayId, newSemester, inviteCode]
      );
      const newGroupId = grpRes.insertId || grpRes.lastInsertRowid;

      const newYear = Math.ceil(newSemester / 2);
      const regRes = await conn.query(
        `INSERT INTO attendance_registers (teacher_id, name, subject_id, department_id, year, semester, academic_year_id, session_type_scope, is_official, is_active, group_id, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 1, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [oldGroup.teacher_id, newName, deptId, newYear, newSemester, ayId, oldGroup.component, newGroupId]
      );
      const newRegisterId = regRes.insertId || regRes.lastInsertRowid;

      let enrolledCount = 0;
      for (const sid of studentIds) {
        const studentId = Number(sid);
        if (!studentId) continue;
        await conn.query(
          `INSERT INTO teaching_group_members (group_id, student_id, joined_at, status)
           VALUES (?, ?, CURRENT_TIMESTAMP, 'ENROLLED')`,
          [newGroupId, studentId]
        );
        enrolledCount++;
      }

      await conn.query(`UPDATE teaching_groups SET status = 'ARCHIVED', archived_at = CURRENT_TIMESTAMP WHERE id = ?`, [oldGroupId]);
      await conn.query(`UPDATE attendance_registers SET is_active = 0 WHERE group_id = ?`, [oldGroupId]);

      await conn.query(
        `INSERT INTO classroom_posts (group_id, author_id, content, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [oldGroupId, userId, `🎓 Cohort successfully promoted to Semester ${newSemester} ("${newName}"). This previous semester group has been archived.`]
      );
      await conn.query(
        `INSERT INTO classroom_posts (group_id, author_id, content, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [newGroupId, userId, `🎉 Welcome to ${newName} (Semester ${newSemester})! Cohort promoted from ${oldGroup.name}. Official Register #${newRegisterId} is active.`]
      );

      await conn.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
         VALUES (?, 'TEACHING_GROUP_PROMOTED', 'teaching_groups', ?, ?, CURRENT_TIMESTAMP)`,
        [userId, String(newGroupId), JSON.stringify({ old_group_id: oldGroupId, old_name: oldGroup.name, new_name: newName, new_semester: newSemester, promoted_count: enrolledCount })]
      );

      return { newGroupId, newRegisterId, enrolledCount, inviteCode };
    });
  }

  /**
   * Finds matching active teaching groups for a faculty broadcast announcement.
   * @calledBy TeachingGroupController.broadcastNotice() (controllers/teachingGroupController.js)
   * @route POST /api/v1/teaching-groups/broadcast-notice (routes/teachingGroups.js)
   * @param {number} teacherId - Teacher ID
   * @param {string|number} target_semester - Semester filter
   * @param {string|number} target_year - Year filter
   * @param {string|number} department_id - Department filter
   * @returns {Promise<Array>} List of matching groups
   */
  static async getMatchingGroupsForBroadcast(teacherId, target_semester, target_year, department_id) {
    let sql = `
      SELECT tg.id, tg.name, tg.semester, ar.department_id
      FROM teaching_groups tg
      LEFT JOIN attendance_registers ar ON ar.group_id = tg.id
      WHERE tg.teacher_id = ? AND tg.status = 'ACTIVE'
    `;
    const params = [teacherId];

    if (target_semester && target_semester !== 'ALL') {
      sql += ` AND tg.semester = ?`;
      params.push(Number(target_semester));
    } else if (target_year && target_year !== 'ALL') {
      const semStart = (Number(target_year) - 1) * 2 + 1;
      const semEnd = semStart + 1;
      sql += ` AND tg.semester IN (?, ?)`;
      params.push(semStart, semEnd);
    }

    if (department_id && department_id !== 'ALL') {
      sql += ` AND ar.department_id = ?`;
      params.push(Number(department_id));
    }

    return await query(sql, params);
  }

  /**
   * Retrieves unique enrolled student user IDs across multiple teaching groups.
   * @calledBy TeachingGroupController.broadcastNotice() (controllers/teachingGroupController.js)
   * @route POST /api/v1/teaching-groups/broadcast-notice (routes/teachingGroups.js)
   * @param {Array<number>} groupIds - List of group IDs
   * @returns {Promise<Array>} List of students
   */
  static async getDistinctEnrolledStudents(groupIds) {
    const placeholders = groupIds.map(() => '?').join(',');
    return await query(
      `SELECT DISTINCT s.user_id, s.id as student_id
       FROM teaching_group_members tgm
       JOIN students s ON tgm.student_id = s.id
       WHERE tgm.group_id IN (${placeholders}) AND tgm.status = 'ENROLLED'`,
      groupIds
    );
  }

  /**
   * Retrieves coursework assignments for a teaching group.
   * @calledBy TeachingGroupController.getAssignments() (controllers/teachingGroupController.js)
   * @route GET /api/v1/teaching-groups/:id/assignments (routes/teachingGroups.js)
   * @param {number} groupId - Group ID
   * @param {number|null} studentId - Optional Student ID for personalized submission status
   * @returns {Promise<Array>} Coursework assignments
   */
  static async getGroupAssignments(groupId, studentId = null) {
    if (studentId) {
      return await query(
        `SELECT a.id, a.type, a.title, a.description, a.due_date, a.max_marks, a.created_at, a.questions, a.unit_name,
                (SELECT COUNT(*) FROM assessment_submissions sub WHERE sub.assessment_id = a.id AND sub.status != 'ABSENT') as submission_count,
                (SELECT COUNT(*) FROM assessment_submissions sub WHERE sub.assessment_id = a.id AND sub.marks_obtained IS NOT NULL AND sub.status != 'ABSENT') as graded_count,
                (SELECT AVG(sub.marks_obtained) FROM assessment_submissions sub WHERE sub.assessment_id = a.id AND sub.marks_obtained IS NOT NULL AND sub.status != 'ABSENT') as avg_score,
                mysub.id as my_submission_id,
                mysub.status as my_status,
                mysub.marks_obtained as my_marks_obtained,
                mysub.file_path as my_file_path,
                mysub.original_filename as my_original_filename,
                mysub.submitted_at as my_submitted_at,
                mysub.feedback as my_feedback
         FROM assessments a
         LEFT JOIN assessment_submissions mysub ON mysub.assessment_id = a.id AND mysub.student_id = ?
         WHERE a.group_id = ? AND a.type IN ('ASSIGNMENT', 'PRACTICAL', 'FINAL_DOCS')
         ORDER BY a.created_at DESC`,
        [studentId, groupId]
      );
    }
    return await query(
      `SELECT a.id, a.type, a.title, a.description, a.due_date, a.max_marks, a.created_at, a.questions, a.unit_name,
              (SELECT COUNT(*) FROM assessment_submissions sub WHERE sub.assessment_id = a.id AND sub.status != 'ABSENT') as submission_count,
              (SELECT COUNT(*) FROM assessment_submissions sub WHERE sub.assessment_id = a.id AND sub.marks_obtained IS NOT NULL AND sub.status != 'ABSENT') as graded_count,
              (SELECT AVG(sub.marks_obtained) FROM assessment_submissions sub WHERE sub.assessment_id = a.id AND sub.marks_obtained IS NOT NULL AND sub.status != 'ABSENT') as avg_score
       FROM assessments a
       WHERE a.group_id = ? AND a.type IN ('ASSIGNMENT', 'PRACTICAL', 'FINAL_DOCS')
       ORDER BY a.created_at DESC`,
      [groupId]
    );
  }

  /**
   * Creates a new assessment entry (assignment, practical, or exam) linked to a teaching group.
   * @calledBy TeachingGroupController.createAssignment(), scheduleTest() (controllers/teachingGroupController.js)
   * @route POST /api/v1/teaching-groups/:id/assignments, POST /api/v1/teaching-groups/:id/tests (routes/teachingGroups.js)
   * @param {Object} params - Assessment attributes
   * @returns {Promise<number>} Inserted assessment ID
   */
  static async createGroupAssessment({
    teacherId,
    groupId,
    semester,
    academicYearId,
    type,
    title,
    description,
    dueDate,
    effectiveMaxMarks,
    questionsJson,
    departmentId,
    unitName
  }) {
    const res = await query(
      `INSERT INTO assessments (teacher_id, group_id, semester, academic_year_id, type, title, description, due_date, max_marks, questions, department_id, year, unit_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        teacherId,
        groupId,
        semester,
        academicYearId,
        type,
        title,
        description || null,
        dueDate || null,
        effectiveMaxMarks,
        questionsJson,
        departmentId || null,
        Math.ceil(semester / 2),
        unitName || null
      ]
    );
    return res.insertId || res.lastInsertRowid;
  }

  /**
   * Updates an existing coursework assessment.
   * @calledBy TeachingGroupController.editAssignment() (controllers/teachingGroupController.js)
   * @route PUT /api/v1/teaching-groups/:id/assignments/:assignmentId (routes/teachingGroups.js)
   * @param {number} assessmentId - Assessment ID
   * @param {number} groupId - Group ID
   * @param {Object} fields - Updated fields
   * @returns {Promise<void>}
   */
  static async updateGroupAssessment(assessmentId, groupId, { title, description, dueDate, maxMarks, questionsJson, unitName }) {
    if (unitName !== undefined) {
      await query(
        `UPDATE assessments
         SET title = ?, description = ?, due_date = ?, max_marks = ?, questions = ?, unit_name = ?
         WHERE id = ? AND group_id = ?`,
        [title, description, dueDate, maxMarks, questionsJson, unitName || null, assessmentId, groupId]
      );
    } else {
      await query(
        `UPDATE assessments
         SET title = ?, description = ?, due_date = ?, max_marks = ?, questions = ?
         WHERE id = ? AND group_id = ?`,
        [title, description, dueDate, maxMarks, questionsJson, assessmentId, groupId]
      );
    }
  }

  /**
   * Retrieves student submissions roster for a coursework item.
   * @calledBy TeachingGroupController.getAssignmentSubmissions() (controllers/teachingGroupController.js)
   * @route GET /api/v1/teaching-groups/:id/assignments/:assignmentId/submissions (routes/teachingGroups.js)
   * @param {number} assignmentId - Assessment ID
   * @param {number} groupId - Group ID
   * @returns {Promise<Array>} Submission roster rows
   */
  static async getAssessmentSubmissionsRoster(assignmentId, groupId) {
    return await query(
      `SELECT COALESCE(s.class_roll_no, e.class_roll_no) as class_roll_no,
              s.id as student_id, s.full_name, s.official_enrollment_no, s.registration_no,
              sub.id as submission_id, sub.status as submission_status, sub.file_path, sub.original_filename,
              sub.submitted_at, sub.marks_obtained, sub.feedback
       FROM teaching_group_members tgm
       JOIN students s ON tgm.student_id = s.id
       LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ENROLLED'
       LEFT JOIN assessment_submissions sub ON sub.assessment_id = ? AND sub.student_id = s.id
       WHERE tgm.group_id = ? AND (tgm.status = 'ACTIVE' OR tgm.status = 'ENROLLED')
       ORDER BY COALESCE(s.class_roll_no, e.class_roll_no, 9999) ASC, s.full_name ASC`,
      [assignmentId, groupId]
    );
  }

  /**
   * Deletes all student submissions for an assessment.
   * @calledBy TeachingGroupController.deleteAssignment(), deleteTest() (controllers/teachingGroupController.js)
   * @param {number} assignmentId - Assessment ID
   * @returns {Promise<void>}
   */
  static async deleteAssessmentSubmissions(assignmentId) {
    await query(`DELETE FROM assessment_submissions WHERE assessment_id = ?`, [assignmentId]);
  }

  /**
   * Deletes an assessment entry from a teaching group.
   * @calledBy TeachingGroupController.deleteAssignment(), deleteTest() (controllers/teachingGroupController.js)
   * @route DELETE /api/v1/teaching-groups/:id/assignments/:assignmentId, DELETE /api/v1/teaching-groups/:id/tests/:testId (routes/teachingGroups.js)
   * @param {number} assignmentId - Assessment ID
   * @param {number} groupId - Group ID
   * @returns {Promise<void>}
   */
  static async deleteAssessment(assignmentId, groupId) {
    await query(`DELETE FROM assessments WHERE id = ? AND group_id = ?`, [assignmentId, groupId]);
  }

  /**
   * Retrieves class tests / exams scheduled in a teaching group.
   * @calledBy TeachingGroupController.getTests() (controllers/teachingGroupController.js)
   * @route GET /api/v1/teaching-groups/:id/tests (routes/teachingGroups.js)
   * @param {number} groupId - Group ID
   * @returns {Promise<Array>} List of class tests
   */
  static async getGroupTests(groupId) {
    return await query(
      `SELECT a.id, a.title as name, a.title, a.description, a.due_date as test_date, a.due_date, a.max_marks, a.created_at, a.questions, a.instructions, a.unit_name,
              (SELECT COUNT(*) FROM assessment_submissions sub WHERE sub.assessment_id = a.id AND sub.status != 'ABSENT') as graded_count,
              (SELECT AVG(sub.marks_obtained) FROM assessment_submissions sub WHERE sub.assessment_id = a.id AND sub.status != 'ABSENT') as avg_score,
              (SELECT (COUNT(CASE WHEN sub.marks_obtained >= (a.max_marks * 0.4) THEN 1 END) * 100.0 / NULLIF(COUNT(sub.id), 0))
               FROM assessment_submissions sub WHERE sub.assessment_id = a.id AND sub.status != 'ABSENT') as pass_rate
       FROM assessments a
       WHERE a.group_id = ? AND a.type = 'EXAM'
       ORDER BY a.created_at DESC`,
      [groupId]
    );
  }

  /**
   * Updates a class test configuration and questions structure.
   * @calledBy TeachingGroupController.editTest() (controllers/teachingGroupController.js)
   * @route PUT /api/v1/teaching-groups/:id/tests/:testId (routes/teachingGroups.js)
   * @param {number} testId - Test ID
   * @param {number} groupId - Group ID
   * @param {Object} fields - Updated fields
   * @returns {Promise<void>}
   */
  static async updateGroupTest(testId, groupId, { name, description, testDate, maxMarks, questionsJson, instructionsJson, unitName }) {
    await query(
      `UPDATE assessments
       SET title = COALESCE(?, title),
           description = COALESCE(?, description),
           due_date = COALESCE(?, due_date),
           max_marks = COALESCE(?, max_marks),
           questions = COALESCE(?, questions),
           instructions = COALESCE(?, instructions),
           unit_name = COALESCE(?, unit_name)
       WHERE id = ? AND group_id = ? AND type = 'EXAM'`,
      [name || null, description !== undefined ? description : null, testDate || null, maxMarks !== undefined ? maxMarks : null, questionsJson || null, instructionsJson || null, unitName !== undefined ? unitName : null, testId, groupId]
    );
  }

  /**
   * Retrieves test submission scores for a class test.
   * @calledBy TeachingGroupController.getTestScores() (controllers/teachingGroupController.js)
   * @route GET /api/v1/teaching-groups/:id/tests/:testId/scores (routes/teachingGroups.js)
   * @param {number} testId - Test ID
   * @returns {Promise<Array>} List of test scores
   */
  static async getTestScores(testId) {
    return await query(
      `SELECT sub.student_id, sub.marks_obtained, sub.status,
              CASE WHEN sub.status = 'ABSENT' THEN 1 ELSE 0 END as is_absent,
              sub.feedback as remarks
       FROM assessment_submissions sub
       WHERE sub.assessment_id = ?`,
      [testId]
    );
  }

  /**
   * Saves or updates student test marks and questions structure atomically.
   * @calledBy TeachingGroupController.saveTestScores() (controllers/teachingGroupController.js)
   * @route POST /api/v1/teaching-groups/:id/tests/:testId/scores (routes/teachingGroups.js)
   * @param {number} testId - Test assessment ID
   * @param {number} groupId - Group ID
   * @param {Array} scores - Roster scores
   * @param {any} questions - Optional questions schema
   * @param {any} instructions - Optional test instructions
   * @param {number} userId - Grading teacher user ID
   * @returns {Promise<void>}
   */
  static async saveTestScoresTransaction(testId, groupId, scores, questions, instructions, userId) {
    if (questions !== undefined || instructions !== undefined) {
      const upParts = [];
      const upVals = [];
      if (questions !== undefined) {
        upParts.push('questions = ?');
        upVals.push(questions ? (typeof questions === 'string' ? questions : JSON.stringify(questions)) : null);
      }
      if (instructions !== undefined) {
        upParts.push('instructions = ?');
        upVals.push(instructions ? (typeof instructions === 'string' ? instructions : JSON.stringify(instructions)) : null);
      }
      if (upParts.length) {
        upVals.push(testId, groupId);
        await query(`UPDATE assessments SET ${upParts.join(', ')} WHERE id = ? AND group_id = ? AND type = 'EXAM'`, upVals);
      }
    }

    return await withTransaction(async (conn) => {
      for (const s of scores) {
        const isAbsent = Boolean(s.is_absent);
        const marks = isAbsent ? null : (s.marks_obtained !== undefined && s.marks_obtained !== null && s.marks_obtained !== '' ? Number(s.marks_obtained) : null);
        const status = isAbsent ? 'ABSENT' : (marks !== null ? 'GRADED' : 'SUBMITTED');
        const feedbackPayload = JSON.stringify({
          is_absent: isAbsent,
          remarks: s.remarks || null,
          question_scores: s.question_scores || null,
          questions: s.questions || questions || null,
          instructions: instructions || null
        });

        await conn.execute(
          `INSERT INTO assessment_submissions (assessment_id, student_id, marks_obtained, feedback, graded_by, status)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(assessment_id, student_id) DO UPDATE SET
             marks_obtained = excluded.marks_obtained,
             feedback = excluded.feedback,
             graded_by = excluded.graded_by,
             status = excluded.status,
             updated_at = CURRENT_TIMESTAMP`,
          [testId, s.student_id, marks, feedbackPayload, userId, status]
        );
      }
    });
  }

  /**
   * Saves student marks and feedback for an assignment or coursework item.
   * @calledBy TeachingGroupController.saveAssignmentScores() (controllers/teachingGroupController.js)
   * @route POST /api/v1/teaching-groups/:id/assignments/:assignmentId/scores (routes/teachingGroups.js)
   * @param {number} assignmentId - Assessment ID
   * @param {number} groupId - Group ID
   * @param {Array} scores - Roster scores array
   * @param {number} userId - Grading teacher user ID
   * @returns {Promise<void>}
   */
  static async saveAssignmentScoresTransaction(assignmentId, groupId, scores, userId) {
    return await withTransaction(async (conn) => {
      for (const s of scores) {
        const isAbsent = Boolean(s.is_absent);
        const rawMarks = s.marks_obtained !== undefined ? s.marks_obtained : (s.score !== undefined ? s.score : s.marks);
        const marks = isAbsent ? null : (rawMarks !== undefined && rawMarks !== null && rawMarks !== '' ? Number(rawMarks) : null);
        const status = isAbsent ? 'ABSENT' : (marks !== null ? 'GRADED' : (s.status || 'SUBMITTED'));
        const feedback = s.remarks || s.feedback || null;

        await conn.execute(
          `INSERT INTO assessment_submissions (assessment_id, student_id, marks_obtained, feedback, graded_by, status)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(assessment_id, student_id) DO UPDATE SET
             marks_obtained = excluded.marks_obtained,
             feedback = excluded.feedback,
             graded_by = excluded.graded_by,
             status = excluded.status,
             updated_at = CURRENT_TIMESTAMP`,
          [assignmentId, s.student_id, marks, feedback, userId, status]
        );
      }
    });
  }

  /**
   * Retrieves metadata required for generating marksheet export documents.
   * @calledBy TeachingGroupController.exportTest() (controllers/teachingGroupController.js)
   * @route ALL /api/v1/teaching-groups/:id/tests/:testId/export/:format (routes/teachingGroups.js)
   * @param {number} testId - Test assessment ID
   * @param {number} groupId - Teaching group ID
   * @returns {Promise<Object|null>} Export metadata or null
   */
  static async getTestExportMetadata(testId, groupId) {
    const testRows = await query(
      `SELECT a.*, tg.name as group_name, tg.subject_name, tg.semester, tg.academic_year_id,
              ay.label as academic_year_label,
              d.name as department_name, d.code as department_code
       FROM assessments a
       JOIN teaching_groups tg ON tg.id = a.group_id
       LEFT JOIN academic_years ay ON ay.id = tg.academic_year_id
       LEFT JOIN teachers tech ON tech.user_id = tg.teacher_id
       LEFT JOIN departments d ON d.id = tech.department_id
       WHERE a.id = ? AND a.group_id = ? AND a.type = 'EXAM'`,
      [testId, groupId]
    );
    return testRows[0] || null;
  }

  /**
   * Retrieves configured institution name from system settings.
   * @calledBy TeachingGroupController.exportTest() (controllers/teachingGroupController.js)
   * @returns {Promise<string>} Institution name
   */
  static async getInstitutionName() {
    const rows = await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'institution_name'`);
    return rows[0]?.setting_value || 'Government Polytechnic College';
  }

  /**
   * Retrieves full student roster with test marks for document export.
   * @calledBy TeachingGroupController.exportTest() (controllers/teachingGroupController.js)
   * @param {number} testId - Test assessment ID
   * @param {number} groupId - Group ID
   * @returns {Promise<Array>} Roster with scores
   */
  static async getTestRosterScores(testId, groupId) {
    return await query(
      `SELECT s.id as student_id, s.class_roll_no, s.registration_no, s.official_enrollment_no,
              s.full_name,
              sub.marks_obtained, sub.status, sub.feedback
       FROM teaching_group_members gm
       JOIN students s ON s.id = gm.student_id
       LEFT JOIN assessment_submissions sub ON sub.assessment_id = ? AND sub.student_id = s.id
       WHERE gm.group_id = ? AND gm.status = 'ENROLLED'
       ORDER BY CAST(s.class_roll_no AS INTEGER) ASC, s.class_roll_no ASC`,
      [testId, groupId]
    );
  }

  /**
   * Looks up official enrollment numbers and registration IDs for student list.
   * @param {Array<number>} studentIds - Array of student IDs
   * @returns {Promise<Array>} Student records
   */
  static async getStudentIdentifiers(studentIds) {
    return await query(
      `SELECT id, official_enrollment_no, registration_no
       FROM students WHERE id IN (${studentIds.map(() => '?').join(',')})
       LIMIT 200`,
      studentIds
    );
  }

  /**
   * Automatically transitions active teaching groups from expired academic sessions to ARCHIVED.
   * @calledBy TeachingGroupController.autoArchiveExpired() (controllers/teachingGroupController.js)
   * @route POST /api/v1/teaching-groups/auto-archive-expired (routes/teachingGroups.js)
   * @returns {Promise<number>} Number of archived groups
   */
  static async autoArchiveExpiredGroups() {
    const expiredGroups = await query(
      `SELECT tg.id, tg.name, ay.label
       FROM teaching_groups tg
       JOIN academic_years ay ON tg.academic_year_id = ay.id
       WHERE tg.status = 'ACTIVE' AND ay.is_current = 0`
    );

    let archivedCount = 0;
    for (const g of expiredGroups) {
      await query(`UPDATE teaching_groups SET status = 'ARCHIVED', archived_at = CURRENT_TIMESTAMP WHERE id = ?`, [g.id]);
      await query(`UPDATE attendance_registers SET is_active = 0 WHERE group_id = ?`, [g.id]);
      archivedCount++;
    }
    return archivedCount;
  }
}

module.exports = TeachingGroupModel;
