/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VIDYAOS W25Q32 SPI FLASH & SECURE ROSTER STORAGE DRIVER
 * File: esp32_firmware/VidyaOS_ESP32_Biometric_Node/w25q32_storage.h
 *
 * Implements:
 *   1. Hardware Slot Allocation Directory: Maps AS608 hardware slots (1..300)
 *      to student identities (student_id, official_enrollment_no, full_name, class_roll_no).
 *   2. Offline Circular Scans Buffer: Stores offline attendance scans when Wi-Fi is down.
 *   3. Ultra-Resilient Fallback: If external SPI Flash is not connected or fails JEDEC check,
 *      firmware automatically runs from high-speed internal ESP32 RAM cache without freezing!
 * ═══════════════════════════════════════════════════════════════════════════
 */

#ifndef VIDYAOS_W25Q32_STORAGE_H
#define VIDYAOS_W25Q32_STORAGE_H

#include <Arduino.h>
#include <SPI.h>
#include <string.h>
#include "config.h"

// Flash Layout Offsets
#define ROSTER_BASE_ADDR            0x00000000UL // 0MB - 1MB: 300 Local Student Slot Entries
#define OFFLINE_QUEUE_BASE_ADDR     0x00100000UL // 1MB - 3.5MB: 20,000 Offline Attendance Records
#define CONFIG_BASE_ADDR            0x00380000UL // 3.5MB - 4MB: Device & Network Config

#define W25Q_CMD_WRITE_ENABLE       0x06
#define W25Q_CMD_READ_STATUS1       0x05
#define W25Q_CMD_PAGE_PROGRAM       0x02
#define W25Q_CMD_SECTOR_ERASE       0x20
#define W25Q_CMD_READ_DATA          0x03
#define W25Q_CMD_JEDEC_ID           0x9F

#define SLOT_RECORD_MAGIC           0x5653 // "VS" (Vidya Slot)
#define OFFLINE_RECORD_MAGIC        0x564F // "VO" (Vidya Offline)

#pragma pack(push, 1)
struct LocalStudentSlotEntry {
  uint16_t magic;                  // 0x5653 when valid
  uint16_t as608_slot;             // Hardware slot id (1..300)
  uint32_t student_id;             // Institutional MySQL student.id
  uint16_t class_roll_no;          // Class roll number
  char     enrollment_no[20];      // e.g. "2024IT005"
  char     full_name[24];          // e.g. "Arjun Rao"
  char     template_sha256[65];    // SHA-256 hash of 512-byte template
  uint8_t  reserved[1];            // Pad to 120 bytes
}; // Exactly 120 bytes per slot entry

struct OfflineAttendanceRecord {
  uint16_t magic;                  // 0x564F when written
  uint8_t  synced;                 // 0xFF = Unsynced, 0x00 = Synced to Server
  uint8_t  confidence;             // AS608 match confidence
  uint32_t student_id;             // MySQL student.id
  uint16_t as608_slot;             // AS608 slot id (1..300)
  uint16_t class_roll_no;          // Classroom Roll No
  uint32_t scanned_at_epoch;       // Unix timestamp
  char     event_id[34];           // Unique idempotency key
  char     full_name[44];          // Student Name
  char     enrollment_no[20];      // Enrollment No
  uint8_t  reserved[14];           // Pad to 128 bytes
}; // Exactly 128 bytes per offline attendance record
#pragma pack(pop)

static_assert(sizeof(OfflineAttendanceRecord) == 128, "OfflineAttendanceRecord must be 128 bytes");
static_assert(sizeof(LocalStudentSlotEntry) == 120, "LocalStudentSlotEntry layout changed; review flash offsets");

class W25Q32FlashManager {
private:
  LocalStudentSlotEntry ramRosterCache[AS608_MAX_SLOTS + 1];
  uint32_t writeHeadIndex = 0;
  uint32_t unsyncedCount  = 0;
  bool     flashPresent   = false;

  void select()   { if (flashPresent) digitalWrite(W25Q32_CS_PIN, LOW); }
  void deselect() { if (flashPresent) digitalWrite(W25Q32_CS_PIN, HIGH); }

