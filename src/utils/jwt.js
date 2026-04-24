const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

const generateAccessToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' });

const generateRefreshToken = (payload) =>
  jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' });

const verifyAccessToken = (token) => jwt.verify(token, process.env.JWT_SECRET);

const verifyRefreshToken = (token) => jwt.verify(token, process.env.JWT_REFRESH_SECRET);

const saveRefreshToken = async (userId, token, deviceInfo, ipAddress) => {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.query(
    'INSERT INTO refresh_tokens (user_id, token, device_info, ip_address, expires_at) VALUES ($1, $2, $3, $4, $5)',
    [userId, token, deviceInfo, ipAddress, expiresAt]
  );
};

const revokeRefreshToken = async (token) => {
  await db.query('UPDATE refresh_tokens SET revoked = TRUE WHERE token = $1', [token]);
};

const revokeAllUserTokens = async (userId) => {
  await db.query('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1', [userId]);
};

const isRefreshTokenValid = async (token) => {
  const { rows } = await db.query(
    'SELECT * FROM refresh_tokens WHERE token = $1 AND revoked = FALSE AND expires_at > NOW()',
    [token]
  );
  return rows[0] || null;
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  saveRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  isRefreshTokenValid,
};