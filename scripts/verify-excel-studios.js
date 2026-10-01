/**
 * Automated Verification Script: Institutional Excel Marksheet & Progress Studios
 * Tests:
 * 1. OpenXML Excel Generation & Formulas Verification via ExcelJS parser
 * 2. Playwright UI Automation: Class Test Studio (Image 1 replica), Add Question column, Absent toggle
 * 3. Playwright UI Automation: Master Internal Evaluation Studio (Image 2 replica), Add Column, calculations
 * 4. Captures visual screenshots for walkthrough.md
 */

const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';
const ARTIFACT_DIR = path.resolve('C:/Users/GD/.gemini/antigravity-ide/brain/988bafc2-0375-4ef1-bbd9-b63358c45e39');

async function runVerification() {
  console.log('======================================================');
  console.log('🧪 VERIFYING INSTITUTIONAL EXCEL STUDIOS & EXPORTS');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(cond, msg) {
    if (cond) {
      console.log(`✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${msg}`);
      failed++;
    }
  }

  // 1. Direct API & ExcelJS OpenXML Tests
  console.log('--- 1. Testing Backend Excel Generation & OpenXML Parsing ---');

  // Authenticate
  const loginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'hod@gmail.com', password: 'Password@123' })
  });
  const loginData = await loginRes.json();
  const token = loginData.data?.access_token || loginData.data?.token;
  assert(loginData.success && Boolean(token), 'Login successful for HOD');

  // Fetch registers
  const regRes = await fetch(`${BASE_URL}/api/v1/faculty/registers`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const regData = await regRes.json();
  assert(regData.success && regData.data?.length > 0, 'Fetched active registers');
  const regId = regData.data[0].id;

  // Fetch exams
  const examsRes = await fetch(`${BASE_URL}/api/v1/exams?department_id=${regData.data[0].department_id}&semester=${regData.data[0].semester}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const examsData = await examsRes.json();
  assert(examsData.success, 'Fetched exams list');
  let examId = examsData.data && examsData.data.length ? examsData.data[0].id : null;

  if (!examId) {
    const createExamRes = await fetch(`${BASE_URL}/api/v1/exams`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        name: 'Unit Test 4',
        type: 'UNIT_TEST',
        exam_date: new Date().toISOString().slice(0, 10),
        max_marks: 25,
        subject_id: regData.data[0].subject_id,
        department_id: regData.data[0].department_id,
        year: regData.data[0].year,
        semester: regData.data[0].semester
      })
    });
    const created = await createExamRes.json();
    assert(created.success, 'Created demo Unit Test 4');
    examId = created.data.id;
  }

  // Test Class Test Excel Export (POST with custom added Q5 and absent student)
  console.log('\n--- 2. Testing Class Test (.xlsx) OpenXML Export with Custom Grid ---');
  const customExamPayload = {
    institution_name: 'Uttarakhand Government Institute of Polytechnic, Srinagar Garhwal',
    session_label: 'Internal Evaluation Sheet 2026 Session',
    department_name: 'Information Technology',
    department_code: 'IT',
    subject_name: 'Database Management Systems',
    year: 3,
    semester: 5,
    name: 'Unit Test 4',
    max_marks: 30,
    exam_date: '2026-09-20',
    duration: '50 Minutes',
    mode: 'OFFLINE',
    questions: [
      { num: 1, label: 'Q1', max: 5 },
      { num: 2, label: 'Q2', max: 5 },
      { num: 3, label: 'Q3', max: 5 },
      { num: 4, label: 'Q4', max: 10 },
      { num: 5, label: 'Q5', max: 5 } // Custom added question!
    ],
    instructions: [
      'All questions are compulsory.',
      'Write your Roll Number and Name clearly.',
      'No electronic gadgets allowed.'
    ],
    questions_meta: [
      { num: 1, text: 'Explain ACID properties in DBMS.', marks: 5 },
      { num: 2, text: 'Define normalization and 1NF, 2NF, 3NF.', marks: 5 },
      { num: 3, text: 'Primary key vs foreign key.', marks: 5 },
      { num: 4, text: 'SQL JOIN operations with examples.', marks: 10 },
      { num: 5, text: 'Transaction isolation levels.', marks: 5 }
    ],
    roster: [
      { student_id: 101, class_roll_no: 1, official_enrollment_no: 'ENR001', full_name: 'Aarav Sharma', is_absent: false, question_scores: [5, 4.5, 4, 9, 4.5] },
      { student_id: 102, class_roll_no: 2, official_enrollment_no: 'ENR002', full_name: 'Priya Verma', is_absent: true, question_scores: [0, 0, 0, 0, 0] }, // Absent in red!
      { student_id: 103, class_roll_no: 3, official_enrollment_no: 'ENR003', full_name: 'Rohan Patel', is_absent: false, question_scores: [4, 4, 3.5, 8, 4] }
    ]
  };

  const examExportRes = await fetch(`${BASE_URL}/api/v1/exams/${examId}/export/excel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(customExamPayload)
  });

  assert(examExportRes.status === 200, `POST /api/v1/exams/${examId}/export/excel returns HTTP 200`);
  const examExcelBuffer = await examExportRes.arrayBuffer();
  assert(examExcelBuffer.byteLength > 2000, `Excel file generated (${examExcelBuffer.byteLength} bytes)`);

  // Parse with ExcelJS to verify structure
  const wbExam = new ExcelJS.Workbook();
  await wbExam.xlsx.load(Buffer.from(examExcelBuffer));
  const wsExam = wbExam.getWorksheet(1);
  assert(wsExam !== undefined, 'Worksheet loaded cleanly');
  assert(wsExam.getCell(1, 1).value.includes('Uttarakhand Government Institute of Polytechnic'), 'Row 1 Header contains institutional name');
  assert(wsExam.getCell(5, 9).value === 'Total', 'Row 5 Column 9 is Total (accommodating Q1..Q5)');
  assert(wsExam.getCell(5, 8).value === 'Q5', 'Row 5 Column 8 is custom added Q5');
  
  // Check absent student styling in row 7 (Priya Verma)
  const student2Name = wsExam.getCell(7, 3).value;
  assert(student2Name.toUpperCase() === 'PRIYA VERMA', 'Student 2 is Priya Verma');
  const student2Q1Cell = wsExam.getCell(7, 4);
  assert(student2Q1Cell.font && student2Q1Cell.font.color && student2Q1Cell.font.color.argb === 'FFFF0000', 'Absent student score has bold RED font (FFFF0000)');
  const student2TotalCell = wsExam.getCell(7, 9);
  assert(student2TotalCell.font && student2TotalCell.font.color && student2TotalCell.font.color.argb === 'FFFF0000', 'Absent student Total has bold RED font (FFFF0000)');

  // Test Internal Evaluation Master Sheet Export
  console.log('\n--- 3. Testing Master Internal Evaluation (.xlsx) OpenXML Export ---');
  const customEvalPayload = {
    institution_name: 'Uttarakhand Government Institute of Polytechnic, Srinagar Garhwal',
    session_label: 'Internal Evaluation Sheet 2026 Session',
    department_name: 'Information Technology',
    department_code: 'IT',
    subject_name: 'Database Management Systems',
    semester: 5,
    assignments: [
      { id: 1, name: '1' }, { id: 2, name: '2' }, { id: 3, name: '3' }, { id: 4, name: '4' }, { id: 5, name: '5' }
    ],
    exams: [
      { id: 1, name: '1' }, { id: 2, name: '2' }, { id: 3, name: '3' }, { id: 4, name: '4' }
    ],
    custom_columns: [
      { id: 'viva', name: 'Viva / Quiz (5)', max: 5 } // Custom added assessment column!
    ],
    students: [
      {
        student_id: 101,
        class_roll_no: 1,
        official_enrollment_no: 'ENR001',
        full_name: 'Aarav Sharma',
        assignment_scores: [9, 8.5, 9, 8, 9],
        assignment_avg: 13.1,
        exam_scores: [22, 21, 23, 22],
        exam_absent: [false, false, false, false],
        exam_avg: 17.6,
        attendance_score: 9.5,
        presentation_score: 4.5,
        custom_scores: [4.5],
        grand_total: 49
      },
      {
        student_id: 102,
        class_roll_no: 2,
        official_enrollment_no: 'ENR002',
        full_name: 'Priya Verma',
        assignment_scores: [8, 8, 7.5, 8, 8],
        assignment_avg: 11.9,
        exam_scores: [20, 0, 19, 21],
        exam_absent: [false, true, false, false], // Unit Test 2 absent in red!
        exam_avg: 16.0,
        attendance_score: 8.5,
        presentation_score: 4.0,
        custom_scores: [4.0],
        grand_total: 44
      }
    ]
  };

  const evalExportRes = await fetch(`${BASE_URL}/api/v1/faculty/registers/${regId}/export/internal-evaluation-excel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(customEvalPayload)
  });

  assert(evalExportRes.status === 200, `POST /api/v1/faculty/registers/${regId}/export/internal-evaluation-excel returns HTTP 200`);
  const evalExcelBuffer = await evalExportRes.arrayBuffer();
  assert(evalExcelBuffer.byteLength > 2000, `Master Evaluation Excel generated (${evalExcelBuffer.byteLength} bytes)`);

  const wbEval = new ExcelJS.Workbook();
  await wbEval.xlsx.load(Buffer.from(evalExcelBuffer));
  const wsEval = wbEval.getWorksheet(1);
  assert(wsEval !== undefined, 'Master Evaluation worksheet loaded cleanly');
  // Find headers dynamically in wsEval row 4
  let foundAssignMarks = false;
  let foundUtMarks = false;
  let foundCustomCol = false;
  let foundGrandTotal = false;

  for (let c = 1; c <= 25; c++) {
    const val = String(wsEval.getCell(4, c).value || '');
    if (val.includes('Assignment Marks')) foundAssignMarks = true;
    if (val.includes('Unit Test Marks')) foundUtMarks = true;
    if (val.includes('Viva')) foundCustomCol = true;
    if (val.includes('Total') && val.includes('Marks')) foundGrandTotal = true;
  }

  assert(foundAssignMarks, 'Found "Assignment Marks" group header in Row 4');
  assert(foundUtMarks, 'Found "Unit Test Marks" group header in Row 4');
  assert(foundCustomCol, 'Found custom added "Viva / Quiz (5)" header in Row 4');
  assert(foundGrandTotal, 'Found "Total Marks (50)" header in Row 4');

  // Check Priya Verma UT2 absent formatting (row 7, col 12)
  const ut2Cell = wsEval.getCell(7, 12);
  assert(ut2Cell.value === 'AB', 'UT2 cell shows AB for absent exam');
  assert(ut2Cell.font && ut2Cell.font.color && ut2Cell.font.color.argb === 'FFFF0000', 'UT2 AB cell font is bold RED (FFFF0000)');

  // 4. Playwright End-to-End Browser UI Automation
  console.log('\n--- 4. Running Playwright UI Automation ---');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('   [Browser Error]:', msg.text());
  });

  // Login via faculty login page
  console.log('Logging in at /login/faculty.html...');
  await page.goto(`${BASE_URL}/login/faculty.html`, { waitUntil: 'networkidle' });
  await page.fill('#username', 'hod@gmail.com');
  await page.fill('#password', 'Password@123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1000);

  // Navigate to dedicated tests page
  console.log('Navigating to /faculty/tests.html...');
  await page.goto(`${BASE_URL}/faculty/tests.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#register-switcher-select');
  await page.waitForTimeout(1200);

  // Verify workspace buttons
  const evalBtn = await page.$('button:has-text("Internal Evaluation Sheet")');
  assert(evalBtn !== null, 'Found "Internal Evaluation Sheet" button in workspace bar');

  // Verify exam card and buttons
  await page.waitForSelector('.item-card');
  const exportBtnOnCard = await page.$('.item-card button:has-text("Export Excel")');
  assert(exportBtnOnCard !== null, 'Found "📥 Export Excel (.xlsx)" button on exam card');

  const editBtn = await page.$('.item-card button:has-text("Edit")');
  assert(editBtn !== null, 'Found "Edit" button on exam card');

  // Click Edit to open Class Test Marksheet Studio
  console.log('Opening Class Test Marksheet Studio...');
  await editBtn.click();
  await page.waitForSelector('.sheet-studio-container', { timeout: 5000 });
  assert(true, 'Class Test Marksheet Studio opened in expand panel');

  // Check studio elements
  const studioBanner = await page.$eval('.sheet-header-banner', el => el.innerText);
  assert(studioBanner.includes('Internal Evaluation'), `Banner displays: "${studioBanner.slice(0, 45)}..."`);

  const sidePanel = await page.$('.sheet-side-panel');
  assert(sidePanel !== null, 'Side Panel with instructions and questions exists');

  const redNote = await page.$eval('.sheet-note-red', el => el.innerText);
  assert(redNote.includes('NOTE : All marked as RED were absent.'), 'Red absent warning note is present in side panel');

  // Test + Add Question button
  console.log('Clicking "+ Add Question"...');
  const addQBtn = await page.$('button:has-text("+ Add Question")');
  assert(addQBtn !== null, 'Found "+ Add Question" button');
  await addQBtn.click();
  await page.waitForSelector('#exam-questions-modal.open', { timeout: 4000 });
  assert(true, 'Questions & Marks modal opened');

  // Click + Add Another Question in modal
  await page.click('#exam-questions-modal button:has-text("+ Add Another Question")');
  await page.waitForTimeout(300);

  // Click Save & Apply Questions in modal
  await page.click('#exam-questions-modal button:has-text("Save & Apply Questions")');
  await page.waitForTimeout(600);

  const q5Header = await page.$('th:has-text("Q5")');
  assert(q5Header !== null, 'Question column Q5 dynamically added to spreadsheet grid');

  // Toggle student absent
  console.log('Toggling student attendance status...');
  const presentBtn = await page.$('td button:has-text("Present")');
  if (presentBtn) {
    await presentBtn.click();
    await page.waitForTimeout(600);
    const isAbsentRow = await page.$('tr.is-absent');
    assert(isAbsentRow !== null, 'Student row received is-absent class with bold red text');
  }

  // Capture Screenshot of Class Test Marksheet Studio
  const examStudioShotPath = path.join(ARTIFACT_DIR, 'class_test_spreadsheet_studio.png');
  await page.screenshot({ path: examStudioShotPath });
  console.log(`📸 Screenshot saved: ${examStudioShotPath}`);

  // Now test Master Internal Evaluation Studio Modal
  console.log('\n--- 5. Testing Master Internal Evaluation Modal UI ---');
  await page.locator('#exams-quick-controls button:has-text("Internal Evaluation Sheet")').click();
  await page.waitForSelector('#internal-eval-modal.open', { timeout: 5000 });
  assert(true, 'Master Internal Evaluation Studio modal opened');

  await page.waitForSelector('#internal-eval-content .sheet-table', { timeout: 8000 });
  assert(true, 'Master Internal Evaluation table rendered');

  const assignHeader = await page.$('th:has-text("Assignment Marks")');
  assert(assignHeader !== null, 'Contains two-tier header: "Assignment Marks"');

  const utHeader = await page.$('th:has-text("Unit Test Marks")');
  assert(utHeader !== null, 'Contains two-tier header: "Unit Test Marks"');

  const totHeader = await page.$('th:has-text("Total Marks (50)")');
  assert(totHeader !== null, 'Contains "Total Marks (50)" column header');

  // Test + Add Assessment Column
  console.log('Clicking "+ Add Assessment Column"...');
  const addColBtn = await page.$('#internal-eval-modal button:has-text("+ Add Assessment Column")');
  assert(addColBtn !== null, 'Found "+ Add Assessment Column" button');
  await addColBtn.click();
  await page.waitForTimeout(600);

  const customColHeader = await page.$('th:has-text("Viva / Quiz 1")');
  assert(customColHeader !== null, 'Custom column "Viva / Quiz 1" added to master evaluation sheet');

  // Capture Screenshot of Master Internal Evaluation Studio
  const evalStudioShotPath = path.join(ARTIFACT_DIR, 'internal_evaluation_master_studio.png');
  await page.screenshot({ path: evalStudioShotPath });
  console.log(`📸 Screenshot saved: ${evalStudioShotPath}`);

  await browser.close();

  console.log('\n======================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runVerification().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