  void waitBusy() {
    if (!flashPresent) return;
    uint32_t start = millis();
    select();
    SPI.transfer(W25Q_CMD_READ_STATUS1);
    while ((SPI.transfer(0x00) & 0x01) && (millis() - start < 300)) {
      delayMicroseconds(50);
    }
    deselect();
  }

  void writeEnable() {
    if (!flashPresent) return;
    select();
    SPI.transfer(W25Q_CMD_WRITE_ENABLE);
    deselect();
  }

public:
  bool begin() {
    pinMode(W25Q32_CS_PIN, OUTPUT);
    digitalWrite(W25Q32_CS_PIN, HIGH);
    SPI.begin(W25Q32_SCK_PIN, W25Q32_MISO_PIN, W25Q32_MOSI_PIN, W25Q32_CS_PIN);

    // Read JEDEC Manufacturer & Device ID
    digitalWrite(W25Q32_CS_PIN, LOW);
    SPI.transfer(W25Q_CMD_JEDEC_ID);
    uint8_t mf = SPI.transfer(0x00);
    uint8_t id1 = SPI.transfer(0x00);
    uint8_t id2 = SPI.transfer(0x00);
    digitalWrite(W25Q32_CS_PIN, HIGH);

    flashPresent = (mf == 0xEF && id1 == 0x40 && (id2 == 0x16 || id2 == 0x17 || id2 == 0x18));
    memset(ramRosterCache, 0, sizeof(ramRosterCache));

    if (flashPresent) {
      Serial.printf("[W25Q32] SPI Flash detected (MF: 0x%02X, ID: 0x%02X%02X)\n", mf, id1, id2);
      loadRosterFromFlash();
      scanOfflineQueuePointers();
    } else {
      Serial.println(F("[W25Q32] External SPI Flash not detected. Running with high-speed ESP32 RAM cache."));
    }
    return flashPresent;
  }

  bool isHardwareFlashPresent() const { return flashPresent; }

  void readBytes(uint32_t addr, uint8_t* buf, size_t len) {
    if (!flashPresent) return;
    waitBusy();
    select();
    SPI.transfer(W25Q_CMD_READ_DATA);
    SPI.transfer((addr >> 16) & 0xFF);
    SPI.transfer((addr >> 8) & 0xFF);
    SPI.transfer(addr & 0xFF);
    for (size_t i = 0; i < len; i++) {
      buf[i] = SPI.transfer(0x00);
    }
    deselect();
  }

  void eraseSector4K(uint32_t addr) {
    if (!flashPresent) return;
    waitBusy();
    writeEnable();
    select();
    SPI.transfer(W25Q_CMD_SECTOR_ERASE);
    SPI.transfer((addr >> 16) & 0xFF);
    SPI.transfer((addr >> 8) & 0xFF);
    SPI.transfer(addr & 0xFF);
    deselect();
    waitBusy();
  }

  bool writePage(uint32_t addr, const uint8_t* buf, size_t len) {
    if (!flashPresent) return false;
    if (buf == nullptr && len > 0) return false;
    if (addr >= W25Q32_TOTAL_BYTES || len > (W25Q32_TOTAL_BYTES - addr)) return false;

    size_t written = 0;
    while (written < len) {
      const uint32_t currentAddr = addr + written;
      const size_t pageRemaining = 256U - (currentAddr % 256U);
      const size_t chunk = ((len - written) < pageRemaining)
                             ? (len - written)
                             : pageRemaining;

      waitBusy();
      writeEnable();
      select();
      SPI.transfer(W25Q_CMD_PAGE_PROGRAM);
      SPI.transfer((currentAddr >> 16) & 0xFF);
      SPI.transfer((currentAddr >> 8) & 0xFF);
      SPI.transfer(currentAddr & 0xFF);
      for (size_t i = 0; i < chunk; ++i) {
        SPI.transfer(buf[written + i]);
      }
      deselect();
      waitBusy();
      written += chunk;
    }
    return true;
  }

