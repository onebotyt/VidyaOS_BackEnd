/**
 * Notifications REST API Routes (/api/v1/notifications/*)
 * Compliant with Section 55 of redesign.md
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const notificationService = require('../services/notificationService');

// All notification endpoints require authenticated user
router.use(auth);

/**
 * GET /api/v1/notifications
 * Fetch paginated notifications for current user
 */
router.get('/', async (req, res) => {
  try {
    const { unreadOnly, limit = 20, offset = 0 } = req.query;
    const isUnreadOnly = unreadOnly === 'true' || unreadOnly === '1';

    const result = await notificationService.getUserNotifications(req.user.id, {
      unreadOnly: isUnreadOnly,
      limit: parseInt(limit, 10) || 20,
      offset: parseInt(offset, 10) || 0
    });

    res.json({
      success: true,
      data: result.data,
      unreadCount: result.unreadCount,
      limit: result.limit,
      offset: result.offset
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: err.message }
    });
  }
});

/**
 * GET /api/v1/notifications/unread-count
 * Quick poll endpoint for unread badge count
 */
router.get('/unread-count', async (req, res) => {
  try {
    const unreadCount = await notificationService.getUnreadCount(req.user.id);
    res.json({
      success: true,
      data: { unreadCount }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: err.message }
    });
  }
});

/**
 * PUT /api/v1/notifications/:id/read
 * Mark a single notification as read
 */
router.put('/:id/read', async (req, res) => {
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
    res.json({
      success: true,
      message: 'Notification marked as read',
      unreadCount
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: err.message }
    });
  }
});

/**
 * PUT /api/v1/notifications/mark-all-read
 * Mark all notifications as read for current user
 */
router.put('/mark-all-read', async (req, res) => {
  try {
    const count = await notificationService.markAllAsRead(req.user.id);
    res.json({
      success: true,
      message: `${count} notifications marked as read`,
      unreadCount: 0
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: err.message }
    });
  }
});

module.exports = router;
