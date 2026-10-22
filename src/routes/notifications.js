/**
 * Notifications REST API Routes (/api/v1/notifications/*)
 * Delegates request processing to NotificationController.
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const notificationController = require('../controllers/notificationController');

// All notification endpoints require authenticated user
router.use(auth);

// @route   GET /api/v1/notifications
// @desc    Fetch paginated notifications for current user
// @handler NotificationController.getNotifications -> NotificationService.getUserNotifications()
router.get('/', (req, res) => notificationController.getNotifications(req, res));

// @route   GET /api/v1/notifications/unread-count
// @desc    Fetch unread badge count for current user
// @handler NotificationController.getUnreadCount -> NotificationService.getUnreadCount()
router.get('/unread-count', (req, res) => notificationController.getUnreadCount(req, res));

// @route   PUT /api/v1/notifications/:id/read
// @desc    Mark individual notification as read
// @handler NotificationController.markAsRead -> NotificationService.markAsRead()
router.put('/:id/read', (req, res) => notificationController.markAsRead(req, res));

// @route   PUT /api/v1/notifications/mark-all-read
// @desc    Mark all unread notifications as read
// @handler NotificationController.markAllAsRead -> NotificationService.markAllAsRead()
router.put('/mark-all-read', (req, res) => notificationController.markAllAsRead(req, res));

module.exports = router;
