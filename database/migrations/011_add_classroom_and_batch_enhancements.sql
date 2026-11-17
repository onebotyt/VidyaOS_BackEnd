-- Migration 011: Classroom Metadata Enhancements and Batch Indexing
ALTER TABLE teaching_groups ADD COLUMN IF NOT EXISTS subject_short_name VARCHAR(50) NULL AFTER subject_name;
ALTER TABLE teaching_groups ADD COLUMN IF NOT EXISTS year INT NULL AFTER semester;

-- Auto-fill year based on semester for existing teaching groups
UPDATE teaching_groups SET year = CEIL(semester / 2) WHERE year IS NULL AND semester IS NOT NULL;
