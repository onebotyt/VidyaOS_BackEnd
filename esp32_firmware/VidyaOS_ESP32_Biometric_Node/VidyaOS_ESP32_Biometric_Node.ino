/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VIDYAOS ESP32 BIOMETRIC ATTENDANCE TERMINAL — MAIN FIRMWARE
 * File: esp32_firmware/VidyaOS_ESP32_Biometric_Node/VidyaOS_ESP32_Biometric_Node.ino
 *
 * Implements all Specifications & Behavioral Modes:
 *   1. Hardware Pinout Map: AS608, 0.96" OLED (SSD1306), W25Qxx SPI Flash,
 *      Piezo Buzzer (GPIO 14), 4 Status LEDs (WiFi Blue 27, Success Green 25,
 *      Fail Red 26, Low Batt Amber 4), 2S Battery Telemetry (GPIO 34).
 *   2. Behavioral Conditions & Operational Modes:
 *      - Successful Attendance: 2s 2400Hz beep, Green LED 2.5s, OLED details.
 *      - Failed Attendance: 3 short beeps, Red LED flashes 3x, OLED error.
 *      - Unregistered Finger: Continuous rapid 800Hz tone (< 2s), Red LED 2.0s, OLED alert.
 *      - Low Battery: 5 beeps in 5s, Amber LED solid/slow pulse, OLED battery gauge.
 *      - Idle / Standby: Blue WiFi LED, Clock, RSSI, Battery %, Scan prompt.
 *      - Auto Sleep: OLED off, LEDs off, wake on AS608 prism touch (GPIO 33).
 *   3. Secure Dual-Layer Slot Allocation & Two-Way Verification Protocol:
 *      - Matches AS608 slot_id, resolves student_id in W25Qxx / RAM.
 *      - Transmits AES-256-GCM encrypted { device_uid, student_id, slot_id, enrollment_no }.
 *      - Server verifies slot_id against device registry before marking PRESENT.
 * ═══════════════════════════════════════════════════════════════════════════
 */

#include <WiFi.h>
#include <WiFiMulti.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <WiFiClientSecure.h>
#include <Update.h>
#include <esp_sleep.h>
#include <string.h>
#include <stdio.h>
#include <math.h>
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
WiFiMulti           wifiMulti;
Preferences         wifiPrefs;
WiFiClient          tcpClient;
PubSubClient        mqttClient(tcpClient);

String currentConnectedSsid = WIFI_SSID;
String defaultWifiSsid      = DEFAULT_FACTORY_WIFI_SSID;
String defaultWifiPass      = DEFAULT_FACTORY_WIFI_PASS;

unsigned long lastHeartbeatMs     = 0;
unsigned long lastActivityMs      = 0;
unsigned long lastBatteryCheckMs  = 0;
unsigned long lastLowBattAlertMs  = 0;
unsigned long lastMqttRetryMs     = 0;
unsigned long lastWifiReconnectMs = 0;
unsigned long lastDisplayMs       = 0;

// UI State Management: Prevents display freezes after events
enum TerminalUiState {
  UI_STATE_IDLE,
  UI_STATE_BANNER,
  UI_STATE_ENROLL
};

TerminalUiState currentUiState = UI_STATE_IDLE;
unsigned long bannerExpireMs    = 0;

static const char* activeEnrollName = "";
static uint16_t    activeEnrollRoll = 0;

void onEnrollStageUpdate(const char* stageMsg) {
  ui.showEnrollmentScreen(activeEnrollName, activeEnrollRoll, stageMsg);
}

// ─── Remote Cloud Diagnostics & System Logging (Over the Internet) ──────────
#define MAX_REMOTE_LOG_QUEUE 12

struct RemoteLogEntry {
  String level;
  String tag;
  String msg;
};

RemoteLogEntry remoteLogQueue[MAX_REMOTE_LOG_QUEUE];
int remoteLogCount = 0;

void queueRemoteLog(const char* level, const char* tag, const String& msg) {
  Serial.printf("[%s][%s] %s\n", level, tag, msg.c_str());

  if (remoteLogCount < MAX_REMOTE_LOG_QUEUE) {
    remoteLogQueue[remoteLogCount].level = String(level);
    remoteLogQueue[remoteLogCount].tag = String(tag);
    remoteLogQueue[remoteLogCount].msg = msg;
    remoteLogCount++;
  } else {
    for (int i = 0; i < MAX_REMOTE_LOG_QUEUE - 1; i++) {
      remoteLogQueue[i] = remoteLogQueue[i + 1];
    }
    remoteLogQueue[MAX_REMOTE_LOG_QUEUE - 1].level = String(level);
    remoteLogQueue[MAX_REMOTE_LOG_QUEUE - 1].tag = String(tag);
    remoteLogQueue[MAX_REMOTE_LOG_QUEUE - 1].msg = msg;
  }
}

static bool executeSinglePost(const String& fullUrl, const String& endpointPath, const String& plainJson, String& outDecryptedJson) {
  HTTPClient http;
  WiFiClientSecure secureClient;
  WiFiClient plainClient;

  http.setTimeout(15000); // 15s timeout
  bool began = false;
  if (fullUrl.startsWith("https://")) {
    secureClient.setInsecure(); // Allow HTTPS to Render without embedding CA cert
    began = http.begin(secureClient, fullUrl);
  } else {
    began = http.begin(plainClient, fullUrl);
  }

  if (!began) {
    Serial.println("[HTTP] http.begin() failed for: " + fullUrl);
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-UID", DEVICE_UID);

  String encryptedBody = cryptoEngine.encryptJsonEnvelope(DEVICE_UID, plainJson);
  int httpCode = http.POST(encryptedBody);
  String respStr = http.getString();
  http.end();

  if (httpCode < 200 || httpCode >= 300) {
    Serial.printf("[HTTP] POST %s FAILED -> code=%d, body=%s\n",
                  endpointPath.c_str(), httpCode, respStr.c_str());
    return false;
  }

#if defined(ARDUINOJSON_VERSION_MAJOR) && (ARDUINOJSON_VERSION_MAJOR >= 7)
  JsonDocument doc;
#else
  DynamicJsonDocument doc(32768);
#endif

  DeserializationError err = deserializeJson(doc, respStr);
  if (err) {
    Serial.printf("[JSON] Parse error on %s: %s\n", endpointPath.c_str(), err.c_str());
    return false;
  }

  JsonObject enc = doc["encrypted_response"];
  if (!enc.isNull() && enc["encrypted"] == true) {
    bool ok = cryptoEngine.decryptEnvelope(
      enc["iv"] | "",
      enc["tag"] | "",
      String((const char*)(enc["ciphertext"] | "")),
      outDecryptedJson
    );
    if (!ok) Serial.println("[CRYPTO] Response AES-256-GCM decrypt failed");
    return ok;
  }
  outDecryptedJson = respStr;
  return true;
}

/**
 * Posts an AES-256-GCM encrypted JSON payload to the VidyaOS backend with automatic cloud fallback.
 */
bool postEncryptedToServer(const String& endpointPath, const String& plainJson, String& outDecryptedJson) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] Skipped: Wi-Fi not connected");
    return false;
  }

  // 1. Try Primary Server Base URL
  String primaryUrl = String(VIDYAOS_SERVER_BASE_URL) + endpointPath;
  if (executeSinglePost(primaryUrl, endpointPath, plainJson, outDecryptedJson)) {
    return true;
  }

  // 2. Try Fallback Cloud Base URL (Render) if configured
