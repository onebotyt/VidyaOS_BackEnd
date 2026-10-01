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
const { body, param, query: queryValidator } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requireDepartmentFaculty, requireTeachingGroupOwner } = require('../middleware/requireScope');
const validate = require('../middleware/validate');
const { query, withTransaction } = require('../config/db');
const notificationService = require('../services/notificationService');
const auditService = require('../services/auditService');

function generateInviteCode(prefix = '') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = prefix ? prefix.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, 'X') : '';
  while (code.length < 6) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * List Teaching Groups for Teacher (or Admin)
 * GET /api/v1/teaching-groups
 */
router.get('/', auth, async (req, res) => {
  try {
    const statusFilter = req.query.status || 'ACTIVE'; // 'ACTIVE' | 'ARCHIVED' | 'ALL'
    let sql = `
      SELECT tg.id, tg.name, tg.subject_name, tg.component, tg.teacher_id,
             tg.academic_year_id, ay.label as academic_year_label,
             tg.semester, tg.invite_code, tg.status, tg.created_at, tg.archived_at,
             t.full_name as teacher_name, t.department_id as teacher_department_id,
             d.name as department_name, d.code as department_code,
             ar.id as register_id,
             (SELECT COUNT(*) FROM teaching_group_members tgm WHERE tgm.group_id = tg.id AND tgm.status = 'ENROLLED') as member_count
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

    if (statusFilter !== 'ALL') {
      conditions.push('tg.status = ?');
      params.push(statusFilter);
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
  requireRole('TEACHER'),
  [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Group name required (2-100 chars)'),
    body('subject_name').trim().isLength({ min: 2, max: 100 }).withMessage('Subject name required (2-100 chars)'),
    body('component').optional().isIn(['THEORY', 'PRACTICAL']).withMessage('Component must be THEORY or PRACTICAL'),
    body('semester').isInt({ min: 1, max: 8 }).withMessage('Semester must be between 1 and 8'),
    body('academic_year_id').optional().isInt(),
    validate
  ],
  async (req, res) => {
    const { name, subject_name, component = 'THEORY', semester } = req.body;

    try {
      // Resolve active academic year if not provided
      let ayId = req.body.academic_year_id;
      if (!ayId) {
        const currentAY = await query(`SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1`);
        ayId = currentAY[0]?.id || 1;
      }

      // Resolve teacher profile & primary department
      const teacherRows = await query(
        `SELECT id, department_id, full_name FROM teachers WHERE id = ?`,
        [req.user.teacher_id]
      );
      if (!teacherRows || teacherRows.length === 0) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Teacher profile not found' } });
      }
      const teacherDeptId = teacherRows[0].department_id || null;

      // Generate unique invite code
      let inviteCode = generateInviteCode(subject_name);
      let exists = await query(`SELECT id FROM teaching_groups WHERE invite_code = ?`, [inviteCode]);
      while (exists && exists.length > 0) {
        inviteCode = generateInviteCode();
        exists = await query(`SELECT id FROM teaching_groups WHERE invite_code = ?`, [inviteCode]);
      }

      // Execute in transaction: Create Teaching Group + Auto-Create Official Register
      const result = await withTransaction(async (conn) => {
        const groupInsert = await conn.query(
          `INSERT INTO teaching_groups 
            (name, subject_name, component, teacher_id, academic_year_id, semester, invite_code, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP)`,
          [name, subject_name, component, req.user.teacher_id, ayId, semester, inviteCode]
        );
        const groupId = groupInsert.insertId || groupInsert.lastInsertRowid;

        // Auto-create 1:1 Official Attendance Register
        const year = Math.ceil(semester / 2);
        const regInsert = await conn.query(
          `INSERT INTO attendance_registers 
            (teacher_id, name, subject_id, department_id, year, semester, academic_year_id, session_type_scope, is_official, is_active, group_id, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 1, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [req.user.teacher_id, name, teacherDeptId, year, semester, ayId, component, groupId]
        );
        const registerId = regInsert.insertId || regInsert.lastInsertRowid;

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
          [req.user.id, String(groupId), JSON.stringify({ name, subject_name, component, semester, register_id: registerId, invite_code: inviteCode })]
        );

        return { groupId, registerId, inviteCode };
      });

      res.status(201).json({
        success: true,
        message: 'Teaching group created successfully with linked official register',
        data: {
          id: result.groupId,
          name,
          subject_name,
          component,
          semester,
          academic_year_id: ayId,
          invite_code: result.inviteCode,
          register_id: result.registerId,
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

    res.status(200).json({ success: true, data: rows[0] });
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
      } catch (_) {}

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
  requireRole('TEACHER'),
  requireTeachingGroupOwner('id'),
  [
    body('student_ids').isArray({ min: 1 }).withMessage('Array of student_ids required'),
    validate
  ],
  async (req, res) => {
    const groupId = Number(req.params.id);
    const studentIds = req.body.student_ids;

    try {
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
              type: notificationService.NOTIFICATION_TYPES.GROUP_INVITE,
              title: `Enrolled in ${grpName}`,
              message: `You have been added to teaching group "${grpName}".`,
              linkUrl: `/student/groups.html?id=${groupId}`
            });
          }
        }
      } catch (_) {}

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
  requireRole('TEACHER'),
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
      `SELECT tg.id, tg.name, tg.subject_name, tg.component, tg.semester,
              ay.label as academic_year_label, tg.status, tgm.joined_at,
              t.full_name as teacher_name, d.name as department_name, d.code as department_code,
              (SELECT COUNT(*) FROM assessments a WHERE a.group_id = tg.id AND a.type = 'ASSIGNMENT') as assignment_count,
              (SELECT COUNT(*) FROM assessments a WHERE a.group_id = tg.id AND a.type = 'EXAM') as exam_count
       FROM teaching_group_members tgm
       JOIN teaching_groups tg ON tgm.group_id = tg.id
       JOIN teachers t ON tg.teacher_id = t.id
       LEFT JOIN departments d ON t.department_id = d.id
       JOIN academic_years ay ON tg.academic_year_id = ay.id
       WHERE tgm.student_id = ? AND tgm.status = 'ENROLLED'
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
              ur.role as author_role
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
 * Post Announcement to Classroom Stream
 * POST /api/v1/teaching-groups/:id/stream
 */
router.post(
  '/:id/stream',
  auth,
  [
    body('content').trim().isLength({ min: 1, max: 2000 }).withMessage('Post content required (1-2000 chars)'),
    validate
  ],
  async (req, res) => {
    const groupId = Number(req.params.id);
    const { content, attachment_path, attachment_name } = req.body;

    try {
      const result = await query(
        `INSERT INTO classroom_posts (group_id, author_id, content, attachment_path, attachment_name, created_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [groupId, req.user.id, content, attachment_path || null, attachment_name || null]
      );

      res.status(201).json({
        success: true,
        message: 'Announcement posted to classroom stream',
        data: {
          id: result.insertId || result.lastInsertRowid,
          group_id: groupId,
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

module.exports = router;
