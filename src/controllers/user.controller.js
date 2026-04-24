const bcrypt = require('bcryptjs');
const db = require('../config/database');
const res_ = require('../utils/response');
const { deleteImage } = require('../config/cloudinary');
const { revokeAllUserTokens } = require('../utils/jwt');

exports.getProfile = async (req, res) => {
  try {
    const { rows: [user] } = await db.query(
      'SELECT id, full_name, email, phone, phone_country_code, user_type, avatar_url, bio, language, theme, currency, notification_push, notification_email, notification_in_app, email_verified, two_factor_enabled, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    return res_.success(res, { user });
  } catch (err) {
    return res_.error(res, 'Failed to fetch profile');
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { full_name, phone, phone_country_code, bio, language, theme, currency } = req.body;
    const { rows: [user] } = await db.query(
      `UPDATE users SET full_name=$1, phone=$2, phone_country_code=$3, bio=$4, language=$5, theme=$6, currency=$7
       WHERE id=$8 RETURNING id, full_name, email, phone, bio, language, theme, currency`,
      [full_name, phone, phone_country_code, bio, language, theme, currency, req.user.id]
    );
    return res_.success(res, { user }, 'Profile updated');
  } catch (err) {
    return res_.error(res, 'Profile update failed');
  }
};

exports.updateAvatar = async (req, res) => {
  try {
    if (!req.file) return res_.error(res, 'No image uploaded', 400);

    // Delete old avatar
    const { rows: [old] } = await db.query('SELECT avatar_public_id FROM users WHERE id=$1', [req.user.id]);
    if (old?.avatar_public_id) await deleteImage(old.avatar_public_id).catch(() => {});

    const { rows: [user] } = await db.query(
      'UPDATE users SET avatar_url=$1, avatar_public_id=$2 WHERE id=$3 RETURNING id, avatar_url',
      [req.file.path, req.file.filename, req.user.id]
    );
    return res_.success(res, { user }, 'Avatar updated');
  } catch (err) {
    return res_.error(res, 'Avatar update failed');
  }
};

exports.updateNotificationPrefs = async (req, res) => {
  try {
    const { notification_push, notification_email, notification_in_app } = req.body;
    const { rows: [user] } = await db.query(
      'UPDATE users SET notification_push=$1, notification_email=$2, notification_in_app=$3 WHERE id=$4 RETURNING id',
      [notification_push, notification_email, notification_in_app, req.user.id]
    );
    return res_.success(res, {}, 'Notification preferences updated');
  } catch (err) {
    return res_.error(res, 'Update failed');
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const { rows: [user] } = await db.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res_.error(res, 'Current password is incorrect', 400);

    const hash = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);
    return res_.success(res, {}, 'Password changed successfully');
  } catch (err) {
    return res_.error(res, 'Password change failed');
  }
};

exports.deleteAccount = async (req, res) => {
  try {
    const { password } = req.body;
    const { rows: [user] } = await db.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res_.error(res, 'Password incorrect', 400);

    await revokeAllUserTokens(req.user.id);
    await db.query('UPDATE users SET is_active=FALSE WHERE id=$1', [req.user.id]);
    return res_.success(res, {}, 'Account deleted');
  } catch (err) {
    return res_.error(res, 'Account deletion failed');
  }
};

exports.getActiveSessions = async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, device_info, ip_address, created_at FROM refresh_tokens WHERE user_id=$1 AND revoked=FALSE AND expires_at>NOW() ORDER BY created_at DESC',
      [req.user.id]
    );
    return res_.success(res, { sessions: rows });
  } catch (err) {
    return res_.error(res, 'Failed to fetch sessions');
  }
};

exports.revokeSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    await db.query('UPDATE refresh_tokens SET revoked=TRUE WHERE id=$1 AND user_id=$2', [sessionId, req.user.id]);
    return res_.success(res, {}, 'Session revoked');
  } catch (err) {
    return res_.error(res, 'Failed to revoke session');
  }
};