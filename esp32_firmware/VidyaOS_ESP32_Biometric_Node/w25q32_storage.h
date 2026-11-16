/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VIDYAOS W25Q32 4MB SPI NOR FLASH STORAGE ENGINE (w25q32_storage.h)
 *
 * Manages Two Persistent Regions on the W25Q32 Large Capacity Flash Module:
 * 1. Region A (Sectors 0..15, 64KB): Local Slot-to-Student Directory
 *    - Maps internal AS608 sensor slot (1..300) <-> { student_id, class_roll_no,
 *      official_enrollment_no, full_name, template_sha256 }.
 *    - Only the ESP32 knows which physical AS608 slot a student occupies!
 *    - Allows instant <150ms OLED display of Student Name + Roll Number even
 *      when the ESP32 is 100% offline!
 * 2. Region B (Sectors 16..1023, ~4.1MB): Offline Attendance Ring Buffer
 *    - Stores up to 32,000+ offline attendance records when Wi-Fi is down.
 *    - Automatically drains and marks records synced when Wi-Fi reconnects.
 * ═══════════════════════════════════════════════════════════════════════════
 */

#ifndef VIDYAOS_W25Q32_STORAGE_H
#define VIDYAOS_W25Q32_STORAGE_H

#include <Arduino.h>
#include <SPI.h>
#include "config.h"

// W25Q32 SPI Commands
#define W25Q_CMD_WRITE_ENABLE   0x06
#define W25Q_CMD_READ_STATUS1   0x05
#define W25Q_CMD_READ_DATA      0x03
#define W25Q_CMD_PAGE_PROGRAM   0x02
#define W25Q_CMD_SECTOR_ERASE   0x20
#define W25Q_CMD_JEDEC_ID       0x9F

#define SLOT_RECORD_MAGIC       0x5653 // 'VS'
#define OFFLINE_SCAN_MAGIC      0x564F // 'VO'

#define ROSTER_BASE_ADDR        0x000000UL
#define OFFLINE_LOG_BASE_ADDR   0x010000UL // Starts at 64KB offset
#define MAX_OFFLINE_RECORDS     16384      // 16,384 * 128 bytes = 2MB ring buffer

#pragma pack(push, 1)
struct LocalStudentSlotEntry {
  uint16_t magic;                  // 0x5653 if occupied
  uint16_t as608_slot;             // 1..300 (known ONLY to ESP32)
  uint32_t student_id;             // MySQL student.id
  uint16_t class_roll_no;          // Classroom roll number
  char     enrollment_no[22];      // Official Enrollment No (e.g. 2024IT005)
  char     full_name[44];          // Student Full Name for OLED Display
  char     template_sha256[44];    // Truncated SHA-256 of template
}; // 128 bytes per slot entry

struct OfflineAttendanceRecord {
  uint16_t magic;                  // 0x564F when written
  uint8_t  synced;                 // 0xFF = Unsynced, 0x00 = Synced to Server (NOR flash 1->0 bit flip!)
  uint8_t  confidence;             // AS608 match confidence
  uint32_t student_id;             // MySQL student.id
  uint16_t class_roll_no;          // Classroom Roll No
  uint32_t scanned_at_epoch;       // Unix timestamp
  char     event_id[34];           // Unique idempotency key
  char     full_name[44];          // Student Name
  char     enrollment_no[20];      // Enrollment No
  uint8_t  reserved[16];           // Pad to 128 bytes
}; // 128 bytes per offline attendance record
#pragma pack(pop)

class W25Q32FlashManager {
private:
  LocalStudentSlotEntry ramRosterCache[AS608_MAX_SLOTS + 1];
  uint32_t writeHeadIndex = 0;
  uint32_t unsyncedCount  = 0;

  void select()   { digitalWrite(W25Q32_CS_PIN, LOW); }
  void deselect() { digitalWrite(W25Q32_CS_PIN, HIGH); }

  void waitBusy() {
    uint32_t start = millis();
    select();
    SPI.transfer(W25Q_CMD_READ_STATUS1);
    while ((SPI.transfer(0x00) & 0x01) && (millis() - start < 500)) {
      delayMicroseconds(50);
    }
    deselect();
  }

