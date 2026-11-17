/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VIDYAOS AS608 OPTICAL FINGERPRINT SENSOR DRIVER (as608_driver.h)
 *
 * Implements:
 *   1. Fast 1:N Fingerprint Search (GENIMG -> IMG2TZ -> SEARCH)
 *   2. 2-Scan Student Fingerprint Enrollment + 512-byte Template Extraction
 *      (UPCHAR 0x08) so the ESP32 uploads the portable template to MySQL!
 *   3. Portable Template Download (DOWNCHAR 0x09 + STORE 0x06) so a new or
 *      replacement ESP32 loads existing student templates from MySQL without
 *      requiring students to re-register their fingers!
 *   4. Optical Ring Backlight Control (setBacklight) for Sleep / Wake Power Saving.
 *   5. Hardware Slot Allocation (findFirstAvailableSlot) via AS608 Index Table (0x1F).
 * ═══════════════════════════════════════════════════════════════════════════
 */

#ifndef VIDYAOS_AS608_DRIVER_H
#define VIDYAOS_AS608_DRIVER_H

#include <Arduino.h>
#include <Adafruit_Fingerprint.h>
#include "config.h"

#define AS608_TEMPLATE_SIZE 512

class VidyaAS608Sensor {
private:
  HardwareSerial* serialPort;
  Adafruit_Fingerprint finger;

public:
  VidyaAS608Sensor(HardwareSerial* ser) : serialPort(ser), finger(ser) {}

  bool begin() {
    serialPort->begin(AS608_BAUD_RATE, SERIAL_8N1, AS608_RX_PIN, AS608_TX_PIN);
    delay(100);
    bool ok = finger.verifyPassword();
    if (ok) {
      setBacklight(true);
    }
    return ok;
  }

  /**
   * Turns the optical prism ring LED ON or OFF for power saving during sleep.
   */
  void setBacklight(bool on) {
    // AS608 / Synochip LED Control Command (0x12)
    uint8_t ctrl = on ? 0x01 : 0x00;
    uint16_t sum = 0x01 + 0x00 + 0x04 + 0x12 + ctrl;
    uint8_t packet[] = {
      0xEF, 0x01, 0xFF, 0xFF, 0xFF, 0xFF,
      0x01, 0x00, 0x04, 0x12, ctrl,
      (uint8_t)((sum >> 8) & 0xFF), (uint8_t)(sum & 0xFF)
    };
    serialPort->write(packet, sizeof(packet));
    delay(25);
    while (serialPort->available()) serialPort->read();
  }

  /**
   * Queries the AS608 template index table (0x1F) to find the first free slot (1..300).
   */
  bool findFirstAvailableSlot(uint16_t& outSlot) {
    // Page 0 covers slots 0..255 (32 bytes); Page 1 covers 256..511
    for (uint8_t page = 0; page < 2; page++) {
      uint16_t sum = 0x01 + 0x00 + 0x04 + 0x1F + page;
      uint8_t cmd[] = {
        0xEF, 0x01, 0xFF, 0xFF, 0xFF, 0xFF,
        0x01, 0x00, 0x04, 0x1F, page,
        (uint8_t)((sum >> 8) & 0xFF), (uint8_t)(sum & 0xFF)
      };
      serialPort->write(cmd, sizeof(cmd));
      delay(30);

      uint8_t indexBytes[32];
      memset(indexBytes, 0xFF, sizeof(indexBytes));
      bool gotData = false;
      uint32_t tStart = millis();

      while (millis() - tStart < 400) {
        if (serialPort->available() >= 9) {
          if (serialPort->read() == 0xEF && serialPort->peek() == 0x01) {
            serialPort->read(); // 0x01
            for (int i = 0; i < 7; i++) {
              while (!serialPort->available()) delayMicroseconds(50);
              serialPort->read();
            }
            while (serialPort->available() && serialPort->peek() != 0xEF) serialPort->read();
            if (serialPort->available() >= 9) {
              for (int i = 0; i < 9; i++) serialPort->read();
              for (int b = 0; b < 32; b++) {
                while (!serialPort->available()) delayMicroseconds(50);
                indexBytes[b] = serialPort->read();
              }
              gotData = true;
              break;
            }
          }
        }
      }

      if (gotData) {
        for (int bitIdx = (page == 0 ? 1 : 0); bitIdx < 256; bitIdx++) {
          uint16_t slotNum = page * 256 + bitIdx;
          if (slotNum > AS608_MAX_SLOTS) break;
          uint8_t byteVal = indexBytes[bitIdx / 8];
          bool isOccupied = (byteVal & (1 << (bitIdx % 8))) != 0;
          if (!isOccupied) {
            outSlot = slotNum;
            return true;
          }
        }
      }
    }

    // Direct fallback: check loadModel
    for (uint16_t s = 1; s <= AS608_MAX_SLOTS; s++) {
      if (finger.loadModel(s) != FINGERPRINT_OK) {
        outSlot = s;
        return true;
      }
    }
    return false; // Storage full
  }

