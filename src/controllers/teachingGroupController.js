/**
 * Teaching Group Controller
 * Coordinates HTTP request processing, validations, service calls, and responses for teaching groups.
 *
 * Architecture Role: Controller (HTTP Coordination Layer)
 * Interacts With:
 *   - Models: models/teachingGroupModel.js
 *   - Routes: routes/teachingGroups.js
 *   - Services: services/notificationService.js, services/auditService.js, services/excelExportService.js
 */

const path = require('path');
const fs = require('fs');
const TeachingGroupModel = require('../models/teachingGroupModel');
const notificationService = require('../services/notificationService');
const auditService = require('../services/auditService');
const excelExportService = require('../services/excelExportService');
const { query } = require('../config/db');

function generateInviteCode(prefix = '') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = prefix ? prefix.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, 'X') : '';
  while (code.length < 6) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

class TeachingGroupController {
  /**
   * Retrieves teacher dashboard overview data (classes, recent due work, attendance rates).
   * @route GET /api/v1/teaching-groups/overview (routes/teachingGroups.js)
   * @access Authenticated
   * @usesModel TeachingGroupModel.getOverviewData() (models/teachingGroupModel.js)
   */
  static async getOverview(req, res) {
    try {
      const data = await TeachingGroupModel.getOverviewData(req.user.teacher_id);
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  }

  /**
   * Lists teaching groups accessible to the user (filtered by ACTIVE, ARCHIVED, or TRASH).
   * @route GET /api/v1/teaching-groups (routes/teachingGroups.js)
   * @access Authenticated
   * @usesModel TeachingGroupModel.listGroups() (models/teachingGroupModel.js)
   */
  static async listGroups(req, res) {
    try {
      const statusFilter = req.query.status || 'ACTIVE';
      const groups = await TeachingGroupModel.listGroups({
        user: req.user,
        statusFilter
      });
      res.status(200).json({ success: true, data: groups });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Creates a new teaching group, automatically provisioning an official attendance register.
   * @route POST /api/v1/teaching-groups (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel TeachingGroupModel.getCurrentAcademicYearId() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.resolveTeacher() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.checkInviteCode() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.createGroupTransaction() (models/teachingGroupModel.js)
   */
  static async createGroup(req, res) {
    const { name, subject_name, subject_code, component = 'THEORY', semester, enrollment_mode = 'INVITE_CODE', department_id, total_units } = req.body;
    try {
      let ayId = req.body.academic_year_id;
      if (!ayId) {
        ayId = await TeachingGroupModel.getCurrentAcademicYearId();
      }

      const teacher = await TeachingGroupModel.resolveTeacher(req.user);
      if (!teacher) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Teacher profile not found' } });
      }

      let inviteCode = generateInviteCode(subject_name);
      let exists = await TeachingGroupModel.checkInviteCode(inviteCode);
      while (exists) {
        inviteCode = generateInviteCode();
        exists = await TeachingGroupModel.checkInviteCode(inviteCode);
      }

      const targetDeptId = department_id ? Number(department_id) : (teacher.department_id || null);
      const finalName = (name && name.trim()) ? name.trim() : subject_name.trim();
      const finalUnits = Math.min(20, Math.max(1, parseInt(total_units) || 5));

      const result = await TeachingGroupModel.createGroupTransaction({
        name: finalName,
        subjectName: subject_name,
        subjectCode: subject_code,
        component,
        effTeacherId: teacher.id,
        ayId,
        semester,
        inviteCode,
        targetDeptId,
        enrollmentMode: enrollment_mode,
        userId: req.user.id,
        totalUnits: finalUnits
      });

      res.status(201).json({
        success: true,
        message: 'Teaching group created successfully with linked official register',
        data: {
          id: result.groupId,
          name: finalName,
          subject_name,
          subject_code: result.subjectCode,
          component,
          total_units: finalUnits,
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

  /**
   * Retrieves detailed profile and roster for a specific teaching group.
   * @route GET /api/v1/teaching-groups/:id (routes/teachingGroups.js)
   * @access Authenticated
   * @usesModel TeachingGroupModel.getGroupById() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.getGroupMembers() (models/teachingGroupModel.js)
   */
  static async getGroupDetails(req, res) {
    try {
      const groupId = Number(req.params.id);
      const group = await TeachingGroupModel.getGroupById(groupId);
      if (!group) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teaching group not found' } });
      }

      group.linked_register_id = group.register_id;
      group.members = await TeachingGroupModel.getGroupMembers(groupId);

      if (group.syllabus_units) {
        if (typeof group.syllabus_units === 'string') {
          try { group.syllabus_units = JSON.parse(group.syllabus_units); } catch (_) { group.syllabus_units = []; }
        }
      } else {
        const totalUnits = parseInt(group.total_units) || 5;
        group.syllabus_units = Array.from({ length: totalUnits }, (_, i) => ({
          num: i + 1,
          name: `Unit ${i + 1}`,
          title: '',
          description: ''
        }));
      }

      res.status(200).json({ success: true, data: group });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Allows student to join a teaching group via 6-character alphanumeric invite code.
   * @route POST /api/v1/teaching-groups/join (routes/teachingGroups.js)
   * @access STUDENT
   * @usesModel TeachingGroupModel.findGroupByInviteCode() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.checkMembership() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.addMember() (models/teachingGroupModel.js)
   * @usesService notificationService.sendNotification() (services/notificationService.js)
   */
  static async joinGroup(req, res) {
    const code = req.body.invite_code.toUpperCase();
    try {
      const group = await TeachingGroupModel.findGroupByInviteCode(code);
      if (!group) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invalid invite code or group not found' } });
      }

      if (group.status !== 'ACTIVE') {
        return res.status(400).json({ success: false, error: { code: 'GROUP_ARCHIVED', message: 'This teaching group is archived and no longer accepting joins' } });
      }

      const isMember = await TeachingGroupModel.checkMembership(group.id, req.user.student_id);
      if (isMember) {
        return res.status(200).json({
          success: true,
          message: 'You are already enrolled in this Teaching Group',
          data: group
        });
      }

      await TeachingGroupModel.addMember(group.id, req.user.student_id);

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

  /**
   * Retrieves enrolled student members for a teaching group.
   * @route GET /api/v1/teaching-groups/:id/members (routes/teachingGroups.js)
   * @access Authenticated
   * @usesModel TeachingGroupModel.getGroupMembers() (models/teachingGroupModel.js)
   */
  static async getMembers(req, res) {
    try {
      const groupId = Number(req.params.id);
      const members = await TeachingGroupModel.getGroupMembers(groupId);
      res.status(200).json({ success: true, data: members });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Adds one or more students to a teaching group by IDs or official enrollment number.
   * @route POST /api/v1/teaching-groups/:id/members (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN, requireTeachingGroupOwner('id')
   * @usesModel TeachingGroupModel.findStudentIdByEnrollment() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.addMember() (models/teachingGroupModel.js)
   */
  static async addMembers(req, res) {
    const groupId = Number(req.params.id);
    let studentIds = req.body.student_ids;

    try {
      if (!studentIds && req.body.official_enrollment_no) {
        const eno = req.body.official_enrollment_no.trim();
        const foundId = await TeachingGroupModel.findStudentIdByEnrollment(eno);
        if (!foundId) {
          return res.status(404).json({ success: false, error: { code: 'STUDENT_NOT_FOUND', message: `Student with enrollment "${eno}" not found in database` } });
        }
        studentIds = [foundId];
      }

      if (!Array.isArray(studentIds) || studentIds.length === 0) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Valid student_ids array or official_enrollment_no required' } });
      }

      let added = 0;
      for (const sid of studentIds) {
        const studentId = Number(sid);
        if (!studentId) continue;
        await TeachingGroupModel.addMember(groupId, studentId);
        added++;
      }

      res.status(200).json({
        success: true,
        message: `Added ${added} student(s) to Teaching Group`,
        data: { added_count: added }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Removes a student member from a teaching group.
   * @route DELETE /api/v1/teaching-groups/:id/members/:studentId (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN, requireTeachingGroupOwner('id')
   * @usesModel TeachingGroupModel.removeMember() (models/teachingGroupModel.js)
   */
  static async removeMember(req, res) {
    const groupId = Number(req.params.id);
    const studentId = Number(req.params.studentId);
    try {
      await TeachingGroupModel.removeMember(groupId, studentId);
      res.status(200).json({ success: true, message: 'Student removed from teaching group' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves all teaching groups the authenticated student is currently enrolled in.
   * @route GET /api/v1/teaching-groups/student/my-groups (routes/teachingGroups.js)
   * @access STUDENT
   * @usesModel TeachingGroupModel.getStudentEnrolledGroups() (models/teachingGroupModel.js)
   */
  static async getStudentGroups(req, res) {
    try {
      const groups = await TeachingGroupModel.getStudentEnrolledGroups(req.user.student_id);
      res.status(200).json({ success: true, data: groups });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves stream announcements for a classroom.
   * @route GET /api/v1/teaching-groups/:id/stream (routes/teachingGroups.js)
   * @access Authenticated
   * @usesModel TeachingGroupModel.getStreamPosts() (models/teachingGroupModel.js)
   */
  static async getStreamPosts(req, res) {
    try {
      const groupId = Number(req.params.id);
      const posts = await TeachingGroupModel.getStreamPosts(groupId);
      res.status(200).json({ success: true, data: posts });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Publishes an announcement or file attachment to the classroom stream.
   * @route POST /api/v1/teaching-groups/:id/stream (routes/teachingGroups.js)
   * @access Authenticated
   * @usesModel TeachingGroupModel.createStreamPost() (models/teachingGroupModel.js)
   */
  static async createStreamPost(req, res) {
    const groupId = Number(req.params.id);
    const content = req.body.content;
    let attachmentPath = req.body.attachment_path || null;
    let attachmentName = req.body.attachment_name || null;

    if (req.file) {
      attachmentPath = `/uploads/stream/${req.file.filename}`;
      attachmentName = req.file.originalname;
    }

    try {
      const insertId = await TeachingGroupModel.createStreamPost(groupId, req.user.id, content, attachmentPath, attachmentName);
      res.status(201).json({
        success: true,
        message: 'Announcement posted to classroom stream',
        data: {
          id: insertId,
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

  /**
   * Deletes an announcement post from the classroom stream.
   * @route DELETE /api/v1/teaching-groups/:id/stream/:postId (routes/teachingGroups.js)
   * @access Authenticated
   * @usesModel TeachingGroupModel.deleteStreamPost() (models/teachingGroupModel.js)
   */
  static async deleteStreamPost(req, res) {
    try {
      const groupId = Number(req.params.id);
      const postId = Number(req.params.postId);
      await TeachingGroupModel.deleteStreamPost(groupId, postId);
      res.status(200).json({ success: true, message: 'Announcement deleted successfully' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Archives a teaching group and deactivates its linked attendance register.
   * @route POST /api/v1/teaching-groups/:id/archive (routes/teachingGroups.js)
   * @access Authenticated (Owner, Admin, HOD)
   * @usesModel TeachingGroupModel.getGroupById() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.setArchiveStatus() (models/teachingGroupModel.js)
   * @usesService auditService.logAudit() (services/auditService.js)
   */
  static async archiveGroup(req, res) {
    try {
      const groupId = Number(req.params.id);
      const group = await TeachingGroupModel.getGroupById(groupId);
      if (!group) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teaching group not found' } });
      }

      const isOwner = req.user.teacher_id && req.user.teacher_id === group.teacher_id;
      const isAdmin = req.user.roles && req.user.roles.includes('SYSTEM_ADMIN');
      if (!isOwner && !isAdmin && !req.user.is_hod) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Unauthorized to archive this teaching group' } });
      }

      if (group.status === 'ARCHIVED') {
        return res.status(400).json({ success: false, error: { code: 'ALREADY_ARCHIVED', message: 'Teaching group is already archived' } });
      }

      await TeachingGroupModel.setArchiveStatus(groupId, true);

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
  }

  /**
   * Restores an archived teaching group back to active status.
   * @route POST /api/v1/teaching-groups/:id/unarchive (routes/teachingGroups.js)
   * @access Authenticated (Owner, Admin, HOD)
   * @usesModel TeachingGroupModel.getGroupById() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.setArchiveStatus() (models/teachingGroupModel.js)
   * @usesService auditService.logAudit() (services/auditService.js)
   */
  static async unarchiveGroup(req, res) {
    try {
      const groupId = Number(req.params.id);
      const group = await TeachingGroupModel.getGroupById(groupId);
      if (!group) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teaching group not found' } });
      }

      const isOwner = req.user.teacher_id && req.user.teacher_id === group.teacher_id;
      const isAdmin = req.user.roles && req.user.roles.includes('SYSTEM_ADMIN');
      if (!isOwner && !isAdmin && !req.user.is_hod) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Unauthorized to unarchive this teaching group' } });
      }

      await TeachingGroupModel.setArchiveStatus(groupId, false);

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
  }

  /**
   * Updates title, subject, or component of a teaching group.
   * @route PUT /api/v1/teaching-groups/:id (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel TeachingGroupModel.getGroupById() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.updateGroup() (models/teachingGroupModel.js)
   */
  static async editGroup(req, res) {
    try {
      const groupId = Number(req.params.id);
      const g = await TeachingGroupModel.getGroupById(groupId);
      if (!g) return res.status(404).json({ success: false, error: { message: 'Teaching group not found' } });

      const isOwner = req.user.teacher_id && req.user.teacher_id === g.teacher_id;
      const isAdmin = req.user.roles && req.user.roles.includes('SYSTEM_ADMIN');
      if (!isOwner && !isAdmin && !req.user.is_hod) {
        return res.status(403).json({ success: false, error: { message: 'Forbidden' } });
      }

      const { name = g.name, subject_name = g.subject_name, subject_code = g.subject_code, component = g.component, total_units = g.total_units, syllabus_units } = req.body;
      const finalName = (name && name.trim()) ? name.trim() : (subject_name ? subject_name.trim() : g.name);
      const finalUnits = total_units != null ? Math.min(20, Math.max(1, parseInt(total_units) || 5)) : (g.total_units || 5);
      await TeachingGroupModel.updateGroup(groupId, { name: finalName, subject_name, subject_code, component, total_units: finalUnits, syllabus_units });

      res.status(200).json({
        success: true,
        message: 'Class updated successfully',
        data: { id: groupId, name: finalName, subject_name, subject_code, component, total_units: finalUnits }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  }

  /**
   * Adds or updates a syllabus unit for a teaching group.
   * @route POST /api/v1/teaching-groups/:id/units (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN
   */
  static async saveUnit(req, res) {
    try {
      const groupId = Number(req.params.id);
      const g = await TeachingGroupModel.getGroupById(groupId);
      if (!g) return res.status(404).json({ success: false, error: { message: 'Teaching group not found' } });

      const isOwner = req.user.teacher_id && req.user.teacher_id === g.teacher_id;
      const isAdmin = req.user.roles && req.user.roles.includes('SYSTEM_ADMIN');
      if (!isOwner && !isAdmin && !req.user.is_hod) {
        return res.status(403).json({ success: false, error: { message: 'Forbidden' } });
      }

      let units = [];
      if (g.syllabus_units) {
        try { units = typeof g.syllabus_units === 'string' ? JSON.parse(g.syllabus_units) : g.syllabus_units; } catch (_) { units = []; }
      }
      if (!Array.isArray(units)) units = [];

      const totalUnits = parseInt(g.total_units) || 5;
      if (units.length === 0) {
        for (let i = 1; i <= totalUnits; i++) {
          units.push({ num: i, name: `Unit ${i}`, title: '', description: '' });
        }
      }

      const { num, name, title = '', description = '', action = 'save' } = req.body;

      if (action === 'delete') {
        units = units.filter(u => u.num !== Number(num) && u.name !== name);
      } else {
        // Find existing or add new
        let targetIdx = units.findIndex(u => (num && u.num === Number(num)) || (name && u.name.toLowerCase() === name.toLowerCase()));
        if (targetIdx >= 0) {
          units[targetIdx].title = title ? title.trim() : '';
          if (description !== undefined) units[targetIdx].description = description.trim();
          if (name) units[targetIdx].name = name.trim();
        } else {
          // Add new unit
          const newNum = Number(num) || (units.length ? Math.max(...units.map(u => u.num || 0)) + 1 : 1);
          const newName = name ? name.trim() : `Unit ${newNum}`;
          units.push({
            num: newNum,
            name: newName,
            title: title ? title.trim() : '',
            description: description ? description.trim() : ''
          });
        }
      }

      units.sort((a, b) => (a.num || 0) - (b.num || 0));
      const newTotalUnits = Math.max(totalUnits, units.length);
      await TeachingGroupModel.updateGroupSyllabusUnits(groupId, units, newTotalUnits);

      res.status(200).json({
        success: true,
        message: 'Unit saved successfully',
        data: { syllabus_units: units, total_units: newTotalUnits }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  }

  /**
   * Soft-deletes a teaching group to trash with a 7-day recovery grace period.
   * @route POST /api/v1/teaching-groups/:id/trash (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel TeachingGroupModel.getGroupById() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.setTrashStatus() (models/teachingGroupModel.js)
   * @usesService auditService.logAudit() (services/auditService.js)
   */
  static async trashGroup(req, res) {
    try {
      const groupId = Number(req.params.id);
      const g = await TeachingGroupModel.getGroupById(groupId);
      if (!g) return res.status(404).json({ success: false, error: { message: 'Teaching group not found' } });

      const isOwner = req.user.teacher_id && req.user.teacher_id === g.teacher_id;
      const isAdmin = req.user.roles && req.user.roles.includes('SYSTEM_ADMIN');
      if (!isOwner && !isAdmin && !req.user.is_hod) {
        return res.status(403).json({ success: false, error: { message: 'Forbidden' } });
      }

      await TeachingGroupModel.setTrashStatus(groupId, true);

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
  }

  /**
   * Restores a soft-deleted teaching group from the trash bin.
   * @route POST /api/v1/teaching-groups/:id/restore (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel TeachingGroupModel.getGroupById() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.setTrashStatus() (models/teachingGroupModel.js)
   * @usesService auditService.logAudit() (services/auditService.js)
   */
  static async restoreGroup(req, res) {
    try {
      const groupId = Number(req.params.id);
      const g = await TeachingGroupModel.getGroupById(groupId);
      if (!g) return res.status(404).json({ success: false, error: { message: 'Teaching group not found' } });

      const isOwner = req.user.teacher_id && req.user.teacher_id === g.teacher_id;
      const isAdmin = req.user.roles && req.user.roles.includes('SYSTEM_ADMIN');
      if (!isOwner && !isAdmin && !req.user.is_hod) {
        return res.status(403).json({ success: false, error: { message: 'Forbidden' } });
      }

      await TeachingGroupModel.setTrashStatus(groupId, false);

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
  }

  /**
   * Permanently deletes teaching group while safely detaching official register records.
   * @route DELETE /api/v1/teaching-groups/:id/permanent (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel TeachingGroupModel.getGroupById() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.permanentDeleteGroupTransaction() (models/teachingGroupModel.js)
   */
  static async permanentDelete(req, res) {
    try {
      const groupId = Number(req.params.id);
      const g = await TeachingGroupModel.getGroupById(groupId);
      if (!g) return res.status(404).json({ success: false, error: { message: 'Teaching group not found' } });

      await TeachingGroupModel.permanentDeleteGroupTransaction(groupId);

      res.status(200).json({ success: true, message: 'Class permanently deleted (historical student attendance preserved in academic vault).' });
    } catch (err) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  }

  /**
   * Searches cohort students not yet enrolled in the group.
   * @route GET /api/v1/teaching-groups/:id/unenrolled-students (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel TeachingGroupModel.getGroupById() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.getUnenrolledStudents() (models/teachingGroupModel.js)
   */
  static async getUnenrolledStudents(req, res) {
    try {
      const groupId = Number(req.params.id);
      const group = await TeachingGroupModel.getGroupById(groupId);
      if (!group) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teaching group not found' } });
      }

      const search = req.query.search ? `%${req.query.search.trim()}%` : null;
      const departmentId = req.query.department_id ? Number(req.query.department_id) : null;
      const targetDeptId = departmentId || group.teacher_department_id || null;

      const students = await TeachingGroupModel.getUnenrolledStudents(groupId, group, targetDeptId, search);
      res.status(200).json({ success: true, data: students });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Promotes student cohort to the next semester group, archiving the current group.
   * @route POST /api/v1/teaching-groups/:id/promote (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN, requireTeachingGroupOwner('id')
   * @usesModel TeachingGroupModel.getGroupById() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.getCurrentAcademicYearId() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.checkInviteCode() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.promoteCohortTransaction() (models/teachingGroupModel.js)
   */
  static async promoteCohort(req, res) {
    const oldGroupId = Number(req.params.id);
    const { new_name, new_semester, student_ids = [] } = req.body;

    try {
      const oldGroup = await TeachingGroupModel.getGroupById(oldGroupId);
      if (!oldGroup) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teaching group not found' } });
      }

      const currentAY = await TeachingGroupModel.getCurrentAcademicYearId();
      const ayId = req.body.academic_year_id || currentAY;
      const deptId = oldGroup.teacher_department_id || null;

      let inviteCode = generateInviteCode(oldGroup.subject_name);
      let exists = await TeachingGroupModel.checkInviteCode(inviteCode);
      while (exists) {
        inviteCode = generateInviteCode();
        exists = await TeachingGroupModel.checkInviteCode(inviteCode);
      }

      const result = await TeachingGroupModel.promoteCohortTransaction({
        oldGroupId,
        oldGroup,
        newName: new_name,
        newSemester: new_semester,
        studentIds: student_ids,
        ayId,
        deptId,
        inviteCode,
        userId: req.user.id
      });

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

  /**
   * Broadcasts a notice announcement across multiple teaching groups belonging to a faculty.
   * @route POST /api/v1/teaching-groups/broadcast-notice (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel TeachingGroupModel.getMatchingGroupsForBroadcast() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.createStreamPost() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.getDistinctEnrolledStudents() (models/teachingGroupModel.js)
   * @usesService notificationService.sendNotification() (services/notificationService.js)
   */
  static async broadcastNotice(req, res) {
    const { title, content, target_semester, target_year, department_id } = req.body;
    try {
      const groups = await TeachingGroupModel.getMatchingGroupsForBroadcast(req.user.teacher_id, target_semester, target_year, department_id);
      if (!groups || groups.length === 0) {
        return res.status(404).json({ success: false, error: { code: 'NO_MATCHING_GROUPS', message: 'No active teaching groups match the selected cohort criteria' } });
      }

      const formattedContent = `📢 **${title}**\n\n${content}`;
      const groupIds = groups.map(g => g.id);

      for (const gid of groupIds) {
        await TeachingGroupModel.createStreamPost(gid, req.user.id, formattedContent, null, null);
      }

      const students = await TeachingGroupModel.getDistinctEnrolledStudents(groupIds);

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
          } catch (_) {}
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

  /**
   * Retrieves comments on a stream post.
   * @route GET /api/v1/teaching-groups/posts/:postId/comments (routes/teachingGroups.js)
   * @access Authenticated
   * @usesModel TeachingGroupModel.getPostComments() (models/teachingGroupModel.js)
   */
  static async getPostComments(req, res) {
    try {
      const postId = Number(req.params.postId);
      const comments = await TeachingGroupModel.getPostComments(postId);
      res.status(200).json({ success: true, data: comments });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Adds a comment to a stream post.
   * @route POST /api/v1/teaching-groups/posts/:postId/comments (routes/teachingGroups.js)
   * @access Authenticated
   * @usesModel TeachingGroupModel.createPostComment() (models/teachingGroupModel.js)
   */
  static async createPostComment(req, res) {
    const postId = Number(req.params.postId);
    const { content } = req.body;
    try {
      const insertId = await TeachingGroupModel.createPostComment(postId, req.user.id, content);
      res.status(201).json({
        success: true,
        message: 'Comment posted successfully',
        data: {
          id: insertId,
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

  /**
   * Retrieves coursework assignments and practical items for a teaching group.
   * @route GET /api/v1/teaching-groups/:id/assignments (routes/teachingGroups.js)
   * @access Authenticated
   * @usesModel TeachingGroupModel.getGroupAssignments() (models/teachingGroupModel.js)
   */
  static async getAssignments(req, res) {
    try {
      const groupId = Number(req.params.id);
      const user = req.user || {};
      const isStudent = user.role === 'STUDENT' || (Array.isArray(user.roles) && user.roles.includes('STUDENT'));
      const studentId = isStudent ? user.student_id : null;

      const rows = await TeachingGroupModel.getGroupAssignments(groupId, studentId);
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
          questions: qList,
          my_submission: studentId ? {
            id: r.my_submission_id || null,
            status: r.my_status || 'NOT_SUBMITTED',
            is_submitted: Boolean(r.my_submission_id && r.my_status !== 'ABSENT'),
            submitted_at: r.my_submitted_at || null,
            marks_obtained: r.my_marks_obtained !== undefined ? r.my_marks_obtained : null,
            file_path: r.my_file_path || null,
            original_filename: r.my_original_filename || null,
            feedback: r.my_feedback || null
          } : null
        };
      });
      res.status(200).json({ success: true, data: formatted });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Publishes a new assignment, practical, or final documents requirement.
   * @route POST /api/v1/teaching-groups/:id/assignments (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel TeachingGroupModel.getGroupById() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.createGroupAssessment() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.getGroupMembers() (models/teachingGroupModel.js)
   */
  static async createAssignment(req, res) {
    try {
      const groupId = Number(req.params.id);
      const { title, description, due_date, max_marks, type = 'ASSIGNMENT', questions, unit_name, unit } = req.body;

      const g = await TeachingGroupModel.getGroupById(groupId);
      if (!g) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teaching group not found' } });

      let qJson = null;
      if (questions) {
        qJson = typeof questions === 'string' ? questions : JSON.stringify(questions);
      }

      const effectiveMaxMarks = max_marks !== undefined && max_marks !== null && max_marks !== ''
        ? Number(max_marks)
        : (type === 'FINAL_DOCS' ? 100 : (type === 'PRACTICAL' ? 25 : 100));

      const effectiveUnit = (unit_name || unit || '').trim() || null;

      const insertId = await TeachingGroupModel.createGroupAssessment({
        teacherId: g.teacher_id,
        groupId,
        semester: g.semester,
        academicYearId: g.academic_year_id,
        type,
        title,
        description,
        dueDate: due_date,
        effectiveMaxMarks,
        questionsJson: qJson,
        departmentId: g.teacher_department_id,
        unitName: effectiveUnit
      });

      res.status(201).json({
        success: true,
        message: `${type === 'PRACTICAL' ? 'Practical announcement' : type === 'FINAL_DOCS' ? 'Final documents request' : 'Assignment'} published successfully`,
        data: { id: insertId, questions: questions || null, unit_name: effectiveUnit }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Updates an existing coursework item.
   * @route PUT /api/v1/teaching-groups/:id/assignments/:assignmentId (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel TeachingGroupModel.updateGroupAssessment() (models/teachingGroupModel.js)
   */
  static async editAssignment(req, res) {
    try {
      const groupId = Number(req.params.id);
      const assignmentId = Number(req.params.assignmentId);
      const { title, description, due_date, max_marks, questions, unit_name, unit } = req.body;

      let qJson = questions !== undefined ? (questions ? (typeof questions === 'string' ? questions : JSON.stringify(questions)) : null) : null;
      const effectiveUnit = unit_name !== undefined ? (unit_name ? unit_name.trim() : null) : (unit !== undefined ? (unit ? unit.trim() : null) : undefined);

      await TeachingGroupModel.updateGroupAssessment(assignmentId, groupId, {
        title: title ? title.trim() : 'Assignment',
        description: description ? description.trim() : null,
        dueDate: due_date || null,
        maxMarks: max_marks !== undefined ? Number(max_marks) : 100,
        questionsJson: qJson,
        unitName: effectiveUnit
      });

      res.status(200).json({ success: true, message: 'Classwork item updated successfully' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves student submissions roster for a specific coursework item.
   * @route GET /api/v1/teaching-groups/:id/assignments/:assignmentId/submissions (routes/teachingGroups.js)
   * @access Authenticated
   * @usesModel TeachingGroupModel.getAssessmentSubmissionsRoster() (models/teachingGroupModel.js)
   */
  static async getAssignmentSubmissions(req, res) {
    try {
      const groupId = Number(req.params.id);
      const assignmentId = Number(req.params.assignmentId);

      const roster = await TeachingGroupModel.getAssessmentSubmissionsRoster(assignmentId, groupId);
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
      res.status(200).json({
        success: true,
        data: {
          assignment_id: assignmentId,
          total_students: formatted.length,
          submitted_count: submittedCount,
          not_submitted_count: formatted.length - submittedCount,
          roster: formatted
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Saves student marks and feedback for an assignment or coursework item.
   * @route POST /api/v1/teaching-groups/:id/assignments/:assignmentId/scores (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel TeachingGroupModel.saveAssignmentScoresTransaction() (models/teachingGroupModel.js)
   */
  static async saveAssignmentScores(req, res) {
    try {
      const groupId = Number(req.params.id);
      const assignmentId = Number(req.params.assignmentId);
      const { scores } = req.body;

      if (!Array.isArray(scores)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'scores array is required' } });
      }

      await TeachingGroupModel.saveAssignmentScoresTransaction(assignmentId, groupId, scores, req.user.id);
      res.status(200).json({ success: true, message: 'Assignment marks saved successfully' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Deletes a coursework assignment and its associated student submissions.
   * @route DELETE /api/v1/teaching-groups/:id/assignments/:assignmentId (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel TeachingGroupModel.deleteAssessmentSubmissions() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.deleteAssessment() (models/teachingGroupModel.js)
   */
  static async deleteAssignment(req, res) {
    try {
      const groupId = Number(req.params.id);
      const assignmentId = Number(req.params.assignmentId);
      await TeachingGroupModel.deleteAssessmentSubmissions(assignmentId);
      await TeachingGroupModel.deleteAssessment(assignmentId, groupId);
      res.status(200).json({ success: true, message: 'Classwork item deleted successfully' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves list of scheduled class tests and pass statistics for a teaching group.
   * @route GET /api/v1/teaching-groups/:id/tests (routes/teachingGroups.js)
   * @access Authenticated
   * @usesModel TeachingGroupModel.getGroupTests() (models/teachingGroupModel.js)
   */
  static async getTests(req, res) {
    try {
      const groupId = Number(req.params.id);
      const rows = await TeachingGroupModel.getGroupTests(groupId);
      const user = req.user || {};
      const isStudent = user.role === 'STUDENT' || (Array.isArray(user.roles) && user.roles.includes('STUDENT'));
      const studentId = user.student_id;

      const formatted = await Promise.all(rows.map(async r => {
        let qList = null;
        if (r.questions) {
          try { qList = typeof r.questions === 'string' ? JSON.parse(r.questions) : r.questions; } catch {}
        }
        let instList = null;
        if (r.instructions) {
          try { instList = typeof r.instructions === 'string' ? JSON.parse(r.instructions) : r.instructions; } catch {}
        }

        // Student Visibility Rule:
        // Student only sees test is scheduled with Title, Date, and Max Marks; CANNOT see questions until teacher gives marks to student.
        let studentScore = null;
        let isEvaluated = false;
        if (isStudent) {
          if (studentId) {
            const scores = await TeachingGroupModel.getTestScores(r.id);
            studentScore = scores.find(s => s.student_id === studentId);
            isEvaluated = Boolean(studentScore && (studentScore.marks_obtained !== null || studentScore.is_absent));
          }
          if (!isEvaluated) {
            // Questions hidden until marks are entered
            qList = null;
            instList = null;
          }
        }

        return {
          ...r,
          questions: qList,
          instructions: isStudent && !isEvaluated ? null : instList,
          num_questions: isStudent && !isEvaluated ? null : (Array.isArray(qList) ? qList.length : null),
          student_marks: studentScore ? studentScore.marks_obtained : null,
          student_is_absent: studentScore ? Boolean(studentScore.is_absent) : false,
          is_evaluated: isEvaluated
        };
      }));
      res.status(200).json({ success: true, data: formatted });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Schedules a new class test / unit exam with question distributions.
   * @route POST /api/v1/teaching-groups/:id/tests (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel TeachingGroupModel.getGroupById() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.createGroupAssessment() (models/teachingGroupModel.js)
   */
  static async scheduleTest(req, res) {
    try {
      const groupId = Number(req.params.id);
      const { name, test_date, max_marks = 20, description, num_questions, questions, unit_name, unit } = req.body;

      const g = await TeachingGroupModel.getGroupById(groupId);
      if (!g) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teaching group not found' } });

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

      const effectiveUnit = (unit_name || unit || '').trim() || null;

      const questionsJson = questionsPayload ? JSON.stringify(questionsPayload) : null;
      const insertId = await TeachingGroupModel.createGroupAssessment({
        teacherId: g.teacher_id,
        groupId,
        semester: g.semester,
        academicYearId: g.academic_year_id,
        type: 'EXAM',
        title: name,
        description,
        dueDate: test_date,
        effectiveMaxMarks: max_marks,
        questionsJson,
        departmentId: g.teacher_department_id,
        unitName: effectiveUnit
      });

      res.status(201).json({
        success: true,
        message: 'Class test scheduled successfully',
        data: {
          id: insertId,
          questions: questionsPayload,
          num_questions: questionsPayload ? questionsPayload.length : null,
          unit_name: effectiveUnit
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Updates test date, max marks, questions, and instructions for a class test.
   * @route PUT /api/v1/teaching-groups/:id/tests/:testId (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel TeachingGroupModel.updateGroupTest() (models/teachingGroupModel.js)
   */
  static async editTest(req, res) {
    try {
      const groupId = Number(req.params.id);
      const testId = Number(req.params.testId);
      const { name, test_date, max_marks, description, questions, instructions, unit_name, unit } = req.body;

      let qJson = questions !== undefined ? (questions ? (typeof questions === 'string' ? questions : JSON.stringify(questions)) : null) : null;
      let instJson = instructions !== undefined ? (instructions ? (typeof instructions === 'string' ? instructions : JSON.stringify(instructions)) : null) : null;
      const effectiveUnit = unit_name !== undefined ? (unit_name ? unit_name.trim() : null) : (unit !== undefined ? (unit ? unit.trim() : null) : undefined);

      await TeachingGroupModel.updateGroupTest(testId, groupId, {
        name: name || null,
        description: description || null,
        testDate: test_date || null,
        maxMarks: (max_marks !== undefined && max_marks !== null) ? Number(max_marks) : null,
        questionsJson: qJson,
        instructionsJson: instJson,
        unitName: effectiveUnit
      });

      res.status(200).json({ success: true, message: 'Class test updated successfully' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Deletes a class test and its student scores roster.
   * @route DELETE /api/v1/teaching-groups/:id/tests/:testId (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel TeachingGroupModel.deleteAssessmentSubmissions() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.deleteAssessment() (models/teachingGroupModel.js)
   */
  static async deleteTest(req, res) {
    try {
      const groupId = Number(req.params.id);
      const testId = Number(req.params.testId);
      await TeachingGroupModel.deleteAssessmentSubmissions(testId);
      await TeachingGroupModel.deleteAssessment(testId, groupId);
      res.status(200).json({ success: true, message: 'Test deleted successfully' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieves recorded test scores for a class test.
   * @route GET /api/v1/teaching-groups/:id/tests/:testId/scores (routes/teachingGroups.js)
   * @access Authenticated
   * @usesModel TeachingGroupModel.getTestScores() (models/teachingGroupModel.js)
   */
  static async getTestScores(req, res) {
    try {
      const testId = Number(req.params.testId);
      const groupId = Number(req.params.id);
      const scores = await TeachingGroupModel.getTestScores(testId);

      // Check if digital register has an updated attendance session for this group on the test date
      const testRow = (await query('SELECT id, due_date, group_id, max_marks FROM assessments WHERE id = ?', [testId]))[0];
      const absentStudentIds = new Set();
      let registerDateChecked = null;
      let sessionFound = false;

      if (testRow && testRow.due_date) {
        registerDateChecked = String(testRow.due_date).slice(0, 10);
        const attRows = await query(`
          SELECT ra.student_id, ra.attendance_status
          FROM register_attendance ra
          JOIN attendance_sessions s ON s.id = ra.session_id
          JOIN attendance_registers ar ON ar.id = s.register_id
          WHERE (ar.group_id = ? OR ar.teacher_id = (SELECT tg.teacher_id FROM teaching_groups tg WHERE tg.id = ?))
            AND s.session_date = ?
            AND s.state != 'DRAFT'
        `, [groupId, groupId, registerDateChecked]);

        if (attRows && attRows.length > 0) {
          sessionFound = true;
          attRows.forEach(row => {
            if (row.attendance_status === 'ABSENT') {
              absentStudentIds.add(row.student_id);
            }
          });
        }
      }

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
          } catch {}
        }

        const isRegAbsent = absentStudentIds.has(s.student_id);
        const isAbsent = Boolean(s.is_absent) || (isRegAbsent && (s.marks_obtained === null || s.marks_obtained === undefined || s.marks_obtained === 0));

        return {
          student_id: s.student_id,
          marks_obtained: isAbsent ? 0 : s.marks_obtained,
          is_absent: isAbsent,
          register_absent: isRegAbsent,
          remarks: rem,
          question_scores: isAbsent ? (question_scores ? question_scores.map(() => 0) : null) : question_scores,
          questions,
          status: isAbsent ? 'ABSENT' : s.status
        };
      });

      // Include enrolled group members who don't have an assessment submission row yet
      const members = await TeachingGroupModel.getGroupMembers(groupId);
      const existingIds = new Set(cleaned.map(c => c.student_id));
      for (const m of members) {
        if (!existingIds.has(m.student_id)) {
          const isRegAbsent = absentStudentIds.has(m.student_id);
          cleaned.push({
            student_id: m.student_id,
            marks_obtained: isRegAbsent ? 0 : null,
            is_absent: isRegAbsent,
            register_absent: isRegAbsent,
            remarks: null,
            question_scores: null,
            questions: null,
            status: isRegAbsent ? 'ABSENT' : null
          });
        }
      }

      res.status(200).json({ 
        success: true, 
        data: cleaned,
        meta: {
          attendance_session_found: sessionFound,
          test_date: registerDateChecked,
          absent_from_register_count: absentStudentIds.size
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Saves student marks and question breakdowns for a class test.
   * @route POST /api/v1/teaching-groups/:id/tests/:testId/scores (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel TeachingGroupModel.saveTestScoresTransaction() (models/teachingGroupModel.js)
   */
  static async saveTestScores(req, res) {
    try {
      const groupId = Number(req.params.id);
      const testId = Number(req.params.testId);
      const { scores, questions, instructions } = req.body;

      await TeachingGroupModel.saveTestScoresTransaction(testId, groupId, scores, questions, instructions, req.user.id);
      res.status(200).json({ success: true, message: 'Marks saved successfully' });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Exports test scores marksheet in Excel, PDF, or Word format.
   * @route ALL /api/v1/teaching-groups/:id/tests/:testId/export/:format (routes/teachingGroups.js)
   * @access TEACHER, SYSTEM_ADMIN
   * @usesModel TeachingGroupModel.getTestExportMetadata() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.getInstitutionName() (models/teachingGroupModel.js)
   * @usesModel TeachingGroupModel.getTestRosterScores() (models/teachingGroupModel.js)
   * @usesService excelExportService.generateClassTestExcel() (services/excelExportService.js)
   * @usesService excelExportService.generateClassTestPdf() (services/excelExportService.js)
   * @usesService excelExportService.generateClassTestDoc() (services/excelExportService.js)
   */
  static async exportTest(req, res) {
    try {
      const groupId = Number(req.params.id);
      const testId = Number(req.params.testId);
      const format = (req.params.format || 'excel').toLowerCase();

      const t = await TeachingGroupModel.getTestExportMetadata(testId, groupId);
      if (!t) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Class test not found' } });
      }

      const instName = await TeachingGroupModel.getInstitutionName();
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
        const studRows = await TeachingGroupModel.getTestRosterScores(testId, groupId);
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
  }

  /**
   * Automatically archives teaching groups belonging to closed/expired academic sessions.
   * @route POST /api/v1/teaching-groups/auto-archive-expired (routes/teachingGroups.js)
   * @access Authenticated
   * @usesModel TeachingGroupModel.autoArchiveExpiredGroups() (models/teachingGroupModel.js)
   */
  static async autoArchiveExpired(req, res) {
    try {
      const archivedCount = await TeachingGroupModel.autoArchiveExpiredGroups();
      res.status(200).json({
        success: true,
        message: `Archived ${archivedCount} teaching group(s) from expired academic session(s).`,
        data: { archived_count: archivedCount }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = TeachingGroupController;