#if defined(VIDYAOS_RENDER_FALLBACK_URL)
  String fallbackUrl = String(VIDYAOS_RENDER_FALLBACK_URL) + endpointPath;
  if (fallbackUrl != primaryUrl) {
    Serial.println(F("[HTTP][FAILOVER] Primary server failed. Trying Render Cloud fallback..."));
    if (executeSinglePost(fallbackUrl, endpointPath, plainJson, outDecryptedJson)) {
      return true;
    }
  }
#endif

  return false;
}

/**
 * Formats current time into standard strings:
 *   - outFull: "10:45:12 AM"
 *   - outShort: "10:45 AM"
 * If NTP is not yet synced, falls back to uptime clock so the display visibly ticks!
 */
void getFormattedTime(char* outFull, size_t fullSize, char* outShort, size_t shortSize) {
  struct tm timeinfo;
  if (getLocalTime(&timeinfo, 10)) { // 10ms non-blocking check
    if (outFull && fullSize > 0) {
      strftime(outFull, fullSize, "%I:%M:%S %p", &timeinfo);
    }
    if (outShort && shortSize > 0) {
      strftime(outShort, shortSize, "%I:%M %p", &timeinfo);
    }
  } else {
    // Uptime ticking fallback: ensures display visibly changes every second!
    unsigned long sec = millis() / 1000UL;
    unsigned int h = (sec / 3600UL) % 24;
    unsigned int m = (sec / 60UL) % 60;
    unsigned int s = sec % 60;
    if (outFull && fullSize > 0) {
      snprintf(outFull, fullSize, "%02u:%02u:%02u", h, m, s);
    }
    if (outShort && shortSize > 0) {
      snprintf(outShort, shortSize, "%02u:%02u", h, m);
    }
  }
}

// ─── Deep Sleep & Persistent RTC State Across Power Cycles ──────────────────
struct RecentScanRecord {
  uint32_t student_id;
  uint32_t epoch_sec;
};
#define RECENT_SCANS_CACHE_SIZE 32
RTC_DATA_ATTR RecentScanRecord recentScans[RECENT_SCANS_CACHE_SIZE];
RTC_DATA_ATTR uint8_t recentScanHead = 0;
RTC_DATA_ATTR uint32_t deepSleepCycleCount = 0;

TaskHandle_t wifiSyncTaskHandle = NULL;
SemaphoreHandle_t flashMutex = NULL;

void enterHardwareDeepSleep() {
  Serial.println(F("[SLEEP] Inactivity timeout reached (120s). Entering Hardware Deep Sleep..."));
  queueRemoteLog("INFO", "POWER", "Inactivity timeout (120s) -> Entering Hardware Deep Sleep");
  deepSleepCycleCount++;

  float battVolts = ui.readBatteryVoltage();
  int battPct = ui.readBatteryPercentage(battVolts);
  ui.showSleepBanner(battPct);
  delay(350);
  ui.powerOffDisplay();

  ui.turnOffAllLeds();
  fingerprintSensor.setBacklight(false);

  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  delay(50);

  pinMode(AS608_TOUCH_WAKE_PIN, INPUT_PULLDOWN);
  esp_sleep_enable_ext0_wakeup((gpio_num_t)AS608_TOUCH_WAKE_PIN, 1);
  esp_sleep_enable_timer_wakeup(BACKUP_TIMER_SLEEP_SEC * 1000000ULL);

  Serial.println(F("[SLEEP] Entering Deep Sleep. Touch AS608 prism glass to wake!"));
  Serial.flush();
  esp_deep_sleep_start();
}

/**
 * Downloads all portable 512-byte student fingerprint templates
 * for this department from MySQL and loads them into local AS608 slots + W25Q32 Flash.
 */
