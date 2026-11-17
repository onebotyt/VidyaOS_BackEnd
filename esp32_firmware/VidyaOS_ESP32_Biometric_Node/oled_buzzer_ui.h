/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VIDYAOS 0.96" OLED DISPLAY, 5V PASSIVE BUZZER & 4-LED PERIPHERAL DRIVER
 * File: esp32_firmware/VidyaOS_ESP32_Biometric_Node/oled_buzzer_ui.h
 *
 * Implements the 6 Hardware Behavioral Conditions & Operational Modes:
 *   1. Successful Attendance:
 *      - 2-second continuous long beep (2400 Hz for 2000 ms)
 *      - Green LED Solid ON for 2.5 seconds
 *      - OLED: Header "SUCCESSFULLY MARKED", Enroll No, Student Name, Time
 *   2. Failed Attendance:
 *      - 3 continuous short beeps (3 × [150ms Beep + 100ms Silence])
 *      - Red LED Flashes 3 times
 *      - OLED: Header "ATTENDANCE FAILED", Reason, Retry prompt, Time
 *   3. Finger Not Registered:
 *      - Continuous rapid tone (< 2s) (800 Hz pulsed rapidly for 1800 ms)
 *      - Red LED Solid ON for 2.0 seconds
 *      - OLED: Header "NOT REGISTERED", Finger Not Found, Slot Unassigned, Contact HOD
 *   4. Low Battery Condition:
 *      - 5 beeps in 5 seconds (5 × [200ms Beep + 800ms Silence])
 *      - Amber LED Solid ON / Slow pulse
 *      - OLED: Banner "⚠️ LOW BATTERY", Battery Gauge [█░░░] 14% (6.68V), Charger Prompt
 *   5. Idle / Standby State:
 *      - Silent, Blue Wi-Fi LED ON (Blinks if offline)
 *      - OLED: Top bar RSSI + Battery, Center Institutional Clock, Bottom "Place Finger"
 *   6. Sleep Mode (< 2 min):
 *      - Display powered off (SSD1306_DISPLAYOFF), all LEDs OFF (Amber blinks if low batt)
 *      - Wakes immediately upon AS608 prism glass touch interrupt (GPIO 33)
 * ═══════════════════════════════════════════════════════════════════════════
 */

#ifndef VIDYAOS_OLED_BUZZER_UI_H
#define VIDYAOS_OLED_BUZZER_UI_H

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "config.h"

class VidyaPeripheralsUI {
private:
  Adafruit_SSD1306 display;

public:
  VidyaPeripheralsUI()
    : display(OLED_SCREEN_WIDTH, OLED_SCREEN_HEIGHT, &Wire, -1) {}

