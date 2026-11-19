/**
 * Standardized Student Work Filename Formatter
 * 
 * Enforces the institutional file naming format:
 *   rollno_firstname_lastname_worktype_subject.ext
 * 
 * Examples:
 *   1_girdhar_dhami_assignment_java.pdf
 *   1_girdhar_dhami_labrecord_java.pdf
 *   1_girdhar_dhami_test_java.pdf
 *   1_girdhar_dhami_vivaproject_java.pdf
 * 
 * Handles Required Documents Checklist items:
 *   • Total Assignments PDF Records (Consolidated) -> assignment
 *   • Class Test Records / Question Paper Solutions -> test
 *   • Practical / Lab Journal Records & Implementation -> labrecord
 *   • Viva Voce / Micro-Project Documentation -> vivaproject
 *   • Custom items -> small clean slug without breaking format
 */

const path = require('path');

function slugifyToken(str, maxLen = 20) {
  if (!str) return '';
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLen);
}

function normalizeStudentName(fullName) {
  if (!fullName) return 'student';
  const clean = fullName.replace(/[\(\)\[\]]/g, ' ').trim();
  const parts = clean.toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'student';
  if (parts.length === 1) {
    return slugifyToken(parts[0], 20);
  }
  const first = slugifyToken(parts[0], 15);
  const last = slugifyToken(parts[parts.length - 1], 15);
  return `${first}_${last}`;
}

function resolveWorkType({ checklistItem, assessmentType, assessmentTitle, customWorkType }) {
  // 1. If checklistItem is provided (e.g. from Required Documents Checklist)
  if (checklistItem) {
    const c = checklistItem.toLowerCase();
    if (c.includes('assign') || c.includes('assin')) return 'assignment';
    if (c.includes('test') || c.includes('exam') || c.includes('question') || c.includes('paper')) return 'test';
    if (c.includes('practical') || c.includes('lab') || c.includes('journal') || c.includes('implementation')) return 'labrecord';
    if (c.includes('viva') || c.includes('project') || c.includes('micro-project')) return 'vivaproject';
    
    // Custom checklist item: extract small clean part that does not break format
    const words = c.replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
    const shortToken = slugifyToken(words.slice(0, 2).join('_'), 16);
    return shortToken || 'document';
  }

  // 2. Custom work type override
  if (customWorkType) {
    const w = customWorkType.toLowerCase();
    if (w.includes('assign') || w.includes('assin')) return 'assignment';
    if (w.includes('test') || w.includes('exam')) return 'test';
    if (w.includes('lab') || w.includes('practical')) return 'labrecord';
    if (w.includes('viva') || w.includes('project')) return 'vivaproject';
    return slugifyToken(w, 12) || 'assignment';
  }

  // 3. From Assessment Type & Title
  const type = (assessmentType || '').toUpperCase();
  const title = (assessmentTitle || '').toLowerCase();

  if (title.includes('viva') || title.includes('micro-project') || title.includes('project')) {
    return 'vivaproject';
  }
  if (type === 'PRACTICAL' || type === 'LAB_EXPERIMENT' || title.includes('lab') || title.includes('practical') || title.includes('journal')) {
    return 'labrecord';
  }
  if (type === 'TEST' || type === 'CLASS_TEST' || type === 'EXAM' || title.includes('test') || title.includes('exam') || title.includes('quiz')) {
    return 'test';
  }

  return 'assignment';
}

function normalizeSubject(subjectName, subjectCode) {
  const s = (subjectName || '').toLowerCase();
  if (s.includes('java')) return 'java';
  if (s.includes('dbms') || s.includes('database')) return 'dbms';
  if (s.includes('operating') || s.includes(' os')) return 'os';
  if (s.includes('network') || s.includes(' cn')) return 'cn';
  if (s.includes('web tech') || s.includes('web')) return 'webtech';
  if (s.includes('python')) return 'python';
  if (s.includes('linux')) return 'linux';
  if (s.includes('cloud')) return 'cloud';
  if (s.includes('software')) return 'se';
  if (s.includes('data structure') || s.includes(' ds')) return 'dsa';

  if (subjectName) {
    const clean = slugifyToken(subjectName, 15);
    if (clean) return clean;
  }
  if (subjectCode) {
    return slugifyToken(subjectCode, 10);
  }
  return 'subject';
}

/**
 * Generates the standardized filename: rollno_firstname_lastname_worktype_subject.ext
 */
function formatSubmissionFilename({
  rollNo,
  fullName,
  checklistItem,
  assessmentType,
  assessmentTitle,
  customWorkType,
  subjectName,
  subjectCode,
  originalFilename
}) {
  const roll = (rollNo !== null && rollNo !== undefined && rollNo !== '') ? String(rollNo).trim() : '0';
  const namePart = normalizeStudentName(fullName);
  const workType = resolveWorkType({ checklistItem, assessmentType, assessmentTitle, customWorkType });
  const subjectPart = normalizeSubject(subjectName, subjectCode);
  const ext = originalFilename ? path.extname(originalFilename).toLowerCase() || '.pdf' : '.pdf';

  return `${roll}_${namePart}_${workType}_${subjectPart}${ext}`;
}

module.exports = {
  formatSubmissionFilename,
  normalizeStudentName,
  resolveWorkType,
  normalizeSubject,
  slugifyToken
};
