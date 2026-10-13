/**
 * PIN & Dynamic QR Code Helper Utilities
 */

const crypto = require('crypto');

/**
 * Generate 6-digit numeric PIN for soft self-attendance
 */
function generatePin() {
  const pin = Math.floor(100000 + Math.random() * 900000).toString();
  return pin;
}

/**
 * Generate dynamic QR token & HMAC payload
 */
function generateQrPayload(sessionId, expiryMinutes = 15) {
  const nonce = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
  const rawData = `${sessionId}:${nonce}:${expiresAt.toISOString()}`;
  const tokenHash = crypto.createHash('sha256').update(rawData).digest('hex');

  return {
    tokenHash,
    expiresAt,
    qrPayload: JSON.stringify({
      session_id: sessionId,
      token: tokenHash,
      exp: expiresAt.toISOString()
    })
  };
}

module.exports = {
  generatePin,
  generateQrPayload
};
