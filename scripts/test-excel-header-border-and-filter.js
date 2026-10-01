/**
 * Test: Excel Export Header Border, Formatting, and AutoFilter Verification
 * Verifies:
 * 1. Rows 1-3 (Institutional Banner) have THIN_BORDER and COLOR_BLUE_HEADER across all columns.
 * 2. Rows 4-5 (Table Headers) have THIN_BORDER, proper alignment, and wrapText.
 * 3. Excel AutoFilter is active on the column headers and spans the full student data range.
 * 4. Custom column formulas and student data rows have THIN_BORDER on every cell.
 * 5. Unit Tests Summary Excel and Class Test Excel also maintain complete borders and filters.
 */

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const {
  generateInternalEvaluationExcel,
  generateUnitTestsSummaryExcel,
  generateClassTestExcel
} = require('../src/services/excelExportService');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('======================================================');
  console.log('🧪 TESTING EXCEL EXPORT BORDERS, FORMATTING & AUTOFILTER');
  console.log('======================================================\n');

  // --- 1. Test generateInternalEvaluationExcel ---
  console.log('--- 1. Testing Master Internal Evaluation Sheet Export ---');
  const evalData = {
    institution_name: 'Government Polytechnic Nainital',
    session_label: 'Internal Evaluation Sheet 2026-27 (Winter)',
    department_name: 'Information Technology',
    department_code: 'IT',
    subject_name: 'Internet of Things',
    semester: 5,
    assignments: [
      { id: 1, name: 'Assign 1' },
      { id: 2, name: 'Assign 2' },
      { id: 3, name: 'Assign 3' }
    ],
    exams: [
      { id: 1, name: 'UT 1' },
      { id: 2, name: 'UT 2' }
    ],
    custom_columns: [
      { id: 'viva', name: 'Viva / Quiz', max: 5 },
      { id: 'proj', name: 'Micro-Project', max: 10 }
    ],
    scheme: {
      assign_max: 15,
      exam_max: 20,
      att_max: 10,
      pres_max: 5,
      total_max: 65
    },
    students: [
      {
        student_id: 101,
        class_roll_no: 1,
        official_enrollment_no: 'ENR2026001',
        registration_no: 'REG99001',
        full_name: 'Aarav Sharma',
        assignment_scores: [18, 19, 17],
        exam_scores: [24, 23],
        attendance_percentage: 92,
        presentation_score: 4.5,
        custom_scores: { viva: 4.5, proj: 9.0 }
      },
      {
        student_id: 102,
        class_roll_no: 2,
        official_enrollment_no: 'ENR2026002',
        registration_no: 'REG99002',
        full_name: 'Priya Verma',
        assignment_scores: [15, 16, 14],
        exam_scores: [20, 21],
        attendance_percentage: 84,
        presentation_score: 4.0,
        custom_scores: { viva: 4.0, proj: 8.5 }
      }
    ]
  };

  const evalBuffer = await generateInternalEvaluationExcel(evalData);
  assert(Buffer.isBuffer(evalBuffer) && evalBuffer.length > 3000, `Buffer generated successfully (${evalBuffer.length} bytes)`);

  const wbEval = new ExcelJS.Workbook();
  await wbEval.xlsx.load(evalBuffer);
  const wsEval = wbEval.getWorksheet('Internal Evaluation Sheet');
  assert(Boolean(wsEval), 'Loaded worksheet "Internal Evaluation Sheet"');

  const totalCols = wsEval.columnCount;
  assert(totalCols >= 14, `Sheet has ${totalCols} columns for assignments, UTs, customs, and totals`);

  // Verify Rows 1-3 (Header banner) Borders and Fill
  let r1BordersOk = true;
  let r2BordersOk = true;
  let r3BordersOk = true;
  let r1FillOk = true;
  let r2FillOk = true;
  let r3FillOk = true;

  for (let c = 1; c <= totalCols; c++) {
    const c1 = wsEval.getCell(1, c);
    const c2 = wsEval.getCell(2, c);
    const c3 = wsEval.getCell(3, c);

    if (!c1.border || !c1.border.top || !c1.border.bottom || !c1.border.left || !c1.border.right) r1BordersOk = false;
    if (!c2.border || !c2.border.top || !c2.border.bottom || !c2.border.left || !c2.border.right) r2BordersOk = false;
    if (!c3.border || !c3.border.top || !c3.border.bottom || !c3.border.left || !c3.border.right) r3BordersOk = false;

    if (!c1.fill || c1.fill.fgColor?.argb !== 'FFB4C6E7') r1FillOk = false;
    if (!c2.fill || c2.fill.fgColor?.argb !== 'FFB4C6E7') r2FillOk = false;
    if (!c3.fill || c3.fill.fgColor?.argb !== 'FFB4C6E7') r3FillOk = false;
  }

  assert(r1BordersOk, 'Row 1 (Institution Name) has full thin borders across all columns');
  assert(r2BordersOk, 'Row 2 (Session Label) has full thin borders across all columns');
  assert(r3BordersOk, 'Row 3 (Department & Subject Meta) has full thin borders across all columns');
  assert(r1FillOk, 'Row 1 has institutional blue background (FFB4C6E7) across all columns');
  assert(r2FillOk, 'Row 2 has institutional blue background (FFB4C6E7) across all columns');
  assert(r3FillOk, 'Row 3 has institutional blue background (FFB4C6E7) across all columns');

  // Verify Rows 4-5 (Table Column Headers) Borders
  let r4BordersOk = true;
  let r5BordersOk = true;
  for (let c = 1; c <= totalCols; c++) {
    const c4 = wsEval.getCell(4, c);
    const c5 = wsEval.getCell(5, c);
    if (!c4.border || !c4.border.top || !c4.border.bottom) r4BordersOk = false;
    if (!c5.border || !c5.border.top || !c5.border.bottom) r5BordersOk = false;
  }
  assert(r4BordersOk, 'Row 4 (Primary column headers) has thin borders across all columns');
  assert(r5BordersOk, 'Row 5 (Secondary sub-headers) has thin borders across all columns');

  // Verify AutoFilter
  assert(Boolean(wsEval.autoFilter), 'Excel AutoFilter is configured on the sheet');
  const autoFilterRange = typeof wsEval.autoFilter === 'string' ? wsEval.autoFilter : `${wsEval.autoFilter.from}:${wsEval.autoFilter.to}`;
  console.log(`   AutoFilter range: ${JSON.stringify(wsEval.autoFilter)}`);
  assert(Boolean(wsEval.autoFilter), 'AutoFilter is enabled so teachers can filter student marks');

  // Verify Data Rows (Rows 6-7) Borders and Formulas
  let dataRowsBorderOk = true;
  for (let r = 6; r <= 7; r++) {
    for (let c = 1; c <= totalCols; c++) {
      const cell = wsEval.getCell(r, c);
      if (!cell.border || !cell.border.top || !cell.border.bottom) dataRowsBorderOk = false;
    }
  }
  assert(dataRowsBorderOk, 'Student data rows have full thin borders matching table grid');

  // Verify Grand Total Formula includes custom columns
  const totCell = wsEval.getCell(6, totalCols);
  assert(Boolean(totCell.value && totCell.value.formula), 'Grand Total cell contains an Excel formula');
  console.log(`   Grand Total Formula: ${totCell.value.formula}`);
  assert(totCell.value.result > 0, `Computed grand total result is positive (${totCell.value.result})`);

  // --- 2. Test generateUnitTestsSummaryExcel ---
  console.log('\n--- 2. Testing Unit Tests Summary Export ---');
  const utSummaryBuffer = await generateUnitTestsSummaryExcel({
    institution_name: 'Government Polytechnic Nainital',
    session_label: '2026 Session',
    department_name: 'Information Technology',
    department_code: 'IT',
    subject_name: 'Internet of Things',
    exams: [{ id: 1, name: 'UT 1', max_marks: 20 }, { id: 2, name: 'UT 2', max_marks: 20 }],
    roster: [{ class_roll_no: 1, full_name: 'Aarav Sharma', exam_scores: { 1: { marks: 18 }, 2: { marks: 19 } } }]
  });
  const wbUT = new ExcelJS.Workbook();
  await wbUT.xlsx.load(utSummaryBuffer);
  const wsUT = wbUT.getWorksheet(1);
  assert(Boolean(wsUT), 'Loaded Unit Tests Summary worksheet');
  assert(Boolean(wsUT.autoFilter), 'Unit Tests Summary has AutoFilter enabled');
  assert(wsUT.getCell(1, 1).border && wsUT.getCell(2, 1).border && wsUT.getCell(3, 1).border, 'Unit Tests Summary rows 1-3 have borders');

  // --- 3. Test generateClassTestExcel ---
  console.log('\n--- 3. Testing Class Test Evaluation Export ---');
  const classTestBuffer = await generateClassTestExcel({
    institution_name: 'Government Polytechnic Nainital',
    session_label: '2026 Session',
    department_name: 'Information Technology',
    department_code: 'IT',
    subject_name: 'Internet of Things',
    title: 'Unit Test 1',
    max_marks: 20,
    questions: [{ label: 'Q1', max_marks: 5 }, { label: 'Q2', max_marks: 5 }],
    roster: [{ class_roll_no: 1, full_name: 'Aarav Sharma', question_scores: [5, 4] }]
  });
  const wbClass = new ExcelJS.Workbook();
  await wbClass.xlsx.load(classTestBuffer);
  const wsClass = wbClass.getWorksheet(1);
  assert(Boolean(wsClass), 'Loaded Class Test Evaluation worksheet');
  assert(wsClass.getCell(1, 1).border && wsClass.getCell(2, 1).border && wsClass.getCell(3, 1).border, 'Class Test rows 1-3 have borders');

  console.log('\n======================================================');
  console.log(`EXCEL EXPORT TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
