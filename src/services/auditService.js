/**
 * Institutional Audit Logging Service
 * Compliant with Section 54 of redesign.md
 */

const { query } = require('../config/db');
const logger = require('../utils/logger');

const AUDIT_EVENTS = {
  FACULTY_APPROVED: 'FACULTY_APPROVED',
  FACULTY_REJECTED: 'FACULTY_REJECTED',
  HOD_ASSIGNED: 'HOD_ASSIGNED',
  HOD_REMOVED: 'HOD_REMOVED',
  HOD_REPLACED: 'HOD_REPLACED',
  COMMON_MANAGER_ASSIGNED: 'COMMON_MANAGER_ASSIGNED',
  STUDENT_APPROVED: 'STUDENT_APPROVED',
  STUDENT_REJECTED: 'STUDENT_REJECTED',
  TEACHING_GROUP_CREATED: 'TEACHING_GROUP_CREATED',
  TEACHING_GROUP_ARCHIVED: 'TEACHING_GROUP_ARCHIVED',
  TEACHING_GROUP_RESTORED: 'TEACHING_GROUP_RESTORED',
  BIOMETRIC_ENROLLED: 'BIOMETRIC_ENROLLED',
  BIOMETRIC_UPDATED: 'BIOMETRIC_UPDATED',
  BIOMETRIC_REMOVED: 'BIOMETRIC_REMOVED',
  DEVICE_REGISTERED: 'DEVICE_REGISTERED',
  DEVICE_DISABLED: 'DEVICE_DISABLED',
  ESP_SYNC_EXECUTED: 'ESP_SYNC_EXECUTED',
  ATTENDANCE_FINALIZED: 'ATTENDANCE_FINALIZED',
  ATTENDANCE_CORRECTED: 'ATTENDANCE_CORRECTED',
  ASSIGNMENT_GRADED: 'ASSIGNMENT_GRADED',
  TEST_MARK_UPDATED: 'TEST_MARK_UPDATED',
  STUDENT_PROMOTION_EXECUTED: 'STUDENT_PROMOTION_EXECUTED',
  STUDENT_DEMOTION_EXECUTED: 'STUDENT_DEMOTION_EXECUTED',
  PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
  OTP_DISPATCHED: 'OTP_DISPATCHED',
  OTP_VERIFIED: 'OTP_VERIFIED',
  PARENT_ALERT_DISPATCHED: 'PARENT_ALERT_DISPATCHED'
};

/**
 * Record an audit log entry
 * @param {Object} entry
 * @param {string} [entry.eventType] - One of AUDIT_EVENTS or string
 * @param {string} [entry.action] - Alias for eventType
 * @param {number} [entry.actorId] - User ID performing the action
 * @param {string} [entry.actorRole] - Role of the actor (ADMIN, HOD, TEACHER, etc.)
 * @param {string} [entry.targetType] - Entity affected (teachers, students, teaching_groups, etc.)
 * @param {string|number} [entry.targetId] - ID of affected entity
 * @param {Object|string} [entry.details] - Arbitrary metadata or diff
 * @param {string} [entry.ipAddress] - Client IP address
 */
async function logAudit({
  eventType,
  action = null,
  actorId = null,
  actorRole = null,
  targetType = null,
  targetId = null,
  details = null,
  ipAddress = null
}) {
  try {
    const finalEventType = eventType || action;
    const detailsJson = typeof details === 'object' && details !== null ? JSON.stringify(details) : (details ? String(details) : null);
    const targetIdStr = targetId != null ? String(targetId) : null;

    await query(
      `INSERT INTO audit_logs (
        event_type, action,
        actor_id, user_id,
        actor_role,
        target_type, entity_type,
        target_id, entity_id,
        details_json, ip_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        finalEventType, finalEventType,
        actorId, actorId,
        actorRole,
        targetType, targetType,
        targetIdStr, targetIdStr,
        detailsJson, ipAddress
      ]
    );

    logger.info(`[AUDIT] ${eventType}`, {
      actorId,
      actorRole,
      targetType,
      targetId: targetIdStr
    });
  } catch (err) {
    // Non-blocking: audit log failures should never crash primary operations
    logger.error('Failed to write audit log', { error: err.message, eventType });
  }
}

/**
 * Query audit logs with rich filtering & pagination
 */
async function getAuditLogs({
  limit = 50,
  offset = 0,
  eventType = null,
  actorId = null,
  targetType = null,
  startDate = null,
  endDate = null,
  search = null
} = {}) {
  let whereClauses = ['1=1'];
  const params = [];

  if (eventType) {
    whereClauses.push('(al.event_type = ? OR al.action = ?)');
    params.push(eventType, eventType);
  }

  if (actorId) {
    whereClauses.push('(al.actor_id = ? OR al.user_id = ?)');
    params.push(actorId, actorId);
  }

  if (targetType) {
    whereClauses.push('(al.target_type = ? OR al.entity_type = ?)');
    params.push(targetType, targetType);
  }

  if (startDate) {
    whereClauses.push('al.created_at >= ?');
    params.push(startDate);
  }

  if (endDate) {
    whereClauses.push('al.created_at <= ?');
    params.push(endDate);
  }

  if (search) {
    whereClauses.push('(al.details_json LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR al.actor_role LIKE ?)');
    const searchWildcard = `%${search}%`;
    params.push(searchWildcard, searchWildcard, searchWildcard, searchWildcard);
  }

  const whereSql = whereClauses.join(' AND ');

  const countQuery = `
    SELECT COUNT(*) as total
    FROM audit_logs al
    LEFT JOIN users u ON (al.actor_id = u.id OR al.user_id = u.id)
    WHERE ${whereSql}
  `;
  const countRes = await query(countQuery, params);
  const total = countRes[0]?.total || 0;

  const dataQuery = `
    SELECT
      al.id,
      COALESCE(al.event_type, al.action) as event_type,
      COALESCE(al.actor_id, al.user_id) as actor_id,
      al.actor_role,
      COALESCE(al.target_type, al.entity_type) as target_type,
      COALESCE(al.target_id, al.entity_id) as target_id,
      al.details_json,
      al.ip_address,
      al.created_at,
      u.username as actor_username,
      u.email as actor_email
    FROM audit_logs al
    LEFT JOIN users u ON (al.actor_id = u.id OR al.user_id = u.id)
    WHERE ${whereSql}
    ORDER BY al.created_at DESC, al.id DESC
    LIMIT ? OFFSET ?
  `;

  const rows = await query(dataQuery, [...params, parseInt(limit, 10), parseInt(offset, 10)]);

  return {
    total,
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
    data: rows.map(r => {
      let details = null;
      if (r.details_json) {
        try {
          details = JSON.parse(r.details_json);
        } catch (_) {
          details = r.details_json;
        }
      }
      return {
        ...r,
        details
      };
    })
  };
}

module.exports = {
  AUDIT_EVENTS,
  logAudit,
  log: logAudit,
  getAuditLogs
};
