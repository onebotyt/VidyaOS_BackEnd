/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VIDYAOS ESP32 BIOMETRIC ATTENDANCE NODE — HARDWARE & CRYPTO CONFIGURATION
 * File: esp32_firmware/VidyaOS_ESP32_Biometric_Node/config.h
 *
 * Target Hardware:
 *   - MCU: ESP32-WROOM-32D / ESP32 DevKit V1
 *   - Biometric Sensor: AS608 Optical Fingerprint Reader (UART2 @ 57600 baud, Touch Wake GPIO 33)
 *   - Display: 0.96" I2C OLED SSD1306 (128x64 px, I2C 0x3C / 0x3D, SDA 21, SCL 22)
 *   - Offline Flash: W25Qxx 32Mbit (4MB) SPI NOR Flash Module (VSPI: CS 5, SCK 18, MISO 19, MOSI 23)
 *   - Audio: 5V Passive Piezo Buzzer (GPIO 14, 2N2222 NPN driver, LEDC PWM)
 *   - Visual Indicators (4 LEDs):
 *       - Wi-Fi LED (Blue): GPIO 27 (Solid = Wi-Fi Connected, Blinking = Reconnecting/Offline)
 *       - Success LED (Green): GPIO 25 (2.5s hold on successful attendance)
 *       - Failed LED (Red): GPIO 26 (Flashes on error or unregistered finger)
 *       - Low Battery LED (Amber): GPIO 4 (Turns ON/Blinks when battery < 20% / < 6.8V)
 *   - Power: 2S 3.7V Li-ion/LiPo Pack (7.4V Nom, 8.4V Max, 6.4V Cutoff) + ADC on GPIO 34
 *   - Sleep: Inactivity watchdog with touch-wake on AS608 WAK pin (GPIO 33)
 * ═══════════════════════════════════════════════════════════════════════════
 */

#ifndef VIDYAOS_ESP32_CONFIG_H
#define VIDYAOS_ESP32_CONFIG_H

// ─── 1. Wi-Fi & Institutional Server Configuration ──────────────────────────
#define WIFI_SSID                   "Airtel_Ruby"
#define WIFI_PASSWORD               "Rubyblack@567"

// Factory Fallback Wi-Fi Credentials
#define DEFAULT_FACTORY_WIFI_SSID   WIFI_SSID
#define DEFAULT_FACTORY_WIFI_PASS   WIFI_PASSWORD
#define NVS_WIFI_NAMESPACE          "vidya_wifi"

// Base URL of the VidyaOS Node.js / Express Backend
// Use Render HTTPS:
#define VIDYAOS_SERVER_BASE_URL     "https://vidyaos-backend.onrender.com/api/v1/devices/esp32"
// OR for local laptop testing (replace with your LAN IP):
// #define VIDYAOS_SERVER_BASE_URL  "http://192.168.1.15:5000/api/v1/devices/esp32"

// Unique Hardware Terminal UID & 256-Bit Shared Encryption Secret
// Copy these exact two values from HOD Portal -> /faculty/esp32-devices/ -> config.h
#define DEVICE_UID                  "ESP32-IT-LAB-01"
#define DEVICE_AES_SECRET           "8f4b2e9a1c7d6035a9e8f12b34c56d7890ab12cd34ef567890abcdef12345678"
#define FIRMWARE_VERSION            "v3.1.0-SECURE-BIOMETRIC-TERMINAL"

// ─── 2. Complete Pinout Definitions (ESP32 DevKit V1) ───────────────────────

// AS608 Optical Fingerprint Sensor (UART2)
#define AS608_UART_NUM              2
#define AS608_RX_PIN                16   // Connect to AS608 TX (Yellow/White)
#define AS608_TX_PIN                17   // Connect to AS608 RX (Green)
#define AS608_TOUCH_WAKE_PIN        33   // AS608 WAK / Touch sense pin (Active-HIGH interrupt)
#define AS608_BAUD_RATE             57600
#define AS608_MAX_SLOTS             300

// 0.96" SSD1306 I2C OLED Display (128x64 px)
#define OLED_SDA_PIN                21   // I2C Data line
#define OLED_SCL_PIN                22   // I2C Clock line
#define OLED_I2C_ADDR               0x3C // Primary I2C address (auto-falls back to 0x3D)
#define OLED_SCREEN_WIDTH           128
#define OLED_SCREEN_HEIGHT          64