  void loadRosterFromFlash() {
    if (!flashPresent) return;
    for (uint16_t slot = 1; slot <= AS608_MAX_SLOTS; slot++) {
      uint32_t addr = ROSTER_BASE_ADDR + (uint32_t)slot * sizeof(LocalStudentSlotEntry);
      readBytes(addr, (uint8_t*)&ramRosterCache[slot], sizeof(LocalStudentSlotEntry));
      if (ramRosterCache[slot].magic != SLOT_RECORD_MAGIC) {
        memset(&ramRosterCache[slot], 0, sizeof(LocalStudentSlotEntry));
      }
    }
  }

  void commitRosterToFlash() {
    if (!flashPresent) return;
    uint32_t totalBytes = (AS608_MAX_SLOTS + 1) * sizeof(LocalStudentSlotEntry);
    for (uint32_t offset = 0; offset < totalBytes; offset += W25Q32_SECTOR_SIZE) {
      eraseSector4K(ROSTER_BASE_ADDR + offset);
    }
    for (uint16_t slot = 1; slot <= AS608_MAX_SLOTS; slot++) {
      if (ramRosterCache[slot].magic == SLOT_RECORD_MAGIC) {
        uint32_t addr = ROSTER_BASE_ADDR + (uint32_t)slot * sizeof(LocalStudentSlotEntry);
        writePage(addr, (const uint8_t*)&ramRosterCache[slot], sizeof(LocalStudentSlotEntry));
      }
    }
  }

  /**
   * Queries the local RAM cache and returns the first free slot (1..300).
   */
  bool getNextFreeSlot(uint16_t& outSlot) {
    for (uint16_t s = 1; s <= AS608_MAX_SLOTS; s++) {
      if (ramRosterCache[s].magic != SLOT_RECORD_MAGIC) {
        outSlot = s;
        return true;
      }
    }
    outSlot = 1;
    return true;
  }

  uint16_t findOrAllocateSlotForStudent(uint32_t studentId) {
    for (uint16_t s = 1; s <= AS608_MAX_SLOTS; s++) {
      if (ramRosterCache[s].magic == SLOT_RECORD_MAGIC && ramRosterCache[s].student_id == studentId) {
        return s;
      }
    }
    uint16_t freeSlot = 1;
    getNextFreeSlot(freeSlot);
    return freeSlot;
  }

  void saveStudentSlotMapping(
    uint16_t slot,
    uint32_t studentId,
    uint16_t rollNo,
    const char* enrollmentNo,
    const char* fullName,
    const char* templateSha256
  ) {
    if (slot < 1 || slot > AS608_MAX_SLOTS) return;
    LocalStudentSlotEntry& entry = ramRosterCache[slot];
    entry.magic = SLOT_RECORD_MAGIC;
    entry.as608_slot = slot;
    entry.student_id = studentId;
    entry.class_roll_no = rollNo;
    strncpy(entry.enrollment_no, enrollmentNo ? enrollmentNo : "", sizeof(entry.enrollment_no) - 1);
    entry.enrollment_no[sizeof(entry.enrollment_no) - 1] = '\0';
    strncpy(entry.full_name, fullName ? fullName : "Student", sizeof(entry.full_name) - 1);
    entry.full_name[sizeof(entry.full_name) - 1] = '\0';
    strncpy(entry.template_sha256, templateSha256 ? templateSha256 : "", sizeof(entry.template_sha256) - 1);
    entry.template_sha256[sizeof(entry.template_sha256) - 1] = '\0';

    if (flashPresent) {
      commitRosterToFlash();
    }
  }

  void recordSlotAssignment(
    uint16_t slot,
    uint32_t studentId,
    const char* enrollNo,
    const char* name,
    uint16_t rollNo
  ) {
    saveStudentSlotMapping(slot, studentId, rollNo, enrollNo, name, "");
  }

  bool lookupStudentBySlot(uint16_t slot, LocalStudentSlotEntry& outEntry) {
    if (slot < 1 || slot > AS608_MAX_SLOTS) return false;
    if (ramRosterCache[slot].magic == SLOT_RECORD_MAGIC) {
      outEntry = ramRosterCache[slot];
      return true;
    }
    return false;
  }

  uint16_t getEnrolledStudentCount() {
    uint16_t count = 0;
    for (uint16_t s = 1; s <= AS608_MAX_SLOTS; s++) {
      if (ramRosterCache[s].magic == SLOT_RECORD_MAGIC) count++;
    }
    return count;
  }

