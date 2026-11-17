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
