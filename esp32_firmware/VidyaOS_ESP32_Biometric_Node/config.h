/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VIDYAOS ESP32 BIOMETRIC ATTENDANCE NODE — HARDWARE & CRYPTO CONFIGURATION
 * File: esp32_firmware/VidyaOS_ESP32_Biometric_Node/config.h
 *
 * Target Hardware:
 *   - MCU: ESP32-WROOM-32D / ESP32 DevKit V1
 *   - Biometric Sensor: AS608 Optical Fingerprint Reader (UART2 @ 57600 baud)
 *   - Display: 0.96" I2C OLED SSD1306 (128x64 px, I2C 0x3C)
 *   - Offline Flash: W25Q32 32Mbit (4MB) SPI NOR Flash Module (VSPI)
 *   - Audio: 5V Passive Piezoelectric Buzzer (LEDC PWM Tone Generator)
 *   - Visual Indicators: Green LED (Verified), Red LED (Error), Blue LED (Sync/Enroll)
 *   - Power: 2S 3.7V Li-ion/LiPo Battery Pack (7.4V Nominal, 8.4V Max, 6.4V Cutoff)
 * ═══════════════════════════════════════════════════════════════════════════
 */

#ifndef VIDYAOS_ESP32_CONFIG_H
#define VIDYAOS_ESP32_CONFIG_H

// ─── 1. Wi-Fi & Institutional Server Configuration ──────────────────────────
#define WIFI_SSID               "GP_NAINITAL_CAMPUS_WIFI"
#define WIFI_PASSWORD           "CampusWiFi@2026"

// Base URL of the VidyaOS Node.js / Express Backend
#define VIDYAOS_SERVER_BASE_URL "https://api.gpnainital.com/api/v1/devices/esp32"

// Unique Hardware Terminal UID & 256-Bit Shared Encryption Secret
// (Copy these directly from the HOD ESP32 Management Portal when pairing)
#define DEVICE_UID              "ESP32-IT-LAB-01"
#define DEVICE_AES_SECRET       "8f4b2e9a1c7d6035a9e8f12b34c56d7890ab12cd34ef567890abcdef12345678"
#define FIRMWARE_VERSION        "v3.0.0-AES256-W25Q32"

// ─── 2. Pinout Definitions (ESP32 DevKit V1) ────────────────────────────────

// AS608 Optical Fingerprint Sensor (UART2)
#define AS608_UART_NUM          2
#define AS608_RX_PIN            16   // Connect to AS608 TX (Yellow/White)
#define AS608_TX_PIN            17   // Connect to AS608 RX (Green)
#define AS608_TOUCH_WAKE_PIN    33   // Optional AS608 WAK/Touch sense pin
#define AS608_BAUD_RATE         57600
#define AS608_MAX_SLOTS         300

// 0.96" SSD1306 I2C OLED Display (128x64)
#define OLED_SDA_PIN            21
#define OLED_SCL_PIN            22
#define OLED_I2C_ADDR           0x3C
#define OLED_SCREEN_WIDTH       128
#define OLED_SCREEN_HEIGHT      64

// W25Q32 Large Capacity 4MB (32Mbit) SPI Flash Module (VSPI)
#define W25Q32_CS_PIN           5
#define W25Q32_SCK_PIN          18
#define W25Q32_MISO_PIN         19
#define W25Q32_MOSI_PIN         23
#define W25Q32_TOTAL_BYTES      (4UL * 1024UL * 1024UL) // 4,194,304 Bytes
#define W25Q32_SECTOR_SIZE      4096

// Status LED Indicators
#define LED_GREEN_PIN           25   // Attendance Marked / Enrollment Success
#define LED_RED_PIN             26   // Unrecognized Finger / Error / Low Battery
#define LED_BLUE_PIN            27   // Wi-Fi Syncing / Enrollment Mode Active

// Small 5V Passive Piezoelectric Buzzer (Driven via NPN Transistor on GPIO14)
#define BUZZER_PIN              14
#define BUZZER_PWM_CHANNEL      0

// 2S 3.7V Li-ion Battery Voltage Monitor (6.4V Cutoff - 8.4V Full)
// Connected via 100kOhm (top) / 33kOhm (bottom) voltage divider -> Ratio = 4.0303
#define BATTERY_ADC_PIN         34   // ADC1_CH6 (Input-only, Wi-Fi safe)
#define BATTERY_CHARGE_STAT_PIN 35   // Optional TP5100 CHRG status pin
#define BATTERY_DIVIDER_RATIO   4.0303f
#define BATTERY_MIN_VOLTAGE     6.40f // 0% (3.20V per cell)
#define BATTERY_MAX_VOLTAGE     8.40f // 100% (4.20V per cell)

// ─── 3. Timing & Offline Queue Constants ────────────────────────────────────
#define HEARTBEAT_INTERVAL_MS   8000UL   // Poll server / report telemetry every 8s
#define OFFLINE_SYNC_BATCH_SIZE 20       // Upload 20 offline records per batch
#define OLED_BANNER_HOLD_MS     3200UL   // Keep student Name & Roll No on OLED for 3.2s

#endif // VIDYAOS_ESP32_CONFIG_H
