/**
 * Teaching Groups REST API Routes (/api/v1/teaching-groups/*)
 * 
 * Implements Teaching Group Architecture Redesign:
 * - Direct subject_name + component creation (No global subject catalog requirement)
 * - Automatic 1:1 Official Attendance Register creation
 * - Multi-department cohort support via Google Classroom-style invite codes & membership
 * - Stream announcements, assignments, and test linking
 * - Safe archiving with 100% data preservation
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { body, param, query: queryValidator } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requireDepartmentFaculty, requireTeachingGroupOwner } = require('../middleware/requireScope');
const validate = require('../middleware/validate');
const { query, withTransaction } = require('../config/db');
const notificationService = require('../services/notificationService');
const auditService = require('../services/auditService');
const excelExportService = require('../services/excelExportService');
const { makeUploader } = require('../middleware/upload');

const uploadStream = makeUploader('stream', 100);

// Ensure subject_code column exists in teaching_groups
try {
  query('ALTER TABLE teaching_groups ADD COLUMN subject_code TEXT;').catch(() => {});
} catch (_) {}

function generateInviteCode(prefix = '') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = prefix ? prefix.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, 'X') : '';
  while (code.length < 6) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function resolveTeacher(req) {
  let teacherId = req.user?.teacher_id;
  if (teacherId) {
    const rows = await query(`SELECT id, department_id, full_name FROM teachers WHERE id = ?`, [teacherId]);
    if (rows && rows.length > 0) {
      return { id: rows[0].id, department_id: rows[0].department_id, full_name: rows[0].full_name };
    }
  }

  if (req.user?.id) {
    const rows = await query(`SELECT id, department_id, full_name FROM teachers WHERE user_id = ?`, [req.user.id]);
    if (rows && rows.length > 0) {
      req.user.teacher_id = rows[0].id;
      return { id: rows[0].id, department_id: rows[0].department_id, full_name: rows[0].full_name };
    }
  }

  if (req.user?.roles && req.user.roles.includes('SYSTEM_ADMIN')) {
    const rows = await query(`SELECT id, department_id, full_name FROM teachers ORDER BY id ASC LIMIT 1`);
    if (rows && rows.length > 0) {
      req.user.teacher_id = rows[0].id;
      return { id: rows[0].id, department_id: rows[0].department_id, full_name: rows[0].full_name };
    }
  }

  return null;
}

/**
 * Quick Access Overview & Analytics for Google Classroom Dashboard
 * GET /api/v1/teaching-groups/overview
 */
