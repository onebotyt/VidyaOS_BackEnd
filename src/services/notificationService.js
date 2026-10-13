/**
 * In-App Notification Hub Service
 * Compliant with Section 55 of redesign.md
 */

const { query } = require('../config/db');
const logger = require('../utils/logger');

const NOTIFICATION_TYPES = {
  FACULTY_APPROVAL: 'FACULTY_APPROVAL',
  STUDENT_APPROVAL: 'STUDENT_APPROVAL',
  GROUP_INVITE: 'GROUP_INVITE',
  ASSIGNMENT_POSTED: 'ASSIGNMENT_POSTED',
  ASSIGNMENT_DUE: 'ASSIGNMENT_DUE',
  ASSIGNMENT_GRADED: 'ASSIGNMENT_GRADED',
  TEST_MARKS_PUBLISHED: 'TEST_MARKS_PUBLISHED',
  ATTENDANCE_NOTICE: 'ATTENDANCE_NOTICE',
  ATTENDANCE_WARNING: 'ATTENDANCE_WARNING',
  ADMIN_NOTICE: 'ADMIN_NOTICE'
};

/**
 * Send an in-app notification to a single user
 */
async function sendNotification({
  userId,
  type = NOTIFICATION_TYPES.ADMIN_NOTICE,
  title,
  message,
  linkUrl = null
}) {
  if (!userId || !title || !message) {
    logger.warn('sendNotification missing required fields', { userId, title });
    return null;
  }

  try {
    const res = await query(
      `INSERT INTO notifications (user_id, type, title, message, link_url, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)`,
      [userId, type, title, message, linkUrl]
    );
    const insertId = res?.insertId || res?.[0]?.insertId;
    return insertId;
  } catch (err) {
    logger.error('Failed to send in-app notification', { error: err.message, userId, type });
    return null;
  }
}

/**
 * Send an in-app notification to multiple users simultaneously
 */
async function sendBatchNotification({
  userIds = [],
  type = NOTIFICATION_TYPES.ADMIN_NOTICE,
  title,
  message,
  linkUrl = null
}) {
  if (!Array.isArray(userIds) || userIds.length === 0 || !title || !message) {
    return 0;
  }

  const uniqueUserIds = [...new Set(userIds.filter(id => id != null))];
  if (uniqueUserIds.length === 0) return 0;

  try {
    let count = 0;
    for (const uId of uniqueUserIds) {
      await query(
        `INSERT INTO notifications (user_id, type, title, message, link_url, is_read, created_at)
         VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)`,
        [uId, type, title, message, linkUrl]
      );
      count++;
    }
    return count;
  } catch (err) {
    logger.error('Failed to send batch notifications', { error: err.message, count: uniqueUserIds.length, type });
    return 0;
  }
}

/**
 * Fetch notifications for a user with pagination
 */
async function getUserNotifications(userId, { unreadOnly = false, limit = 20, offset = 0 } = {}) {
  let sql = 'SELECT * FROM notifications WHERE user_id = ?';
  const params = [userId];

  if (unreadOnly) {
    sql += ' AND is_read = 0';
  }

  sql += ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit, 10), parseInt(offset, 10));

  const items = await query(sql, params);

  const unreadCountRes = await query(
    'SELECT COUNT(*) as unread FROM notifications WHERE user_id = ? AND is_read = 0',
    [userId]
  );
  const unreadCount = unreadCountRes[0]?.unread || 0;

  return {
    unreadCount,
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
    data: items.map(item => ({
      ...item,
      is_read: Boolean(item.is_read)
    }))
  };
}

/**
 * Get count of unread notifications for a user
 */
async function getUnreadCount(userId) {
  const res = await query(
    'SELECT COUNT(*) as unread FROM notifications WHERE user_id = ? AND is_read = 0',
    [userId]
  );
  return res[0]?.unread || 0;
}

/**
 * Mark a single notification as read (scoped to the user)
 */
async function markAsRead(notificationId, userId) {
  const res = await query(
    'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
    [notificationId, userId]
  );
  return (res?.affectedRows || res?.[0]?.affectedRows || 0) > 0;
}

/**
 * Mark all notifications as read for a user
 */
async function markAllAsRead(userId) {
  const res = await query(
    'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
    [userId]
  );
  return res?.affectedRows || res?.[0]?.affectedRows || 0;
}

module.exports = {
  NOTIFICATION_TYPES,
  sendNotification,
  sendBatchNotification,
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead
};
