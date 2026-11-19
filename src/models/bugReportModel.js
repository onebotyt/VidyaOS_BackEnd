/**
 * Bug Report Model — Data access layer for VidyaOS Website Bug Reporting & Technical Complaints
 */

const { query } = require('../config/db');

class BugReportModel {
  /**
   * Generates a unique sequential human-readable report ID (e.g. BR-101, BR-102).
   */
  async generateReportId() {
    try {
      const rows = await query('SELECT MAX(id) as maxId FROM bug_reports');
      const maxId = rows[0]?.maxId || 0;
      let candidateNum = 100 + Number(maxId) + 1;
      let candidateId = `BR-${candidateNum}`;

      // Guarantee collision safety
      let exists = await query('SELECT id FROM bug_reports WHERE report_id = ? LIMIT 1', [candidateId]);
      while (exists && exists.length > 0) {
        candidateNum++;
        candidateId = `BR-${candidateNum}`;
        exists = await query('SELECT id FROM bug_reports WHERE report_id = ? LIMIT 1', [candidateId]);
      }
      return candidateId;
    } catch (err) {
      // Fallback in case of DB read error
      const rnd = Math.floor(1000 + Math.random() * 9000);
      return `BR-${rnd}`;
    }
  }

  /**
   * Creates a new bug report.
   */
  async create({
    reportId,
    userId,
    userName,
    userRole,
    userEmail,
    departmentId,
    departmentName,
    issueTitle,
    issueCategory,
    description,
    screenshotUrl,
    screenshotFilename,
    recordingUrl,
    recordingFilename
  }) {
    const finalReportId = reportId || await this.generateReportId();

    const res = await query(
      `INSERT INTO bug_reports (
        report_id, user_id, user_name, user_role, user_email,
        department_id, department_name, issue_title, issue_category,
        description, screenshot_url, screenshot_filename,
        recording_url, recording_filename, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        finalReportId,
        userId,
        userName,
        userRole,
        userEmail || null,
        departmentId || null,
        departmentName || null,
        issueTitle,
        issueCategory,
        description,
        screenshotUrl,
        screenshotFilename,
        recordingUrl || null,
        recordingFilename || null
      ]
    );

    const insertId = res?.insertId || res?.[0]?.insertId;
    return this.getById(finalReportId, null, true);
  }

  /**
   * Retrieves all reports submitted by a specific user.
   */
  async getByUser(userId) {
    const rows = await query(
      `SELECT * FROM bug_reports
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC`,
      [userId]
    );
    return rows || [];
  }

  /**
   * Retrieves a single report by ID or report_id with optional user permission guard.
   */
  async getById(idOrReportId, userId = null, isAdmin = false) {
    const isReportCode = typeof idOrReportId === 'string' && idOrReportId.startsWith('BR-');
    let sql = isReportCode
      ? 'SELECT * FROM bug_reports WHERE report_id = ?'
      : 'SELECT * FROM bug_reports WHERE id = ?';
    const params = [idOrReportId];

    if (!isAdmin && userId) {
      sql += ' AND user_id = ?';
      params.push(userId);
    }

    const rows = await query(sql, params);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  /**
   * Admin: Retrieves all reports with searching, filtering, and pagination.
   */
  async getAll({
    search = '',
    role = '',
    category = '',
    status = '',
    dateFrom = '',
    dateTo = '',
    page = 1,
    limit = 20
  } = {}) {
    let whereClauses = [];
    let params = [];

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      whereClauses.push('(report_id LIKE ? OR user_name LIKE ? OR issue_title LIKE ?)');
      params.push(term, term, term);
    }

    if (role && role.trim()) {
      whereClauses.push('user_role = ?');
      params.push(role.trim().toUpperCase());
    }

    if (category && category.trim()) {
      whereClauses.push('issue_category = ?');
      params.push(category.trim());
    }

    if (status && status.trim()) {
      whereClauses.push('status = ?');
      params.push(status.trim());
    }

    if (dateFrom && dateFrom.trim()) {
      whereClauses.push('created_at >= ?');
      params.push(`${dateFrom.trim()} 00:00:00`);
    }

    if (dateTo && dateTo.trim()) {
      whereClauses.push('created_at <= ?');
      params.push(`${dateTo.trim()} 23:59:59`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Count total records matching filters
    const countRows = await query(`SELECT COUNT(*) as total FROM bug_reports ${whereSql}`, params);
    const total = countRows[0]?.total || 0;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    // Fetch paginated data
    const listParams = [...params, limitNum, offset];
    const reports = await query(
      `SELECT * FROM bug_reports
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      listParams
    );

    return {
      reports: reports || [],
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1
    };
  }

  /**
   * Retrieves summary statistics for the Admin dashboard cards.
   */
  async getStatistics() {
    const rows = await query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'New' THEN 1 END) as new_count,
        COUNT(CASE WHEN status = 'Under Review' THEN 1 END) as under_review,
        COUNT(CASE WHEN status = 'In Progress' THEN 1 END) as in_progress,
        COUNT(CASE WHEN status = 'Resolved' THEN 1 END) as resolved,
        COUNT(CASE WHEN status = 'Rejected' THEN 1 END) as rejected
      FROM bug_reports
    `);

    const stats = rows[0] || {};
    return {
      total: Number(stats.total) || 0,
      new: Number(stats.new_count) || 0,
      under_review: Number(stats.under_review) || 0,
      in_progress: Number(stats.in_progress) || 0,
      resolved: Number(stats.resolved) || 0,
      rejected: Number(stats.rejected) || 0
    };
  }

  /**
   * Admin: Updates status, admin response, and rejection reason of a bug report.
   */
  async updateStatus(idOrReportId, { status, adminResponse, rejectionReason }) {
    const isReportCode = typeof idOrReportId === 'string' && idOrReportId.startsWith('BR-');
    const idField = isReportCode ? 'report_id' : 'id';

    let updates = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
    let params = [status];

    if (adminResponse !== undefined) {
      updates.push('admin_response = ?');
      params.push(adminResponse ? adminResponse.trim() : null);
    }

    if (rejectionReason !== undefined) {
      updates.push('rejection_reason = ?');
      params.push(rejectionReason ? rejectionReason.trim() : null);
    }

    if (status === 'Resolved') {
      updates.push('resolved_at = CURRENT_TIMESTAMP');
    }

    params.push(idOrReportId);

    await query(
      `UPDATE bug_reports
       SET ${updates.join(', ')}
       WHERE ${idField} = ?`,
      params
    );

    return this.getById(idOrReportId, null, true);
  }
}

module.exports = new BugReportModel();
