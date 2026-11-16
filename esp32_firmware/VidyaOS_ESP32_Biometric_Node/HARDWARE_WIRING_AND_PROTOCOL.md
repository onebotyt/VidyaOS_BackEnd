# VidyaOS ESP32 Biometric Attendance Node — Hardware Wiring & Encrypted Protocol Guide

## 1. Hardware Bill of Materials (BOM)
1. **Microcontroller**: ESP32-WROOM-32D / ESP32 DevKit V1 (Dual-Core 240MHz, Hardware mbedTLS AES-256-GCM)
2. **Biometric Sensor**: AS608 Optical Fingerprint Reader Module (UART interface, 512-byte template buffer)
3. **Display**: 0.96" I2C OLED Display Module (SSD1306 128x64 px, 3.3V)
4. **Offline Flash Storage**: W25Q32 Large Capacity SPI NOR Flash Module (32Mbit / 4MB, VSPI)
5. **Audio Indicator**: 5V Passive Piezoelectric Buzzer (driven via 2N2222 / S8050 NPN transistor on `GPIO14`)
6. **LED Indicators**: Green LED (`GPIO25`), Red LED (`GPIO26`), Blue LED (`GPIO27`) with `220Ω` current-limiting resistors
7. **Battery System**: 2S 3.7V 18650 Li-ion / LiPo Battery Pack (`7.4V` nominal, `8.4V` full, `6.4V` cutoff) + 2S 10A BMS + Mini360 / LM2596 `5V` Buck Converter + `100kΩ / 33kΩ` ADC Voltage Divider on `GPIO34`

---

## 2. Complete Pin-by-Pin Wiring Table

| Peripheral | Module Pin | ESP32 Pin | Notes |
| :--- | :--- | :--- | :--- |
| **AS608 Fingerprint Sensor** | `VCC` (Red) | `3V3` | Optical sensor logic & LED power |
| | `TX` (Yellow/White) | `GPIO 16 (RX2)` | UART2 Receive (57600 baud) |
| | `RX` (Green) | `GPIO 17 (TX2)` | UART2 Transmit (57600 baud) |
| | `GND` (Black) | `GND` | Common ground |
| **0.96" OLED (SSD1306)** | `VCC` | `3V3` | I2C Display Power |
| | `GND` | `GND` | Common ground |
| | `SCL` | `GPIO 22` | Hardware I2C Clock |
| | `SDA` | `GPIO 21` | Hardware I2C Data (`0x3C`) |
| **W25Q32 4MB SPI Flash** | `VCC` | `3V3` | 3.3V SPI NOR Flash |
| | `CS` | `GPIO 5` | VSPI Chip Select |
| | `DO (MISO)` | `GPIO 19` | VSPI Master-In Slave-Out |
| | `DI (MOSI)` | `GPIO 23` | VSPI Master-Out Slave-In |
| | `CLK (SCK)` | `GPIO 18` | VSPI Clock |
| | `GND` | `GND` | Common ground |
| **5V Passive Piezo Buzzer** | `+ (VCC)` | `5V (VIN)` | Powered from 5V buck rail |
| | `- (Signal)` | `GPIO 14` | Via NPN transistor collector (`1kΩ` base resistor) |
| **Status LEDs** | `Green Anode` | `GPIO 25` | Verified / Attendance Marked |
| | `Red Anode` | `GPIO 26` | Error / Unrecognized Finger |
| | `Blue Anode` | `GPIO 27` | Sync / Remote Enrollment Active |
| **2S 7.4V Battery Monitor** | `Pack + (6.4V–8.4V)` | `GPIO 34 (ADC1_6)` | Via `100kΩ` (top) + `33kΩ` (bottom to GND) divider |

---

## 3. Architectural Highlights
- **End-to-End AES-256-GCM Encryption**: Every payload between the ESP32 and `/api/v1/devices/esp32/*` is encrypted using a 256-bit key (`SHA256(DEVICE_AES_SECRET)`), a 12-byte random IV, and a 16-byte GCM authentication tag.
- **100% Slot-Agnostic Server**: The server never tracks or cares which internal AS608 slot (`1..300`) a student occupies. The ESP32 manages its own local slot table in **W25Q32 Region A (64KB)** and communicates with the server strictly using `student_id`.
- **Portable 512-Byte Biometric Templates**: During enrollment, the ESP32 extracts the 512-byte AS608 template (`UPCHAR 0x08`) and uploads it encrypted to MySQL (`student_biometric_templates`). If an ESP32 hardware unit is ever replaced, the new ESP32 automatically downloads all department templates from `/api/v1/devices/esp32/templates-sync` (`DOWNCHAR 0x09` + `STORE 0x06`) with **zero student re-registration**.
- **W25Q32 Offline Attendance Ring Buffer**: When Wi-Fi is offline, verified scans are stored in **W25Q32 Region B (4MB)** (capacity: 16,384+ offline scans), while the 0.96" OLED immediately displays the student's **Full Name**, **Class Roll Number**, and **`ATTENDANCE MARKED!`** from the local W25Q32 roster. When Wi-Fi reconnects, the ESP32 automatically uploads and clears the offline queue.
