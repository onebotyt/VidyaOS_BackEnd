# VidyaOS — Pure MySQL 8.x / MariaDB Database Schema Dictionary

> **Adapter**: `src/config/db.js` (`mysql2/promise` pool)  
> **Charset / Collation**: `utf8mb4` / `utf8mb4_unicode_ci`  
> **Engine**: `InnoDB` (full ACID transactions via `withTransaction()`)

## 1. MySQL Connection Pool & SSL Architecture (`src/config/db.js`)

- **Connection Pooling**: Uses `mysql.createPool()` with configurable `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and `DB_CONNECTION_LIMIT` (default `10`).
- **Cloud SSL Verification**: Automatically detects `DB_SSL=true` or `ca.pem` in the repository root for encrypted connections to Aiven Cloud MySQL, TiDB Cloud, or AWS RDS.
- **Session SQL Mode**: Automatically strips `ONLY_FULL_GROUP_BY` on each pooled connection (`SET SESSION sql_mode=(SELECT REPLACE(@@sql_mode,'ONLY_FULL_GROUP_BY',''))`) so complex institutional aggregation queries run cleanly across MySQL 8.0+ and MariaDB 10/11.
- **100% Native MySQL 8.x SQL Execution**: All queries across models, services, and migrations execute pure MySQL 8.x / MariaDB InnoDB syntax (`ON DUPLICATE KEY UPDATE`, `INSERT IGNORE INTO`, `DATE_SUB`/`DATE_ADD`, `information_schema.columns`).
- **Dual Return-Shape Compatibility**: For `INSERT`/`UPDATE`/`DELETE` statements, `query()` attaches `rows[0] = rows` to the `ResultSetHeader` object so models checking either `res.insertId` or `res[0].insertId` work identically.

## 2. Complete MySQL Table Inventory

| Table Name | Column Count | Columns (`name (type)`) |
| :--- | ---: | :--- |
| `academic_years` | 7 | `id` (INT), `label` (VARCHAR(20)), `start_date` (DATE), `end_date` (DATE), `is_current` (BOOLEAN), `created_at` (TIMESTAMP), `updated_at` (TIMESTAMP) |
| `assessment_submissions` | 13 | `id` (INT), `assessment_id` (INT), `student_id` (INT), `file_path` (VARCHAR(500)), `original_filename` (VARCHAR(255)), `submitted_at` (DATETIME), `status` (VARCHAR(30)), `marks_obtained` (DECIMAL(10,2)), `feedback` (TEXT), `graded_at` (DATETIME), `graded_by` (INT), `created_at` (DATETIME), `updated_at` (DATETIME) |
| `assessments` | 17 | `id` (INT), `teacher_id` (INT), `subject_id` (INT), `department_id` (INT), `branch_id` (INT), `year` (INT), `semester` (INT), `academic_year_id` (INT), `type` (VARCHAR(30)), `title` (VARCHAR(255)), `description` (TEXT), `attachment_path` (VARCHAR(500)), `attachment_name` (VARCHAR(255)), `due_date` (DATETIME), `max_marks` (DECIMAL(10,2)), `created_at` (DATETIME), `updated_at` (DATETIME) |
| `assignment_submissions` | 11 | `id` (INT), `assignment_id` (INT), `student_id` (INT), `file_path` (VARCHAR(500)), `original_filename` (VARCHAR(255)), `submitted_at` (DATETIME), `status` (VARCHAR(30)), `marks_obtained` (DECIMAL(10,2)), `feedback` (TEXT), `graded_at` (DATETIME), `graded_by` (INT) |
| `assignments` | 16 | `id` (INT), `teacher_id` (INT), `subject_id` (INT), `department_id` (INT), `branch_id` (INT), `year` (INT), `semester` (INT), `academic_year_id` (INT), `title` (VARCHAR(255)), `description` (TEXT), `attachment_path` (VARCHAR(500)), `attachment_name` (VARCHAR(255)), `due_date` (DATETIME), `max_marks` (INT), `created_at` (DATETIME), `updated_at` (DATETIME) |
| `attendance_corrections` | 8 | `id` (INT), `session_id` (INT), `student_id` (INT), `original_status` (VARCHAR(50)), `new_status` (VARCHAR(50)), `reason` (TEXT), `changed_by` (INT), `created_at` (DATETIME) |
| `attendance_registers` | 15 | `id` (INT), `teacher_id` (INT), `name` (VARCHAR(200)), `subject_id` (INT), `assignment_id` (INT), `department_id` (INT), `branch_id` (INT), `year` (INT), `semester` (INT), `academic_year_id` (INT), `session_type_scope` (ENUM('THEORY',), `is_official` (BOOLEAN), `is_active` (BOOLEAN), `created_at` (TIMESTAMP), `updated_at` (TIMESTAMP) |
| `attendance_session_pins` | 5 | `id` (INT), `session_id` (INT), `pin_code` (VARCHAR(10)), `expires_at` (DATETIME), `created_at` (TIMESTAMP) |
| `attendance_session_qr` | 5 | `id` (INT), `session_id` (INT), `token_hash` (VARCHAR(255)), `expires_at` (DATETIME), `created_at` (TIMESTAMP) |
| `attendance_session_students` | 7 | `id` (INT), `session_id` (INT), `student_id` (INT), `enrollment_id` (INT), `class_roll_no` (INT), `included` (BOOLEAN), `created_at` (TIMESTAMP) |
| `attendance_sessions` | 16 | `id` (INT), `teacher_id` (INT), `subject_id` (INT), `department_id` (INT), `branch_id` (INT), `year` (INT), `semester` (INT), `academic_year_id` (INT), `session_type` (ENUM('THEORY',), `label` (VARCHAR(100)), `start_time` (DATETIME), `end_time` (DATETIME), `state` (ENUM('DRAFT',), `auto_close_at` (DATETIME), `created_at` (TIMESTAMP), `updated_at` (TIMESTAMP) |
| `audit_logs` | 8 | `id` (INT), `user_id` (INT), `action` (VARCHAR(100)), `entity_type` (VARCHAR(100)), `entity_id` (VARCHAR(100)), `details_json` (JSON), `ip_address` (VARCHAR(45)), `created_at` (TIMESTAMP) |
| `branches` | 7 | `id` (INT), `department_id` (INT), `name` (VARCHAR(100)), `code` (VARCHAR(20)), `is_active` (BOOLEAN), `created_at` (TIMESTAMP), `updated_at` (TIMESTAMP) |
| `classroom_posts` | 7 | `id` (INT), `group_id` (INT), `author_id` (INT), `content` (TEXT), `post_type` (VARCHAR(50)), `created_at` (DATETIME), `updated_at` (DATETIME) |
| `cohort_registration_settings` | 9 | `id` (INT), `department_id` (INT), `branch_id` (INT), `year` (INT), `semester` (INT), `academic_year_id` (INT), `registration_open` (BOOLEAN), `changed_by` (INT), `changed_at` (TIMESTAMP) |
| `common_faculty_manager_assignments` | 6 | `id` (INT), `teacher_id` (INT), `appointed_by` (INT), `is_active` (TINYINT(1)), `appointed_at` (DATETIME), `revoked_at` (DATETIME) |
| `departments` | 6 | `id` (INT), `name` (VARCHAR(100)), `code` (VARCHAR(20)), `is_active` (BOOLEAN), `created_at` (TIMESTAMP), `updated_at` (TIMESTAMP) |
| `device_events` | 5 | `id` (INT), `device_id` (INT), `event_type` (ENUM('HEARTBEAT',), `payload_json` (JSON), `created_at` (TIMESTAMP) |
| `devices` | 14 | `id` (INT), `device_uid` (VARCHAR(100)), `name` (VARCHAR(100)), `department_id` (INT), `branch_id` (INT), `year` (INT), `semester` (INT), `academic_year_id` (INT), `secret_hash` (VARCHAR(255)), `certificate_fingerprint` (VARCHAR(255)), `is_active` (BOOLEAN), `last_heartbeat_at` (TIMESTAMP), `created_at` (TIMESTAMP), `updated_at` (TIMESTAMP) |
| `enrollments` | 11 | `id` (INT), `student_id` (INT), `department_id` (INT), `branch_id` (INT), `year` (INT), `semester` (INT), `academic_year_id` (INT), `class_roll_no` (INT), `status` (ENUM('ENROLLED',), `created_at` (TIMESTAMP), `updated_at` (TIMESTAMP) |
| `esp32_command_queue` | 12 | `id` (INT), `device_id` (INT), `department_id` (INT), `command_type` (VARCHAR(50)), `student_id` (INT), `payload_json` (LONGTEXT), `status` (VARCHAR(30)), `result_message` (VARCHAR(255)), `created_by` (INT), `created_at` (DATETIME), `updated_at` (DATETIME), `completed_at` (DATETIME) |
| `esp32_presence` | 7 | `id` (INT), `event_id` (VARCHAR(64)), `device_id` (INT), `student_id` (INT), `scan_time` (DATETIME), `payload_json` (JSON), `created_at` (TIMESTAMP) |
| `exam_scores` | 8 | `id` (INT), `exam_id` (INT), `student_id` (INT), `marks_obtained` (DECIMAL(10,2)), `remarks` (TEXT), `entered_by` (INT), `created_at` (DATETIME), `updated_at` (DATETIME) |
| `exams` | 13 | `id` (INT), `teacher_id` (INT), `subject_id` (INT), `department_id` (INT), `branch_id` (INT), `year` (INT), `semester` (INT), `academic_year_id` (INT), `name` (VARCHAR(255)), `exam_date` (DATE), `max_marks` (INT), `created_at` (DATETIME), `updated_at` (DATETIME) |
| `faculty_registration_requests` | 14 | `id` (INT), `full_name` (VARCHAR(150)), `email` (VARCHAR(191)), `phone` (VARCHAR(20)), `employee_id` (VARCHAR(100)), `requested_role` (VARCHAR(50)), `department_id` (INT), `password_hash` (VARCHAR(255)), `approval_type` (VARCHAR(50)), `status` (VARCHAR(50)), `rejection_reason` (TEXT), `adjudicated_by` (INT), `adjudicated_at` (DATETIME), `created_at` (DATETIME) |
| `fingerprint_slots` | 6 | `id` (INT), `device_id` (INT), `slot_id` (INT), `student_id` (INT), `enrolled_at` (TIMESTAMP), `is_active` (BOOLEAN) |
| `iot_attendance_events` | 10 | `id` (INT), `student_id` (INT), `device_id` (INT), `department_id` (INT), `scan_time` (DATETIME), `scan_date` (DATE), `verification_status` (VARCHAR(50)), `event_type` (VARCHAR(50)), `raw_payload` (TEXT), `created_at` (DATETIME) |
| `leave_applications` | 11 | `id` (INT), `student_id` (INT), `from_date` (DATE), `to_date` (DATE), `reason` (TEXT), `status` (VARCHAR(30)), `reviewed_by` (INT), `review_note` (TEXT), `reviewed_at` (DATETIME), `created_at` (DATETIME), `updated_at` (DATETIME) |
| `notifications` | 7 | `id` (INT), `user_id` (INT), `title` (VARCHAR(150)), `message` (TEXT), `is_read` (BOOLEAN), `link_url` (VARCHAR(255)), `created_at` (TIMESTAMP) |
| `otp_verifications` | 7 | `id` (INT), `phone` (VARCHAR(20)), `otp_code` (VARCHAR(10)), `purpose` (VARCHAR(50)), `is_verified` (TINYINT(1)), `expires_at` (DATETIME), `created_at` (DATETIME) |
| `register_attendance` | 9 | `id` (INT), `session_id` (INT), `student_id` (INT), `attendance_status` (ENUM('PRESENT',), `source` (ENUM('MANUAL',), `teacher_notes` (TEXT), `marked_by` (INT), `marked_at` (TIMESTAMP), `updated_at` (TIMESTAMP) |
| `student_biometric_templates` | 12 | `id` (INT), `student_id` (INT), `department_id` (INT), `finger_index` (TINYINT), `template_base64` (LONGTEXT), `template_sha256` (VARCHAR(64)), `quality_score` (INT), `captured_by_device_uid` (VARCHAR(100)), `enrolled_by` (INT), `is_active` (TINYINT(1)), `created_at` (DATETIME), `updated_at` (DATETIME) |
| `student_department_enrollments` | 12 | `id` (INT), `student_id` (INT), `department_id` (INT), `academic_year_id` (INT), `year` (INT), `semester` (INT), `class_roll_no` (INT), `start_date` (DATE), `end_date` (DATE), `status` (VARCHAR(50)), `created_at` (DATETIME), `updated_at` (DATETIME) |
| `student_self_attendance` | 8 | `id` (INT), `session_id` (INT), `student_id` (INT), `verification_method` (ENUM('PIN',), `request_status` (ENUM('PENDING',), `submitted_at` (TIMESTAMP), `reviewed_at` (TIMESTAMP), `reviewed_by` (INT) |
| `students` | 7 | `id` (INT), `user_id` (INT), `official_enrollment_no` (VARCHAR(50)), `full_name` (VARCHAR(150)), `entry_mode` (ENUM('teacher_provisioned',), `created_at` (TIMESTAMP), `updated_at` (TIMESTAMP) |
| `subjects` | 10 | `id` (INT), `department_id` (INT), `branch_id` (INT), `year` (INT), `semester` (INT), `name` (VARCHAR(150)), `code` (VARCHAR(30)), `is_active` (BOOLEAN), `created_at` (TIMESTAMP), `updated_at` (TIMESTAMP) |
| `system_settings` | 6 | `id` (INT), `setting_key` (VARCHAR(100)), `setting_value` (TEXT), `description` (VARCHAR(255)), `updated_by` (INT), `updated_at` (TIMESTAMP) |
| `teacher_assignments` | 13 | `id` (INT), `teacher_id` (INT), `assignment_type` (ENUM('SUBJECT_TEACHER',), `subject_id` (INT), `department_id` (INT), `branch_id` (INT), `year` (INT), `semester` (INT), `academic_year_id` (INT), `assigned_by` (INT), `is_active` (BOOLEAN), `created_at` (TIMESTAMP), `updated_at` (TIMESTAMP) |
| `teachers` | 7 | `id` (INT), `user_id` (INT), `employee_id` (VARCHAR(50)), `full_name` (VARCHAR(150)), `phone` (VARCHAR(20)), `created_at` (TIMESTAMP), `updated_at` (TIMESTAMP) |
| `teaching_group_members` | 5 | `id` (INT), `group_id` (INT), `student_id` (INT), `joined_at` (DATETIME), `status` (VARCHAR(50)) |
| `teaching_groups` | 12 | `id` (INT), `name` (VARCHAR(150)), `subject_name` (VARCHAR(150)), `component` (VARCHAR(50)), `teacher_id` (INT), `academic_year_id` (INT), `semester` (INT), `invite_code` (VARCHAR(20)), `status` (VARCHAR(50)), `is_archived` (TINYINT(1)), `created_at` (DATETIME), `archived_at` (DATETIME) |
| `timetable_slots` | 16 | `id` (INT), `department_id` (INT), `branch_id` (INT), `year` (INT), `semester` (INT), `academic_year_id` (INT), `subject_id` (INT), `teacher_id` (INT), `day_of_week` (INT), `start_time` (VARCHAR(16)), `end_time` (VARCHAR(16)), `room` (VARCHAR(100)), `session_type` (VARCHAR(30)), `created_by` (INT), `created_at` (DATETIME), `updated_at` (DATETIME) |
| `user_roles` | 4 | `id` (INT), `user_id` (INT), `role` (ENUM('SYSTEM_ADMIN',), `created_at` (TIMESTAMP) |
| `user_sessions` | 9 | `id` (INT), `user_id` (INT), `refresh_token_hash` (VARCHAR(255)), `user_agent` (VARCHAR(255)), `ip_address` (VARCHAR(45)), `expires_at` (DATETIME), `is_revoked` (BOOLEAN), `created_at` (TIMESTAMP), `updated_at` (TIMESTAMP) |
| `users` | 11 | `id` (INT), `username` (VARCHAR(100)), `email` (VARCHAR(150)), `password_hash` (VARCHAR(255)), `temp_password_hash` (VARCHAR(255)), `must_change_password` (BOOLEAN), `google_sub` (VARCHAR(255)), `status` (ENUM('PROVISIONED',), `rejection_reason` (VARCHAR(255)), `created_at` (TIMESTAMP), `updated_at` (TIMESTAMP) |

## 3. MySQL Compatibility Views (`ensureCompatibilityViews()`)

| View Name | Underlying Source Table | Filter / Purpose |
| :--- | :--- | :--- |
| `exams` | `assessments` | Projects `WHERE type = 'EXAM'` with `title AS name`, `due_date AS exam_date` |
| `exam_scores` | `assessment_submissions` | Maps `assessment_id AS exam_id`, `feedback AS remarks`, `graded_by AS entered_by` |
| `assignments` | `assessments` | Projects `WHERE type = 'ASSIGNMENT'` |
| `assignment_submissions` | `assessment_submissions` | Maps `assessment_id AS assignment_id` for assignment grading queries |
| `attendance_session_pins` | `attendance_sessions` | Projects active PIN codes (`WHERE pin_code IS NOT NULL`) |
| `attendance_session_qr` | `attendance_sessions` | Projects active QR token hashes (`WHERE qr_token IS NOT NULL`) |
