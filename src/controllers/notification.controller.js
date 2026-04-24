const res_ = require('../utils/response');
const notif = require('../services/notification.service');
const db    = require('../config/database');

exports.getNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const { notifications, total } = await notif.getUserNotifications(req.user.id, page, limit);
    const unread = await notif.getUnreadCount(req.user.id);
    return res_.paginate(res, notifications, total, page, limit, 'Notifications fetched');
  } catch (err) {
    return res_.error(res, 'Failed to fetch notifications');
  }
};

exports.markRead = async (req, res) => {
  try {
    const { ids } = req.body;
    await notif.markAsRead(req.user.id, ids || null);
    return res_.success(res, {}, 'Marked as read');
  } catch (err) {
    return res_.error(res, 'Failed to mark as read');
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const count = await notif.getUnreadCount(req.user.id);
    return res_.success(res, { count });
  } catch (err) {
    return res_.error(res, 'Failed to fetch count');
  }
};

exports.registerPushToken = async (req, res) => {
  try {
    const { token, platform } = req.body;
    await db.query(
      'INSERT INTO push_tokens (user_id, token, platform) VALUES ($1,$2,$3) ON CONFLICT (token) DO NOTHING',
      [req.user.id, token, platform]
    );
    return res_.success(res, {}, 'Push token registered');
  } catch (err) {
    return res_.error(res, 'Failed to register token');
  }
};