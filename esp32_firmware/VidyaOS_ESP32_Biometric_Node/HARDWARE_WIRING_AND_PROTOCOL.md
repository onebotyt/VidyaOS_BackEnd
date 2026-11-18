# VidyaOS ESP32 Biometric Hardware Node & Secure Attendance Terminal
## Complete Wiring Specification, Operational Modes & Two-Way Security Protocol

---

## 1. Hardware Bill of Materials (BOM)
1. **Microcontroller**: ESP32-WROOM-32D / ESP32 DevKit V1 (Dual-Core 240MHz, Hardware mbedTLS AES-256-GCM, Light Sleep Touch Wake)
2. **Biometric Sensor**: AS608 Optical Fingerprint Reader Module (UART interface @ 57600 baud, 512-byte template buffer, capacitive/optical Touch Wake pin on prism glass)
3. **Display**: 0.96" I2C OLED Display Module (SSD1306 128x64 px, 3.3V logic, I2C address `0x3C`)
4. **Offline Flash Storage**: W25Qxx (W25Q32 / W25Q64 / W25Q128) SPI NOR Flash Module (32Mbit / 4MB, VSPI)
5. **Audio Feedback**: 5V Passive Piezoelectric Buzzer driven via 2N2222 NPN transistor on `GPIO 14` with LEDC PWM tone generator
6. **Dedicated 4 Status LEDs**:
   - **Wi-Fi LED (Blue)**: `GPIO 27` (Solid = Wi-Fi Connected, Blinking = Reconnecting/Offline)
   - **Success LED (Green)**: `GPIO 25` (2.5-second hold on successful attendance)
   - **Failed LED (Red)**: `GPIO 26` (Flashes on failed attendance or unregistered finger)
   - **Low Battery LED (Amber)**: `GPIO 4` (Turns ON/Blinks when battery pack < 20% / < 6.8V)
7. **Battery Telemetry System**: 2S 3.7V 18650 Li-ion / LiPo Pack (`7.4V` nominal, `8.4V` full, `6.4V` cutoff) + 2S 10A BMS + `100kΩ / 33kΩ` ADC Voltage Divider on `GPIO 34` (Ratio: `4.0303`)

---

## 2. Complete Pin-by-Pin Hardware Wiring Specification

| Component | Component Pin | ESP32 GPIO | Direction | Purpose / Function |
| :--- | :--- | :--- | :--- | :--- |
| **AS608 Fingerprint** | `VCC` (Red) | `3V3` | Power | Optical sensor 3.3V supply |
| | `TX` (Yellow/White) | `GPIO 16 (RX2)` | Input | UART2 Serial receive from sensor |
| | `RX` (Green) | `GPIO 17 (TX2)` | Output | UART2 Serial transmit to sensor |
| | `WAK / Touch` (Blue) | `GPIO 33` | Input | Active-HIGH interrupt when finger touches optical prism |
| | `GND` (Black) | `GND` | Ground | Common ground reference |
| **0.96" OLED (SSD1306)** | `VCC` | `3V3` | Power | 3.3V logic & display drive |
| | `GND` | `GND` | Ground | Common ground |
| | `SCL` | `GPIO 22` | Output | I2C Clock line (`0x3C`) |
| | `SDA` | `GPIO 21` | In/Out | I2C Data line |
| **W25Qxx SPI Flash** | `VCC` | `3V3` | Power | 3.3V NOR Flash supply |
| | `CS` | `GPIO 5` | Output | VSPI Chip Select (Active LOW) |
| | `SCK` | `GPIO 18` | Output | VSPI Serial Clock |
| | `MISO (DO)` | `GPIO 19` | Input | VSPI Master-In Slave-Out |
| | `MOSI (DI)` | `GPIO 23` | Output | VSPI Master-Out Slave-In |
| | `GND` | `GND` | Ground | Common ground |
| **Audio Feedback** | `Buzzer (+)` | `5V (VIN)` | Power | Powered from 5V rail |
| | `Buzzer (-)` | `GPIO 14` | Output | Driven via 2N2222 NPN transistor collector with LEDC PWM |
| **Status LEDs (4)** | `Wi-Fi LED (Blue)` | `GPIO 27` | Output | Solid = Wi-Fi Connected, Blinking = Reconnecting/Offline |
| | `Success LED (Green)` | `GPIO 25` | Output | 2.5-second hold on successful attendance |
| | `Failed LED (Red)` | `GPIO 26` | Output | Flashes on failed attendance or unregistered finger |
| | `Low Battery LED (Amber)` | `GPIO 4` | Output | Turns ON/Blinks when battery pack < 20% (< 6.8V) |
| **Battery Telemetry** | `Battery (+)` | `GPIO 34 (ADC1_6)` | Input | Analog input via 100kΩ/33kΩ divider (Ratio: 4.0303) |

