/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VIDYAOS ESP32 BIOMETRIC ATTENDANCE TERMINAL — MAIN FIRMWARE
 * File: esp32_firmware/VidyaOS_ESP32_Biometric_Node/VidyaOS_ESP32_Biometric_Node.ino
 *
 * Implements all 5 Core Hardware & Security Specifications:
 *   1. AES-256-GCM Encrypted Server <-> ESP32 Communication (crypto_aes_gcm.h)
 *   2. 100% Slot-Agnostic Server Protocol: ESP32 maps AS608 slots locally inside
 *      W25Q32 SPI Flash and communicates with the server strictly by `student_id`.
 *   3. Portable 512-Byte Fingerprint Template Upload & Restoration:
 *      Uploads newly enrolled AS608 templates to MySQL (`student_biometric_templates`)
 *      and automatically downloads all department templates when replacing a device.
 *   4. OLED 0.96" Display + 5V Passive Buzzer + LED Confirmation:
 *      Shows Student Full Name, Class Roll Number, and "ATTENDANCE MARKED!"
 *      immediately upon scan (both Online and Offline).
 *   5. W25Q32 4MB SPI Flash Offline Attendance Queue + 2S 3.7V Battery Telemetry.
 * ═══════════════════════════════════════════════════════════════════════════
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "time.h"
#include "config.h"
#include "crypto_aes_gcm.h"
#include "w25q32_storage.h"
#include "as608_driver.h"
#include "oled_buzzer_ui.h"

VidyaCryptoEngine   cryptoEngine;
W25Q32FlashManager  flashStorage;
VidyaAS608Sensor    fingerprintSensor(&Serial2);
VidyaPeripheralsUI  ui;

unsigned long lastHeartbeatMs = 0;
static const char* activeEnrollName = "";
static uint16_t    activeEnrollRoll = 0;

void onEnrollStageUpdate(const char* stageMsg) {
  ui.showEnrollmentScreen(activeEnrollName, activeEnrollRoll, stageMsg);
}

/**
 * Posts an AES-256-GCM encrypted JSON payload to the VidyaOS backend and decrypts the response.
 */
bool postEncryptedToServer(const String& endpointPath, const String& plainJson, String& outDecryptedJson) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = String(VIDYAOS_SERVER_BASE_URL) + endpointPath;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-UID", DEVICE_UID);

  String encryptedBody = cryptoEngine.encryptJsonEnvelope(DEVICE_UID, plainJson);
  int httpCode = http.POST(encryptedBody);
  if (httpCode < 200 || httpCode >= 300) {
    http.end();
    return false;
  }

  String respStr = http.getString();
  http.end();

  StaticJsonDocument<4096> doc;
  if (deserializeJson(doc, respStr) != DeserializationError::Ok) return false;

  JsonObject enc = doc["encrypted_response"];
  if (!enc.isNull() && enc["encrypted"] == true) {
    return cryptoEngine.decryptEnvelope(
      enc["iv"] | "",
      enc["tag"] | "",
      String((const char*)(enc["ciphertext"] | "")),
      outDecryptedJson
    );
  }
  outDecryptedJson = respStr;
  return true;
}

/**
 * Requirement 3: Downloads all portable 512-byte student fingerprint templates
 * for this department from MySQL and loads them into local AS608 slots + W25Q32 Flash.
 */
void syncDepartmentTemplatesFromServer() {
  ui.setLeds(false, false, true);
  String decryptedResp;
  if (!postEncryptedToServer("/templates-sync", "{\"action\":\"SYNC\"}", decryptedResp)) {
    ui.setLeds(false, false, false);
    return;
  }

  DynamicJsonDocument doc(32768);
  if (deserializeJson(doc, decryptedResp) != DeserializationError::Ok) {
    ui.setLeds(false, false, false);
    return;
  }

  JsonArray arr = doc["templates"].as<JsonArray>();
  uint8_t rawTemplate[AS608_TEMPLATE_SIZE];

  for (JsonObject t : arr) {
    uint32_t studentId = t["student_id"] | 0;
    uint16_t rollNo    = t["class_roll_no"] | 0;
    const char* name   = t["full_name"] | "Student";
    const char* enroll = t["official_enrollment_no"] | "";
    const char* sha    = t["template_sha256"] | "";
    String b64         = String((const char*)(t["template_base64"] | ""));

    if (studentId == 0 || b64.length() == 0) continue;

    // Allocate a local AS608 slot on this ESP32 (server never knows or cares about this slot number!)
    uint16_t localSlot = flashStorage.findOrAllocateSlotForStudent(studentId);
    if (localSlot == 0) continue;

    size_t decodedLen = VidyaCryptoEngine::base64Decode(b64, rawTemplate, AS608_TEMPLATE_SIZE);
    if (decodedLen == AS608_TEMPLATE_SIZE) {
      if (fingerprintSensor.writeTemplateToSlot(localSlot, rawTemplate)) {
        flashStorage.saveStudentSlotMapping(localSlot, studentId, rollNo, enroll, name, sha);
      }
    }
  }
  ui.chimeEnrollSuccess();
  ui.setLeds(false, false, false);
}

