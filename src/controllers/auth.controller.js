const bcrypt    = require('bcryptjs');
const crypto    = require('crypto');
const speakeasy = require('speakeasy');
const qrcode    = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const db        = require('../config/database');
const jwtUtil   = require('../utils/jwt');
const res_      = require('../utils/response');
const emailSvc  = require('../services/email.service');
const logger    = require('../config/logger');

// ── Register
exports.register = async (req, res) => {
  try {
    const { full_name, email, phone, phone_country_code, password, user_type } = req.body;

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows[0]) return res_.error(res, 'Email already registered', 409);

    const hash  = await bcrypt.hash(password, 12);
    const token = crypto.randomBytes(32).toString('hex');

    const { rows: [user] } = await db.query(
      `INSERT INTO users (full_name, email, phone, phone_country_code, password_hash, user_type, verification_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, full_name, email, user_type`,
      [full_name, email, phone, phone_country_code, hash, user_type || 'owner', token]
    );

    await emailSvc.sendVerificationEmail(email, full_name, token).catch(() => {});

    return res_.created(res, { user }, 'Registration successful. Please verify your email.');
  } catch (err) {
    logger.error(`Register error: ${err.message}`);
    return res_.error(res, 'Registration failed');
  }
};

// ── Verify Email
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;
    const { rows: [user] } = await db.query(
      'UPDATE users SET email_verified = TRUE, is_verified = TRUE, verification_token = NULL WHERE verification_token = $1 RETURNING id',
      [token]
    );
    if (!user) return res_.error(res, 'Invalid or expired verification token', 400);
    return res_.success(res, {}, 'Email verified successfully');
  } catch (err) {
    return res_.error(res, 'Verification failed');
  }
};

// ── Login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const { rows: [user] } = await db.query(
      'SELECT id, full_name, email, password_hash, user_type, is_active, two_factor_enabled, two_factor_secret FROM users WHERE email = $1',
      [email]
    );
    if (!user) return res_.error(res, 'Invalid credentials', 401);
    if (!user.is_active) return res_.error(res, 'Account deactivated', 401);

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res_.error(res, 'Invalid credentials', 401);

    // If 2FA enabled, return partial token
    if (user.two_factor_enabled) {
      const tempToken = jwtUtil.generateAccessToken({ userId: user.id, twoFaPending: true });
      return res_.success(res, { requires2FA: true, tempToken }, '2FA required');
    }

    await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const accessToken  = jwtUtil.generateAccessToken({ userId: user.id, userType: user.user_type });
    const refreshToken = jwtUtil.generateRefreshToken({ userId: user.id });
    await jwtUtil.saveRefreshToken(user.id, refreshToken, req.headers['user-agent'], req.ip);

    return res_.success(res, {
      accessToken,
      refreshToken,
      user: { id: user.id, full_name: user.full_name, email: user.email, user_type: user.user_type },
    }, 'Login successful');
  } catch (err) {
    logger.error(`Login error: ${err.message}`);
    return res_.error(res, 'Login failed');
  }
};

// ── 2FA Verify
exports.verify2FA = async (req, res) => {
  try {
    const { tempToken, code } = req.body;
    const decoded = jwtUtil.verifyAccessToken(tempToken);
    if (!decoded.twoFaPending) return res_.error(res, 'Invalid token', 401);

    const { rows: [user] } = await db.query(
      'SELECT id, full_name, email, user_type, two_factor_secret FROM users WHERE id = $1',
      [decoded.userId]
    );

    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret, encoding: 'base32', token: code, window: 1,
    });
    if (!verified) return res_.error(res, 'Invalid 2FA code', 401);

    const accessToken  = jwtUtil.generateAccessToken({ userId: user.id, userType: user.user_type });
    const refreshToken = jwtUtil.generateRefreshToken({ userId: user.id });
    await jwtUtil.saveRefreshToken(user.id, refreshToken, req.headers['user-agent'], req.ip);

    return res_.success(res, { accessToken, refreshToken, user });
  } catch (err) {
    return res_.error(res, '2FA verification failed');
  }
};

// ── Refresh Token
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res_.error(res, 'Refresh token required', 401);

    const decoded = jwtUtil.verifyRefreshToken(refreshToken);
    const stored  = await jwtUtil.isRefreshTokenValid(refreshToken);
    if (!stored)  return res_.error(res, 'Invalid refresh token', 401);

    const accessToken     = jwtUtil.generateAccessToken({ userId: decoded.userId });
    const newRefreshToken = jwtUtil.generateRefreshToken({ userId: decoded.userId });

    await jwtUtil.revokeRefreshToken(refreshToken);
    await jwtUtil.saveRefreshToken(decoded.userId, newRefreshToken, req.headers['user-agent'], req.ip);

    return res_.success(res, { accessToken, refreshToken: newRefreshToken });
  } catch (err) {
    return res_.error(res, 'Token refresh failed', 401);
  }
};

// ── Logout
exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) await jwtUtil.revokeRefreshToken(refreshToken);
    return res_.success(res, {}, 'Logged out successfully');
  } catch (err) {
    return res_.error(res, 'Logout failed');
  }
};

// ── Forgot Password
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const { rows: [user] } = await db.query('SELECT id, full_name FROM users WHERE email = $1', [email]);
    if (!user) return res_.success(res, {}, 'If that email exists, a reset link was sent.');

    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600 * 1000);
    await db.query('UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3', [token, expires, user.id]);
    await emailSvc.sendPasswordResetEmail(email, user.full_name, token).catch(() => {});

    return res_.success(res, {}, 'Password reset email sent');
  } catch (err) {
    return res_.error(res, 'Request failed');
  }
};

// ── Reset Password
exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    const { rows: [user] } = await db.query(
      'SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()',
      [token]
    );
    if (!user) return res_.error(res, 'Invalid or expired reset token', 400);

    const hash = await bcrypt.hash(password, 12);
    await db.query(
      'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [hash, user.id]
    );
    await jwtUtil.revokeAllUserTokens(user.id);
    return res_.success(res, {}, 'Password reset successful');
  } catch (err) {
    return res_.error(res, 'Password reset failed');
  }
};

// ── Setup 2FA
exports.setup2FA = async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({ name: `CrackDetectX (${req.user.email})`, length: 20 });
    await db.query('UPDATE users SET two_factor_secret = $1 WHERE id = $2', [secret.base32, req.user.id]);
    const qrUrl = await qrcode.toDataURL(secret.otpauth_url);
    return res_.success(res, { secret: secret.base32, qrCode: qrUrl });
  } catch (err) {
    return res_.error(res, '2FA setup failed');
  }
};

// ── Enable 2FA (confirm)
exports.enable2FA = async (req, res) => {
  try {
    const { code } = req.body;
    const { rows: [user] } = await db.query('SELECT two_factor_secret FROM users WHERE id = $1', [req.user.id]);
    const verified = speakeasy.totp.verify({ secret: user.two_factor_secret, encoding: 'base32', token: code, window: 1 });
    if (!verified) return res_.error(res, 'Invalid code', 400);
    await db.query('UPDATE users SET two_factor_enabled = TRUE WHERE id = $1', [req.user.id]);
    return res_.success(res, {}, '2FA enabled');
  } catch (err) {
    return res_.error(res, 'Failed to enable 2FA');
  }
};