---

## 3. Behavioral Conditions & Operational Modes Matrix

| Event / Trigger | Buzzer Profile | Active LED Indicator | OLED Display Content |
| :--- | :--- | :--- | :--- |
| **1. Successful Attendance** | 2-Second Continuous Long Beep (`2400 Hz` tone uninterrupted for `2000 ms`) | Green LED Solid ON for 2.5 seconds | **Header**: `SUCCESSFULLY MARKED`<br>**Line 1**: `Enroll: 2024IT005`<br>**Line 2**: `Arjun Rao`<br>**Line 3**: `Time: 10:45:12 AM` |
| **2. Failed Attendance** | 3 Continuous Short Beeps (`3 × [150ms Beep + 100ms Silence]`) | Red LED Flashes 3 times | **Header**: `ATTENDANCE FAILED`<br>**Line 1**: `Class / Register Error`<br>**Line 2**: `Retry or Check Admin`<br>**Line 3**: `Time: 10:45:14 AM` |
| **3. Finger Not Registered** | Continuous Rapid Tone (< 2s) (`800 Hz` pulsed rapidly for `1800 ms`) | Red LED Solid ON for 2.0 seconds | **Header**: `NOT REGISTERED`<br>**Line 1**: `Finger Not Found`<br>**Line 2**: `Slot Unassigned`<br>**Line 3**: `Contact HOD Office` |
| **4. Low Battery Condition** | 5 Beeps in 5 Seconds (`5 cycles of [200ms Beep + 800ms Silence]`) | Amber LED Solid ON / Slow pulse | **Top Banner**: `⚠️ LOW BATTERY`<br>**Battery Gauge**: `[█░░░] 14% (6.68V)`<br>**Prompt**: `Connect 5V/9V Charger` |
| **5. Idle / Standby State** | Silent | Blue Wi-Fi LED ON (Blinks if offline) | **Top Bar**: Wi-Fi RSSI • Battery % (`[████] 88%`)<br>**Center**: Institutional Clock (`10:45 AM`)<br>**Bottom**: `👉 Place Finger to Scan` |
| **6. Sleep Mode (< 2 min)** | Silent | All LEDs OFF (Amber blinks if low battery) | OLED Display powered off (`display.ssd1306_command(SSD1306_DISPLAYOFF)`). Wakes immediately upon touch. |

---

## 4. Power Management & Touch-Wake Interrupt Protocol
- **Inactivity Watchdog**: Firmware checks `millis() - lastActivityMs >= 120000UL` (2 minutes).
- **AS608 Optical Touch Pin (`GPIO 33`)**: When a finger touches the prism glass, WAK pulls Active-HIGH (`3.3V`).
- **ESP32 Sleep Entry**:
  1. Shows sleep banner and powers off OLED display controller.
  2. Turns off AS608 optical backlight LED.
  3. Configures wakeup interrupt: `esp_sleep_enable_ext0_wakeup((gpio_num_t)AS608_TOUCH_WAKE_PIN, 1);`.
  4. Calls `esp_light_sleep_start();` (RAM and peripheral state preserved).
  5. Upon touch interrupt, wakes up instantly, restores OLED, turns backlight ON, and is immediately ready to scan.

