const fs = require('fs');
const path = require('path');
const { query } = require('../src/config/db');

// Minimal valid PDF binary generator
function createDummyPdf(text) {
  return `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 120 >>
stream
BT
/F1 18 Tf
50 720 Td
(${text}) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000414 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
495
%%EOF`;
}

async function main() {
  console.log('Seeding Java coursework & Girdhar Dhami (Roll 1)...');

  // 1. Update Student 1 to Girdhar Dhami
  await query(`UPDATE students SET full_name = 'Girdhar Dhami', class_roll_no = 1 WHERE id = 1`);
  console.log('✓ Student 1 set to Girdhar Dhami (Roll 1)');

  // 2. Ensure Java subject exists
  let javaSub = await query(`SELECT id FROM subjects WHERE code = 'IT506' OR name LIKE '%Java%' LIMIT 1`);
  let subjectId;
  if (!javaSub || javaSub.length === 0) {
    const res = await query(`
      INSERT INTO subjects (department_id, name, code, semester, year, is_active)
      VALUES (4, 'Java Programming', 'IT506', 5, 3, 1)
    `);
    subjectId = res.insertId || res.lastID;
    console.log('✓ Created Java Programming subject ID:', subjectId);
  } else {
    subjectId = javaSub[0].id;
    console.log('✓ Found Java Programming subject ID:', subjectId);
  }

  // 3. Ensure Teaching Group exists
  let tgRows = await query(`SELECT id FROM teaching_groups WHERE subject_code = 'IT506' OR name LIKE '%Java%' LIMIT 1`);
  let groupId;
  if (!tgRows || tgRows.length === 0) {
    const teacherRows = await query(`SELECT id FROM teachers WHERE department_id = 4 LIMIT 1`);
    const teacherId = teacherRows[0]?.id || 1;
    const res = await query(`
      INSERT INTO teaching_groups (department_id, teacher_id, name, subject_name, subject_code, subject_short_name, semester, year, academic_year_id, invite_code)
      VALUES (4, ?, 'Java Programming [IT506]', 'Java Programming', 'IT506', 'Java', 5, 3, 1, 'JAVA506')
    `, [teacherId]);
    groupId = res.insertId || res.lastID;
    console.log('✓ Created Java Teaching Group ID:', groupId);
  } else {
    groupId = tgRows[0].id;
    console.log('✓ Found Java Teaching Group ID:', groupId);
  }

  // Ensure student 1 is enrolled in teaching group
  const memberCheck = await query(`SELECT id FROM teaching_group_members WHERE group_id = ? AND student_id = 1`, [groupId]);
  if (!memberCheck || memberCheck.length === 0) {
    await query(`INSERT INTO teaching_group_members (group_id, student_id) VALUES (?, 1)`, [groupId]);
    console.log('✓ Enrolled Girdhar Dhami into Java Teaching Group');
  }

  // 4. Create sample files on disk
  const uploadsDir = path.join(__dirname, '../uploads/submissions');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const f1 = '1_girdhar_dhami_assignment_java.pdf';
  const f2 = '1_girdhar_dhami_assignment2_java.pdf';
  const f3 = '1_girdhar_dhami_test_java.pdf';
  const f4 = '1_girdhar_dhami_labrecord_java.pdf';

  fs.writeFileSync(path.join(uploadsDir, f1), createDummyPdf('VidyaOS - Assignment 1: Java OOP Principles by Girdhar Dhami'));
  fs.writeFileSync(path.join(uploadsDir, f2), createDummyPdf('VidyaOS - Assignment 2: Java Collections & Exceptions by Girdhar Dhami'));
  fs.writeFileSync(path.join(uploadsDir, f3), createDummyPdf('VidyaOS - Class Test 1: Core Java Solutions by Girdhar Dhami'));
  fs.writeFileSync(path.join(uploadsDir, f4), createDummyPdf('VidyaOS - Lab Journal: Java Multithreading by Girdhar Dhami'));
  console.log('✓ Sample submission PDF files created on disk');

  // 5. Ensure assessments exist
  const teacherRows = await query(`SELECT id FROM teachers WHERE department_id = 4 LIMIT 1`);
  const teacherId = teacherRows[0]?.id || 1;

  async function upsertAssessment(title, type, maxMarks) {
    const existing = await query(`SELECT id FROM assessments WHERE (group_id = ? OR department_id = 4) AND title = ? LIMIT 1`, [groupId, title]);
    let aId;
    if (existing && existing.length > 0) {
      aId = existing[0].id;
    } else {
      const res = await query(`
        INSERT INTO assessments (group_id, teacher_id, subject_id, department_id, year, semester, academic_year_id, title, type, max_marks, created_at)
        VALUES (?, ?, ?, 4, 3, 5, 1, ?, ?, ?, NOW())
      `, [groupId, teacherId, subjectId, title, type, maxMarks]);
      aId = res.insertId || res.lastID;
    }
    return aId;
  }

  const a1 = await upsertAssessment('Assignment 1: Java OOP Principles & Inheritance', 'ASSIGNMENT', 10);
  const a2 = await upsertAssessment('Assignment 2: Java Collections & Exception Handling', 'ASSIGNMENT', 10);
  const a3 = await upsertAssessment('Class Test 1: Core Java Fundamentals', 'EXAM', 20);
  const a4 = await upsertAssessment('Lab 1: Java Multithreading & File Streams', 'PRACTICAL', 20);

  // 6. Upsert submissions for Girdhar Dhami (Student 1)
  async function upsertSub(assessmentId, filename, marks, feedback) {
    await query(`
      INSERT INTO assessment_submissions (assessment_id, student_id, file_path, original_filename, marks_obtained, status, submitted_at, feedback)
      VALUES (?, 1, ?, ?, ?, 'GRADED', NOW(), ?)
      ON DUPLICATE KEY UPDATE 
        file_path = VALUES(file_path),
        original_filename = VALUES(original_filename),
        marks_obtained = VALUES(marks_obtained),
        status = 'GRADED',
        feedback = VALUES(feedback)
    `, [assessmentId, `/uploads/submissions/${filename}`, filename, marks, feedback]);
  }

  await upsertSub(a1, f1, 9.5, 'Excellent explanation of encapsulation and inheritance.');
  await upsertSub(a2, f2, 10.0, 'Full marks. Clean code and exception hierarchy diagrams.');
  await upsertSub(a3, f3, 18.0, 'Very good test score. Minor syntax error in question 4.');
  await upsertSub(a4, f4, 19.5, 'Outstanding lab implementation with thread synchronization.');

  console.log('✓ All 4 submissions seeded for Girdhar Dhami!');
  console.log('Done!');
  process.exit(0);
}

main().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
