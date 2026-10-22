/**
 * Notification Controller — HTTP request/response handlers for notifications.
 */

const notificationService = require('../services/notificationService');
const logger = require('../utils/logger');

class NotificationController {
  /**
   * Retrieves paginated notifications for current authenticated user.
   * 
   * @route GET /api/v1/notifications (routes/notifications.js)
   * @access Protected (All Authenticated Users)
   * @usesService NotificationService.getUserNotifications() (services/notificationService.js)
   */
  async getNotifications(req, res) {
    try {
      const { unreadOnly, limit = 20, offset = 0 } = req.query;
      const isUnreadOnly = unreadOnly === 'true' || unreadOnly === '1';

      const result = await notificationService.getUserNotifications(req.user.id, {
        unreadOnly: isUnreadOnly,
        limit: parseInt(limit, 10) || 20,
        offset: parseInt(offset, 10) || 0
      });

      return res.json({
        success: true,
        data: result.data,
        unreadCount: result.unreadCount,
        limit: result.limit,
        offset: result.offset
      });
    } catch (err) {
      logger.error('[NotificationController] getNotifications error:', { error: err.message });
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }

  /**
   * Retrieves unread notification count for active user header badge.
   * 
   * @route GET /api/v1/notifications/unread-count (routes/notifications.js)
   * @access Protected (All Authenticated Users)
   * @usesService NotificationService.getUnreadCount() (services/notificationService.js)
   */
  async getUnreadCount(req, res) {
    try {
      const unreadCount = await notificationService.getUnreadCount(req.user.id);
      return res.json({
        success: true,
        data: { unreadCount }
      });
    } catch (err) {
      logger.error('[NotificationController] getUnreadCount error:', { error: err.message });
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }

  /**
   * Marks a specific notification as read.
   * 
   * @route PUT /api/v1/notifications/:id/read (routes/notifications.js)
   * @access Protected (All Authenticated Users)
   * @usesService NotificationService.markAsRead() (services/notificationService.js)
   */
  async markAsRead(req, res) {
    try {
      const notificationId = parseInt(req.params.id, 10);
      const updated = await notificationService.markAsRead(notificationId, req.user.id);

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Notification not found or access denied' }
        });
      }

      const unreadCount = await notificationService.getUnreadCount(req.user.id);
      return res.json({
        success: true,
        message: 'Notification marked as read',
        unreadCount
      });
    } catch (err) {
      logger.error('[NotificationController] markAsRead error:', { error: err.message });
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }

  /**
   * Marks all notifications as read for current user.
   * 
   * @route PUT /api/v1/notifications/mark-all-read (routes/notifications.js)
   * @access Protected (All Authenticated Users)
   * @usesService NotificationService.markAllAsRead() (services/notificationService.js)
   */
  async markAllAsRead(req, res) {
    try {
      const count = await notificationService.markAllAsRead(req.user.id);
      return res.json({
        success: true,
        message: `Marked ${count} notifications as read`,
        unreadCount: 0
      });
    } catch (err) {
      logger.error('[NotificationController] markAllAsRead error:', { error: err.message });
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message: err.message }
      });
    }
  }
}

module.exports = new NotificationController();