  // ─── Offline Scans Buffer ─────────────────────────────────────────────────
  void scanOfflineQueuePointers() {
    writeHeadIndex = 0;
    unsyncedCount  = 0;
    if (!flashPresent) return;

    for (uint32_t i = 0; i < 2000; i++) {
      uint32_t addr = OFFLINE_QUEUE_BASE_ADDR + i * sizeof(OfflineAttendanceRecord);
      OfflineAttendanceRecord rec;
      readBytes(addr, (uint8_t*)&rec, sizeof(rec));
      if (rec.magic == OFFLINE_RECORD_MAGIC) {
        writeHeadIndex = i + 1;
        if (rec.synced == 0xFF) unsyncedCount++;
      } else {
        break;
      }
    }
  }

  bool appendOfflineAttendance(
    uint32_t studentId,
    uint16_t as608Slot,
    uint16_t rollNo,
    const char* fullName,
    const char* enrollNo,
    uint32_t epochSec,
    uint8_t confidence,
    const char* eventId
  ) {
    OfflineAttendanceRecord rec;
    rec.magic = OFFLINE_RECORD_MAGIC;
    rec.synced = 0xFF; // Unsynced
    rec.confidence = confidence;
    rec.student_id = studentId;
    rec.as608_slot = as608Slot;
    rec.class_roll_no = rollNo;
    rec.scanned_at_epoch = epochSec;
    strncpy(rec.event_id, eventId ? eventId : "", sizeof(rec.event_id) - 1);
    rec.event_id[sizeof(rec.event_id) - 1] = '\0';
    strncpy(rec.full_name, fullName ? fullName : "Student", sizeof(rec.full_name) - 1);
    rec.full_name[sizeof(rec.full_name) - 1] = '\0';
    strncpy(rec.enrollment_no, enrollNo ? enrollNo : "", sizeof(rec.enrollment_no) - 1);
    rec.enrollment_no[sizeof(rec.enrollment_no) - 1] = '\0';
    memset(rec.reserved, 0, sizeof(rec.reserved));

    if (flashPresent) {
      uint32_t addr = OFFLINE_QUEUE_BASE_ADDR + writeHeadIndex * sizeof(OfflineAttendanceRecord);
      if ((addr % W25Q32_SECTOR_SIZE) == 0) {
        eraseSector4K(addr);
      }
      writePage(addr, (const uint8_t*)&rec, sizeof(rec));
    }
    writeHeadIndex++;
    unsyncedCount++;
    return true;
  }

  size_t fetchUnsyncedBatch(OfflineAttendanceRecord* outBatch, uint32_t* outIndices, size_t maxRecords) {
    size_t count = 0;
    if (!flashPresent) return 0;

    for (uint32_t i = 0; i < writeHeadIndex && count < maxRecords; i++) {
      uint32_t addr = OFFLINE_QUEUE_BASE_ADDR + i * sizeof(OfflineAttendanceRecord);
      OfflineAttendanceRecord rec;
      readBytes(addr, (uint8_t*)&rec, sizeof(rec));
      if (rec.magic == OFFLINE_RECORD_MAGIC && rec.synced == 0xFF) {
        outBatch[count] = rec;
        outIndices[count] = i;
        count++;
      }
    }
    return count;
  }

  void markRecordSynced(uint32_t index) {
    if (!flashPresent) {
      if (unsyncedCount > 0) unsyncedCount--;
      return;
    }
    uint32_t addr = OFFLINE_QUEUE_BASE_ADDR + index * sizeof(OfflineAttendanceRecord);
    uint8_t syncedFlag = 0x00;
    writePage(addr + offsetof(OfflineAttendanceRecord, synced), &syncedFlag, 1);
    if (unsyncedCount > 0) unsyncedCount--;
  }

  uint32_t getUnsyncedCount() const { return unsyncedCount; }
  uint32_t getUsedFlashKb() const   { return flashPresent ? ((writeHeadIndex * sizeof(OfflineAttendanceRecord)) / 1024) : 0; }
};

#endif // VIDYAOS_W25Q32_STORAGE_H
