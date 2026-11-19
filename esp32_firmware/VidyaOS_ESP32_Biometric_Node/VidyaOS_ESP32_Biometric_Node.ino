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

/**
 * Posts an AES-256-GCM encrypted JSON payload to the VidyaOS backend and decrypts the response.
 * Features automatic HTTPS (WiFiClientSecure with setInsecure()) & HTTP (WiFiClient) resolution,
 * 25-second timeout for Render cold-starts, and 32KB JSON parsing buffer for template bundles.
 */
bool postEncryptedToServer(const String& endpointPath, const String& plainJson, String& outDecryptedJson) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] Skipped: Wi-Fi not connected");
    return false;
  }

  HTTPClient http;
  WiFiClientSecure secureClient;
  WiFiClient plainClient;
  String url = String(VIDYAOS_SERVER_BASE_URL) + endpointPath;

  http.setTimeout(25000); // 25s timeout for Render cold start
  bool began = false;
  if (url.startsWith("https://")) {
    secureClient.setInsecure(); // Allow HTTPS to Render without embedding CA cert
    began = http.begin(secureClient, url);
  } else {
    began = http.begin(plainClient, url);
  }

  if (!began) {
    Serial.println("[HTTP] http.begin() failed for: " + url);
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

/**
 * Enters Low-Power Light Sleep after 2 minutes of inactivity.
 * Preserves RAM & flash state, wakes immediately upon finger touch on AS608 prism (GPIO 33).
 */
void enterLowPowerSleep() {
  float battVolts = ui.readBatteryVoltage();
  int battPct = ui.readBatteryPercentage(battVolts);

  // 1. Show brief sleep banner on OLED then turn off display controller
  ui.showSleepBanner(battPct);
  delay(800);
  ui.powerOffDisplay();

  // Turn off LEDs (keep amber indicator if battery is low)
  ui.turnOffAllLeds();
  if (battVolts < BATTERY_LOW_THRESHOLD_VOLTS) {
    ui.setLowBattLed(true);
  }

  // 2. Turn off AS608 optical LED
  fingerprintSensor.setBacklight(false);

  // 3. Configure Touch Wakeup on GPIO 33 (Active HIGH) & safe backup timer wakeup
  pinMode(AS608_TOUCH_WAKE_PIN, INPUT_PULLDOWN);
  esp_sleep_enable_ext0_wakeup((gpio_num_t)AS608_TOUCH_WAKE_PIN, 1);
  esp_sleep_enable_timer_wakeup(60ULL * 1000000ULL); // 60s backup wake timer

  // 4. Enter Light Sleep (preserves RAM, W25Qxx state, and instant resumption)
  esp_light_sleep_start();

  // 5. Execution resumes right here upon finger touch!
  lastActivityMs = millis();
  ui.powerOnDisplay();
  fingerprintSensor.setBacklight(true);
  ui.showWakingScreen();
  delay(500);

  currentUiState = UI_STATE_IDLE;
  lastDisplayMs = 0; // Trigger immediate idle redraw
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
 */
void syncOfflineQueueToServer() {
  if (WiFi.status() != WL_CONNECTED || flashStorage.getUnsyncedCount() == 0) return;

  OfflineAttendanceRecord batch[OFFLINE_SYNC_BATCH_SIZE];
  uint32_t indices[OFFLINE_SYNC_BATCH_SIZE];
  size_t count = flashStorage.fetchUnsyncedBatch(batch, indices, OFFLINE_SYNC_BATCH_SIZE);
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
    for (size_t i = 0; i < count; i++) {
      flashStorage.markRecordSynced(indices[i]);
    }
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
 * to the stored default network, with automatic fallback to factory credentials.
 */
void initWifiManager() {
  Serial.println(F("[WiFi] Initializing Wi-Fi manager..."));
  wifiPrefs.begin(NVS_WIFI_NAMESPACE, false);
  
  // Always synchronize primary credentials from config.h to NVS
  defaultWifiSsid = DEFAULT_FACTORY_WIFI_SSID;
  defaultWifiPass = DEFAULT_FACTORY_WIFI_PASS;
  wifiPrefs.putString("def_ssid", defaultWifiSsid);
  wifiPrefs.putString("def_pass", defaultWifiPass);

  WiFi.mode(WIFI_STA);
  wifiMulti.addAP(defaultWifiSsid.c_str(), defaultWifiPass.c_str());

  bool ok = connectToNetwork(defaultWifiSsid, defaultWifiPass, WIFI_CONNECT_TIMEOUT_MS);
  if (ok) {
    currentConnectedSsid = WiFi.SSID();
  }
}

/**
 * Scans nearby Wi-Fi networks in real-time and transmits the report encrypted to the server.
 */
void scanNearbyWifiNetworksAndReport() {
  ui.setWifiLed(true);
  int n = WiFi.scanNetworks();
  if (n < 0) n = 0;

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

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  DynamicJsonDocument doc(2048);
  if (deserializeJson(doc, payload, length) == DeserializationError::Ok) {
    JsonObject cmd = doc.as<JsonObject>();
    String cmdType = cmd["command_type"] | "";
    if (cmdType == "SCAN_WIFI") handleScanWifiCommand(cmd);
    else if (cmdType == "SWITCH_WIFI") handleSwitchWifiCommand(cmd);
    else if (cmdType == "FALLBACK_WIFI") handleFallbackWifiCommand(cmd);
    else if (cmdType == "RESET_WIFI") handleResetWifiCommand(cmd);
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

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println(F("=============================================="));
  Serial.println(F(" VIDYAOS ESP32 BIOMETRIC ATTENDANCE TERMINAL"));
  Serial.println(F(" Firmware: " FIRMWARE_VERSION));
  Serial.println(F("=============================================="));

  // 1. Initialize Display & Peripherals
  ui.begin();
  ui.showBootScreen("VIDYAOS TERMINAL", "Initializing HW...");

  // 2. Initialize Crypto Engine
  cryptoEngine.begin(DEVICE_AES_SECRET);

  // 3. Initialize Flash Storage (Ultra-resilient: runs RAM cache if flash not wired)
  ui.showBootScreen("VIDYAOS TERMINAL", "Checking Storage...");
  flashStorage.begin();

  // 4. Initialize AS608 Fingerprint Sensor
  ui.showBootScreen("VIDYAOS TERMINAL", "Checking AS608...");
  fingerprintSensor.begin();

  // 5. Initialize Wi-Fi
  ui.showBootScreen("VIDYAOS TERMINAL", "Connecting WiFi...");
  initWifiManager();
  initMqtt();

  if (WiFi.status() == WL_CONNECTED) {
    ui.setWifiLed(true);
    configTime(19800, 0, "pool.ntp.org", "time.nist.gov"); // IST UTC+5:30
    Serial.println(F("[BOOT] Wi-Fi is ready. Device online."));
    ui.showBootScreen("TERMINAL READY", WiFi.localIP().toString().c_str());
  } else {
    ui.setWifiLed(false);
    Serial.println(F("[BOOT][WARNING] Wi-Fi offline. Local mode active."));
    ui.showBootScreen("OFFLINE READY", "Local Mode Active");
  }

  delay(600);
  ui.chimeBoot();
  lastActivityMs = millis();
  currentUiState = UI_STATE_IDLE;
  lastDisplayMs = 0; // Trigger immediate idle screen render
}

void loop() {
  float battVolts = ui.readBatteryVoltage();
  int   battPct   = ui.readBatteryPercentage(battVolts);
  bool  isOnline  = (WiFi.status() == WL_CONNECTED);

  // Print disconnect once and retry Wi-Fi periodically without blocking the main loop.
  static bool wasWifiConnected = false;
  if (isOnline && !wasWifiConnected) {
    wasWifiConnected = true;
    currentConnectedSsid = WiFi.SSID();
    Serial.println(F("[WiFi][CONNECTED] Network active."));
    configTime(19800, 0, "pool.ntp.org", "time.nist.gov");
  } else if (!isOnline && wasWifiConnected) {
    wasWifiConnected = false;
    Serial.println(F("[WiFi][DISCONNECTED] Network lost."));
    ui.setWifiLed(false);
  }

  if (!isOnline && millis() - lastWifiReconnectMs >= 15000UL) {
    lastWifiReconnectMs = millis();
    WiFi.reconnect();
  }

  // 1. Wi-Fi Status LED & Dual-Stack MQTT Maintenance
  maintainMqtt();
  if (isOnline) {
    ui.setWifiLed(true);
  } else {
    static unsigned long lastBlinkMs = 0;
    if (millis() - lastBlinkMs >= 500) {
      lastBlinkMs = millis();
      ui.setWifiLed(!digitalRead(LED_WIFI_PIN));
    }
  }

  // 2. Battery Telemetry & Low Battery Warning (Every 10 seconds)
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

  // 3. Inactivity Watchdog: Enter Light Sleep only if configured
#if defined(ENABLE_AUTO_SLEEP) && (ENABLE_AUTO_SLEEP == true)
  if (millis() - lastActivityMs >= INACTIVITY_SLEEP_TIMEOUT_MS) {
    enterLowPowerSleep();
    return;
  }
#endif

  // 4. Poll AS608 Fingerprint Sensor for Attendance Scan
  uint16_t matchedSlot = 0;
  uint16_t confidence  = 0;
  int scanStatus = fingerprintSensor.pollAndSearch(matchedSlot, confidence);

  if (scanStatus != 0) {
    lastActivityMs = millis();
  }

  // ─── Attendance Scan Match Handling ───
  if (scanStatus == 1) {
    LocalStudentSlotEntry student;
    bool found = flashStorage.lookupStudentBySlot(matchedSlot, student);

    char fullTime[24];
    char shortTime[16];
    getFormattedTime(fullTime, sizeof(fullTime), shortTime, sizeof(shortTime));

    if (!found) {
      // Finger is in sensor but unassigned in local flash/RAM roster
      currentUiState = UI_STATE_BANNER;
      bannerExpireMs = millis() + UNREGISTERED_HOLD_MS;
      ui.setFailLed(true);
      ui.showFingerNotRegistered();
      ui.beepFingerNotRegistered();
      delay(200);
      ui.setFailLed(false);
    } else {
      time_t nowEpoch;
      time(&nowEpoch);
      char eventId[40];
      snprintf(eventId, sizeof(eventId), "EVT_%lu_%lu", (unsigned long)nowEpoch, (unsigned long)student.student_id);

      bool attendanceRecorded = false;
      bool serverRejected     = false;
      String serverTimeStr    = String(fullTime);

      if (isOnline) {
        String scanJson = "{\"device_uid\":\"" + String(DEVICE_UID) + "\",\"scans\":[{";
        scanJson += "\"event_id\":\"" + String(eventId) + "\",";
        scanJson += "\"student_id\":" + String(student.student_id) + ",";
        scanJson += "\"slot_id\":" + String(matchedSlot) + ",";
        scanJson += "\"enrollment_no\":\"" + String(student.enrollment_no) + "\",";
        scanJson += "\"confidence\":" + String(confidence) + ",";
        scanJson += "\"scanned_at\":" + String((unsigned long)nowEpoch) + ",";
        scanJson += "\"is_offline_sync\":false";
        scanJson += "}]}";

        String respJson;
        if (postEncryptedToServer("/attendance", scanJson, respJson)) {
          StaticJsonDocument<2048> doc;
          if (deserializeJson(doc, respJson) == DeserializationError::Ok) {
            bool ok = doc["success"] | false;
            String status = String((const char*)(doc["status"] | ""));
            if (ok || status == "ATTENDANCE_MARKED") {
              attendanceRecorded = true;
              const char* t = doc["time"] | doc["data"]["time"] | "";
              if (t && strlen(t) > 0) serverTimeStr = String(t);
            } else {
              serverRejected = true;
            }
          } else {
            attendanceRecorded = true;
          }
        } else {
          if (WiFi.status() == WL_CONNECTED) {
            serverRejected = true;
          }
        }
      }

      if (serverRejected) {
        // Mode 2: Failed Attendance
        currentUiState = UI_STATE_BANNER;
        bannerExpireMs = millis() + FAILED_HOLD_MS;
        ui.showAttendanceFailed("Class / Register Error", serverTimeStr.c_str());
        for (int i = 0; i < 3; i++) {
          ui.setFailLed(true);
          ui.playTone(1800, 150);
          ui.setFailLed(false);
          delay(100);
        }
      } else {
        // Online success or offline fallback
        if (!isOnline || !attendanceRecorded) {
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
        }

        // Mode 1: Successful Attendance (2s beep, 2.5s Green LED)
        currentUiState = UI_STATE_BANNER;
        bannerExpireMs = millis() + SUCCESS_LED_HOLD_MS;
        ui.setSuccessLed(true);
        ui.showAttendanceSuccess(student.enrollment_no, student.full_name, serverTimeStr.c_str());
        ui.beepAttendanceSuccess(); // 2000 ms
        delay(500);                 // Total 2.5s hold
        ui.setSuccessLed(false);
      }
    }
  }
  // ─── Mode 3: Finger Not Registered ───
  else if (scanStatus == -2) {
    currentUiState = UI_STATE_BANNER;
    bannerExpireMs = millis() + UNREGISTERED_HOLD_MS;
    ui.setFailLed(true);
    ui.showFingerNotRegistered();
    ui.beepFingerNotRegistered(); // 1800 ms
    delay(200);
    ui.setFailLed(false);
  }

  // 5. Periodic Heartbeat, Offline Sync & Remote Command Poll
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
      hbJson += "\"connected_ssid\":\"" + currentConnectedSsid + "\",";
      hbJson += "\"firmware_version\":\"" + String(FIRMWARE_VERSION) + "\"";
      hbJson += "}";

      publishMqttTelemetry(battVolts, battPct);

      String hbResp;
      if (postEncryptedToServer("/heartbeat", hbJson, hbResp)) {
        StaticJsonDocument<2048> doc;
        if (deserializeJson(doc, hbResp) == DeserializationError::Ok) {
          uint16_t cloudCount = doc["cloud_template_count"] | 0;
          if (cloudCount > 0 && flashStorage.getEnrolledStudentCount() == 0) {
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
            }
          }
        }
      }
    }
  }

  // ─── 6. Continuous OLED Display Update Engine ───
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
