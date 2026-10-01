/**
 * JWT Token Generation & Cryptographic Hashing Utilities
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config();

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'super_secret_access_jwt_key_2026';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'super_secret_refresh_jwt_key_2026';
const ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
const REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';

/**
 * Generates short-lived Access Token
 * Invariant: Never bake dynamic academic scopes (cohort/subjects) into token.
 */
function generateAccessToken(payload) {
  return jwt.sign(
    {
      user_id: payload.id || payload.user_id,
      username: payload.username,
      roles: payload.roles || []
    },
    ACCESS_SECRET,
    { expiresIn: ACCESS_EXPIRY }
  );
}

/**
 * Generates long-lived Refresh Token
 */
function generateRefreshToken(payload) {
  return jwt.sign(
    {
      user_id: payload.id,
      token_id: crypto.randomUUID()
    },
    REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRY }
  );
}

/**
 * Generates restricted Activation Token for first-time password change
 */
function generateActivationToken(payload) {
  return jwt.sign(
    {
      user_id: payload.id,
      purpose: 'PASSWORD_ACTIVATION'
    },
    ACCESS_SECRET,
    { expiresIn: '1h' }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

/**
 * Hashes token using SHA-256 for secure DB persistence in user_sessions
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateActivationToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken
};