// W25Qxx (W25Q32 / W25Q64 / W25Q128) SPI NOR Flash Module (VSPI)
#define W25Q32_CS_PIN               5    // VSPI Chip Select (Active LOW)
#define W25Q32_SCK_PIN              18   // VSPI Serial Clock
#define W25Q32_MISO_PIN             19   // VSPI Master-In Slave-Out (DO)
#define W25Q32_MOSI_PIN             23   // VSPI Master-Out Slave-In (DI)
#define W25Q32_TOTAL_BYTES          (4UL * 1024UL * 1024UL) // 4,194,304 Bytes
#define W25Q32_SECTOR_SIZE          4096

// Dedicated 4 Status LED Indicators
#define LED_WIFI_PIN                27   // Blue: Solid = Wi-Fi Connected, Blinking = Reconnecting/Offline
#define LED_SUCCESS_PIN             25   // Green: 2.5-second hold on successful attendance
#define LED_FAIL_PIN                26   // Red: Flashes on failed attendance or unregistered finger
#define LED_LOW_BATT_PIN            4    // Amber: Turns ON/Blinks when battery pack < 20% (< 6.8V)

// Backward-compatibility aliases
#define LED_BLUE_PIN                LED_WIFI_PIN
#define LED_GREEN_PIN               LED_SUCCESS_PIN
#define LED_RED_PIN                 LED_FAIL_PIN
#define LED_AMBER_PIN               LED_LOW_BATT_PIN

// Audio Feedback: 5V Passive Piezo Buzzer (Driven via 2N2222 NPN on GPIO 14)
#define BUZZER_PIN                  14
#define BUZZER_PWM_CHANNEL          0

// 2S 3.7V Li-ion Battery Telemetry (6.4V Cutoff - 8.4V Full)
// Connected via 100kΩ (top) / 33kΩ (bottom to GND) voltage divider -> Ratio = 4.0303
#define BATTERY_ADC_PIN             34   // ADC1_CH6 (Input-only, Wi-Fi safe)
#define BATTERY_DIVIDER_RATIO       4.0303f
#define BATTERY_MIN_VOLTAGE         6.40f // 0% (3.20V per cell cutoff)
#define BATTERY_MAX_VOLTAGE         8.40f // 100% (4.20V per cell full)
#define BATTERY_LOW_THRESHOLD_VOLTS 6.80f // 20% Low Battery Warning (< 6.8V)

// ─── 3. Timing Constants & Thresholds ───────────────────────────────────────
#define ENABLE_AUTO_SLEEP           false    // Set true ONLY if AS608 Pin 6 (WAK) is wired to GPIO 33
#define INACTIVITY_SLEEP_TIMEOUT_MS 120000UL // 2 minutes (120,000 ms) auto sleep
#define SUCCESS_LED_HOLD_MS         2500UL   // Green LED held for 2.5 seconds
#define UNREGISTERED_HOLD_MS        2000UL   // Red LED held for 2.0 seconds
#define FAILED_HOLD_MS              2000UL   // Red LED flash / failure hold
#define HEARTBEAT_INTERVAL_MS       8000UL   // Poll server / report telemetry every 8s
#define OFFLINE_SYNC_BATCH_SIZE     20       // Upload 20 offline records per batch
#define OLED_BANNER_HOLD_MS         2500UL   // Hold confirmation banner on OLED
#define WIFI_CONNECT_TIMEOUT_MS     12000UL  // Wi-Fi connection timeout
#define WIFI_FALLBACK_TIMEOUT_MS    8000UL   // Factory Wi-Fi fallback timeout

// ─── 4. Dual-Stack Telemetry: MQTT Broker Configuration (Optional) ───────────
#define ENABLE_MQTT_TELEMETRY       false    // Set true to enable dual-stack MQTT alongside HTTPS
#define MQTT_BROKER_HOST            "broker.emqx.io"
#define MQTT_BROKER_PORT            1883
#define MQTT_CLIENT_ID              "VidyaOS-ESP32-IT-01"
#define MQTT_TOPIC_TELEMETRY        "vidyaos/devices/ESP32-IT-LAB-01/telemetry"
#define MQTT_TOPIC_COMMANDS         "vidyaos/devices/ESP32-IT-LAB-01/commands"
#define MQTT_TOPIC_WIFI_REPORT      "vidyaos/devices/ESP32-IT-LAB-01/wifi_scan"

#endif // VIDYAOS_ESP32_CONFIG_H