void syncDepartmentTemplatesFromServer() {
  ui.setWifiLed(true);
  String decryptedResp;
  if (!postEncryptedToServer("/templates-sync", "{\"action\":\"SYNC\"}", decryptedResp)) {
    return;
  }

  DynamicJsonDocument doc(32768);
  if (deserializeJson(doc, decryptedResp) != DeserializationError::Ok) {
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

    // Allocate local AS608 slot
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
}

/**
 * Remote student fingerprint enrollment handler:
 * Allocates free slot, guides 2-scan enrollment, extracts template, saves in W25Qxx/RAM,
 * and uploads { student_id, slot_id, template_base64 } to MySQL.
 */
void handleRemoteStudentEnrollment(JsonObject cmd) {
  currentUiState = UI_STATE_ENROLL;
  lastActivityMs = millis();

  // Support both top-level and nested payload
  JsonObject payload = cmd["payload"].is<JsonObject>() ? cmd["payload"].as<JsonObject>() : cmd;
  uint32_t commandId = cmd["command_id"] | payload["command_id"] | 0;
  uint32_t studentId = cmd["student_id"] | payload["student_id"] | 0;
  uint16_t rollNo    = cmd["class_roll_no"] | payload["class_roll_no"] | 0;
  const char* name   = cmd["full_name"] | payload["full_name"] | "Student";
  const char* enroll = cmd["official_enrollment_no"] | payload["official_enrollment_no"] | "";
  uint8_t fingerIdx  = cmd["finger_index"] | payload["finger_index"] | 1;

  activeEnrollName = name;
  activeEnrollRoll = rollNo;
  ui.setWifiLed(true);
  ui.playTone(1400, 90);

  // Allocate first free slot (1..300)
  uint16_t localSlot = 1;
  if (!flashStorage.getNextFreeSlot(localSlot) || localSlot < 1 || localSlot > AS608_MAX_SLOTS) {
    fingerprintSensor.findFirstAvailableSlot(localSlot);
  }
  if (localSlot < 1 || localSlot > AS608_MAX_SLOTS) {
    localSlot = 1;
  }

  Serial.printf("[ENROLL] Starting enrollment for Student %lu (%s) into Slot #%u\n", (unsigned long)studentId, name, localSlot);
  ui.showEnrollmentScreen(name, rollNo, "1. Place Finger");

  uint8_t extractedTemplate[AS608_TEMPLATE_SIZE];
  uint16_t qualityScore = 96;

  bool ok = fingerprintSensor.enrollAndExtractTemplate(localSlot, extractedTemplate, qualityScore, onEnrollStageUpdate);
  if (!ok) {
    Serial.println(F("[ENROLL][ERROR] Biometric scan timed out or failed."));
    ui.chimeError();
    ui.flashFailLed(3, 150);
    ui.showEnrollmentScreen(name, rollNo, "Enroll Failed/Retry");
    delay(2000);
    currentUiState = UI_STATE_IDLE;
    lastDisplayMs = 0;
    return;
  }

  Serial.println(F("[ENROLL] Finger stored! Uploading template to server..."));
  ui.showEnrollmentScreen(name, rollNo, "Saving Template...");

  String tplB64 = VidyaCryptoEngine::base64Encode(extractedTemplate, AS608_TEMPLATE_SIZE);
  flashStorage.recordSlotAssignment(localSlot, studentId, enroll, name, rollNo);

  // Upload portable template with slot_id to server
  String uploadJson = "{";
  uploadJson += "\"command_id\":" + String(commandId) + ",";
  uploadJson += "\"student_id\":" + String(studentId) + ",";
  uploadJson += "\"slot_id\":" + String(localSlot) + ",";
  uploadJson += "\"finger_index\":" + String(fingerIdx) + ",";
  uploadJson += "\"quality_score\":" + String(qualityScore) + ",";
  uploadJson += "\"template_base64\":\"" + tplB64 + "\"";
  uploadJson += "}";

  String decryptedResp;
  bool uploaded = postEncryptedToServer("/template-upload", uploadJson, decryptedResp);
  Serial.printf("[ENROLL] Upload result: %s\n", uploaded ? "SUCCESS" : "OFFLINE/PENDING");

  ui.chimeEnrollSuccess();
  ui.setSuccessLed(true);
  ui.showEnrollmentScreen(name, rollNo, "FINGERPRINT SAVED!");
  delay(SUCCESS_LED_HOLD_MS);
  ui.setSuccessLed(false);

  currentUiState = UI_STATE_IDLE;
  lastDisplayMs = 0; // Immediate redraw of idle screen
}

/**
 * Drains unsynced offline attendance scans from W25Q32 SPI Flash to the server.
 * Protected by FreeRTOS mutex to guarantee thread-safety between Core 0 and Core 1.
 */
void syncOfflineQueueToServer() {
  if (WiFi.status() != WL_CONNECTED) return;

  OfflineAttendanceRecord batch[OFFLINE_SYNC_BATCH_SIZE];
  uint32_t indices[OFFLINE_SYNC_BATCH_SIZE];
  size_t count = 0;

  if (flashMutex != NULL && xSemaphoreTake(flashMutex, pdMS_TO_TICKS(500)) == pdTRUE) {
    if (flashStorage.getUnsyncedCount() > 0) {
      count = flashStorage.fetchUnsyncedBatch(batch, indices, OFFLINE_SYNC_BATCH_SIZE);
    }
    xSemaphoreGive(flashMutex);
  }

  if (count == 0) return;

  String json = "{\"scans\":[";
  for (size_t i = 0; i < count; i++) {
    if (i > 0) json += ",";
    json += "{";
    json += "\"event_id\":\"" + String(batch[i].event_id) + "\",";
    json += "\"student_id\":" + String(batch[i].student_id) + ",";
    json += "\"slot_id\":" + String(batch[i].as608_slot) + ",";
    json += "\"enrollment_no\":\"" + String(batch[i].enrollment_no) + "\",";
    json += "\"scanned_at\":" + String(batch[i].scanned_at_epoch) + ",";
    json += "\"confidence\":" + String(batch[i].confidence) + ",";
    json += "\"is_offline_sync\":true";
    json += "}";
  }
  json += "]}";

  String decryptedResp;
  if (postEncryptedToServer("/attendance", json, decryptedResp)) {
    Serial.printf("[Core 0][SYNC] Synchronized batch of %u offline attendance scans to server!\n", (unsigned int)count);
    if (flashMutex != NULL && xSemaphoreTake(flashMutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
      for (size_t i = 0; i < count; i++) {
        flashStorage.markRecordSynced(indices[i]);
      }
      xSemaphoreGive(flashMutex);
    }
  } else {
    Serial.println(F("[Core 0][SYNC] Server upload failed. Records preserved in local flash for retry."));
  }
}

/**
 * Connects to a specific Wi-Fi SSID with timeout.
 */
bool connectToNetwork(const String& ssid, const String& pass, uint32_t timeoutMs) {
  Serial.println();
  Serial.println(F("========================================"));
  Serial.println(F("[WiFi] Starting connection attempt"));
  Serial.print(F("[WiFi] SSID: "));
  Serial.println(ssid.length() ? ssid : String(F("<empty>")));

  if (ssid.length() == 0) {
    Serial.println(F("[WiFi][ERROR] SSID is empty. Check config.h."));
    return false;
  }

  WiFi.disconnect(true, true);
  delay(300);
  WiFi.mode(WIFI_STA);
  delay(100);
  WiFi.begin(ssid.c_str(), pass.c_str());

  const uint32_t startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - startedAt < timeoutMs)) {
    ui.setWifiLed(!digitalRead(LED_WIFI_PIN));
    delay(300);
    Serial.print(F("."));
  }
  Serial.println();

  const bool connected = (WiFi.status() == WL_CONNECTED);
  ui.setWifiLed(connected);

  if (connected) {
    currentConnectedSsid = WiFi.SSID();
    Serial.println(F("[WiFi][SUCCESS] Connected to Wi-Fi!"));
    Serial.print(F("[WiFi] IP address: "));
    Serial.println(WiFi.localIP());
    Serial.print(F("[WiFi] RSSI: "));
    Serial.print(WiFi.RSSI());
    Serial.println(F(" dBm"));
  } else {
    Serial.println(F("[WiFi][FAILED] Could not connect before timeout."));
  }
  Serial.println(F("========================================"));
  return connected;
}