  void begin() {
    // 1. Initialize 4 Status LED GPIOs
    pinMode(LED_WIFI_PIN, OUTPUT);
    pinMode(LED_SUCCESS_PIN, OUTPUT);
    pinMode(LED_FAIL_PIN, OUTPUT);
    pinMode(LED_LOW_BATT_PIN, OUTPUT);
    turnOffAllLeds();

    // 2. Initialize Battery ADC pin
    pinMode(BATTERY_ADC_PIN, INPUT);

    // 3. Initialize 5V Passive Piezo Buzzer PWM channel (LEDC)
    ledcSetup(BUZZER_PWM_CHANNEL, 2000, 8);
    ledcAttachPin(BUZZER_PIN, BUZZER_PWM_CHANNEL);

    // 4. Initialize 0.96" SSD1306 I2C OLED (128x64)
    Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
    display.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDR);
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.display();
  }

  // ─── 1. Status LED Controls ───────────────────────────────────────────────
  void setWifiLed(bool on)     { digitalWrite(LED_WIFI_PIN, on ? HIGH : LOW); }
  void setSuccessLed(bool on)  { digitalWrite(LED_SUCCESS_PIN, on ? HIGH : LOW); }
  void setFailLed(bool on)     { digitalWrite(LED_FAIL_PIN, on ? HIGH : LOW); }
  void setLowBattLed(bool on)  { digitalWrite(LED_LOW_BATT_PIN, on ? HIGH : LOW); }

  void setAllLeds(bool wifi, bool success, bool fail, bool lowBatt) {
    setWifiLed(wifi);
    setSuccessLed(success);
    setFailLed(fail);
    setLowBattLed(lowBatt);
  }

  void turnOffAllLeds() {
    setAllLeds(false, false, false, false);
  }

  // Backward compatibility helper
  void setLeds(bool green, bool red, bool blue, bool amber = false) {
    setSuccessLed(green);
    setFailLed(red);
    setWifiLed(blue);
    setLowBattLed(amber);
  }

  void flashFailLed(int times = 3, int periodMs = 150) {
    for (int i = 0; i < times; i++) {
      setFailLed(true);
      delay(periodMs);
      setFailLed(false);
      delay(100);
    }
  }

  // ─── 2. 5V Passive Piezoelectric Buzzer Audio Profiles ───────────────────
  void playTone(uint32_t freqHz, uint32_t durationMs) {
    if (freqHz == 0 || durationMs == 0) {
      ledcWriteTone(BUZZER_PWM_CHANNEL, 0);
      return;
    }
    ledcWriteTone(BUZZER_PWM_CHANNEL, freqHz);
    delay(durationMs);
    ledcWriteTone(BUZZER_PWM_CHANNEL, 0);
  }

  /**
   * Profile 1: Successful Attendance
   * 2-Second Continuous Long Beep (2400 Hz tone uninterrupted for 2000 ms)
   */
  void beepAttendanceSuccess() {
    playTone(2400, 2000);
  }

  /**
   * Profile 2: Failed Attendance
   * 3 Continuous Short Beeps (3 × [150ms Beep + 100ms Silence])
   */
  void beepAttendanceFailed() {
    for (int i = 0; i < 3; i++) {
      playTone(1800, 150);
      delay(100);
    }
  }

  /**
   * Profile 3: Finger Not Registered
   * Continuous Rapid Tone (< 2s) (800 Hz pulsed rapidly for 1800 ms)
   */
  void beepFingerNotRegistered() {
    unsigned long start = millis();
    while (millis() - start < 1800) {
      playTone(800, 75);
      delay(35);
    }
    ledcWriteTone(BUZZER_PWM_CHANNEL, 0);
  }

  /**
   * Profile 4: Low Battery Condition
   * 5 Beeps in 5 Seconds (5 cycles of [200ms Beep + 800ms Silence])
   */
  void beepLowBattery() {
    for (int i = 0; i < 5; i++) {
      setLowBattLed(true);
      playTone(2000, 200);
      setLowBattLed(false);
      delay(800);
    }
  }

  void chimeBoot() {
    playTone(1046, 70); delay(25);
    playTone(1318, 70); delay(25);
    playTone(1568, 110);
  }

  void chimeEnrollSuccess() {
    playTone(1318, 80); delay(30);
    playTone(1568, 80); delay(30);
    playTone(2093, 160);
  }

  void chimeError() {
    playTone(420, 140); delay(40);
    playTone(310, 200);
  }

  // ─── 3. 2S 3.7V Battery Telemetry ─────────────────────────────────────────
  float readBatteryVoltage() {
    uint32_t mvSum = 0;
    for (int i = 0; i < 8; i++) {
      mvSum += analogReadMilliVolts(BATTERY_ADC_PIN);
    }
    float pinVolts = (mvSum / 8.0f) / 1000.0f;
    float packVolts = pinVolts * BATTERY_DIVIDER_RATIO;
    if (packVolts < 1.0f) return 7.85f; // Bench default if USB powered
    return packVolts;
  }

  int readBatteryPercentage(float packVolts) {
    float pct = ((packVolts - BATTERY_MIN_VOLTAGE) / (BATTERY_MAX_VOLTAGE - BATTERY_MIN_VOLTAGE)) * 100.0f;
    if (pct > 100.0f) pct = 100.0f;
    if (pct < 0.0f)   pct = 0.0f;
    return (int)round(pct);
  }

  int readBatteryPercentage() {
    return readBatteryPercentage(readBatteryVoltage());
  }

  // ─── 4. OLED Display Power State Management (Sleep / Wake) ────────────────
  void powerOffDisplay() {
    display.ssd1306_command(SSD1306_DISPLAYOFF);
  }

  void powerOnDisplay() {
    display.ssd1306_command(SSD1306_DISPLAYON);
  }

  // ─── 5. OLED Screen Renderers (128x64 px) ─────────────────────────────────

  /**
   * Helper: Draw standard battery gauge text, e.g. "[████] 88%" or "[█░░░] 14%"
   */
  static void formatBatteryGauge(char* outBuf, size_t bufSize, int pct, float volts = 0.0f) {
    const char* bar = "[░░░░]";
    if (pct >= 75)      bar = "[████]";
    else if (pct >= 50) bar = "[███░]";
    else if (pct >= 25) bar = "[██░░]";
    else if (pct >= 10) bar = "[█░░░]";

    if (volts > 0.1f) {
      snprintf(outBuf, bufSize, "%s %d%% (%.2fV)", bar, pct, volts);
    } else {
      snprintf(outBuf, bufSize, "%s %d%%", bar, pct);
    }
  }

  /**
   * Screen 1: Successful Attendance
   * Header: SUCCESSFULLY MARKED
   * Line 1: Enroll: 2024IT005
   * Line 2: Arjun Rao
   * Line 3: Time: 10:45:12 AM
   */
  void showAttendanceSuccess(const char* enrollmentNo, const char* fullName, const char* timeStr) {
    display.clearDisplay();
    // Header Banner (Inverted bar for high institutional visibility)
    display.fillRect(0, 0, 128, 14, SSD1306_WHITE);
    display.setTextColor(SSD1306_BLACK);
    display.setTextSize(1);
    display.setCursor(6, 3);
    display.print("SUCCESSFULLY MARKED");

    display.setTextColor(SSD1306_WHITE);

    // Line 1: Enrollment Number
    display.setCursor(2, 19);
    display.print("Enroll: ");
    display.print((enrollmentNo && strlen(enrollmentNo) > 0) ? enrollmentNo : "2024IT005");

    // Line 2: Student Full Name
    display.setCursor(2, 33);
    char nameBuf[22];
    strncpy(nameBuf, (fullName && strlen(fullName) > 0) ? fullName : "Student", 21);
    nameBuf[21] = '\0';
    display.print(nameBuf);

    // Line 3: Timestamp
    display.setCursor(2, 49);
    display.print("Time: ");
    display.print((timeStr && strlen(timeStr) > 0) ? timeStr : "10:45:12 AM");

    display.display();
  }

  /**
   * Screen 2: Failed Attendance
   * Header: ATTENDANCE FAILED
   * Line 1: Class / Register Error
   * Line 2: Retry or Check Admin
   * Line 3: Time: 10:45:14 AM
   */
  void showAttendanceFailed(const char* reason, const char* timeStr) {
    display.clearDisplay();
    // Header Banner
    display.fillRect(0, 0, 128, 14, SSD1306_WHITE);
    display.setTextColor(SSD1306_BLACK);
    display.setTextSize(1);
    display.setCursor(14, 3);
    display.print("ATTENDANCE FAILED");

    display.setTextColor(SSD1306_WHITE);

    // Line 1: Error reason
    display.setCursor(2, 19);
    char reasonBuf[22];
    strncpy(reasonBuf, (reason && strlen(reason) > 0) ? reason : "Class / Register Error", 21);
    reasonBuf[21] = '\0';
    display.print(reasonBuf);

    // Line 2: Prompt
    display.setCursor(2, 33);
    display.print("Retry or Check Admin");

    // Line 3: Timestamp
    display.setCursor(2, 49);
    display.print("Time: ");
    display.print((timeStr && strlen(timeStr) > 0) ? timeStr : "10:45:14 AM");

    display.display();
  }

  /**
   * Screen 3: Finger Not Registered
   * Header: NOT REGISTERED
   * Line 1: Finger Not Found
   * Line 2: Slot Unassigned
   * Line 3: Contact HOD Office
   */
  void showFingerNotRegistered() {
    display.clearDisplay();
    display.fillRect(0, 0, 128, 14, SSD1306_WHITE);
    display.setTextColor(SSD1306_BLACK);
    display.setTextSize(1);
    display.setCursor(20, 3);
    display.print("NOT REGISTERED");

    display.setTextColor(SSD1306_WHITE);
    display.setCursor(4, 20);
    display.print("Finger Not Found");

    display.setCursor(4, 34);
    display.print("Slot Unassigned");

    display.setCursor(4, 49);
    display.print("Contact HOD Office");

    display.display();
  }

  /**
   * Screen 4: Low Battery Condition
   * Top Banner: ⚠️ LOW BATTERY
   * Battery Gauge: [█░░░] 14% (6.68V)
   * Prompt: Connect 5V/9V Charger
   */
  void showLowBatteryScreen(float battVolts, int battPct) {
    display.clearDisplay();
    display.fillRect(0, 0, 128, 14, SSD1306_WHITE);
    display.setTextColor(SSD1306_BLACK);
    display.setTextSize(1);
    display.setCursor(16, 3);
    display.print("! LOW BATTERY !");

    display.setTextColor(SSD1306_WHITE);

    // Battery Gauge
    char gaugeBuf[32];
    formatBatteryGauge(gaugeBuf, sizeof(gaugeBuf), battPct, battVolts);
    display.setCursor(4, 24);
    display.print(gaugeBuf);

    // Prompt
    display.drawRoundRect(2, 42, 124, 20, 3, SSD1306_WHITE);
    display.setCursor(6, 48);
    display.print("Connect Charger Now");

    display.display();
  }

  /**
   * Screen 5: Idle / Standby State
   * Top Bar: Wi-Fi RSSI • Battery % ([████] 88%)
   * Center: Institutional Clock (10:45 AM)
   * Bottom: 👉 Place Finger to Scan
   */
  void showIdleScreen(int batteryPct, float batteryVolts, bool isWifiConnected, const char* currentTimeStr, int rssi = -60) {
    display.clearDisplay();

    // Top Status Bar (Solid Bar)
    display.fillRect(0, 0, 128, 12, SSD1306_WHITE);
    display.setTextColor(SSD1306_BLACK);
    display.setTextSize(1);
    display.setCursor(2, 2);

    if (isWifiConnected) {
      display.print("WiFi ");
      display.print(rssi);
      display.print("dB");
    } else {
      display.print("OFFLINE");
    }

    char gauge[16];
    snprintf(gauge, sizeof(gauge), "%d%% %.1fV", batteryPct, batteryVolts);
    int16_t x = 128 - (strlen(gauge) * 6) - 2;
    display.setCursor(max((int)x, 56), 2);
    display.print(gauge);

    display.setTextColor(SSD1306_WHITE);

    // Center: Institutional Clock (Size 2)
    display.setTextSize(2);
    display.setCursor(16, 22);
    if (currentTimeStr && strlen(currentTimeStr) > 0) {
      display.print(currentTimeStr);
    } else {
      display.print("10:45 AM");
    }

    // Bottom: Institutional Prompt
    display.setTextSize(1);
    display.drawRoundRect(2, 46, 124, 17, 3, SSD1306_WHITE);
    display.setCursor(6, 51);
    display.print("Place Finger to Scan");

    display.display();
  }

  /**
   * Sleep transition banner before powering down OLED
   */
  void showSleepBanner(int battPct) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setCursor(14, 18);
    display.print("ENTERING SLEEP...");
    display.setCursor(8, 34);
    display.print("Touch Prism to Wake");
    char battBuf[24];
    snprintf(battBuf, sizeof(battBuf), "Battery: %d%%", battPct);
    display.setCursor(24, 48);
    display.print(battBuf);
    display.display();
  }

  /**
   * Screen shown immediately upon touch wakeup
   */
  void showWakingScreen() {
    display.clearDisplay();
    display.setTextSize(1);
    display.setCursor(20, 22);
    display.print("TOUCH DETECTED");
    display.setCursor(16, 38);
    display.print("Terminal Ready...");
    display.display();
  }

  // Interactive Remote Enrollment Guide Screen
  void showEnrollmentScreen(const char* studentName, uint16_t rollNo, const char* stepPrompt) {
    display.clearDisplay();
    display.fillRect(0, 0, 128, 12, SSD1306_WHITE);
    display.setTextColor(SSD1306_BLACK);
    display.setCursor(6, 2);
    display.print("ENROLL FINGERPRINT");
    display.setTextColor(SSD1306_WHITE);

    display.setCursor(4, 16);
    char nameBuf[22];
    strncpy(nameBuf, studentName ? studentName : "Student", 21);
    nameBuf[21] = '\0';
    display.print(nameBuf);

    display.setCursor(4, 28);
    display.print("Roll No: #");
    display.print(rollNo);

    display.drawRoundRect(2, 40, 124, 22, 3, SSD1306_WHITE);
    display.setCursor(6, 47);
    display.print(stepPrompt);
    display.display();
  }
};

#endif // VIDYAOS_OLED_BUZZER_UI_H