/**
 * Requirement 3 & 5: Executes remote student fingerprint enrollment triggered from the HOD page,
 * extracts the 512-byte AS608 template, and uploads it encrypted to MySQL.
 */
void handleRemoteStudentEnrollment(JsonObject cmd) {
  uint32_t commandId = cmd["command_id"] | 0;
  uint32_t studentId = cmd["student_id"] | 0;
  uint16_t rollNo    = cmd["class_roll_no"] | 0;
  const char* name   = cmd["full_name"] | "Student";
  const char* enroll = cmd["official_enrollment_no"] | "";
  uint8_t fingerIdx  = cmd["finger_index"] | 1;

  activeEnrollName = name;
  activeEnrollRoll = rollNo;
  ui.setLeds(false, false, true);
  ui.playTone(1400, 90);

  uint16_t localSlot = flashStorage.findOrAllocateSlotForStudent(studentId);
  uint8_t extractedTemplate[AS608_TEMPLATE_SIZE];
  uint16_t qualityScore = 96;

  bool ok = fingerprintSensor.enrollAndExtractTemplate(localSlot, extractedTemplate, qualityScore, onEnrollStageUpdate);
  if (!ok) {
    ui.chimeError();
    ui.showEnrollmentScreen(name, rollNo, "Enrollment Failed/Timeout");
    delay(2000);
    ui.setLeds(false, false, false);
    return;
  }

  String tplB64 = VidyaCryptoEngine::base64Encode(extractedTemplate, AS608_TEMPLATE_SIZE);
  String tplSha = VidyaCryptoEngine::sha256Hex(extractedTemplate, AS608_TEMPLATE_SIZE);

  // Save slot -> student mapping in local W25Q32 SPI Flash
  flashStorage.saveStudentSlotMapping(localSlot, studentId, rollNo, enroll, name, tplSha.c_str());

  // Upload portable 512-byte template encrypted to server (under student_id, zero slot coupling!)
  String payload = "{";
  payload += "\"command_id\":" + String(commandId) + ",";
  payload += "\"student_id\":" + String(studentId) + ",";
  payload += "\"finger_index\":" + String(fingerIdx) + ",";
  payload += "\"quality_score\":" + String(qualityScore) + ",";
  payload += "\"template_base64\":\"" + tplB64 + "\"";
  payload += "}";

  String decryptedResp;
  postEncryptedToServer("/template-upload", payload, decryptedResp);

  ui.chimeEnrollSuccess();
  ui.showEnrollmentScreen(name, rollNo, "FINGERPRINT SAVED!");
  delay(2500);
  ui.setLeds(false, false, false);
}

/**
 * Drains unsynced offline attendance scans from W25Q32 SPI Flash to the server when Wi-Fi is online.
 */
void syncOfflineQueueToServer() {
  if (WiFi.status() != WL_CONNECTED || flashStorage.getUnsyncedCount() == 0) return;

  OfflineAttendanceRecord batch[OFFLINE_SYNC_BATCH_SIZE];
  uint32_t indices[OFFLINE_SYNC_BATCH_SIZE];
  size_t count = flashStorage.fetchUnsyncedBatch(batch, indices, OFFLINE_SYNC_BATCH_SIZE);
  if (count == 0) return;

  ui.setLeds(false, false, true);
  String json = "{\"scans\":[";
  for (size_t i = 0; i < count; i++) {
    if (i > 0) json += ",";
    json += "{";
    json += "\"event_id\":\"" + String(batch[i].event_id) + "\",";
    json += "\"student_id\":" + String(batch[i].student_id) + ",";
    json += "\"scanned_at\":" + String(batch[i].scanned_at_epoch) + ",";
    json += "\"confidence\":" + String(batch[i].confidence) + ",";
    json += "\"is_offline_sync\":true";
    json += "}";
  }
  json += "]}";

  String decryptedResp;
  if (postEncryptedToServer("/attendance", json, decryptedResp)) {
    for (size_t i = 0; i < count; i++) {
      flashStorage.markRecordSynced(indices[i]);
    }
  }
  ui.setLeds(false, false, false);
}

void setup() {
  Serial.begin(115200);
  ui.begin();
  cryptoEngine.begin(DEVICE_AES_SECRET);
  flashStorage.begin();
  fingerprintSensor.begin();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - t0 < 8000)) {
    delay(250);
  }
  configTime(19800, 0, "pool.ntp.org", "time.nist.gov"); // IST UTC+5:30
  ui.chimeBoot();
}