/**
 * Initializes persistent Wi-Fi storage (NVS) and attempts connection
 * to Main Wi-Fi (Airtel_neer_3811) with instant fallback to Fallback Wi-Fi (vivot3lite).
 */
void initWifiManager() {
  Serial.println(F("[WiFi] Initializing Wi-Fi manager..."));
  wifiPrefs.begin(NVS_WIFI_NAMESPACE, false);
  wifiPrefs.clear(); // Wipe any stale custom NVS keys so it never connects to Airtel_Ruby!
  
  // Store default credentials
  defaultWifiSsid = WIFI_SSID;
  defaultWifiPass = WIFI_PASSWORD;
  wifiPrefs.putString("def_ssid", defaultWifiSsid);
  wifiPrefs.putString("def_pass", defaultWifiPass);

  // Erase any ESP-IDF cached credentials from old networks (e.g. Airtel_Ruby)
  WiFi.persistent(false);
  WiFi.disconnect(true, true);
  delay(200);

  WiFi.mode(WIFI_STA);
  wifiMulti.addAP(WIFI_SSID, WIFI_PASSWORD);
#if defined(FALLBACK_WIFI_SSID)
  wifiMulti.addAP(FALLBACK_WIFI_SSID, FALLBACK_WIFI_PASS);
#endif

  // 1. Attempt connection to Main Wi-Fi (Airtel_neer_3811)
  Serial.printf("[WiFi] Attempting connection to Main Wi-Fi: %s...\n", WIFI_SSID);
  ui.showBootScreen("CONNECTING WIFI", WIFI_SSID);
  bool ok = connectToNetwork(WIFI_SSID, WIFI_PASSWORD, 8000);

  // 2. If Main Wi-Fi fails or not reachable, attempt Fallback Wi-Fi (vivot3lite)
#if defined(FALLBACK_WIFI_SSID)
  if (!ok) {
    Serial.printf("[WiFi][FAILOVER] Main Wi-Fi unreachable. Connecting to Fallback: %s...\n", FALLBACK_WIFI_SSID);
    ui.showBootScreen("WIFI FALLBACK", FALLBACK_WIFI_SSID);
    ok = connectToNetwork(FALLBACK_WIFI_SSID, FALLBACK_WIFI_PASS, 8000);
  }
#endif

  if (ok) {
    currentConnectedSsid = WiFi.SSID();
  }
}

/**
 * Scans nearby Wi-Fi networks in real-time and transmits the report encrypted to the server.
 */
void scanNearbyWifiNetworksAndReport() {
  Serial.println(F("[WiFi] Scanning 2.4GHz Wi-Fi channels (1-13)..."));
  ui.setWifiLed(true);
  
  // Show animated scanning screen on 0.96" OLED
  ui.showWifiScanningScreen(1);
  delay(150);
  ui.showWifiScanningScreen(2);
  delay(150);

  int n = WiFi.scanNetworks();
  if (n < 0) n = 0;

  Serial.printf("[WiFi] Scan complete. Found %d access points.\n", n);
  ui.showWifiScanningScreen(5);
  delay(200);
  ui.showWifiScanComplete(n);
  delay(1000);

  String reportJson = "{\"networks\":[";
  for (int i = 0; i < n; i++) {
    if (i > 0) reportJson += ",";
    String encType = "OPEN";
    wifi_auth_mode_t auth = WiFi.encryptionType(i);
    if (auth == WIFI_AUTH_WPA_PSK) encType = "WPA_PSK";
    else if (auth == WIFI_AUTH_WPA2_PSK) encType = "WPA2_PSK";
    else if (auth == WIFI_AUTH_WPA_WPA2_PSK) encType = "WPA_WPA2_PSK";
    else if (auth == WIFI_AUTH_WPA2_ENTERPRISE) encType = "WPA2_ENTERPRISE";
    else if (auth == WIFI_AUTH_WPA3_PSK) encType = "WPA3_PSK";

    reportJson += "{";
    reportJson += "\"ssid\":\"" + WiFi.SSID(i) + "\",";
    reportJson += "\"bssid\":\"" + WiFi.BSSIDstr(i) + "\",";
    reportJson += "\"rssi\":" + String(WiFi.RSSI(i)) + ",";
    reportJson += "\"channel\":" + String(WiFi.channel(i)) + ",";
    reportJson += "\"encryption_type\":\"" + encType + "\"";
    reportJson += "}";
  }
  reportJson += "]}";

  String decryptedResp;
  postEncryptedToServer("/wifi-scan-report", reportJson, decryptedResp);

  if (ENABLE_MQTT_TELEMETRY && mqttClient.connected()) {
    mqttClient.publish(MQTT_TOPIC_WIFI_REPORT, reportJson.c_str());
  }
}

void handleScanWifiCommand(JsonObject cmd) {
  scanNearbyWifiNetworksAndReport();
}

void handleSwitchWifiCommand(JsonObject cmd) {
  JsonObject payload = cmd["payload"].is<JsonObject>() ? cmd["payload"].as<JsonObject>() : cmd;
  String ssid = payload["ssid"] | "";
  String pass = payload["password"] | "";
  bool isDef  = payload["is_default"] | false;

  if (ssid.length() == 0) return;

  if (isDef) {
    wifiPrefs.putString("def_ssid", ssid);
    wifiPrefs.putString("def_pass", pass);
    defaultWifiSsid = ssid;
    defaultWifiPass = pass;
  }

  bool ok = connectToNetwork(ssid, pass, WIFI_CONNECT_TIMEOUT_MS);
  if (ok) {
    currentConnectedSsid = ssid;
    wifiMulti.addAP(ssid.c_str(), pass.c_str());
    ui.setSuccessLed(true);
    ui.playTone(2000, 300);
    delay(500);
    ui.setSuccessLed(false);
  } else {
    ui.beepAttendanceFailed();
    connectToNetwork(defaultWifiSsid, defaultWifiPass, WIFI_FALLBACK_TIMEOUT_MS);
    currentConnectedSsid = defaultWifiSsid;
  }
}