---

## 5. Secure Slot Allocation & Dual-Layer Verification Protocol
When the ESP32 registers a finger match:
1. Sensor matches finger to `slot_id` (e.g. 14).
2. ESP32 looks up `slot_id = 14` in W25Qxx flash -> reads `student_id = 105`, `enrollment_no = 2024IT005`, `full_name = Arjun Rao`.
3. ESP32 constructs authenticated AES-256-GCM attendance payload:
```json
{
  "device_uid": "ESP32-IT-LAB-01",
  "scans": [
    {
      "event_id": "EVT_1731835512_105",
      "student_id": 105,
      "slot_id": 14,
      "enrollment_no": "2024IT005",
      "confidence": 98,
      "scanned_at": 1731835512,
      "is_offline_sync": false
    }
  ]
}
```
4. Server receives request at `/api/v1/devices/esp32/attendance`:
   - Decrypts AES-256-GCM envelope using terminal's 256-bit secret key.
   - Cross-verifies that `slot_id = 14` matches registered slot for `student_id = 105` on `ESP32-IT-LAB-01`.
   - Records attendance in `esp32_presence`, `iot_attendance_events`, and marks open registers PRESENT.
   - Returns `{ success: true, status: "ATTENDANCE_MARKED", student_id: 105, full_name: "Arjun Rao", enrollment_no: "2024IT005", time: "10:45:12 AM" }`.
5. ESP32 receives positive server acknowledgment:
   - Sounds 2-second continuous long beep.
   - Lights Green LED for 2.5 seconds.
   - Displays Student Name, Enrollment Number, and Time on OLED screen.
6. If the slot doesn't match or the server rejects:
   - Sounds 3 continuous short beeps.
   - Flashes Red LED 3 times.
   - Displays "ATTENDANCE FAILED" on OLED screen.

---

## 6. Required Software Libraries Installation Guide

To compile and flash this firmware, install the following official C++ libraries:

### A. Arduino IDE (Library Manager)
In Arduino IDE, navigate to **Sketch** ➔ **Include Library** ➔ **Manage Libraries...** (`Ctrl + Shift + I`):

1. **Adafruit Fingerprint Sensor Library**
   - *Search term*: `Adafruit Fingerprint Sensor Library`
   - *Author*: `Adafruit`
   - *Version*: `v2.1.3` or higher

2. **Adafruit SSD1306**
   - *Search term*: `Adafruit SSD1306`
   - *Author*: `Adafruit`
   - *Version*: `v2.5.9` or higher

3. **Adafruit GFX Library**
   - *Search term*: `Adafruit GFX Library`
   - *Author*: `Adafruit`
   - *Version*: `v1.11.9` or higher

4. **ArduinoJson**
   - *Search term*: `ArduinoJson`
   - *Author*: `Benoit Blanchon`
   - *Version*: `v6.21.4` (Note: v6 is recommended for low RAM footprint)

5. **PubSubClient** *(For Dual-Stack MQTT Support)*
   - *Search term*: `PubSubClient`
   - *Author*: `Nick O'Leary`
   - *Version*: `v2.8` or higher

*(Note: `WiFi.h`, `WiFiMulti.h`, `HTTPClient.h`, `Preferences.h`, `mbedtls`, and `esp_sleep.h` are standard built-in ESP32 core libraries and do not require external installation).*

### B. PlatformIO (`platformio.ini`)
For VSCode + PlatformIO users, configure your `platformio.ini` as follows:

```ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
monitor_speed = 115200

lib_deps =
  adafruit/Adafruit Fingerprint Sensor Library @ ^2.1.3
  adafruit/Adafruit SSD1306 @ ^2.5.9
  adafruit/Adafruit GFX Library @ ^1.11.9
  bblanchon/ArduinoJson @ ^6.21.4
  knolleary/PubSubClient @ ^2.8
```