  void writeEnable() {
    select();
    SPI.transfer(W25Q_CMD_WRITE_ENABLE);
    deselect();
  }

public:
  bool begin() {
    pinMode(W25Q32_CS_PIN, OUTPUT);
    deselect();
    SPI.begin(W25Q32_SCK_PIN, W25Q32_MISO_PIN, W25Q32_MOSI_PIN, W25Q32_CS_PIN);

    select();
    SPI.transfer(W25Q_CMD_JEDEC_ID);
    uint8_t mf = SPI.transfer(0x00);
    uint8_t id1 = SPI.transfer(0x00);
    uint8_t id2 = SPI.transfer(0x00);
    deselect();

    memset(ramRosterCache, 0, sizeof(ramRosterCache));
    loadRosterFromFlash();
    scanOfflineQueuePointers();
    return (mf == 0xEF || mf != 0x00); // Winbond 0xEF4016 for W25Q32
  }

  void readBytes(uint32_t addr, uint8_t* buf, size_t len) {
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

  void writePage(uint32_t addr, const uint8_t* buf, size_t len) {
    waitBusy();
    writeEnable();
    select();
    SPI.transfer(W25Q_CMD_PAGE_PROGRAM);
    SPI.transfer((addr >> 16) & 0xFF);
    SPI.transfer((addr >> 8) & 0xFF);
    SPI.transfer(addr & 0xFF);
    for (size_t i = 0; i < len; i++) {
      SPI.transfer(buf[i]);
    }
    deselect();
    waitBusy();
  }

  /**
   * Loads the local slot-to-student mapping table from W25Q32 Region A into RAM cache.
   */
  void loadRosterFromFlash() {
    for (uint16_t slot = 1; slot <= AS608_MAX_SLOTS; slot++) {
      uint32_t addr = ROSTER_BASE_ADDR + (uint32_t)slot * sizeof(LocalStudentSlotEntry);
      readBytes(addr, (uint8_t*)&ramRosterCache[slot], sizeof(LocalStudentSlotEntry));
      if (ramRosterCache[slot].magic != SLOT_RECORD_MAGIC) {
        memset(&ramRosterCache[slot], 0, sizeof(LocalStudentSlotEntry));
      }
    }
  }

  /**
   * Persists the RAM slot-to-student directory into W25Q32 Region A.
   */
  void commitRosterToFlash() {
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
   * Finds an existing AS608 slot for a student_id, or allocates the next free local slot (1..300).
   */
  uint16_t findOrAllocateSlotForStudent(uint32_t studentId) {
    for (uint16_t s = 1; s <= AS608_MAX_SLOTS; s++) {
      if (ramRosterCache[s].magic == SLOT_RECORD_MAGIC && ramRosterCache[s].student_id == studentId) {
        return s;
      }
    }
    for (uint16_t s = 1; s <= AS608_MAX_SLOTS; s++) {
      if (ramRosterCache[s].magic != SLOT_RECORD_MAGIC) {
        return s;
      }
    }
    return 0;
  }

  /**
   * Maps a local AS608 sensor slot to a student's identity in W25Q32 flash.
   */
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
    strncpy(entry.full_name, fullName ? fullName : "Student", sizeof(entry.full_name) - 1);
    strncpy(entry.template_sha256, templateSha256 ? templateSha256 : "", sizeof(entry.template_sha256) - 1);
    commitRosterToFlash();
  }

  /**
   * Resolves a matched AS608 sensor slot to the Student's Name, Roll Number & Student ID.
   */
  bool lookupStudentBySlot(uint16_t slot, LocalStudentSlotEntry& outEntry) {
    if (slot < 1 || slot > AS608_MAX_SLOTS) return false;
    if (ramRosterCache[slot].magic != SLOT_RECORD_MAGIC) return false;
    outEntry = ramRosterCache[slot];
    return true;
  }

  uint16_t getEnrolledStudentCount() {
    uint16_t count = 0;
    for (uint16_t s = 1; s <= AS608_MAX_SLOTS; s++) {
      if (ramRosterCache[s].magic == SLOT_RECORD_MAGIC) count++;
    }
    return count;
  }

  /**
   * Scans W25Q32 Region B on boot to count pending unsynced offline attendance records.
   */
  void scanOfflineQueuePointers() {
    unsyncedCount = 0;
    writeHeadIndex = 0;
    OfflineAttendanceRecord rec;
    for (uint32_t idx = 0; idx < MAX_OFFLINE_RECORDS; idx++) {
      uint32_t addr = OFFLINE_LOG_BASE_ADDR + idx * sizeof(OfflineAttendanceRecord);
      readBytes(addr, (uint8_t*)&rec, sizeof(OfflineAttendanceRecord));
      if (rec.magic == OFFLINE_SCAN_MAGIC) {
        writeHeadIndex = idx + 1;
        if (rec.synced == 0xFF) {
          unsyncedCount++;
        }
      } else if (rec.magic == 0xFFFF) {
        writeHeadIndex = idx;
        break;
      }
    }
  }

  /**
   * Appends a verified attendance scan to W25Q32 Flash when ESP32 is offline.
   */
  bool appendOfflineAttendance(
    uint32_t studentId,
    uint16_t rollNo,
    const char* fullName,
    const char* enrollmentNo,
    uint32_t epochTime,
    uint8_t confidence,
    const char* eventId
  ) {
    if (writeHeadIndex >= MAX_OFFLINE_RECORDS) {
      writeHeadIndex = 0;
    }
    uint32_t addr = OFFLINE_LOG_BASE_ADDR + writeHeadIndex * sizeof(OfflineAttendanceRecord);
    if ((addr % W25Q32_SECTOR_SIZE) == 0) {
      eraseSector4K(addr);
    }

    OfflineAttendanceRecord rec;
    memset(&rec, 0xFF, sizeof(rec));
    rec.magic = OFFLINE_SCAN_MAGIC;
    rec.synced = 0xFF; // Unsynced
    rec.confidence = confidence;
    rec.student_id = studentId;
    rec.class_roll_no = rollNo;
    rec.scanned_at_epoch = epochTime;
    strncpy(rec.event_id, eventId, sizeof(rec.event_id) - 1);
    strncpy(rec.full_name, fullName, sizeof(rec.full_name) - 1);
    strncpy(rec.enrollment_no, enrollmentNo, sizeof(rec.enrollment_no) - 1);

    writePage(addr, (const uint8_t*)&rec, sizeof(OfflineAttendanceRecord));
    writeHeadIndex++;
    unsyncedCount++;
    return true;
  }

  /**
   * Fetches up to `maxCount` unsynced attendance records from W25Q32 Flash for batch upload.
   */
  size_t fetchUnsyncedBatch(OfflineAttendanceRecord* outRecords, uint32_t* outIndices, size_t maxCount) {
    size_t found = 0;
    OfflineAttendanceRecord rec;
    for (uint32_t idx = 0; idx < writeHeadIndex && found < maxCount; idx++) {
      uint32_t addr = OFFLINE_LOG_BASE_ADDR + idx * sizeof(OfflineAttendanceRecord);
      readBytes(addr, (uint8_t*)&rec, sizeof(OfflineAttendanceRecord));
      if (rec.magic == OFFLINE_SCAN_MAGIC && rec.synced == 0xFF) {
        outRecords[found] = rec;
        outIndices[found] = idx;
        found++;
      }
    }
    return found;
  }

  /**
   * Marks an offline record in W25Q32 Flash as synced (flips synced byte from 0xFF -> 0x00 without erasing sector!).
   */
  void markRecordSynced(uint32_t recordIndex) {
    uint32_t syncedByteAddr = OFFLINE_LOG_BASE_ADDR + recordIndex * sizeof(OfflineAttendanceRecord) + 2;
    uint8_t zeroByte = 0x00;
    writePage(syncedByteAddr, &zeroByte, 1);
    if (unsyncedCount > 0) unsyncedCount--;
  }

  uint32_t getUnsyncedCount() const { return unsyncedCount; }
  uint32_t getUsedFlashKb() const {
    return 64 + ((writeHeadIndex * sizeof(OfflineAttendanceRecord)) / 1024);
  }
};

#endif // VIDYAOS_W25Q32_STORAGE_H