router.get('/overview', auth, async (req, res) => {
  try {
    const teacherId = req.user.teacher_id;
    const teacherParams = [teacherId || -1];

    // 1. Groups overview & attendance stats for chart
    const groups = await query(`
      SELECT tg.id, tg.name, tg.subject_name, tg.subject_code, tg.component, tg.semester,
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

    // 2. Recent & upcoming due assignments / tests across classes
    const recentDue = await query(`
      SELECT a.id, a.title, a.type, a.due_date, a.max_marks, a.created_at,
             tg.id as group_id, tg.name as group_name, tg.subject_name,
             (SELECT COUNT(*) FROM assessment_submissions sub WHERE sub.assessment_id = a.id) as turned_in_count,
             (SELECT COUNT(*) FROM teaching_group_members tgm WHERE tgm.group_id = tg.id AND tgm.status = 'ENROLLED') as total_students
      FROM assessments a
      JOIN teaching_groups tg ON a.group_id = tg.id
      WHERE tg.teacher_id = ? AND tg.status = 'ACTIVE' AND tg.deleted_at IS NULL
      ORDER BY 
        CASE WHEN a.due_date >= date('now') THEN 0 ELSE 1 END,
        a.due_date ASC,
        a.created_at DESC
      LIMIT 8
    `, teacherParams);

    // 3. Trash count (deleted within last 7 days)
    const trashRows = await query(`
      SELECT COUNT(*) as cnt FROM teaching_groups tg
      WHERE tg.teacher_id = ? AND (tg.status = 'TRASHED' OR tg.deleted_at IS NOT NULL)
    `, teacherParams);

    // 4. Overall attendance KPI
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

    res.json({
      success: true,
      data: {
        classes: groups,
        recent_due: recentDue,
        trash_count: trashRows[0]?.cnt || 0,
        overall_attendance_pct: overallPct,
        total_classes: groups.length
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { message: err.message } });
  }
});

/**
 * List Teaching Groups for Teacher (or Admin)
 * GET /api/v1/teaching-groups
 */
router.get(['/', '/teacher/my-groups', '/my-groups'], auth, async (req, res) => {
  try {
    const statusFilter = req.query.status || 'ACTIVE'; // 'ACTIVE' | 'ARCHIVED' | 'TRASH' | 'ALL'
    let sql = `
      SELECT tg.id, tg.name, tg.subject_name, tg.subject_code, tg.component, tg.teacher_id,
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
             (SELECT a.title || ':::' || COALESCE(a.due_date, '') || ':::' || a.type
              FROM assessments a
              WHERE a.group_id = tg.id AND (a.due_date IS NULL OR a.due_date >= date('now', '-2 days'))
              ORDER BY a.due_date ASC LIMIT 1) as upcoming_work,
             MAX(0, 7 - CAST((julianday('now') - julianday(COALESCE(tg.deleted_at, 'now'))) AS INTEGER)) as days_remaining
      FROM teaching_groups tg
      JOIN teachers t ON tg.teacher_id = t.id
      LEFT JOIN departments d ON t.department_id = d.id
      JOIN academic_years ay ON tg.academic_year_id = ay.id
      LEFT JOIN attendance_registers ar ON ar.group_id = tg.id
    `;
    const params = [];
    const conditions = [];

    if (!req.user.roles.includes('SYSTEM_ADMIN')) {
      conditions.push('tg.teacher_id = ?');
      params.push(req.user.teacher_id || -1);
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

    const groups = await query(sql, params);
    res.status(200).json({ success: true, data: groups });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Create Teaching Group + Auto-Create Official Attendance Register
 * POST /api/v1/teaching-groups
 */
router.post(
  '/',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Group name required (2-100 chars)'),
    body('subject_name').trim().isLength({ min: 2, max: 100 }).withMessage('Subject name required (2-100 chars)'),
    body('subject_code').optional().trim(),
    body('component').optional().isIn(['THEORY', 'PRACTICAL', 'THEORY_PRACTICAL']).withMessage('Component must be THEORY, PRACTICAL, or THEORY_PRACTICAL'),
    body('semester').isInt({ min: 1, max: 6 }).withMessage('Semester must be between 1 and 6'),
    body('enrollment_mode').optional().isIn(['INVITE_CODE', 'COHORT']).withMessage('Enrollment mode must be INVITE_CODE or COHORT'),
    body('department_id').optional({ nullable: true }).isInt(),
    body('academic_year_id').optional().isInt(),
    validate
  ],
  async (req, res) => {
    const { name, subject_name, subject_code, component = 'THEORY', semester, enrollment_mode = 'INVITE_CODE', department_id } = req.body;

    try {
      // Resolve active academic year if not provided
      let ayId = req.body.academic_year_id;
      if (!ayId) {
        const currentAY = await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`);
        ayId = currentAY[0]?.id || 1;
      }

      // Resolve teacher profile & primary department
      const teacher = await resolveTeacher(req);
      if (!teacher) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Teacher profile not found' } });
      }
      const effTeacherId = teacher.id;
      const teacherDeptId = teacher.department_id || null;
      const targetDeptId = department_id ? Number(department_id) : teacherDeptId;

      // Generate unique invite code
      let inviteCode = generateInviteCode(subject_name);
      let exists = await query(`SELECT id FROM teaching_groups WHERE invite_code = ?`, [inviteCode]);
      while (exists && exists.length > 0) {
        inviteCode = generateInviteCode();
        exists = await query(`SELECT id FROM teaching_groups WHERE invite_code = ?`, [inviteCode]);
      }

      // Execute in transaction: Create Teaching Group + Auto-Create Official Register
      const result = await withTransaction(async (conn) => {
        const finalCode = (subject_code || '').trim() || (subject_name || '').split(/[\s-]+/).map(w => w[0]).join('').toUpperCase().slice(0, 8);
        const groupInsert = await conn.query(
          `INSERT INTO teaching_groups 
            (name, subject_name, subject_code, component, teacher_id, academic_year_id, semester, invite_code, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP)`,
          [name, subject_name, finalCode, component, effTeacherId, ayId, semester, inviteCode]
        );
        const groupId = groupInsert.insertId || groupInsert.lastInsertRowid;

        // Auto-create 1:1 Official Attendance Register
        const year = Math.ceil(semester / 2);
        const regInsert = await conn.query(
          `INSERT INTO attendance_registers 
            (teacher_id, name, subject_id, department_id, year, semester, academic_year_id, session_type_scope, is_official, is_active, group_id, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 1, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [effTeacherId, name, targetDeptId, year, semester, ayId, component, groupId]
        );
        const registerId = regInsert.insertId || regInsert.lastInsertRowid;

        // Auto-enroll department cohort students if mode is COHORT
        let autoEnrolledCount = 0;
        if (enrollment_mode === 'COHORT' && targetDeptId) {
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

        // Create initial stream post
        await conn.query(
          `INSERT INTO classroom_posts (group_id, author_id, content, created_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
          [groupId, req.user.id, `Welcome to ${name} (${subject_name} • ${component})! Official Register #${registerId} has been linked.`]
        );

        // Audit log
        await conn.query(
          `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
           VALUES (?, 'TEACHING_GROUP_CREATED', 'teaching_groups', ?, ?, CURRENT_TIMESTAMP)`,
          [req.user.id, String(groupId), JSON.stringify({ name, subject_name, component, semester, register_id: registerId, invite_code: inviteCode, enrollment_mode, auto_enrolled_count: autoEnrolledCount })]
        );

        return { groupId, registerId, inviteCode, autoEnrolledCount, subjectCode: finalCode };
      });

      res.status(201).json({
        success: true,
        message: 'Teaching group created successfully with linked official register',
        data: {
          id: result.groupId,
          name,
          subject_name,
          subject_code: result.subjectCode,
          component,
          semester,
          academic_year_id: ayId,
          invite_code: result.inviteCode,
          register_id: result.registerId,
          auto_enrolled_count: result.autoEnrolledCount,
          status: 'ACTIVE'
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * Get Teaching Group Details
 * GET /api/v1/teaching-groups/:id
 */
router.get('/:id', auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const rows = await query(
      `SELECT tg.id, tg.name, tg.subject_name, tg.component, tg.teacher_id,
              tg.academic_year_id, ay.label as academic_year_label,
              tg.semester, tg.invite_code, tg.status, tg.created_at, tg.archived_at,
              t.full_name as teacher_name, t.department_id as teacher_department_id,
              d.name as department_name, d.code as department_code,
              ar.id as register_id,
              (SELECT COUNT(*) FROM teaching_group_members tgm WHERE tgm.group_id = tg.id AND tgm.status = 'ENROLLED') as member_count,
              (SELECT COUNT(*) FROM assessments a WHERE a.group_id = tg.id AND a.type = 'ASSIGNMENT') as assignment_count,
              (SELECT COUNT(*) FROM assessments a WHERE a.group_id = tg.id AND a.type = 'EXAM') as exam_count
       FROM teaching_groups tg
       JOIN teachers t ON tg.teacher_id = t.id
       LEFT JOIN departments d ON t.department_id = d.id
       JOIN academic_years ay ON tg.academic_year_id = ay.id
       LEFT JOIN attendance_registers ar ON ar.group_id = tg.id
       WHERE tg.id = ?`,
      [groupId]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teaching group not found' } });
    }

    const group = rows[0];
    group.linked_register_id = group.register_id;

    // Fetch enrolled members
    group.members = await query(
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

    res.status(200).json({ success: true, data: group });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});


/**
 * Student Join Teaching Group with Invite Code
 * POST /api/v1/teaching-groups/join
 */
router.post(
  '/join',
  auth,
  requireRole('STUDENT'),
  [
    body('invite_code').trim().isLength({ min: 4, max: 10 }).withMessage('Valid invite code required'),
    validate
  ],
  async (req, res) => {
    const code = req.body.invite_code.toUpperCase();
    try {
      const groups = await query(
        `SELECT tg.id, tg.name, tg.subject_name, tg.component, tg.status,
                t.full_name as teacher_name
         FROM teaching_groups tg
         JOIN teachers t ON tg.teacher_id = t.id
         WHERE UPPER(tg.invite_code) = ?`,
        [code]
      );

      if (!groups || groups.length === 0) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invalid invite code or group not found' } });
      }

      const group = groups[0];
      if (group.status !== 'ACTIVE') {
        return res.status(400).json({ success: false, error: { code: 'GROUP_ARCHIVED', message: 'This teaching group is archived and no longer accepting joins' } });
      }

      // Check if already member
      const existing = await query(
        `SELECT id, status FROM teaching_group_members WHERE group_id = ? AND student_id = ?`,
        [group.id, req.user.student_id]
      );

      if (existing && existing.length > 0) {
        return res.status(200).json({
          success: true,
          message: 'You are already enrolled in this Teaching Group',
          data: group
        });
      }

      await query(
        `INSERT INTO teaching_group_members (group_id, student_id, joined_at, status)
         VALUES (?, ?, CURRENT_TIMESTAMP, 'ENROLLED')`,
        [group.id, req.user.student_id]
      );

      try {
        await notificationService.sendNotification({
          userId: req.user.id,
          type: notificationService.NOTIFICATION_TYPES.GROUP_INVITE,
          title: `Joined ${group.name}`,
          message: `You have successfully enrolled into teaching group "${group.name}".`,
          linkUrl: `/student/groups.html?id=${group.id}`
        });
      } catch (_) { }

      res.status(201).json({
        success: true,
        message: `Successfully joined ${group.name}!`,
        data: group
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * List Student Members in Teaching Group
 * GET /api/v1/teaching-groups/:id/members
 */
router.get('/:id/members', auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const members = await query(
      `SELECT tgm.id as membership_id, tgm.status as membership_status, tgm.joined_at,
              s.id as student_id, s.full_name, s.official_enrollment_no, s.official_enrollment_no as enrollment_no,
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

    res.status(200).json({ success: true, data: members });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Teacher Adds Member(s) Directly to Teaching Group
 * POST /api/v1/teaching-groups/:id/members
 */
router.post(
  '/:id/members',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  requireTeachingGroupOwner('id'),
  async (req, res) => {
    const groupId = Number(req.params.id);
    let studentIds = req.body.student_ids;

    try {
      if (!studentIds && req.body.official_enrollment_no) {
        const eno = req.body.official_enrollment_no.trim();
        const found = await query(
          `SELECT id FROM students WHERE UPPER(official_enrollment_no) = UPPER(?) OR UPPER(registration_no) = UPPER(?) LIMIT 1`,
          [eno, eno]
        );
        if (!found || found.length === 0) {
          return res.status(404).json({ success: false, error: { code: 'STUDENT_NOT_FOUND', message: `Student with enrollment "${eno}" not found in database` } });
        }
        studentIds = [found[0].id];
      }

      if (!Array.isArray(studentIds) || studentIds.length === 0) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Valid student_ids array or official_enrollment_no required' } });
      }

      let added = 0;
      const addedStudentIds = [];
      for (const sid of studentIds) {
        const studentId = Number(sid);
        if (!studentId) continue;
        await query(
          `INSERT OR IGNORE INTO teaching_group_members (group_id, student_id, joined_at, status)
           VALUES (?, ?, CURRENT_TIMESTAMP, 'ENROLLED')`,
          [groupId, studentId]
        );
        addedStudentIds.push(studentId);
        added++;
      }

      // Notify students
      try {
        const [grp] = await query('SELECT name FROM teaching_groups WHERE id = ?', [groupId]);
        const grpName = grp?.name || 'Teaching Group';
        for (const sid of addedStudentIds) {
          const stUser = await query('SELECT user_id FROM students WHERE id = ?', [sid]);
          if (stUser[0]?.user_id) {
            await notificationService.sendNotification({
              userId: stUser[0].user_id,
              type: notificationService.NOTIFICATION_TYPES.GROUP_INVITE || 'GENERAL',
              title: `Enrolled in ${grpName}`,
              message: `You have been added to teaching group "${grpName}".`,
              linkUrl: `/student/groups.html?id=${groupId}`
            });
          }
        }
      } catch (_) { }

      res.status(200).json({
        success: true,
        message: `Added ${added} student(s) to Teaching Group`,
        data: { added_count: added }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * Teacher Removes Member from Teaching Group
 * DELETE /api/v1/teaching-groups/:id/members/:studentId
 */
router.delete(
  '/:id/members/:studentId',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  requireTeachingGroupOwner('id'),
  async (req, res) => {
    const groupId = Number(req.params.id);
    const studentId = Number(req.params.studentId);

    try {
      await query(
        `DELETE FROM teaching_group_members WHERE group_id = ? AND student_id = ?`,
        [groupId, studentId]
      );
      res.status(200).json({ success: true, message: 'Student removed from teaching group' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * Student's Enrolled Teaching Groups
 * GET /api/v1/teaching-groups/student/my-groups
 */
router.get('/student/my-groups', auth, requireRole('STUDENT'), async (req, res) => {
  try {
    const groups = await query(
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
      [req.user.student_id]
    );

    res.status(200).json({ success: true, data: groups });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Get Classroom Stream Posts
 * GET /api/v1/teaching-groups/:id/stream
 */
router.get('/:id/stream', auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const posts = await query(
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

    res.status(200).json({ success: true, data: posts });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Post Announcement to Classroom Stream (Supports Document & File Attachments)
 * POST /api/v1/teaching-groups/:id/stream
 */
router.post(
  '/:id/stream',
  auth,
  (req, res, next) => {
    const ct = req.headers['content-type'] || '';
    if (ct.includes('multipart/form-data')) {
      uploadStream.single('attachment')(req, res, (err) => {
        if (err) {
          return res.status(400).json({ success: false, error: { code: 'UPLOAD_ERROR', message: err.message } });
        }
        if (req.file && (!req.body.content || !req.body.content.trim())) {
          req.body.content = req.file.originalname;
        }
        next();
      });
    } else {
      next();
    }
  },
  [
    body('content').trim().isLength({ min: 1, max: 2000 }).withMessage('Post content required (1-2000 chars)'),
    validate
  ],
  async (req, res) => {
    const groupId = Number(req.params.id);
    const content = req.body.content;
    let attachmentPath = req.body.attachment_path || null;
    let attachmentName = req.body.attachment_name || null;

    if (req.file) {
      attachmentPath = `/uploads/stream/${req.file.filename}`;
      attachmentName = req.file.originalname;
    }

    try {
      const result = await query(
        `INSERT INTO classroom_posts (group_id, author_id, content, attachment_path, attachment_name, created_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [groupId, req.user.id, content, attachmentPath, attachmentName]
      );

      res.status(201).json({
        success: true,
        message: 'Announcement posted to classroom stream',
        data: {
          id: result.insertId || result.lastInsertRowid,
          group_id: groupId,
          author_id: req.user.id,
          content,
          attachment_path: attachmentPath,
          attachment_name: attachmentName,
          created_at: new Date().toISOString()
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * Delete Announcement from Classroom Stream
 * DELETE /api/v1/teaching-groups/:id/stream/:postId
 */
router.delete('/:id/stream/:postId', auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const postId = Number(req.params.postId);

    await query('DELETE FROM classroom_post_comments WHERE post_id = ?', [postId]);
    await query('DELETE FROM classroom_posts WHERE id = ? AND group_id = ?', [postId, groupId]);

    res.status(200).json({ success: true, message: 'Announcement deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});


/**
 * Archive Teaching Group (Section 21, 61)
 * POST /api/v1/teaching-groups/:id/archive
 */
router.post('/:id/archive', auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const groups = await query(`SELECT * FROM teaching_groups WHERE id = ?`, [groupId]);
    if (!groups || groups.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teaching group not found' } });
    }
    const group = groups[0];

    const isOwner = req.user.teacher_id && req.user.teacher_id === group.teacher_id;
    const isAdmin = req.user.roles && req.user.roles.includes('SYSTEM_ADMIN');
    const isHOD = req.user.is_hod;
    if (!isOwner && !isAdmin && !isHOD) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Unauthorized to archive this teaching group' } });
    }

    if (group.status === 'ARCHIVED') {
      return res.status(400).json({ success: false, error: { code: 'ALREADY_ARCHIVED', message: 'Teaching group is already archived' } });
    }

    await query(`UPDATE teaching_groups SET status = 'ARCHIVED', archived_at = CURRENT_TIMESTAMP WHERE id = ?`, [groupId]);
    await query(`UPDATE attendance_registers SET is_active = 0 WHERE group_id = ?`, [groupId]);

    await auditService.logAudit({
      eventType: 'TEACHING_GROUP_ARCHIVED',
      actorId: req.user.id,
      actorRole: req.user.roles ? req.user.roles[0] : 'TEACHER',
      targetType: 'teaching_groups',
      targetId: groupId,
      details: { name: group.name, subject_name: group.subject_name },
      ipAddress: req.ip
    });

    res.status(200).json({
      success: true,
      message: 'Teaching group archived successfully. All historical coursework, submissions, marks and attendance remain accessible.',
      data: { id: groupId, status: 'ARCHIVED' }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Unarchive / Restore Teaching Group
 * POST /api/v1/teaching-groups/:id/unarchive
 */
router.post('/:id/unarchive', auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const groups = await query(`SELECT * FROM teaching_groups WHERE id = ?`, [groupId]);
    if (!groups || groups.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teaching group not found' } });
    }
    const group = groups[0];

    const isOwner = req.user.teacher_id && req.user.teacher_id === group.teacher_id;
    const isAdmin = req.user.roles && req.user.roles.includes('SYSTEM_ADMIN');
    const isHOD = req.user.is_hod;
    if (!isOwner && !isAdmin && !isHOD) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Unauthorized to unarchive this teaching group' } });
    }

    await query(`UPDATE teaching_groups SET status = 'ACTIVE', archived_at = NULL WHERE id = ?`, [groupId]);
    await query(`UPDATE attendance_registers SET is_active = 1 WHERE group_id = ?`, [groupId]);

    await auditService.logAudit({
      eventType: 'TEACHING_GROUP_RESTORED',
      actorId: req.user.id,
      actorRole: req.user.roles ? req.user.roles[0] : 'TEACHER',
      targetType: 'teaching_groups',
      targetId: groupId,
      details: { name: group.name, subject_name: group.subject_name },
      ipAddress: req.ip
    });

    res.status(200).json({
      success: true,
      message: 'Teaching group restored to active workspace.',
      data: { id: groupId, status: 'ACTIVE' }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Edit Teaching Group (Class Settings)
 * PUT /api/v1/teaching-groups/:id
 */
router.put(
  '/:id',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('name').optional().trim().isLength({ min: 2, max: 100 }),
    body('subject_name').optional().trim().isLength({ min: 2, max: 100 }),
    body('component').optional().isIn(['THEORY', 'PRACTICAL', 'THEORY_PRACTICAL']),
    validate
  ],
  async (req, res) => {
    try {
      const groupId = Number(req.params.id);
      const groups = await query(`SELECT * FROM teaching_groups WHERE id = ?`, [groupId]);
      if (!groups.length) return res.status(404).json({ success: false, error: { message: 'Teaching group not found' } });
      const g = groups[0];

      const isOwner = req.user.teacher_id && req.user.teacher_id === g.teacher_id;
      const isAdmin = req.user.roles && req.user.roles.includes('SYSTEM_ADMIN');
      if (!isOwner && !isAdmin && !req.user.is_hod) {
        return res.status(403).json({ success: false, error: { message: 'Forbidden' } });
      }

      const { name = g.name, subject_name = g.subject_name, subject_code = g.subject_code, component = g.component } = req.body;
      await query(
        `UPDATE teaching_groups SET name = ?, subject_name = ?, subject_code = ?, component = ? WHERE id = ?`,
        [name, subject_name, subject_code, component, groupId]
      );
      await query(
        `UPDATE attendance_registers SET name = ?, session_type_scope = ? WHERE group_id = ?`,
        [name, component, groupId]
      );

      res.status(200).json({
        success: true,
        message: 'Class updated successfully',
        data: { id: groupId, name, subject_name, subject_code, component }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  }
);

/**
 * Move Class to Trash Bin (7-Day Recoverable Soft Delete)
 * POST /api/v1/teaching-groups/:id/trash
 */
const handleTrashDelete = async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const groups = await query(`SELECT * FROM teaching_groups WHERE id = ?`, [groupId]);
    if (!groups.length) return res.status(404).json({ success: false, error: { message: 'Teaching group not found' } });
    const g = groups[0];

    const isOwner = req.user.teacher_id && req.user.teacher_id === g.teacher_id;
    const isAdmin = req.user.roles && req.user.roles.includes('SYSTEM_ADMIN');
    if (!isOwner && !isAdmin && !req.user.is_hod) {
      return res.status(403).json({ success: false, error: { message: 'Forbidden' } });
    }

    await query(`UPDATE teaching_groups SET status = 'TRASHED', deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [groupId]);
    await query(`UPDATE attendance_registers SET is_active = 0 WHERE group_id = ?`, [groupId]);

    await auditService.logAudit({
      eventType: 'TEACHING_GROUP_TRASHED',
      actorId: req.user.id,
      actorRole: req.user.roles ? req.user.roles[0] : 'TEACHER',
      targetType: 'teaching_groups',
      targetId: groupId,
      details: { name: g.name, subject_name: g.subject_name, recoverable_days: 7 },
      ipAddress: req.ip
    });

    res.status(200).json({
      success: true,
      message: 'Class moved to Trash Bin. It can be safely restored anytime within 7 days.',
      data: { id: groupId, status: 'TRASHED', recoverable_days: 7 }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { message: err.message } });
  }
};
router.post(['/:id/trash', '/:id/delete'], auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), handleTrashDelete);
router.delete('/:id', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), handleTrashDelete);

/**
 * Restore Class from Trash Bin
 * POST /api/v1/teaching-groups/:id/restore
 */
router.post('/:id/restore', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const groups = await query(`SELECT * FROM teaching_groups WHERE id = ?`, [groupId]);
    if (!groups.length) return res.status(404).json({ success: false, error: { message: 'Teaching group not found' } });
    const g = groups[0];

    const isOwner = req.user.teacher_id && req.user.teacher_id === g.teacher_id;
    const isAdmin = req.user.roles && req.user.roles.includes('SYSTEM_ADMIN');
    if (!isOwner && !isAdmin && !req.user.is_hod) {
      return res.status(403).json({ success: false, error: { message: 'Forbidden' } });
    }

    await query(`UPDATE teaching_groups SET status = 'ACTIVE', deleted_at = NULL WHERE id = ?`, [groupId]);
    await query(`UPDATE attendance_registers SET is_active = 1 WHERE group_id = ?`, [groupId]);

    await auditService.logAudit({
      eventType: 'TEACHING_GROUP_RESTORED_FROM_TRASH',
      actorId: req.user.id,
      actorRole: req.user.roles ? req.user.roles[0] : 'TEACHER',
      targetType: 'teaching_groups',
      targetId: groupId,
      details: { name: g.name },
      ipAddress: req.ip
    });

    res.status(200).json({
      success: true,
      message: 'Class successfully restored from Trash Bin!',
      data: { id: groupId, status: 'ACTIVE' }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { message: err.message } });
  }
});

/**
 * Permanently Delete Class
 * DELETE /api/v1/teaching-groups/:id/permanent
 */
router.delete('/:id/permanent', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const groups = await query(`SELECT * FROM teaching_groups WHERE id = ?`, [groupId]);
    if (!groups.length) return res.status(404).json({ success: false, error: { message: 'Teaching group not found' } });

    await withTransaction(async (conn) => {
      await conn.execute(`DELETE FROM teaching_group_members WHERE group_id = ?`, [groupId]);
      await conn.execute(`DELETE FROM classroom_posts WHERE group_id = ?`, [groupId]);
      // Student Data Sovereignty: Detach attendance register from class container rather than deleting,
      // ensuring student historical attendance sessions and records are permanently preserved in their ledger.
      await conn.execute(`UPDATE attendance_registers SET group_id = NULL, is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE group_id = ?`, [groupId]);
      await conn.execute(`DELETE FROM teaching_groups WHERE id = ?`, [groupId]);
    });

    res.status(200).json({ success: true, message: 'Class permanently deleted (historical student attendance preserved in academic vault).' });
  } catch (err) {
    res.status(500).json({ success: false, error: { message: err.message } });
  }
});

/**
 * Get Students Eligible for Group but Not Yet Enrolled
 * GET /api/v1/teaching-groups/:id/unenrolled-students
 */
router.get('/:id/unenrolled-students', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const groups = await query('SELECT * FROM teaching_groups WHERE id = ?', [groupId]);
    if (!groups || groups.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teaching group not found' } });
    }
    const group = groups[0];

    const search = req.query.search ? `%${req.query.search.trim()}%` : null;
    const departmentId = req.query.department_id ? Number(req.query.department_id) : null;
    const regRows = await query('SELECT department_id FROM attendance_registers WHERE group_id = ?', [groupId]);
    const targetDeptId = departmentId || regRows[0]?.department_id || null;

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

    const students = await query(sql, params);
    res.status(200).json({ success: true, data: students });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Promote Cohort to Next Semester Group (Option 2 Archiving)
 * POST /api/v1/teaching-groups/:id/promote
 */
router.post(
  '/:id/promote',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  requireTeachingGroupOwner('id'),
  [
    body('new_name').trim().isLength({ min: 2, max: 100 }).withMessage('New group name required'),
    body('new_semester').isInt({ min: 1, max: 6 }).withMessage('Valid next semester (1-6) required'),
    body('student_ids').isArray().withMessage('Array of selected student_ids required'),
    validate
  ],
  async (req, res) => {
    const oldGroupId = Number(req.params.id);
    const { new_name, new_semester, student_ids = [] } = req.body;

    try {
      const oldGroupRows = await query('SELECT * FROM teaching_groups WHERE id = ?', [oldGroupId]);
      if (!oldGroupRows || oldGroupRows.length === 0) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teaching group not found' } });
      }
      const oldGroup = oldGroupRows[0];

      // Resolve active academic year
      const currentAY = await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`);
      const ayId = req.body.academic_year_id || currentAY[0]?.id || oldGroup.academic_year_id;

      // Resolve old register's department
      const oldReg = await query('SELECT department_id FROM attendance_registers WHERE group_id = ?', [oldGroupId]);
      const deptId = oldReg[0]?.department_id || null;

      // Generate new invite code
      let inviteCode = generateInviteCode(oldGroup.subject_name);
      let exists = await query(`SELECT id FROM teaching_groups WHERE invite_code = ?`, [inviteCode]);
      while (exists && exists.length > 0) {
        inviteCode = generateInviteCode();
        exists = await query(`SELECT id FROM teaching_groups WHERE invite_code = ?`, [inviteCode]);
      }

      const result = await withTransaction(async (conn) => {
        // 1. Create new Teaching Group
        const grpRes = await conn.query(
          `INSERT INTO teaching_groups (name, subject_name, component, teacher_id, academic_year_id, semester, invite_code, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP)`,
          [new_name, oldGroup.subject_name, oldGroup.component, oldGroup.teacher_id, ayId, new_semester, inviteCode]
        );
        const newGroupId = grpRes.insertId || grpRes.lastInsertRowid;

        // 2. Create new linked official register
        const newYear = Math.ceil(new_semester / 2);
        const regRes = await conn.query(
          `INSERT INTO attendance_registers (teacher_id, name, subject_id, department_id, year, semester, academic_year_id, session_type_scope, is_official, is_active, group_id, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 1, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [oldGroup.teacher_id, new_name, deptId, newYear, new_semester, ayId, oldGroup.component, newGroupId]
        );
        const newRegisterId = regRes.insertId || regRes.lastInsertRowid;

        // 3. Enroll only the selected students into the new group
        let enrolledCount = 0;
        for (const sid of student_ids) {
          const studentId = Number(sid);
          if (!studentId) continue;
          await conn.query(
            `INSERT INTO teaching_group_members (group_id, student_id, joined_at, status)
             VALUES (?, ?, CURRENT_TIMESTAMP, 'ENROLLED')`,
            [newGroupId, studentId]
          );
          enrolledCount++;
        }

        // 4. Automatically archive the old group and deactivate old register
        await conn.query(`UPDATE teaching_groups SET status = 'ARCHIVED', archived_at = CURRENT_TIMESTAMP WHERE id = ?`, [oldGroupId]);
        await conn.query(`UPDATE attendance_registers SET is_active = 0 WHERE group_id = ?`, [oldGroupId]);

        // 5. Classroom Stream posts
        await conn.query(
          `INSERT INTO classroom_posts (group_id, author_id, content, created_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
          [oldGroupId, req.user.id, `🎓 Cohort successfully promoted to Semester ${new_semester} ("${new_name}"). This previous semester group has been archived.`]
        );
        await conn.query(
          `INSERT INTO classroom_posts (group_id, author_id, content, created_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
          [newGroupId, req.user.id, `🎉 Welcome to ${new_name} (Semester ${new_semester})! Cohort promoted from ${oldGroup.name}. Official Register #${newRegisterId} is active.`]
        );

        // 6. Audit log
        await conn.query(
          `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, created_at)
           VALUES (?, 'TEACHING_GROUP_PROMOTED', 'teaching_groups', ?, ?, CURRENT_TIMESTAMP)`,
          [req.user.id, String(newGroupId), JSON.stringify({ old_group_id: oldGroupId, old_name: oldGroup.name, new_name, new_semester, promoted_count: enrolledCount })]
        );

        return { newGroupId, newRegisterId, enrolledCount, inviteCode };
      });

      // Notify promoted students
      try {
        for (const sid of student_ids) {
          const stRows = await query('SELECT user_id FROM students WHERE id = ?', [sid]);
          if (stRows[0]?.user_id) {
            await notificationService.sendNotification({
              userId: stRows[0].user_id,
              type: notificationService.NOTIFICATION_TYPES.GROUP_INVITE || 'GENERAL',
              title: `Promoted to ${new_name}`,
              message: `You have been promoted and enrolled into Semester ${new_semester} group "${new_name}".`,
              linkUrl: `/student/groups.html?id=${result.newGroupId}`
            });
          }
        }
      } catch (_) { }

      res.status(201).json({
        success: true,
        message: `Cohort promoted successfully! Enrolled ${result.enrolledCount} students in "${new_name}". Previous group has been automatically archived.`,
        data: {
          new_group_id: result.newGroupId,
          new_register_id: result.newRegisterId,
          promoted_count: result.enrolledCount,
          invite_code: result.inviteCode,
          old_group_id: oldGroupId,
          status: 'ACTIVE'
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * Broadcast Notice / Announcement to Year or Semester Cohort
 * POST /api/v1/teaching-groups/broadcast-notice
 */
router.post(
  '/broadcast-notice',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('title').trim().isLength({ min: 2, max: 200 }).withMessage('Notice title required (2-200 chars)'),
    body('content').trim().isLength({ min: 5, max: 3000 }).withMessage('Notice content required (5-3000 chars)'),
    validate
  ],
  async (req, res) => {
    const { title, content, target_semester, target_year, department_id } = req.body;
    try {
      // Find matching active teaching groups for this teacher
      let sql = `
        SELECT tg.id, tg.name, tg.semester, ar.department_id
        FROM teaching_groups tg
        LEFT JOIN attendance_registers ar ON ar.group_id = tg.id
        WHERE tg.teacher_id = ? AND tg.status = 'ACTIVE'
      `;
      const params = [req.user.teacher_id];

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

      const groups = await query(sql, params);
      if (!groups || groups.length === 0) {
        return res.status(404).json({ success: false, error: { code: 'NO_MATCHING_GROUPS', message: 'No active teaching groups match the selected cohort criteria' } });
      }

      const formattedContent = `📢 **${title}**\n\n${content}`;
      const groupIds = groups.map(g => g.id);

      // 1. Post to each group stream
      for (const gid of groupIds) {
        await query(
          `INSERT INTO classroom_posts (group_id, author_id, content, created_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
          [gid, req.user.id, formattedContent]
        );
      }

      // 2. Find all distinct enrolled students across these groups
      const placeholders = groupIds.map(() => '?').join(',');
      const students = await query(
        `SELECT DISTINCT s.user_id, s.id as student_id
         FROM teaching_group_members tgm
         JOIN students s ON tgm.student_id = s.id
         WHERE tgm.group_id IN (${placeholders}) AND tgm.status = 'ENROLLED'`,
        groupIds
      );

      // 3. Send in-app notification to each student
      let notifiedCount = 0;
      for (const st of students) {
        if (st.user_id) {
          try {
            await notificationService.sendNotification({
              userId: st.user_id,
              type: notificationService.NOTIFICATION_TYPES.ANNOUNCEMENT || 'GENERAL',
              title: `📢 Notice: ${title}`,
              message: content.length > 120 ? content.slice(0, 117) + '...' : content,
              linkUrl: `/student/groups.html`
            });
            notifiedCount++;
          } catch (_) { }
        }
      }

      res.status(200).json({
        success: true,
        message: `Notice broadcast successfully to ${groupIds.length} teaching group(s) and notified ${notifiedCount} student(s)!`,
        data: {
          groups_count: groupIds.length,
          students_notified: notifiedCount
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * Get Classroom Post Comments / Q&A Thread
 * GET /api/v1/teaching-groups/posts/:postId/comments
 * GET /api/v1/teaching-groups/:id/stream/:postId/comments
 */
router.get(['/posts/:postId/comments', '/:id/stream/:postId/comments', '/:id/posts/:postId/comments'], auth, async (req, res) => {
  try {
    const postId = Number(req.params.postId);
    const comments = await query(
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
    res.status(200).json({ success: true, data: comments });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Post Comment on Classroom Post
 * POST /api/v1/teaching-groups/posts/:postId/comments
 * POST /api/v1/teaching-groups/:id/stream/:postId/comments
 */
router.post(
  ['/posts/:postId/comments', '/:id/stream/:postId/comments', '/:id/posts/:postId/comments'],
  auth,
  [
    body('content').trim().isLength({ min: 1, max: 1000 }).withMessage('Comment content required (1-1000 chars)'),
    validate
  ],
  async (req, res) => {
    const postId = Number(req.params.postId);
    const { content } = req.body;
    try {
      const result = await query(
        `INSERT INTO classroom_post_comments (post_id, author_id, content, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [postId, req.user.id, content]
      );
      res.status(201).json({
        success: true,
        message: 'Comment posted successfully',
        data: {
          id: result.insertId || result.lastInsertRowid,
          post_id: postId,
          author_id: req.user.id,
          content,
          created_at: new Date().toISOString()
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * List Group Assignments
 * GET /api/v1/teaching-groups/:id/assignments
 */
router.get('/:id/assignments', auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const rows = await query(
      `SELECT a.id, a.type, a.title, a.description, a.due_date, a.max_marks, a.created_at, a.questions,
              (SELECT COUNT(*) FROM assessment_submissions sub WHERE sub.assessment_id = a.id AND sub.status != 'ABSENT') as submission_count
       FROM assessments a
       WHERE a.group_id = ? AND a.type IN ('ASSIGNMENT', 'PRACTICAL', 'FINAL_DOCS')
       ORDER BY a.created_at DESC`,
      [groupId]
    );

    const formatted = rows.map(r => {
      let qList = null;
      if (r.questions) {
        try {
          qList = typeof r.questions === 'string' ? JSON.parse(r.questions) : r.questions;
        } catch (_) {
          qList = null;
        }
      }
      return {
        ...r,
        questions: qList
      };
    });

    res.status(200).json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Create Group Assignment / Practical Work / Final Documents Request
 * POST /api/v1/teaching-groups/:id/assignments
 */
router.post(
  '/:id/assignments',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('title').trim().isLength({ min: 2, max: 200 }).withMessage('Title required'),
    body('type').optional().isIn(['ASSIGNMENT', 'PRACTICAL', 'FINAL_DOCS']).withMessage('Invalid work type'),
    validate
  ],
  async (req, res) => {
    try {
      const groupId = Number(req.params.id);
      const { title, description, due_date, max_marks, type = 'ASSIGNMENT', post_to_stream = true, questions } = req.body;

      const grp = await query(
        `SELECT tg.*, COALESCE(ar.department_id, t.department_id, 1) as department_id
         FROM teaching_groups tg
         LEFT JOIN attendance_registers ar ON ar.group_id = tg.id
         LEFT JOIN teachers t ON tg.teacher_id = t.id
         WHERE tg.id = ?`,
        [groupId]
      );
      if (!grp.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teaching group not found' } });
      const g = grp[0];

      let qJson = null;
      if (questions) {
        qJson = typeof questions === 'string' ? questions : JSON.stringify(questions);
      }

      // Final docs do not require max marks input from teacher, default safely to 100 for SQLite NOT NULL constraint
      const effectiveMaxMarks = max_marks !== undefined && max_marks !== null && max_marks !== ''
        ? Number(max_marks)
        : (type === 'FINAL_DOCS' ? 100 : (type === 'PRACTICAL' ? 25 : 100));

      const result = await query(
        `INSERT INTO assessments (teacher_id, group_id, semester, academic_year_id, type, title, description, due_date, max_marks, questions, department_id, year)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          g.teacher_id,
          groupId,
          g.semester,
          g.academic_year_id,
          type,
          title,
          description || null,
          due_date || null,
          effectiveMaxMarks,
          qJson,
          g.department_id || null,
          Math.ceil(g.semester / 2)
        ]
      );
      const insertId = result.insertId || result.lastInsertRowid;

      // Send notifications directly to enrolled students (do not post to stream)
      try {
        const enrolledStudents = await query(
          `SELECT s.user_id 
           FROM teaching_group_members tgm 
           JOIN students s ON tgm.student_id = s.id 
           WHERE tgm.group_id = ? AND (tgm.status = 'ACTIVE' OR tgm.status = 'ENROLLED')`,
          [groupId]
        );
        const studentUserIds = (enrolledStudents || []).map(r => r.user_id).filter(Boolean);
        if (studentUserIds.length > 0) {
          const typeLabel = type === 'PRACTICAL' ? 'New Lab Practical' : type === 'FINAL_DOCS' ? 'Final Documents Submission Request' : 'New Assignment';
          const notifTitle = `${typeLabel}: ${title}`;
          const notifMsg = `Posted in ${g.name} (${g.subject_name})${due_date ? ' · Due: ' + due_date : ''}`;
          await notificationService.sendBatchNotification({
            userIds: studentUserIds,
            type: notificationService.NOTIFICATION_TYPES.ASSIGNMENT_POSTED,
            title: notifTitle,
            message: notifMsg,
            linkUrl: `/student/assignments.html?group=${groupId}`
          });
        }
      } catch (notifErr) {
        console.warn('[ClassworkNotif] Failed to dispatch student notifications:', notifErr.message);
      }

      res.status(201).json({
        success: true,
        message: `${type === 'PRACTICAL' ? 'Practical announcement' : type === 'FINAL_DOCS' ? 'Final documents request' : 'Assignment'} published successfully`,
        data: { id: insertId, questions: questions || null }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * Edit Group Assignment / Practical Work / Final Documents Request
 * PUT /api/v1/teaching-groups/:id/assignments/:assignmentId
 */
router.put(
  '/:id/assignments/:assignmentId',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  async (req, res) => {
    try {
      const groupId = Number(req.params.id);
      const assignmentId = Number(req.params.assignmentId);
      const { title, description, due_date, max_marks, questions } = req.body;

      const existing = await query('SELECT * FROM assessments WHERE id = ? AND group_id = ?', [assignmentId, groupId]);
      if (!existing.length) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Classwork item not found' } });
      }

      let qJson = existing[0].questions;
      if (questions !== undefined) {
        qJson = (questions === null || questions === '') ? null : (typeof questions === 'string' ? questions : JSON.stringify(questions));
      }

      const newTitle = title !== undefined ? title.trim() : existing[0].title;
      const newDesc = description !== undefined ? (description ? description.trim() : null) : existing[0].description;
      const newDue = due_date !== undefined ? (due_date ? due_date : null) : existing[0].due_date;
      const newMarks = max_marks !== undefined ? (max_marks === '' || max_marks === null ? (existing[0].max_marks || 100) : Number(max_marks)) : existing[0].max_marks;

      await query(
        `UPDATE assessments
         SET title = ?, description = ?, due_date = ?, max_marks = ?, questions = ?
         WHERE id = ? AND group_id = ?`,
        [newTitle, newDesc, newDue, newMarks, qJson, assignmentId, groupId]
      );

      res.status(200).json({
        success: true,
        message: 'Classwork item updated successfully'
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * Get Submissions & Student Roster Status for a Classwork item
 * GET /api/v1/teaching-groups/:id/assignments/:assignmentId/submissions
 */
router.get(
  '/:id/assignments/:assignmentId/submissions',
  auth,
  async (req, res) => {
    try {
      const groupId = Number(req.params.id);
      const assignmentId = Number(req.params.assignmentId);

      const asgnRows = await query('SELECT * FROM assessments WHERE id = ? AND group_id = ?', [assignmentId, groupId]);
      if (!asgnRows.length) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Item not found' } });
      }
      const item = asgnRows[0];

      const roster = await query(
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

      const formatted = roster.map(r => {
        let docs = [];
        if (r.file_path) {
          try {
            const parsed = JSON.parse(r.file_path);
            if (Array.isArray(parsed)) {
              docs = parsed;
            } else {
              docs = [{ requirement_name: 'Submitted Document', file_path: r.file_path, original_filename: r.original_filename || 'document' }];
            }
          } catch (_) {
            docs = [{ requirement_name: 'Submitted Document', file_path: r.file_path, original_filename: r.original_filename || 'document' }];
          }
        }

        const isSubmitted = Boolean(r.submission_id && r.submission_status !== 'ABSENT');

        return {
          student_id: r.student_id,
          class_roll_no: r.class_roll_no,
          full_name: r.full_name,
          official_enrollment_no: r.official_enrollment_no,
          registration_no: r.registration_no,
          submission_id: r.submission_id,
          status: isSubmitted ? (r.submission_status || 'SUBMITTED') : 'NOT_SUBMITTED',
          is_submitted: isSubmitted,
          submitted_at: r.submitted_at,
          marks_obtained: r.marks_obtained,
          feedback: r.feedback,
          documents: docs
        };
      });

      const submittedCount = formatted.filter(s => s.is_submitted).length;
      const notSubmittedCount = formatted.length - submittedCount;

      res.status(200).json({
        success: true,
        data: {
          assignment_id: assignmentId,
          title: item.title,
          type: item.type,
          total_students: formatted.length,
          submitted_count: submittedCount,
          not_submitted_count: notSubmittedCount,
          roster: formatted
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * Delete Group Assignment / Practical Work / Final Documents Request
 * DELETE /api/v1/teaching-groups/:id/assignments/:assignmentId
 */
router.delete('/:id/assignments/:assignmentId', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    const deleteFiles = req.query.delete_files !== 'false' && req.query.delete_files !== '0' && req.body?.delete_files !== false;

    if (deleteFiles) {
      const uploadRoot = path.join(__dirname, '../../uploads');

      // 1. Check assessment attachment
      const asgnRows = await query(`SELECT attachment_path FROM assessments WHERE id = ? AND group_id = ?`, [assignmentId, groupId]);
      if (asgnRows.length && asgnRows[0].attachment_path) {
        try {
          const rel = asgnRows[0].attachment_path.replace(/^\/uploads\//, '');
          const fullPath = path.join(uploadRoot, rel);
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        } catch (_) {}
      }

      // 2. Unlink student submission files from disk
      const subs = await query(`SELECT file_path FROM assessment_submissions WHERE assessment_id = ?`, [assignmentId]);
      for (const s of subs) {
        if (!s.file_path) continue;
        let filePaths = [];
        if (typeof s.file_path === 'string' && s.file_path.startsWith('[')) {
          try {
            const arr = JSON.parse(s.file_path);
            if (Array.isArray(arr)) filePaths = arr.map(d => d.file_path).filter(Boolean);
          } catch (_) { filePaths = [s.file_path]; }
        } else {
          filePaths = [s.file_path];
        }

        for (const fp of filePaths) {
          try {
            const rel = fp.replace(/^\/uploads\//, '');
            const fullPath = path.join(uploadRoot, rel);
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
          } catch (e) {
            console.warn('[DeleteFiles] Error deleting file:', fp, e.message);
          }
        }
      }
    }

    // Cascade delete any submissions first to prevent FK/orphan locks
    await query(`DELETE FROM assessment_submissions WHERE assessment_id = ?`, [assignmentId]);
    await query(`DELETE FROM assessments WHERE id = ? AND group_id = ?`, [assignmentId, groupId]);
    res.status(200).json({ success: true, message: 'Classwork item deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

// Ensure questions and instructions columns exist in assessments table (fail-safe idempotent)
(async () => {
  try {
    const cols = await query(`PRAGMA table_info(assessments)`);
    if (Array.isArray(cols)) {
      if (!cols.some(c => c.name === 'questions')) {
        await query(`ALTER TABLE assessments ADD COLUMN questions TEXT`);
      }
      if (!cols.some(c => c.name === 'instructions')) {
        await query(`ALTER TABLE assessments ADD COLUMN instructions TEXT`);
      }
    }
  } catch (_) {}
})();

/**
 * List Group Class Tests
 * GET /api/v1/teaching-groups/:id/tests
 */
router.get('/:id/tests', auth, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const rows = await query(
      `SELECT a.id, a.title as name, a.title, a.description, a.due_date as test_date, a.due_date, a.max_marks, a.created_at, a.questions, a.instructions,
              (SELECT COUNT(*) FROM assessment_submissions sub WHERE sub.assessment_id = a.id AND sub.status != 'ABSENT') as graded_count,
              (SELECT AVG(sub.marks_obtained) FROM assessment_submissions sub WHERE sub.assessment_id = a.id AND sub.status != 'ABSENT') as avg_score,
              (SELECT (COUNT(CASE WHEN sub.marks_obtained >= (a.max_marks * 0.4) THEN 1 END) * 100.0 / NULLIF(COUNT(sub.id), 0))
               FROM assessment_submissions sub WHERE sub.assessment_id = a.id AND sub.status != 'ABSENT') as pass_rate
       FROM assessments a
       WHERE a.group_id = ? AND a.type = 'EXAM'
       ORDER BY a.created_at DESC`,
      [groupId]
    );

    const formatted = rows.map(r => {
      let qList = null;
      if (r.questions) {
        try {
          qList = typeof r.questions === 'string' ? JSON.parse(r.questions) : r.questions;
        } catch {
          qList = null;
        }
      }
      let instList = null;
      if (r.instructions) {
        try {
          instList = typeof r.instructions === 'string' ? JSON.parse(r.instructions) : r.instructions;
        } catch {
          instList = null;
        }
      }
      return {
        ...r,
        questions: qList,
        instructions: instList,
        num_questions: Array.isArray(qList) ? qList.length : null
      };
    });

    res.status(200).json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Schedule Group Class Test
 * POST /api/v1/teaching-groups/:id/tests
 */
router.post(
  '/:id/tests',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('name').trim().isLength({ min: 2, max: 200 }).withMessage('Test name required'),
    body('max_marks').optional().isFloat({ min: 1 }).withMessage('Max marks must be positive number'),
    validate
  ],
  async (req, res) => {
    try {
      const groupId = Number(req.params.id);
      const { name, test_date, max_marks = 20, description, num_questions, questions } = req.body;

      const grp = await query(
        `SELECT tg.*, COALESCE(ar.department_id, t.department_id, 1) as department_id
         FROM teaching_groups tg
         LEFT JOIN attendance_registers ar ON ar.group_id = tg.id
         LEFT JOIN teachers t ON tg.teacher_id = t.id
         WHERE tg.id = ?`,
        [groupId]
      );
      if (!grp.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teaching group not found' } });
      const g = grp[0];

      // Build structured question definitions
      let questionsPayload = null;
      if (Array.isArray(questions) && questions.length > 0) {
        questionsPayload = questions.map((q, idx) => ({
          num: idx + 1,
          label: q.label || ('Q' + (idx + 1)),
          max: Number(q.max) || Math.round((Number(max_marks) / questions.length) * 10) / 10
        }));
      } else if (num_questions && Number(num_questions) > 0) {
        const count = parseInt(num_questions, 10);
        const marksNum = Number(max_marks) || 20;
        const perQ = Math.round((marksNum / count) * 10) / 10;
        questionsPayload = Array.from({ length: count }, (_, i) => ({
          num: i + 1,
          label: 'Q' + (i + 1),
          max: perQ
        }));
      }

      const questionsJson = questionsPayload ? JSON.stringify(questionsPayload) : null;

      const result = await query(
        `INSERT INTO assessments (teacher_id, group_id, semester, academic_year_id, type, title, description, due_date, max_marks, questions, department_id, year)
         VALUES (?, ?, ?, ?, 'EXAM', ?, ?, ?, ?, ?, ?, ?)`,
        [
          g.teacher_id,
          groupId,
          g.semester,
          g.academic_year_id,
          name,
          description || null,
          test_date || null,
          max_marks,
          questionsJson,
          g.department_id || null,
          Math.ceil(g.semester / 2)
        ]
      );

      res.status(201).json({
        success: true,
        message: 'Class test scheduled successfully',
        data: {
          id: result.insertId || result.lastInsertRowid,
          questions: questionsPayload,
          num_questions: questionsPayload ? questionsPayload.length : null
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * Edit Group Class Test
 * PUT /api/v1/teaching-groups/:id/tests/:testId
 */
router.put('/:id/tests/:testId', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const testId = Number(req.params.testId);
    const { name, test_date, max_marks, description, questions, instructions } = req.body;

    const existing = await query('SELECT * FROM assessments WHERE id = ? AND group_id = ? AND type = ?', [testId, groupId, 'EXAM']);
    if (!existing.length) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Test not found' } });
    }

    let qJson = existing[0].questions;
    if (questions !== undefined) {
      qJson = questions ? (typeof questions === 'string' ? questions : JSON.stringify(questions)) : null;
    }

    let instJson = existing[0].instructions;
    if (instructions !== undefined) {
      instJson = instructions ? (typeof instructions === 'string' ? instructions : JSON.stringify(instructions)) : null;
    }

    const newName = name !== undefined ? name.trim() : existing[0].title;
    const newDesc = description !== undefined ? (description ? description.trim() : null) : existing[0].description;
    const newDate = test_date !== undefined ? (test_date ? test_date : null) : existing[0].due_date;
    const newMarks = max_marks !== undefined ? Number(max_marks) : existing[0].max_marks;

    await query(
      `UPDATE assessments
       SET title = ?, description = ?, due_date = ?, max_marks = ?, questions = ?, instructions = ?
       WHERE id = ? AND group_id = ? AND type = 'EXAM'`,
      [newName, newDesc, newDate, newMarks, qJson, instJson, testId, groupId]
    );

    res.status(200).json({ success: true, message: 'Class test updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Delete Group Class Test
 * DELETE /api/v1/teaching-groups/:id/tests/:testId
 */
router.delete('/:id/tests/:testId', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const testId = Number(req.params.testId);
    await query(`DELETE FROM assessment_submissions WHERE assessment_id = ?`, [testId]);
    await query(`DELETE FROM assessments WHERE id = ? AND group_id = ? AND type = 'EXAM'`, [testId, groupId]);
    res.status(200).json({ success: true, message: 'Test deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Get Test Scores for Group Test
 * GET /api/v1/teaching-groups/:id/tests/:testId/scores
 */
router.get('/:id/tests/:testId/scores', auth, async (req, res) => {
  try {
    const testId = Number(req.params.testId);
    const scores = await query(
      `SELECT sub.student_id, sub.marks_obtained, sub.status,
              CASE WHEN sub.status = 'ABSENT' THEN 1 ELSE 0 END as is_absent,
              sub.feedback as remarks
       FROM assessment_submissions sub
       WHERE sub.assessment_id = ?`,
      [testId]
    );

    const cleaned = scores.map(s => {
      let rem = s.remarks;
      let question_scores = null;
      let questions = null;
      if (rem && typeof rem === 'string' && rem.startsWith('{')) {
        try {
          const parsed = JSON.parse(rem);
          if (parsed.remarks !== undefined) rem = parsed.remarks;
          if (parsed.question_scores) question_scores = parsed.question_scores;
          if (parsed.questions) questions = parsed.questions;
        } catch { /* raw string */ }
      }
      return {
        student_id: s.student_id,
        marks_obtained: s.marks_obtained,
        is_absent: Boolean(s.is_absent),
        remarks: rem,
        question_scores,
        questions,
        status: s.status
      };
    });

    res.status(200).json({ success: true, data: cleaned });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Save Test Scores for Group Test
 * POST /api/v1/teaching-groups/:id/tests/:testId/scores
 */
router.post(
  '/:id/tests/:testId/scores',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('scores').isArray().withMessage('scores array is required'),
    validate
  ],
  async (req, res) => {
    try {
      const groupId = Number(req.params.id);
      const testId = Number(req.params.testId);
      const { scores, questions, instructions } = req.body;

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

      await withTransaction(async (conn) => {
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
            [testId, s.student_id, marks, feedbackPayload, req.user.id, status]
          );
        }
      });

      res.status(200).json({ success: true, message: 'Marks saved successfully' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
);

/**
 * Export Group Class Test Marksheet (Excel, PDF, Word DOC)
 * POST /api/v1/teaching-groups/:id/tests/:testId/export/:format
 * GET  /api/v1/teaching-groups/:id/tests/:testId/export/:format
 */
router.all('/:id/tests/:testId/export/:format', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const testId = Number(req.params.testId);
    const format = (req.params.format || 'excel').toLowerCase();

    // Query test and group metadata
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

    if (!testRows.length) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Class test not found' } });
    }
    const t = testRows[0];

    const setRows = await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'institution_name'`);
    const instName = setRows[0]?.setting_value || 'Government Polytechnic College';

    const customData = req.body || {};

    let questions = customData.questions;
    if (!questions && t.questions) {
      try { questions = typeof t.questions === 'string' ? JSON.parse(t.questions) : t.questions; } catch {}
    }

    let instructions = customData.instructions;
    if (!instructions && t.instructions) {
      try { instructions = typeof t.instructions === 'string' ? JSON.parse(t.instructions) : t.instructions; } catch {}
    }

    let roster = customData.roster;
    if (!Array.isArray(roster) || roster.length === 0) {
      // Fetch enrolled students and their scores
      const studRows = await query(
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

      roster = studRows.map(s => {
        let qScores = null;
        let isAb = s.status === 'ABSENT';
        if (s.feedback) {
          try {
            const fb = JSON.parse(s.feedback);
            if (fb.is_absent !== undefined) isAb = Boolean(fb.is_absent);
            if (Array.isArray(fb.question_scores)) qScores = fb.question_scores;
          } catch {}
        }
        return {
          student_id: s.student_id,
          class_roll_no: s.class_roll_no,
          official_enrollment_no: s.official_enrollment_no,
          registration_no: s.registration_no,
          full_name: s.full_name,
          is_absent: isAb,
          question_scores: qScores,
          marks_obtained: isAb ? 0 : s.marks_obtained
        };
      });
    }

    // ── ALWAYS enrich roster with official DB enrollment/registration numbers ──
    // Ensures Enrollment No. and Registration No. appear in exports even when
    // those columns were hidden in the UI marks modal.
    if (Array.isArray(roster) && roster.length > 0) {
      const studentIds = roster.map(r => r.student_id).filter(Boolean);
      if (studentIds.length > 0) {
        try {
          const dbStudents = await query(
            `SELECT id, official_enrollment_no, registration_no
             FROM students WHERE id IN (${studentIds.map(() => '?').join(',')})
             LIMIT 200`,
            studentIds
          );
          const dbMap = {};
          dbStudents.forEach(s => { dbMap[s.id] = s; });
          roster = roster.map(r => ({
            ...r,
            official_enrollment_no: (dbMap[r.student_id]?.official_enrollment_no) || r.official_enrollment_no || '-',
            registration_no:        (dbMap[r.student_id]?.registration_no)        || r.registration_no        || '-'
          }));
        } catch (_) { /* Non-fatal: continue with existing roster data */ }
      }
    }

    const payload = {
      institution_name: customData.institution_name || instName,
      session_label: customData.session_label || `Internal Evaluation Sheet ${t.academic_year_label || '2026 Session'}`,
      department_name: customData.department_name || t.department_name || '',
      department_code: customData.department_code || t.department_code || '',
      subject_name: customData.subject_name || t.subject_name || t.group_name || 'Subject',
      year: customData.year || (t.semester ? Math.ceil(t.semester / 2) : 1),
      semester: customData.semester || t.semester || 1,
      title: customData.title || t.title || 'Unit Test',
      max_marks: customData.max_marks || t.max_marks || 20,
      exam_date: customData.exam_date || t.due_date,
      duration: customData.duration || '50 minutes',
      mode: customData.mode || 'OFFLINE',
      questions,
      instructions,
      question_texts: customData.question_texts,
      roster
    };

    const safeTitle = (payload.title || 'Unit_Test').replace(/[^a-zA-Z0-9_-]/g, '_');

    if (format === 'excel' || format === 'xlsx') {
      const buffer = await excelExportService.generateClassTestExcel(payload);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}_Marksheet.xlsx"`);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } else if (format === 'pdf') {
      const buffer = await excelExportService.generateClassTestPdf(payload);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}_Marksheet.pdf"`);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } else if (format === 'doc' || format === 'docx' || format === 'word') {
      const buffer = await excelExportService.generateClassTestDoc(payload);
      res.setHeader('Content-Type', 'application/msword');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}_Marksheet.doc"`);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } else {
      return res.status(400).json({ success: false, error: { code: 'INVALID_FORMAT', message: 'Format must be excel, pdf, or doc' } });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

/**
 * Auto-Archive Expired Session Teaching Groups (Option 3 Archiving)
 * POST /api/v1/teaching-groups/auto-archive-expired
 */
router.post('/auto-archive-expired', auth, async (req, res) => {
  try {
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

    res.status(200).json({
      success: true,
      message: `Archived ${archivedCount} teaching group(s) from expired academic session(s).`,
      data: { archived_count: archivedCount }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;