void handleFallbackWifiCommand(JsonObject cmd) {
  bool ok = connectToNetwork(defaultWifiSsid, defaultWifiPass, WIFI_FALLBACK_TIMEOUT_MS);
  if (ok) {
    currentConnectedSsid = defaultWifiSsid;
    ui.setSuccessLed(true);
    ui.playTone(1800, 200);
    delay(300);
    ui.setSuccessLed(false);
  } else {
    connectToNetwork(DEFAULT_FACTORY_WIFI_SSID, DEFAULT_FACTORY_WIFI_PASS, WIFI_FALLBACK_TIMEOUT_MS);
    currentConnectedSsid = DEFAULT_FACTORY_WIFI_SSID;
  }
}

void handleResetWifiCommand(JsonObject cmd) {
  wifiPrefs.clear();
  defaultWifiSsid = DEFAULT_FACTORY_WIFI_SSID;
  defaultWifiPass = DEFAULT_FACTORY_WIFI_PASS;
  connectToNetwork(DEFAULT_FACTORY_WIFI_SSID, DEFAULT_FACTORY_WIFI_PASS, WIFI_FALLBACK_TIMEOUT_MS);
  currentConnectedSsid = DEFAULT_FACTORY_WIFI_SSID;
  ui.setFailLed(true);
  ui.playTone(1000, 500);
  delay(500);
  ui.setFailLed(false);
}

/**
 * Wireless Over-The-Air (OTA) Firmware Flasher
 * Downloads compiled binary from server, flashes standby partition, and restarts.
 */
bool performOtaUpdate(const String& binUrl) {
  if (WiFi.status() != WL_CONNECTED) {
    queueRemoteLog("ERROR", "OTA", "Cannot perform OTA update: Wi-Fi offline");
    return false;
  }
  queueRemoteLog("INFO", "OTA", "Starting wireless OTA download from: " + binUrl);

  ui.showBootScreen("OTA FIRMWARE UPDATE", "Connecting to server...");
  ui.setWifiLed(true);

  HTTPClient http;
  WiFiClientSecure secureClient;
  WiFiClient plainClient;
  bool began = false;
  http.setTimeout(35000);
  if (binUrl.startsWith("https://")) {
    secureClient.setInsecure();
    began = http.begin(secureClient, binUrl);
  } else {
    began = http.begin(plainClient, binUrl);
  }

  if (!began) {
    queueRemoteLog("ERROR", "OTA", "Failed to initialize HTTP client for: " + binUrl);
    ui.showAttendanceFailed("OTA Connect Failed", "Check server URL");
    return false;
  }

  int httpCode = http.GET();
  if (httpCode != 200) {
    queueRemoteLog("ERROR", "OTA", "HTTP GET failed with code: " + String(httpCode));
    ui.showAttendanceFailed("OTA HTTP Error", String(httpCode).c_str());
    http.end();
    return false;
  }

  int contentLength = http.getSize();
  queueRemoteLog("INFO", "OTA", "Firmware binary located: " + String(contentLength) + " bytes. Flashing partition...");
  if (contentLength <= 0) {
    queueRemoteLog("ERROR", "OTA", "Invalid firmware content length (0 bytes)");
    http.end();
    return false;
  }

  bool canBegin = Update.begin(contentLength);
  if (!canBegin) {
    queueRemoteLog("ERROR", "OTA", "Update.begin failed: insufficient partition space");
    ui.showAttendanceFailed("OTA Space Error", "Flash partition full");
    http.end();
    return false;
  }

  ui.showBootScreen("OTA FLASHING", "Writing flash partition...");
  WiFiClient* stream = http.getStreamPtr();
  size_t written = Update.writeStream(*stream);

  if (Update.end()) {
    if (Update.isFinished()) {
      queueRemoteLog("INFO", "OTA", "OTA flashing 100% complete (" + String((unsigned int)written) + " bytes)! Restarting ESP32...");
      ui.setSuccessLed(true);
      ui.showBootScreen("OTA UPDATE COMPLETE", "Restarting Node...");
      delay(1500);
      ESP.restart();
      return true;
    } else {
      queueRemoteLog("ERROR", "OTA", "Update did not finish properly");
    }
  } else {
    queueRemoteLog("ERROR", "OTA", "Update error #: " + String(Update.getError()));
    ui.showAttendanceFailed("OTA Write Error", "Checksum mismatch");
  }

  http.end();
  return false;
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  DynamicJsonDocument doc(2048);
  if (deserializeJson(doc, payload, length) == DeserializationError::Ok) {
    JsonObject cmd = doc.as<JsonObject>();
    String cmdType = cmd["command_type"] | "";
    if (cmdType == "SCAN_WIFI") handleScanWifiCommand(cmd);
    else if (cmdType == "SWITCH_WIFI") handleSwitchWifiCommand(cmd);
    else if (cmdType == "FALLBACK_WIFI") handleFallbackWifiCommand(cmd);
    else if (cmdType == "RESET_WIFI") handleResetWifiCommand(cmd);
    else if (cmdType == "CMD_OTA_UPDATE" || cmdType == "OTA_UPDATE") {
      String otaUrl = cmd["url"] | cmd["payload"]["url"] | "";
      if (otaUrl.length() > 0) performOtaUpdate(otaUrl);
    }
  }
}