---

## 7. Architectural Analysis: Why MQTT vs HTTPS REST in Institutional IoT

### Why Many IoT Projects Use MQTT:
1. **Persistent TCP Socket**: MQTT maintains an open TCP pipe to an MQTT broker (`EMQX`, `Mosquitto`, `HiveMQ`).
2. **Low Overhead**: Headers are only 2 bytes compared to HTTP request headers which can be several hundred bytes.
3. **Publish / Subscribe**: Instant 1-to-many event broadcasting without polling.

### Why College & University Deployments Break with Pure MQTT:
1. **Campus Network Firewalls & Captive Portals**: Almost every government college, university, or corporate network strictly blocks non-standard outbound TCP ports (`1883` for unencrypted MQTT and `8883` for MQTTS). In contrast, **HTTPS on port `443` is universal and never blocked**.
2. **Proxy Authentication & Deep Packet Inspection**: Institutional networks routinely inspect traffic; raw MQTT connections are dropped or timed out by campus firewalls.
3. **End-to-End Encryption**: Standard HTTP REST coupled with **Hardware-Accelerated AES-256-GCM** guarantees end-to-end cryptographic integrity directly between the microcontroller and the Node.js backend without depending on a third-party intermediary broker.

### VidyaOS Dual-Stack Solution:
- **Primary Protocol**: **HTTPS REST with AES-256-GCM** on port `443`. Universal, rock-solid, works across all academic firewalls, mobile hotspots, and corporate Wi-Fi.
- **Secondary / Telemetry Protocol**: **MQTT (PubSubClient)** enabled via `#define ENABLE_MQTT_TELEMETRY true` in `config.h`. When enabled, the terminal mirrors telemetry to `MQTT_TOPIC_TELEMETRY` on open IoT subnets, while seamlessly failing back to HTTPS for attendance recording and command polling.

---

## 8. Multi-Wi-Fi Connectivity, Nearby Scanning & Failover Protocol

The VidyaOS ESP32 node incorporates a dynamic Wi-Fi manager designed to prevent terminals from ever becoming "bricked" or unreachable due to changed router passwords:

1. **Nearby Network Discovery (`SCAN_WIFI`)**:
   - The HOD clicks **"Scan Nearby Wi-Fi"** in the HOD portal.
   - Server queues command `SCAN_WIFI`.
   - The terminal scans all 2.4GHz channels (`WiFi.scanNetworks()`), measures signal strength (RSSI), detects BSSIDs and encryption protocols (`WPA2_PSK`, `WPA3_PSK`, `OPEN`), and sends the scan report to `/api/v1/devices/esp32/wifi-scan-report`.
   - The HOD sees all available classroom access points in real-time.

2. **Switching / Adding Wi-Fi Credentials (`SWITCH_WIFI`)**:
   - The HOD selects a scanned network or enters credentials manually, with an optional **"Set as Default Network"** checkbox.
   - Terminal saves credentials to non-volatile storage (NVS via `Preferences.h`).
   - Attempts to connect for 12 seconds:
     - **Success**: Plays confirmation tone, lights Green LED, and reports new active IP/RSSI.
     - **Failure / Incorrect Password**: Plays alert tone, flashes Red LED, and automatically reconnects to the designated Default Wi-Fi network.

3. **One-Click Fallback (`FALLBACK_WIFI`)**:
   - When triggered, forces the terminal to abandon the secondary Wi-Fi and re-associate with the designated primary default AP.

4. **Emergency Factory Reset (`RESET_WIFI`)**:
   - Wipes all custom credentials from NVS.
   - Restores the factory default network defined in `config.h` (`DEFAULT_FACTORY_WIFI_SSID` / `DEFAULT_FACTORY_WIFI_PASS`).
