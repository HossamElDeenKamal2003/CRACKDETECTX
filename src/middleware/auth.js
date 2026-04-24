const { verifyAccessToken } = require('../utils/jwt');
const { error } = require('../utils/response');
const db = require('../config/database');

const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return error(res, 'No token provided', 401);
    }
    const token = header.split(' ')[1];
    const decoded = verifyAccessToken(token);

    const { rows } = await db.query(
      'SELECT id, full_name, email, user_type, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (!rows[0])          return error(res, 'User not found', 401);
    if (!rows[0].is_active) return error(res, 'Account is deactivated', 401);

    req.user = rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError')  return error(res, 'Token expired', 401);
    if (err.name === 'JsonWebTokenError')  return error(res, 'Invalid token', 401);
    return error(res, 'Authentication failed', 401);
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.user_type)) {
    return error(res, 'Access denied: insufficient permissions', 403);
  }
  next();
};

const optionalAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return next();
    const token   = header.split(' ')[1];
    const decoded = verifyAccessToken(token);
    const { rows } = await db.query('SELECT id, full_name, email, user_type FROM users WHERE id = $1', [decoded.userId]);
    if (rows[0]) req.user = rows[0];
  } catch (_) { /* ignore */ }
  next();
};

module.exports = { authenticate, authorize, optionalAuth };