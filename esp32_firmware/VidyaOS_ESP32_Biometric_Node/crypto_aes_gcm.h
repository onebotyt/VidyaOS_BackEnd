/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VIDYAOS ESP32 AES-256-GCM HARDWARE CRYPTO ENGINE (crypto_aes_gcm.h)
 * Uses ESP32 built-in mbedTLS (mbedtls/gcm.h & mbedtls/sha256.h) for
 * authenticated encryption matching src/utils/esp32Crypto.js on the server.
 * ═══════════════════════════════════════════════════════════════════════════
 */

#ifndef VIDYAOS_CRYPTO_AES_GCM_H
#define VIDYAOS_CRYPTO_AES_GCM_H

#include <Arduino.h>
#include "mbedtls/gcm.h"
#include "mbedtls/sha256.h"
#include "mbedtls/base64.h"
#include "esp_system.h"

class VidyaCryptoEngine {
private:
  uint8_t aesKey[32];

  static void bytesToHex(const uint8_t* data, size_t len, char* outHex) {
    static const char hexChars[] = "0123456789abcdef";
    for (size_t i = 0; i < len; i++) {
      outHex[i * 2]     = hexChars[(data[i] >> 4) & 0x0F];
      outHex[i * 2 + 1] = hexChars[data[i] & 0x0F];
    }
    outHex[len * 2] = '\0';
  }

  static bool hexToBytes(const char* hexStr, uint8_t* outBytes, size_t expectedBytes) {
    if (!hexStr || strlen(hexStr) < expectedBytes * 2) return false;
    for (size_t i = 0; i < expectedBytes; i++) {
      char buf[3] = { hexStr[i * 2], hexStr[i * 2 + 1], 0 };
      outBytes[i] = (uint8_t)strtoul(buf, NULL, 16);
    }
    return true;
  }

public:
  /**
   * Derives the 32-byte (256-bit) AES key from the shared secret string using SHA-256.
   */
  void begin(const char* secretKeyStr) {
    mbedtls_sha256_context shaCtx;
    mbedtls_sha256_init(&shaCtx);
    mbedtls_sha256_starts_ret(&shaCtx, 0);
    mbedtls_sha256_update_ret(&shaCtx, (const unsigned char*)secretKeyStr, strlen(secretKeyStr));
    mbedtls_sha256_finish_ret(&shaCtx, aesKey);
    mbedtls_sha256_free(&shaCtx);
  }

  /**
   * Computes SHA-256 hex digest of a binary buffer (used for 512-byte AS608 template verification).
   */
  static String sha256Hex(const uint8_t* data, size_t len) {
    uint8_t hash[32];
    mbedtls_sha256_context ctx;
    mbedtls_sha256_init(&ctx);
    mbedtls_sha256_starts_ret(&ctx, 0);
    mbedtls_sha256_update_ret(&ctx, data, len);
    mbedtls_sha256_finish_ret(&ctx, hash);
    mbedtls_sha256_free(&ctx);
    char hex[65];
    bytesToHex(hash, 32, hex);
    return String(hex);
  }

  /**
   * Base64 encodes a binary buffer (e.g., 512-byte AS608 fingerprint template).
   */
  static String base64Encode(const uint8_t* data, size_t len) {
    size_t outLen = 0;
    mbedtls_base64_encode(NULL, 0, &outLen, data, len);
    uint8_t* outBuf = (uint8_t*)malloc(outLen + 1);
    if (!outBuf) return "";
    mbedtls_base64_encode(outBuf, outLen, &outLen, data, len);
    outBuf[outLen] = '\0';
    String res((char*)outBuf);
    free(outBuf);
    return res;
  }

  /**
   * Base64 decodes a string into a binary buffer.
   */
  static size_t base64Decode(const String& b64, uint8_t* outBuf, size_t maxOutLen) {
    size_t outLen = 0;
    if (mbedtls_base64_decode(outBuf, maxOutLen, &outLen, (const unsigned char*)b64.c_str(), b64.length()) != 0) {
      return 0;
    }
    return outLen;
  }

  /**
   * Encrypts plaintext JSON into an AES-256-GCM JSON envelope for the VidyaOS server.
   */
  String encryptJsonEnvelope(const String& deviceUid, const String& plaintextJson) {
    uint8_t iv[12];
    esp_fill_random(iv, sizeof(iv));

    size_t len = plaintextJson.length();
    uint8_t* cipherBuf = (uint8_t*)malloc(len + 1);
    if (!cipherBuf) return "{}";

    uint8_t tag[16];
    mbedtls_gcm_context gcm;
    mbedtls_gcm_init(&gcm);
    mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, aesKey, 256);
    mbedtls_gcm_crypt_and_tag(
      &gcm,
      MBEDTLS_GCM_ENCRYPT,
      len,
      iv,
      sizeof(iv),
      NULL,
      0,
      (const unsigned char*)plaintextJson.c_str(),
      cipherBuf,
      sizeof(tag),
      tag
    );
    mbedtls_gcm_free(&gcm);

    char ivHex[25];
    char tagHex[33];
    bytesToHex(iv, 12, ivHex);
    bytesToHex(tag, 16, tagHex);
    String cipherB64 = base64Encode(cipherBuf, len);
    free(cipherBuf);

    String envelope = "{";
    envelope += "\"device_uid\":\"" + deviceUid + "\",";
    envelope += "\"encrypted\":true,";
    envelope += "\"alg\":\"AES-256-GCM\",";
    envelope += "\"iv\":\"" + String(ivHex) + "\",";
    envelope += "\"tag\":\"" + String(tagHex) + "\",";
    envelope += "\"ciphertext\":\"" + cipherB64 + "\"";
    envelope += "}";
    return envelope;
  }

  /**
   * Decrypts an AES-256-GCM envelope received from the VidyaOS server.
   */
  bool decryptEnvelope(const char* ivHex, const char* tagHex, const String& cipherB64, String& outPlaintext) {
    uint8_t iv[12];
    uint8_t tag[16];
    if (!hexToBytes(ivHex, iv, 12) || !hexToBytes(tagHex, tag, 16)) {
      return false;
    }

    size_t maxLen = cipherB64.length();
    uint8_t* cipherBuf = (uint8_t*)malloc(maxLen + 1);
    if (!cipherBuf) return false;

    size_t cipherLen = base64Decode(cipherB64, cipherBuf, maxLen);
    if (cipherLen == 0) {
      free(cipherBuf);
      return false;
    }

    uint8_t* plainBuf = (uint8_t*)malloc(cipherLen + 1);
    if (!plainBuf) {
      free(cipherBuf);
      return false;
    }

    mbedtls_gcm_context gcm;
    mbedtls_gcm_init(&gcm);
    mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, aesKey, 256);
    int ret = mbedtls_gcm_auth_decrypt(
      &gcm,
      cipherLen,
      iv,
      12,
      NULL,
      0,
      tag,
      16,
      cipherBuf,
      plainBuf
    );
    mbedtls_gcm_free(&gcm);
    free(cipherBuf);

    if (ret != 0) {
      free(plainBuf);
      return false;
    }

    plainBuf[cipherLen] = '\0';
    outPlaintext = String((char*)plainBuf);
    free(plainBuf);
    return true;
  }
};

#endif // VIDYAOS_CRYPTO_AES_GCM_H
