/**
 * Bug Report Controller — Handles bug reports submission, querying, review, and resolution
 */

const path = require('path');
const fs = require('fs');
const bugReportModel = require('../models/bugReportModel');
const notificationService = require('../services/notificationService');
const { query } = require('../config/db');
const logger = require('../utils/logger');

const VALID_CATEGORIES = [
  'Login / Authentication Problem',
  'Registration Problem',
  'Dashboard Error',
  'Student Management Error',
  'Faculty Management Error',
  'Attendance Error',
  'Assignment / Notes Error',
  'File Upload / Download Problem',
  'Page Not Loading',
  'Button / Functionality Not Working',
  'UI / Design Problem',
  'Other Technical Issue'
];

const VALID_STATUSES = ['New', 'Under Review', 'In Progress', 'Resolved', 'Rejected'];

class BugReportController {
  /**
   * Submit a new bug report (Students & Faculty)
   * POST /api/v1/bug-reports
   */
  async submitBugReport(req, res) {
    try {
      const { issue_title, issue_category, description } = req.body;

      // 1. Validate mandatory fields
      if (!issue_title || !issue_title.trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Issue Title is mandatory.' }
        });
      }

      if (!issue_category || !VALID_CATEGORIES.includes(issue_category.trim())) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_CATEGORY',
            message: `Issue Category is invalid. Must be one of: ${VALID_CATEGORIES.join(', ')}`
          }
        });
      }

      if (!description || !description.trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Problem Description is mandatory.' }
        });
      }

      // 2. Validate mandatory screenshot
      const files = req.files || {};
      const screenshotFile = (files.screenshot && files.screenshot[0]) || null;
      const recordingFile = (files.recording && files.recording[0]) || null;

      if (!screenshotFile) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_SCREENSHOT', message: 'At least one screenshot is mandatory.' }
        });
      }

      // Validate screenshot file type
      const shotExt = path.extname(screenshotFile.originalname).toLowerCase();
      if (!['.png', '.jpg', '.jpeg'].includes(shotExt)) {
        try { fs.unlinkSync(screenshotFile.path); } catch (_) {}
        if (recordingFile) { try { fs.unlinkSync(recordingFile.path); } catch (_) {} }
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_FILE_TYPE', message: 'Screenshot must be a PNG, JPG, or JPEG file.' }
        });
      }

      // Validate optional screen recording file type
      if (recordingFile) {
        const recExt = path.extname(recordingFile.originalname).toLowerCase();
        if (!['.mp4', '.webm'].includes(recExt)) {
          try { fs.unlinkSync(screenshotFile.path); } catch (_) {}
          try { fs.unlinkSync(recordingFile.path); } catch (_) {}
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_FILE_TYPE', message: 'Screen recording must be an MP4 or WebM video file.' }
          });
        }
      }

      // 3. Resolve user details
      const user = req.user;
      const userId = user.id;
      const userName = user.full_name || user.name || user.username || 'User';
      const userRole = (user.roles || []).includes('STUDENT') ? 'STUDENT' : 'FACULTY';
      const userEmail = user.email || null;

      let departmentId = user.department_id || null;
      let departmentName = user.department_name || null;

      if (!departmentId && user.student_id) {
        const enrollRows = await query(
          `SELECT e.department_id, d.name as department_name
           FROM enrollments e
           JOIN departments d ON e.department_id = d.id
           WHERE e.student_id = ?
           ORDER BY e.id DESC LIMIT 1`,
          [user.student_id]
        );
        if (enrollRows && enrollRows.length > 0) {
          departmentId = enrollRows[0].department_id;
          departmentName = enrollRows[0].department_name;
        }
      } else if (!departmentId && user.teacher_id) {
        const tRows = await query(
          `SELECT t.department_id, d.name as department_name
           FROM teachers t
           JOIN departments d ON t.department_id = d.id
           WHERE t.id = ? LIMIT 1`,
          [user.teacher_id]
        );
        if (tRows && tRows.length > 0) {
          departmentId = tRows[0].department_id;
          departmentName = tRows[0].department_name;
        }
      }

      if (departmentId && !departmentName) {
        const dRows = await query('SELECT name FROM departments WHERE id = ?', [departmentId]);
        if (dRows && dRows.length > 0) {
          departmentName = dRows[0].name;
        }
      }

      const screenshotUrl = `/uploads/bug-reports/${screenshotFile.filename}`;
      const recordingUrl = recordingFile ? `/uploads/bug-reports/${recordingFile.filename}` : null;

      // 4. Save to database
      const report = await bugReportModel.create({
        userId,
        userName,
        userRole,
        userEmail,
        departmentId,
        departmentName,
        issueTitle: issue_title.trim(),
        issueCategory: issue_category.trim(),
        description: description.trim(),
        screenshotUrl,
        screenshotFilename: screenshotFile.originalname,
        recordingUrl,
        recordingFilename: recordingFile ? recordingFile.originalname : null
      });

      // 5. Send In-App Notification to Admins
      try {
        const adminUsers = await query(
          `SELECT DISTINCT u.id 
           FROM users u 
           JOIN user_roles ur ON u.id = ur.user_id 
           WHERE ur.role IN ('ADMIN', 'SYSTEM_ADMIN') AND u.status = 'ACTIVE'`
        );
        const adminIds = (adminUsers || []).map(a => a.id);
        if (adminIds.length > 0) {
          await notificationService.sendBatchNotification({
            userIds: adminIds,
            type: 'BUG_REPORT',
            title: `New Bug Report [${report.report_id}]`,
            message: `${userName} (${userRole}) reported: "${report.issue_title.substring(0, 50)}${report.issue_title.length > 50 ? '...' : ''}"`,
            linkUrl: `/admin/bug-reports/index.html?report_id=${report.report_id}`
          });
        }
      } catch (notifErr) {
        logger.warn(`Failed to notify admins of bug report: ${notifErr.message}`);
      }

      return res.status(201).json({
        success: true,
        message: 'Bug report submitted successfully.',
        data: report
      });
    } catch (err) {
      logger.error('Error submitting bug report', { error: err.message, stack: err.stack });
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to submit bug report. ' + err.message }
      });
    }
  }

  /**
   * Get all reports submitted by the logged-in user
   * GET /api/v1/bug-reports/my
   */
  async getMyBugReports(req, res) {
    try {
      const reports = await bugReportModel.getByUser(req.user.id);
      return res.json({
        success: true,
        data: reports
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message }
      });
    }
  }

  /**
   * Get single report details for the logged-in user
   * GET /api/v1/bug-reports/my/:id
   */
  async getMyBugReportById(req, res) {
    try {
      const report = await bugReportModel.getById(req.params.id, req.user.id, false);
      if (!report) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Bug report not found or access denied.' }
        });
      }
      return res.json({
        success: true,
        data: report
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message }
      });
    }
  }

  /**
   * Admin: List all reports with search, filters, pagination
   * GET /api/v1/bug-reports/admin/all
   */
  async adminGetAllReports(req, res) {
    try {
      const {
        search,
        role,
        category,
        status,
        date_from,
        date_to,
        page,
        limit
      } = req.query;

      const result = await bugReportModel.getAll({
        search,
        role,
        category,
        status,
        dateFrom: date_from,
        dateTo: date_to,
        page,
        limit
      });

      return res.json({
        success: true,
        ...result
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message }
      });
    }
  }

  /**
   * Admin: Get summary statistics for dashboard cards
   * GET /api/v1/bug-reports/admin/statistics
   */
  async adminGetStatistics(req, res) {
    try {
      const stats = await bugReportModel.getStatistics();
      return res.json({
        success: true,
        data: stats
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message }
      });
    }
  }

  /**
   * Admin: Get full report details
   * GET /api/v1/bug-reports/admin/:id
   */
  async adminGetReportById(req, res) {
    try {
      const report = await bugReportModel.getById(req.params.id, null, true);
      if (!report) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Bug report not found.' }
        });
      }
      return res.json({
        success: true,
        data: report
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message }
      });
    }
  }

  /**
   * Admin: Update report status, add admin response or rejection reason
   * PUT /api/v1/bug-reports/admin/:id/status
   */
  async adminUpdateStatus(req, res) {
    try {
      const { status, admin_response, rejection_reason } = req.body;

      if (!status || !VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_STATUS', message: `Status must be one of: ${VALID_STATUSES.join(', ')}` }
        });
      }

      // Mandatory rejection reason if rejected
      if (status === 'Rejected' && (!rejection_reason || !rejection_reason.trim())) {
        return res.status(400).json({
          success: false,
          error: { code: 'REJECTION_REASON_REQUIRED', message: 'Rejection reason is mandatory when rejecting a report.' }
        });
      }

      const existing = await bugReportModel.getById(req.params.id, null, true);
      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Bug report not found.' }
        });
      }

      const updated = await bugReportModel.updateStatus(req.params.id, {
        status,
        adminResponse: admin_response,
        rejectionReason: rejection_reason
      });

      // Notify the submitter of status change
      try {
        let notifTitle = `Bug Report [${updated.report_id}] Updated`;
        let notifMessage = `Your report "${updated.issue_title}" is now: ${status}.`;

        if (status === 'Under Review') {
          notifTitle = `Bug Report Under Review [${updated.report_id}]`;
          notifMessage = `Your bug report "${updated.issue_title}" is currently under review by the administration.`;
        } else if (status === 'In Progress') {
          notifTitle = `Bug Report In Progress [${updated.report_id}]`;
          notifMessage = `The technical team is actively working on resolving "${updated.issue_title}".`;
        } else if (status === 'Resolved') {
          notifTitle = `Bug Report Resolved [${updated.report_id}]`;
          notifMessage = admin_response && admin_response.trim()
            ? `Your bug report "${updated.issue_title}" has been resolved! Note: ${admin_response.trim()}`
            : `Your bug report "${updated.issue_title}" has been successfully resolved.`;
        } else if (status === 'Rejected') {
          notifTitle = `Bug Report Rejected [${updated.report_id}]`;
          notifMessage = `Your bug report "${updated.issue_title}" was rejected. Reason: ${rejection_reason.trim()}`;
        }

        const portalPath = updated.user_role === 'STUDENT' ? '/student' : '/faculty';
        const linkUrl = `${portalPath}/bug-reports/index.html?report_id=${updated.report_id}`;

        await notificationService.sendNotification({
          userId: updated.user_id,
          type: 'BUG_REPORT',
          title: notifTitle,
          message: notifMessage,
          linkUrl
        });
      } catch (notifErr) {
        logger.warn(`Failed to send status update notification: ${notifErr.message}`);
      }

      return res.json({
        success: true,
        message: 'Bug report status updated successfully.',
        data: updated
      });
    } catch (err) {
      logger.error('Error updating bug report status', { error: err.message });
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message }
      });
    }
  }
}

module.exports = new BugReportController();