void initMqtt() {
  if (!ENABLE_MQTT_TELEMETRY) return;
  mqttClient.setServer(MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  mqttClient.setCallback(onMqttMessage);
}

void maintainMqtt() {
  if (!ENABLE_MQTT_TELEMETRY || WiFi.status() != WL_CONNECTED) return;
  if (!mqttClient.connected()) {
    if (millis() - lastMqttRetryMs >= 10000UL) {
      lastMqttRetryMs = millis();
      if (mqttClient.connect(MQTT_CLIENT_ID)) {
        mqttClient.subscribe(MQTT_TOPIC_COMMANDS);
      }
    }
  } else {
    mqttClient.loop();
  }
}

void publishMqttTelemetry(float battVolts, int battPct) {
  if (!ENABLE_MQTT_TELEMETRY || !mqttClient.connected()) return;
  String p = "{";
  p += "\"device_uid\":\"" + String(DEVICE_UID) + "\",";
  p += "\"battery_voltage\":" + String(battVolts, 2) + ",";
  p += "\"battery_pct\":" + String(battPct) + ",";
  p += "\"wifi_rssi\":" + String(WiFi.RSSI()) + ",";
  p += "\"connected_ssid\":\"" + currentConnectedSsid + "\"";
  p += "}";
  mqttClient.publish(MQTT_TOPIC_TELEMETRY, p.c_str());
}

void sendHeartbeatAndProcessCommands() {
  if (WiFi.status() != WL_CONNECTED) return;

  float battVolts = ui.readBatteryVoltage();
  int   battPct   = ui.readBatteryPercentage(battVolts);

  uint32_t unsyncedCount = 0;
  uint32_t usedFlashKb   = 0;
  uint16_t enrolledCount = 0;
  if (flashMutex != NULL && xSemaphoreTake(flashMutex, pdMS_TO_TICKS(500)) == pdTRUE) {
    unsyncedCount = flashStorage.getUnsyncedCount();
    usedFlashKb   = flashStorage.getUsedFlashKb();
    enrolledCount = flashStorage.getEnrolledStudentCount();
    xSemaphoreGive(flashMutex);
  }

  String hbJson = "{";
  hbJson += "\"battery_voltage\":" + String(battVolts, 2) + ",";
  hbJson += "\"battery_pct\":" + String(battPct) + ",";
  hbJson += "\"offline_queue_count\":" + String(unsyncedCount) + ",";
  hbJson += "\"w25q32_used_kb\":" + String(usedFlashKb) + ",";
  hbJson += "\"as608_enrolled_count\":" + String(enrolledCount) + ",";
  hbJson += "\"wifi_rssi\":" + String(WiFi.RSSI()) + ",";
  hbJson += "\"connected_ssid\":\"" + currentConnectedSsid + "\",";
  hbJson += "\"firmware_version\":\"" + String(FIRMWARE_VERSION) + "\"";

  if (remoteLogCount > 0) {
    hbJson += ",\"logs\":[";
    for (int i = 0; i < remoteLogCount; i++) {
      if (i > 0) hbJson += ",";
      hbJson += "{\"level\":\"" + remoteLogQueue[i].level + "\",";
      hbJson += "\"tag\":\"" + remoteLogQueue[i].tag + "\",";
      String cleanMsg = remoteLogQueue[i].msg;
      cleanMsg.replace("\"", "\\\"");
      cleanMsg.replace("\n", " ");
      cleanMsg.replace("\r", "");
      hbJson += "\"message\":\"" + cleanMsg + "\"}";
    }
    hbJson += "]";
  }
  hbJson += "}";

  publishMqttTelemetry(battVolts, battPct);

  String hbResp;
  if (postEncryptedToServer("/heartbeat", hbJson, hbResp)) {
    remoteLogCount = 0; // Cleared successfully upon delivery
#if defined(ARDUINOJSON_VERSION_MAJOR) && (ARDUINOJSON_VERSION_MAJOR >= 7)
    JsonDocument doc;
#else
    DynamicJsonDocument doc(2048);
#endif
    if (deserializeJson(doc, hbResp) == DeserializationError::Ok) {
      uint16_t cloudCount = doc["cloud_template_count"] | 0;
      if (cloudCount > 0 && enrolledCount == 0) {
        syncDepartmentTemplatesFromServer();
      }

      JsonObject cmd = doc["command"];
      if (!cmd.isNull()) {
        lastActivityMs = millis();
        String cmdType = String((const char*)(cmd["command_type"] | ""));
        if (cmdType == "ENROLL_STUDENT") {
          handleRemoteStudentEnrollment(cmd);
        } else if (cmdType == "SYNC_TEMPLATES") {
          syncDepartmentTemplatesFromServer();
        } else if (cmdType == "BUZZER_CHIME") {
          ui.beepAttendanceSuccess();
        } else if (cmdType == "SCAN_WIFI") {
          handleScanWifiCommand(cmd);
        } else if (cmdType == "SWITCH_WIFI" || cmdType == "ADD_WIFI") {
          handleSwitchWifiCommand(cmd);
        } else if (cmdType == "FALLBACK_WIFI") {
          handleFallbackWifiCommand(cmd);
        } else if (cmdType == "RESET_WIFI") {
          handleResetWifiCommand(cmd);
        } else if (cmdType == "CMD_OTA_UPDATE" || cmdType == "OTA_UPDATE") {
          String otaUrl = String((const char*)(cmd["url"] | cmd["payload"]["url"] | ""));
          if (otaUrl.length() > 0) {
            performOtaUpdate(otaUrl);
          }
        }
      }
    }
  }
}

/**
 * FreeRTOS Background Wi-Fi & Cloud Synchronization Engine (Pinned to Core 0)
 * Completely decouples all networking from the local attendance marking engine on Core 1!
 */
void backgroundWifiSyncTask(void* pvParameters) {
  Serial.println(F("[Core 0] Background Wi-Fi & Cloud Sync Engine initialized."));
  
  wifiPrefs.begin(NVS_WIFI_NAMESPACE, false);
  defaultWifiSsid = WIFI_SSID;
  defaultWifiPass = WIFI_PASSWORD;

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  wifiMulti.addAP(WIFI_SSID, WIFI_PASSWORD);
#if defined(FALLBACK_WIFI_SSID)
  wifiMulti.addAP(FALLBACK_WIFI_SSID, FALLBACK_WIFI_PASS);
#endif

  initMqtt();

  // Asynchronous non-blocking Wi-Fi connect
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long wifiAttemptStartMs = millis();
  bool connectingToPrimary = true;

  while (true) {
    bool isConnected = (WiFi.status() == WL_CONNECTED);

    if (!isConnected) {
      ui.setWifiLed(false);

      // Auto-failover logic in background between Primary and Fallback routers
      if (connectingToPrimary && (millis() - wifiAttemptStartMs >= 10000UL)) {
#if defined(FALLBACK_WIFI_SSID)
        Serial.printf("[Core 0][WiFi] Primary Wi-Fi timeout. Switching to Fallback: %s\n", FALLBACK_WIFI_SSID);
        connectingToPrimary = false;
        wifiAttemptStartMs = millis();
        WiFi.begin(FALLBACK_WIFI_SSID, FALLBACK_WIFI_PASS);
#else
        wifiAttemptStartMs = millis();
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
#endif
      } else if (!connectingToPrimary && (millis() - wifiAttemptStartMs >= 10000UL)) {
        Serial.printf("[Core 0][WiFi] Fallback timeout. Retrying Main Wi-Fi: %s\n", WIFI_SSID);
        connectingToPrimary = true;
        wifiAttemptStartMs = millis();
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      }

      vTaskDelay(pdMS_TO_TICKS(1500));
      continue;
    }

    // ─── Wi-Fi Connected in Background ───
    ui.setWifiLed(true);
    currentConnectedSsid = WiFi.SSID();

    // 1. Maintain NTP time in background without blocking attendance
    static unsigned long lastNtpSyncMs = 0;
    if (millis() - lastNtpSyncMs >= 1800000UL || lastNtpSyncMs == 0) {
      lastNtpSyncMs = millis();
      configTime(19800, 0, "pool.ntp.org", "time.nist.gov");
    }

    // 2. Synchronize Unsynced Offline Attendance Records to Server
    if (flashMutex != NULL && xSemaphoreTake(flashMutex, pdMS_TO_TICKS(500)) == pdTRUE) {
      uint32_t unsynced = flashStorage.getUnsyncedCount();
      xSemaphoreGive(flashMutex);

      if (unsynced > 0) {
        syncOfflineQueueToServer();
      }
    }

    // 3. Periodic Heartbeat & Remote Command Polling
    if (millis() - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS) {
      lastHeartbeatMs = millis();
      sendHeartbeatAndProcessCommands();
    }

    // 4. Maintain MQTT if enabled
    maintainMqtt();

    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

void setup() {
  Serial.begin(115200);
  delay(100);

  esp_sleep_wakeup_cause_t wakeupReason = esp_sleep_get_wakeup_cause();
  Serial.println();
  Serial.println(F("=============================================="));
  Serial.println(F(" VIDYAOS ESP32 BIOMETRIC ATTENDANCE TERMINAL"));
  Serial.println(F(" Firmware: " FIRMWARE_VERSION));
  Serial.printf("[BOOT] Wakeup Cause: %d (%s) | Deep Sleep Cycles: %lu\n",
                wakeupReason,
                (wakeupReason == ESP_SLEEP_WAKEUP_EXT0) ? "TOUCH WAKEUP (GPIO 33)" :
                (wakeupReason == ESP_SLEEP_WAKEUP_TIMER) ? "TIMER WAKEUP" : "POWER-ON / USB RESET",
                (unsigned long)deepSleepCycleCount);
  Serial.println(F("=============================================="));

  // 1. Initialize Display & Peripherals
  ui.begin();
  if (wakeupReason == ESP_SLEEP_WAKEUP_EXT0) {
    ui.showWakingScreen(); // Prominently displays: "Ready / Scan Finger"
  } else {
    ui.showBootScreen("VIDYAOS TERMINAL", "Ready / Scan Finger");
  }

  // 2. Initialize Crypto Engine
  cryptoEngine.begin(DEVICE_AES_SECRET);

  // 3. Initialize Flash Storage (Ultra-resilient: runs RAM cache if flash not wired)
  flashStorage.begin();

  // 4. Initialize AS608 Fingerprint Sensor & turn backlight ON
  fingerprintSensor.begin();

  // 5. Create FreeRTOS Mutex for thread-safe flash access across CPU cores
  if (flashMutex == NULL) {
    flashMutex = xSemaphoreCreateMutex();
  }

  // 6. Launch Non-Blocking Background Wi-Fi & Server Sync Task on Core 0
  // Core 1 remains 100% dedicated to instant fingerprint scanning with zero network stutter!
  xTaskCreatePinnedToCore(
    backgroundWifiSyncTask,
    "WifiSyncTask",
    10240,
    NULL,
    1,
    &wifiSyncTaskHandle,
    0
  );

  lastActivityMs = millis();
  currentUiState = UI_STATE_IDLE;
  lastDisplayMs = 0; // Trigger immediate idle screen render
  ui.chimeBoot();
}

void loop() {
  float battVolts = ui.readBatteryVoltage();
  int   battPct   = ui.readBatteryPercentage(battVolts);
  bool  isOnline  = (WiFi.status() == WL_CONNECTED);

  // Interactive USB Serial Commands (Press 'e' for enrollment, 'p' for ping)
  if (Serial.available()) {
    char ch = Serial.read();
    if (ch == 'e' || ch == 'E') {
      Serial.println(F("\n[SERIAL] >>> Manual Enrollment Triggered via USB Serial! <<<"));
#if defined(ARDUINOJSON_VERSION_MAJOR) && (ARDUINOJSON_VERSION_MAJOR >= 7)
      JsonDocument testDoc;
#else
      DynamicJsonDocument testDoc(512);
#endif
      testDoc["student_id"] = 1;
      testDoc["full_name"] = "Student Enroll Test";
      testDoc["class_roll_no"] = 1;
      testDoc["official_enrollment_no"] = "2024IT001";
      handleRemoteStudentEnrollment(testDoc.as<JsonObject>());
    } else if (ch == 'p' || ch == 'P') {
      Serial.println(F("\n[SERIAL] >>> Manual Heartbeat Ping Triggered! <<<"));
      lastHeartbeatMs = 0;
    }
  }

  // 1. Battery Telemetry & Low Battery Warning (Every 10 seconds)
  if (millis() - lastBatteryCheckMs >= 10000UL) {
    lastBatteryCheckMs = millis();
    if (battVolts < BATTERY_LOW_THRESHOLD_VOLTS) {
      ui.setLowBattLed(true);
      if (millis() - lastLowBattAlertMs >= 60000UL) {
        lastLowBattAlertMs = millis();
        ui.showLowBatteryScreen(battVolts, battPct);
        ui.beepLowBattery();
      }
    } else {
      ui.setLowBattLed(false);
    }
  }

  // 2. Inactivity Watchdog: Enter Hardware Deep Sleep after 120s of no activity
#if defined(ENABLE_AUTO_SLEEP) && (ENABLE_AUTO_SLEEP == true)
  if (millis() - lastActivityMs >= INACTIVITY_SLEEP_TIMEOUT_MS) {
    enterHardwareDeepSleep();
    return;
  }
#endif

  // 3. Detect Finger Touch and Poll AS608 Fingerprint Sensor
  if (digitalRead(AS608_TOUCH_WAKE_PIN) == HIGH) {
    lastActivityMs = millis();
    if (currentUiState == UI_STATE_IDLE) {
      ui.showScanningScreen();
    }
  }

  uint16_t matchedSlot = 0;
  uint16_t confidence  = 0;
  int scanStatus = fingerprintSensor.pollAndSearch(matchedSlot, confidence);

  if (scanStatus != 0) {
    lastActivityMs = millis();
  }

  // ─── Attendance Scan Match Handling ───
  if (scanStatus == 1) {
    LocalStudentSlotEntry student;
    bool found = false;
    if (flashMutex != NULL && xSemaphoreTake(flashMutex, pdMS_TO_TICKS(500)) == pdTRUE) {
      found = flashStorage.lookupStudentBySlot(matchedSlot, student);
      xSemaphoreGive(flashMutex);
    }

    char fullTime[24];
    char shortTime[16];
    getFormattedTime(fullTime, sizeof(fullTime), shortTime, sizeof(shortTime));

    if (!found) {
      // Finger is in sensor but unassigned in local roster -> "Fingerprint Not Recognized"
      currentUiState = UI_STATE_BANNER;
      bannerExpireMs = millis() + UNREGISTERED_HOLD_MS;
      ui.setFailLed(true);
      ui.showFingerNotRegistered();
      ui.beepFingerNotRegistered();
      ui.setFailLed(false);
      fingerprintSensor.waitForFingerRelease(2000);
      lastActivityMs = millis();
    } else {
      time_t nowEpoch;
      time(&nowEpoch);
      if (nowEpoch < 100000) {
        nowEpoch = (millis() / 1000UL) + 1732000000UL;
      }

      // Duplicate attendance prevention (check recent scans cache across deep sleep)
      bool isDuplicate = false;
      for (int i = 0; i < RECENT_SCANS_CACHE_SIZE; i++) {
        if (recentScans[i].student_id == student.student_id) {
          if ((nowEpoch >= recentScans[i].epoch_sec) && ((nowEpoch - recentScans[i].epoch_sec) < DUPLICATE_COOLDOWN_SEC)) {
            isDuplicate = true;
            break;
          }
        }
      }

      if (isDuplicate) {
        // Situation: Duplicate Attendance -> "Attendance Already Marked"
        currentUiState = UI_STATE_BANNER;
        bannerExpireMs = millis() + 2500;
        ui.showDuplicateAttendance(student.enrollment_no, student.full_name, fullTime);
        ui.chimeError();
        fingerprintSensor.waitForFingerRelease(2000);
        lastActivityMs = millis();
      } else {
        // Record into recent scans cache for duplicate suppression
        recentScans[recentScanHead].student_id = student.student_id;
        recentScans[recentScanHead].epoch_sec = (uint32_t)nowEpoch;
        recentScanHead = (recentScanHead + 1) % RECENT_SCANS_CACHE_SIZE;

        char eventId[40];
        snprintf(eventId, sizeof(eventId), "EVT_%lu_%lu", (unsigned long)nowEpoch, (unsigned long)student.student_id);

        // Save immediately to persistent local storage (W25Q32 SPI Flash / RAM cache)
        if (flashMutex != NULL && xSemaphoreTake(flashMutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
          flashStorage.appendOfflineAttendance(
            student.student_id,
            matchedSlot,
            student.class_roll_no,
            student.full_name,
            student.enrollment_no,
            (uint32_t)nowEpoch,
            (uint8_t)confidence,
            eventId
          );
          xSemaphoreGive(flashMutex);
        }

        // Situation: Fingerprint Matched -> "Attendance Marked Successfully"
        currentUiState = UI_STATE_BANNER;
        bannerExpireMs = millis() + SUCCESS_LED_HOLD_MS;
        ui.setSuccessLed(true);
        ui.showAttendanceSuccess(student.enrollment_no, student.full_name, fullTime);
        ui.beepAttendanceSuccess(); // 2000 ms confirmation beep
        delay(500);                 // Total 2.5s hold
        ui.setSuccessLed(false);

        // Bounded wait for student to remove finger
        fingerprintSensor.waitForFingerRelease(2000);
        lastActivityMs = millis();
      }
    }
  } else if (scanStatus == -2) {
    // Situation: Unknown Fingerprint -> "Fingerprint Not Recognized"
    currentUiState = UI_STATE_BANNER;
    bannerExpireMs = millis() + UNREGISTERED_HOLD_MS;
    ui.setFailLed(true);
    ui.showFingerNotRegistered();
    ui.beepFingerNotRegistered(); // 1800 ms
    delay(200);
    ui.setFailLed(false);
    fingerprintSensor.waitForFingerRelease(2000);
    lastActivityMs = millis();
  }

  // ─── 5. Continuous OLED Display Update Engine ───
  // Automatically reverts banners back to IDLE after timeout
  if (currentUiState == UI_STATE_BANNER) {
    if (millis() >= bannerExpireMs) {
      currentUiState = UI_STATE_IDLE;
      lastDisplayMs = 0; // Trigger instant redraw of idle screen
    }
  }

  // Refreshes the idle screen every 1000ms with live ticking clock, RSSI, and battery!
  if (currentUiState == UI_STATE_IDLE) {
    if (millis() - lastDisplayMs >= 1000UL) {
      lastDisplayMs = millis();
      char dummyFull[24];
      char clockStr[16];
      getFormattedTime(dummyFull, sizeof(dummyFull), clockStr, sizeof(clockStr));

      ui.showIdleScreen(
        battPct,
        battVolts,
        isOnline,
        clockStr,
        isOnline ? WiFi.RSSI() : -99
      );
    }
  }

  delay(30);
}