void loop() {
  float battVolts = ui.readBatteryVoltage();
  int   battPct   = ui.readBatteryPercentage(battVolts);
  bool  isOnline  = (WiFi.status() == WL_CONNECTED);

  // 1. Poll AS608 Fingerprint Sensor for Student Attendance Scan
  uint16_t matchedSlot = 0;
  uint16_t confidence  = 0;
  int scanStatus = fingerprintSensor.pollAndSearch(matchedSlot, confidence);

  if (scanStatus == 1) {
    LocalStudentSlotEntry student;
    if (flashStorage.lookupStudentBySlot(matchedSlot, student)) {
      time_t nowEpoch;
      time(&nowEpoch);
      char eventId[34];
      snprintf(eventId, sizeof(eventId), "EVT-%lu-%lu", (unsigned long)student.student_id, (unsigned long)nowEpoch);

      bool uploadedOnline = false;
      if (isOnline) {
        String scanJson = "{\"scans\":[{";
        scanJson += "\"event_id\":\"" + String(eventId) + "\",";
        scanJson += "\"student_id\":" + String(student.student_id) + ",";
        scanJson += "\"scanned_at\":" + String((unsigned long)nowEpoch) + ",";
        scanJson += "\"confidence\":" + String(confidence) + ",";
        scanJson += "\"is_offline_sync\":false";
        scanJson += "}]}";

        String respJson;
        uploadedOnline = postEncryptedToServer("/attendance", scanJson, respJson);
      }

      if (!uploadedOnline) {
        // Store in W25Q32 4MB SPI Flash Offline Ring Buffer!
        flashStorage.appendOfflineAttendance(
          student.student_id,
          student.class_roll_no,
          student.full_name,
          student.enrollment_no,
          (uint32_t)nowEpoch,
          (uint8_t)confidence,
          eventId
        );
      }

      // Immediately play buzzer chime and show Student Name + Roll No + "ATTENDANCE MARKED!" on OLED
      ui.chimeAttendanceMarked();
      ui.showAttendanceMarkedScreen(
        student.full_name,
        student.class_roll_no,
        student.enrollment_no,
        !uploadedOnline,
        battVolts,
        battPct,
        flashStorage.getUnsyncedCount()
      );
      delay(OLED_BANNER_HOLD_MS);
      ui.setLeds(false, false, false);
    }
  } else if (scanStatus == -2) {
    ui.chimeError();
    ui.showEnrollmentScreen("UNRECOGNIZED", 0, "Finger Not Enrolled");
    delay(1500);
    ui.setLeds(false, false, false);
  }

  // 2. Periodic Encrypted Heartbeat, W25Q32 Offline Sync & Remote Command Poll
  if (millis() - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatMs = millis();

    if (isOnline) {
      syncOfflineQueueToServer();

      String hbJson = "{";
      hbJson += "\"battery_voltage\":" + String(battVolts, 2) + ",";
      hbJson += "\"battery_pct\":" + String(battPct) + ",";
      hbJson += "\"offline_queue_count\":" + String(flashStorage.getUnsyncedCount()) + ",";
      hbJson += "\"w25q32_used_kb\":" + String(flashStorage.getUsedFlashKb()) + ",";
      hbJson += "\"as608_enrolled_count\":" + String(flashStorage.getEnrolledStudentCount()) + ",";
      hbJson += "\"wifi_rssi\":" + String(WiFi.RSSI()) + ",";
      hbJson += "\"firmware_version\":\"" + String(FIRMWARE_VERSION) + "\"";
      hbJson += "}";

      String hbResp;
      if (postEncryptedToServer("/heartbeat", hbJson, hbResp)) {
        StaticJsonDocument<2048> doc;
        if (deserializeJson(doc, hbResp) == DeserializationError::Ok) {
          uint16_t cloudCount = doc["cloud_template_count"] | 0;
          if (cloudCount > 0 && flashStorage.getEnrolledStudentCount() == 0) {
            // New/Replacement ESP32 detected: auto-download all department student templates!
            syncDepartmentTemplatesFromServer();
          }

          JsonObject cmd = doc["command"];
          if (!cmd.isNull()) {
            String cmdType = String((const char*)(cmd["command_type"] | ""));
            if (cmdType == "ENROLL_STUDENT") {
              handleRemoteStudentEnrollment(cmd);
            } else if (cmdType == "SYNC_TEMPLATES") {
              syncDepartmentTemplatesFromServer();
            } else if (cmdType == "BUZZER_CHIME") {
              ui.chimeAttendanceMarked();
            }
          }
        }
      }
    }

    ui.showIdleScreen(
      isOnline,
      flashStorage.getUnsyncedCount(),
      flashStorage.getEnrolledStudentCount(),
      battVolts,
      battPct
    );
  }

  delay(40);
}