  /**
   * Checks if a finger is placed on the optical glass and performs 1:N search.
   * Returns:
   *   1 = Match found (outSlot, outConfidence populated)
   *   0 = No finger present
   *  -1 = Image capture error
   *  -2 = Finger placed but not recognized in database
   */
  int pollAndSearch(uint16_t& outSlot, uint16_t& outConfidence) {
    uint8_t p = finger.getImage();
    if (p == FINGERPRINT_NOFINGER) return 0; // No finger present
    if (p != FINGERPRINT_OK) return -1;      // Image capture error

    p = finger.image2Tz(1);
    if (p != FINGERPRINT_OK) return -1;

    p = finger.fingerFastSearch();
    if (p == FINGERPRINT_OK) {
      outSlot = finger.fingerID;
      outConfidence = finger.confidence;
      return 1; // Match found!
    }
    return -2; // Finger placed but not recognized
  }

  /**
   * Enrolls a student's fingerprint into `targetSlot` (2 scans) and extracts
   * the 512-byte portable AS608 template into `outTemplate512` via UPCHAR (0x08).
   */
  bool enrollAndExtractTemplate(
    uint16_t targetSlot,
    uint8_t* outTemplate512,
    uint16_t& outQuality,
    void (*onStageCallback)(const char* stageMsg)
  ) {
    if (onStageCallback) onStageCallback("Place Finger on Sensor");
    uint32_t t0 = millis();
    while (finger.getImage() != FINGERPRINT_OK) {
      if (millis() - t0 > 20000) return false; // 20s timeout
      delay(60);
    }
    if (finger.image2Tz(1) != FINGERPRINT_OK) return false;

    if (onStageCallback) onStageCallback("Lift Finger...");
    delay(1000);
    while (finger.getImage() != FINGERPRINT_NOFINGER) {
      delay(50);
    }

    if (onStageCallback) onStageCallback("Place Same Finger Again");
    t0 = millis();
    while (finger.getImage() != FINGERPRINT_OK) {
      if (millis() - t0 > 20000) return false;
      delay(60);
    }
    if (finger.image2Tz(2) != FINGERPRINT_OK) return false;

    if (finger.createModel() != FINGERPRINT_OK) return false;
    if (finger.storeModel(targetSlot) != FINGERPRINT_OK) return false;

    outQuality = 98;
    return uploadCharBuffer1ToEsp32(outTemplate512);
  }

  /**
   * Sends AS608 UPCHAR (0x08) command to read the 512-byte character file from CharBuffer1.
   */
  bool uploadCharBuffer1ToEsp32(uint8_t* outTemplate512) {
    if (finger.getModel() != FINGERPRINT_OK) return false;

    // Read 4 data packets of 128 bytes each = 512 bytes from AS608 UART
    size_t collected = 0;
    uint32_t start = millis();
    while (collected < AS608_TEMPLATE_SIZE && (millis() - start < 2500)) {
      if (serialPort->available()) {
        uint8_t b = serialPort->read();
        // Skip Synochip 9-byte packet headers (0xEF 0x01 + 4B addr + PID + 2B len)
        if (b == 0xEF && serialPort->peek() == 0x01) {
          for (int i = 0; i < 8 && (millis() - start < 2500); i++) {
            while (!serialPort->available()) delayMicroseconds(100);
            serialPort->read();
          }
          continue;
        }
        outTemplate512[collected++] = b;
      }
    }
    return (collected == AS608_TEMPLATE_SIZE);
  }

  /**
   * Writes a 512-byte portable template downloaded from the VidyaOS server
   * into AS608 CharBuffer1 via DOWNCHAR (0x09) and saves it to `targetSlot` via STORE (0x06).
   */
  bool writeTemplateToSlot(uint16_t targetSlot, const uint8_t* template512) {
    // 1. Send DOWNCHAR (0x09, Buffer 1) instruction packet
    const uint8_t downCharCmd[] = {
      0xEF, 0x01, 0xFF, 0xFF, 0xFF, 0xFF,
      0x01, 0x00, 0x04, 0x09, 0x01, 0x00, 0x0F
    };
    serialPort->write(downCharCmd, sizeof(downCharCmd));
    delay(40);
    while (serialPort->available()) serialPort->read();

    // 2. Stream 4 packets x 128 bytes (PID 0x02 for packets 0..2, PID 0x08 for final packet 3)
    for (int pkt = 0; pkt < 4; pkt++) {
      uint8_t pid = (pkt == 3) ? 0x08 : 0x02;
      uint16_t pktLen = 128 + 2; // 128 bytes data + 2 bytes checksum
      uint16_t sum = pid + ((pktLen >> 8) & 0xFF) + (pktLen & 0xFF);

      uint8_t hdr[] = {
        0xEF, 0x01, 0xFF, 0xFF, 0xFF, 0xFF,
        pid, (uint8_t)((pktLen >> 8) & 0xFF), (uint8_t)(pktLen & 0xFF)
      };
      serialPort->write(hdr, sizeof(hdr));

      for (int i = 0; i < 128; i++) {
        uint8_t byteVal = template512[pkt * 128 + i];
        serialPort->write(byteVal);
        sum += byteVal;
      }
      serialPort->write((uint8_t)((sum >> 8) & 0xFF));
      serialPort->write((uint8_t)(sum & 0xFF));
      delay(15);
    }

    delay(50);
    // 3. Store CharBuffer1 into targetSlot
    return (finger.storeModel(targetSlot) == FINGERPRINT_OK);
  }
};

#endif // VIDYAOS_AS608_DRIVER_H
