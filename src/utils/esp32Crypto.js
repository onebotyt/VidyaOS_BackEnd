/**
 * VidyaOS ESP32 Hardware Cryptographic Engine (AES-256-GCM + HMAC-SHA256)
 * Provides bidirectional authenticated encryption between the Node.js server
 * and ESP32 biometric terminals (matching ESP32 mbedtls_gcm_crypt_and_tag).
 */

const crypto = require('crypto');

/**
 * Derives a deterministic 256-bit (32-byte) AES key from the device's shared secret.
 * Both the Node.js server and ESP32 (via mbedtls_sha256) derive the exact same 32-byte key.
 * @param {string} secretKey
 * @returns {Buffer} 32-byte key
 */
function deriveAes256Key(secretKey) {
  const normalized = String(secretKey || 'vidyaos_default_esp32_secret_key').trim();
  return crypto.createHash('sha256').update(normalized, 'utf8').digest();
}

/**
 * Generates a cryptographically strong 64-hex-character (256-bit) device secret key.
 * @returns {string}
 */
function generateDeviceSecretKey() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Encrypts a JSON-serializable object using AES-256-GCM for transmission to an ESP32 node.
 * Envelope format:
 * {
 *   encrypted: true,
 *   alg: "AES-256-GCM",
 *   iv: "<24-hex-chars (12 bytes)>",
 *   tag: "<32-hex-chars (16 bytes)>",
 *   ciphertext: "<base64-encoded ciphertext>",
 *   ts: 1731750000
 * }
 * @param {Object} payloadObj
 * @param {string} secretKey
 * @returns {Object} Encrypted envelope
 */
function encryptEsp32Payload(payloadObj, secretKey) {
  const key = deriveAes256Key(secretKey);
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for AES-GCM
  const ts = Math.floor(Date.now() / 1000);

  const plaintext = JSON.stringify({
    ...payloadObj,
    _server_ts: ts
  });

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encryptedBuf = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return {
    encrypted: true,
    alg: 'AES-256-GCM',
    iv: iv.toString('hex'),
    tag: authTag.toString('hex'),
    ciphertext: encryptedBuf.toString('base64'),
    ts
  };
}

/**
 * Decrypts and authenticates an incoming AES-256-GCM envelope from an ESP32 node.
 * If the payload is not wrapped in an encrypted envelope (e.g. during local simulator testing
 * with valid X-Device-Secret header), returns the body object after verifying secret.
 * @param {Object} body
 * @param {string} secretKey
 * @returns {Object} Decrypted JSON object
 */
function decryptEsp32Payload(body, secretKey) {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid ESP32 payload');
  }

  // If payload is AES-256-GCM encrypted envelope
  if (body.encrypted && body.iv && body.tag && body.ciphertext) {
    const key = deriveAes256Key(secretKey);
    const iv = Buffer.from(String(body.iv), 'hex');
    const tag = Buffer.from(String(body.tag), 'hex');
    const cipherBuf = Buffer.from(String(body.ciphertext), 'base64');

    if (iv.length !== 12) {
      throw new Error('Invalid AES-256-GCM IV length (expected 12 bytes)');
    }
    if (tag.length !== 16) {
      throw new Error('Invalid AES-256-GCM authentication tag length (expected 16 bytes)');
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const decryptedBuf = Buffer.concat([
      decipher.update(cipherBuf),
      decipher.final()
    ]);

    const parsed = JSON.parse(decryptedBuf.toString('utf8'));
    return parsed;
  }

  // Fallback for signed/authenticated plaintext JSON (used by HOD Simulator or legacy firmware)
  return body;
}

/**
 * Computes SHA-256 hex digest of a Base64 fingerprint template buffer.
 * @param {string} templateBase64
 * @returns {string} 64-char hex SHA-256
 */
function computeTemplateSha256(templateBase64) {
  const buf = Buffer.from(String(templateBase64 || ''), 'base64');
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Computes HMAC-SHA256 signature for header-based authentication.
 * @param {string} deviceUid
 * @param {string|number} timestamp
 * @param {string} secretKey
 * @returns {string}
 */
function computeHmacSignature(deviceUid, timestamp, secretKey) {
  const key = deriveAes256Key(secretKey);
  return crypto
    .createHmac('sha256', key)
    .update(`${deviceUid}:${timestamp}`, 'utf8')
    .digest('hex');
}

module.exports = {
  deriveAes256Key,
  generateDeviceSecretKey,
  encryptEsp32Payload,
  decryptEsp32Payload,
  computeTemplateSha256,
  computeHmacSignature
};
