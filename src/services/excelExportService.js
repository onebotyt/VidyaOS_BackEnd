/**
 * Institutional Excel Export Service
 * 
 * Generates pixel-perfect, fully styled Microsoft Excel & Google Sheets (.xlsx) workbooks
 * matching the Uttarakhand Polytechnic institutional format:
 * 1. Class Test Marksheet (Image 1 reference): Question breakdown, instructions panel, red absent highlighting.
 * 2. Student Progress / Internal Evaluation Sheet (Image 2 reference): Combined assignments, unit tests, attendance, presentation.
 */

const ExcelJS = require('exceljs');
const { query } = require('../config/db');

// Institutional Palette
const COLOR_BLUE_HEADER = 'FFB4C6E7'; // Soft institutional blue (Header rows 1-3)
const COLOR_TAN_HEADER  = 'FFFFF2CC'; // Soft tan/gold (Table top headers)
const COLOR_GRAY_BG     = 'FFF2F2F2'; // Subtle zebra/summary background
const COLOR_ABSENT_RED  = 'FFFF0000'; // Bold red for absent students
const COLOR_BORDER_GRAY = 'FF000000'; // Standard black gridlines

const THIN_BORDER = {
  top: { style: 'thin', color: { argb: COLOR_BORDER_GRAY } },
  left: { style: 'thin', color: { argb: COLOR_BORDER_GRAY } },
  bottom: { style: 'thin', color: { argb: COLOR_BORDER_GRAY } },
  right: { style: 'thin', color: { argb: COLOR_BORDER_GRAY } }
};

/**
 * Generates the Class Test Evaluation Excel Sheet (Image 1 format)
 * @param {Object} data - Exam metadata, students roster, questions list, instructions panel
 * @returns {Promise<Buffer>} - Excel workbook buffer
 */
async function generateClassTestExcel(data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Smart College Attendance System';
  wb.lastModifiedBy = 'Faculty Examination Portal';
  wb.created = new Date();

  const ws = wb.addWorksheet('Unit Test Evaluation', {
    views: [{ showGridLines: true }],
    pageSetup: { orientation: 'landscape', fitToPage: true }
  });

  // Extract metadata with fallbacks
  const institutionName = data.institution_name || 'Uttarakhand Government Institute of Polytechnic, Nainital';
  const sessionLabel = data.session_label || 'Internal Evaluation Sheet 2026-27 (Odd Semester)';
  const deptName = data.department_name || 'Information Technology';
  const deptCode = data.department_code || 'IT';
  const subjectName = data.subject_name || 'Subject';
  const year = data.year || 3;
  const semester = data.semester || 5;
  const examTitle = data.title || data.name || 'Unit Test';
  const maxMarks = Number(data.max_marks || 10);
  const examDate = data.exam_date ? new Date(data.exam_date).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB');
  const duration = data.duration || '50 minutes';
  const mode = data.mode || 'OFFLINE';

  // Questions configuration (Dynamic: allows Q1..QN)
  const questions = Array.isArray(data.questions) && data.questions.length > 0
    ? data.questions
    : [
        { num: 1, label: '1', max: maxMarks / 4 },
        { num: 2, label: '2', max: maxMarks / 4 },
        { num: 3, label: '3', max: maxMarks / 4 },
        { num: 4, label: '4', max: maxMarks / 4 }
      ];

  const qCount = questions.length;
  // Columns: Col 1: SR NO, Col 2: ROLL NO, Col 3: STUDENT NAME, Cols 4..(3+qCount): Questions, Col (4+qCount): Total, Col (5+qCount): Details Side Panel
  const totalColIdx = 4 + qCount;
  const panelColIdx = 5 + qCount;
  const totalColsCount = panelColIdx;

  // Set column widths
  ws.getColumn(1).width = 9;   // SR. NO.
  ws.getColumn(2).width = 16;  // ROLL NO.
  ws.getColumn(3).width = 30;  // STUDENT NAME
  for (let i = 0; i < qCount; i++) {
    ws.getColumn(4 + i).width = 8; // Q1..QN
  }
  ws.getColumn(totalColIdx).width = 10; // Total
  ws.getColumn(panelColIdx).width = 68; // Side Panel (Instructions / Questions)

  // ── ROW 1: Institution & Session (Light Blue Fill) ──
  ws.mergeCells(1, 1, 1, totalColsCount);
  const r1 = ws.getCell(1, 1);
  r1.value = `${institutionName} | ${sessionLabel}`;
  r1.font = { name: 'Calibri', size: 12, bold: true };
  r1.alignment = { horizontal: 'center', vertical: 'middle' };
  r1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_HEADER } };
  ws.getRow(1).height = 24;

  // ── ROW 2: Department, Class Test, Subject ──
  ws.mergeCells(2, 1, 2, totalColsCount);
  const r2 = ws.getCell(2, 1);
  r2.value = `Department (${deptCode}) | Internal Evaluation - Class Test | Subject : ${subjectName}`;
  r2.font = { name: 'Calibri', size: 11, bold: true };
  r2.alignment = { horizontal: 'center', vertical: 'middle' };
  r2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_HEADER } };
  ws.getRow(2).height = 20;

  // ── ROW 3: Year & Semester ──
  ws.mergeCells(3, 1, 3, totalColsCount);
  const r3 = ws.getCell(3, 1);
  r3.value = `${deptCode} ${year === 1 ? '1st' : year === 2 ? '2nd' : year === 3 ? '3rd' : year + 'th'} Year | ${semester === 1 ? '1st' : semester === 2 ? '2nd' : semester === 3 ? '3rd' : semester + 'th'} Semester`;
  r3.font = { name: 'Calibri', size: 11, bold: true };
  r3.alignment = { horizontal: 'center', vertical: 'middle' };
  r3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_HEADER } };
  ws.getRow(3).height = 20;

  // Borders and fill for header rows
  for (let rowNum = 1; rowNum <= 3; rowNum++) {
    for (let c = 1; c <= totalColsCount; c++) {
      const cell = ws.getCell(rowNum, c);
      cell.border = THIN_BORDER;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_HEADER } };
    }
  }

  // ── ROW 4: Table Top Headers (Beige/Tan Fill) ──
  const r4 = ws.getRow(4);
  r4.height = 22;

  ws.getCell(4, 1).value = 'SR. NO.';
  ws.getCell(4, 2).value = 'ROLL NO.';
  ws.getCell(4, 3).value = 'STUDENT NAME';

  // Merge over questions and Total for Exam Title
  ws.mergeCells(4, 4, 4, totalColIdx);
  const examHeadCell = ws.getCell(4, 4);
  examHeadCell.value = `${examTitle} (Total Marks : ${maxMarks})`;

  // Side Panel Header
  ws.getCell(4, panelColIdx).value = `Unit Test Details (Mode : ${mode})`;

  for (let c = 1; c <= totalColsCount; c++) {
    const cell = ws.getCell(4, c);
    cell.font = { name: 'Calibri', size: 10, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_TAN_HEADER } };
    cell.border = THIN_BORDER;
  }

  // ── ROW 5: Sub-headers ──
  const r5 = ws.getRow(5);
  r5.height = 20;

  ws.mergeCells(5, 1, 5, 3);
  const qPrompt = ws.getCell(5, 1);
  qPrompt.value = 'Question No. -->';
  qPrompt.font = { name: 'Calibri', size: 10, bold: true };
  qPrompt.alignment = { horizontal: 'center', vertical: 'middle' };

  for (let i = 0; i < qCount; i++) {
    const qCell = ws.getCell(5, 4 + i);
    qCell.value = questions[i].label || String(i + 1);
    qCell.font = { name: 'Calibri', size: 10, bold: true };
    qCell.alignment = { horizontal: 'center', vertical: 'middle' };
  }

  const totHead = ws.getCell(5, totalColIdx);
  totHead.value = 'Total';
  totHead.font = { name: 'Calibri', size: 10, bold: true };
  totHead.alignment = { horizontal: 'center', vertical: 'middle' };

  const metaHead = ws.getCell(5, panelColIdx);
  metaHead.value = `${examTitle.toUpperCase()} | Maximum Marks : ${maxMarks} | Time : ${duration} | Date : ${examDate}`;
  metaHead.font = { name: 'Calibri', size: 9.5, bold: true };
  metaHead.alignment = { horizontal: 'center', vertical: 'middle' };

  for (let c = 1; c <= totalColsCount; c++) {
    ws.getCell(5, c).border = THIN_BORDER;
  }

  // ── SIDE PANEL CONTENT SETUP (Instructions & Questions) ──
  const defaultInstructions = [
    'Instructions :',
    '1. Students must write answers only on the A4 answer sheets.',
    '2. Attempt all questions.',
    `3. This question paper carrying a total of ${maxMarks} marks. Each question is of ${(maxMarks / qCount).toFixed(1)} marks.`,
    `4. The time duration for this test is ${duration}.`,
    '5. Students must read all questions carefully before answering.',
    '6. Answers should be clear, neat and to the point.',
    '7. Use of unfair means is strictly prohibited.',
    '8. Write the question number clearly before answering each question.'
  ];

  const instructionsList = Array.isArray(data.instructions) && data.instructions.length > 0
    ? data.instructions
    : defaultInstructions;

  const defaultQuestionTexts = [
    'Questions :',
    '1. Explain the fundamental architecture and core components with diagrams.',
    '2. Discuss state management, parameter passing, and practical use cases.',
    '3. Write a program to demonstrate key method overloading / interface handling.',
    '4. Explain performance optimization and debugging techniques with examples.'
  ];

  const questionsList = Array.isArray(data.question_texts) && data.question_texts.length > 0
    ? data.question_texts
    : defaultQuestionTexts;

  const sidePanelRows = [
    ...instructionsList,
    '',
    ...questionsList,
    '',
    'NOTE : All marked as RED were absent.'
  ];

  // ── ROWS 6+: Student Scores ──
  const roster = Array.isArray(data.roster) ? data.roster : [];
  const startRow = 6;
  let presentCount = 0;
  let absentCount = 0;

  roster.forEach((st, idx) => {
    const currentRow = startRow + idx;
    const r = ws.getRow(currentRow);
    r.height = 19;

    const isAbsent = Boolean(st.is_absent || st.status === 'ABSENT' || String(st.marks_obtained).toUpperCase() === 'AB');
    if (isAbsent) absentCount++; else presentCount++;

    // 1. SR NO
    const cSr = ws.getCell(currentRow, 1);
    cSr.value = idx + 1;
    cSr.alignment = { horizontal: 'center', vertical: 'middle' };

    // 2. ROLL NO (Official enrollment no or class roll no, NO '#')
    const cRoll = ws.getCell(currentRow, 2);
    cRoll.value = String(st.official_enrollment_no || st.class_roll_no || idx + 1);
    cRoll.alignment = { horizontal: 'center', vertical: 'middle' };

    // 3. STUDENT NAME
    const cName = ws.getCell(currentRow, 3);
    cName.value = (st.full_name || st.name || '').toUpperCase();
    cName.alignment = { horizontal: 'left', vertical: 'middle' };

    // Common styling
    [cSr, cRoll, cName].forEach(cell => {
      cell.font = { name: 'Calibri', size: 9.5 };
      cell.border = THIN_BORDER;
    });

    // 4.. Question Columns
    const qScores = Array.isArray(st.question_scores) && st.question_scores.length === qCount
      ? st.question_scores
      : null;

    let computedTotal = 0;

    for (let q = 0; q < qCount; q++) {
      const qCell = ws.getCell(currentRow, 4 + q);
      let val;

      if (isAbsent) {
        val = 0;
      } else if (qScores) {
        val = Number(qScores[q] || 0);
      } else {
        // Distribute student total evenly if individual question breakdown isn't given
        const studentTotal = Number(st.marks_obtained || 0);
        val = Math.round((studentTotal / qCount) * 10) / 10;
      }

      qCell.value = val;
      computedTotal += val;
      qCell.alignment = { horizontal: 'center', vertical: 'middle' };
      qCell.border = THIN_BORDER;
      qCell.font = {
        name: 'Calibri',
        size: 9.5,
        bold: isAbsent,
        color: isAbsent ? { argb: COLOR_ABSENT_RED } : { argb: 'FF000000' }
      };
    }

    // 5. Total Column
    const totCell = ws.getCell(currentRow, totalColIdx);
    const firstQColLetter = ws.getColumn(4).letter;
    const lastQColLetter = ws.getColumn(3 + qCount).letter;

    // Excel formula: =SUM(D6:G6)
    totCell.value = {
      formula: `SUM(${firstQColLetter}${currentRow}:${lastQColLetter}${currentRow})`,
      result: isAbsent ? 0 : (st.marks_obtained !== undefined && st.marks_obtained !== null ? Number(st.marks_obtained) : computedTotal)
    };
    totCell.alignment = { horizontal: 'center', vertical: 'middle' };
    totCell.border = THIN_BORDER;
    totCell.font = {
      name: 'Calibri',
      size: 9.5,
      bold: true,
      color: isAbsent ? { argb: COLOR_ABSENT_RED } : { argb: 'FF000000' }
    };

    // 6. Side Panel Text for this line (if exists)
    const panelCell = ws.getCell(currentRow, panelColIdx);
    const sideText = sidePanelRows[idx] || '';
    panelCell.value = sideText;
    panelCell.alignment = { horizontal: 'left', vertical: 'middle' };
    panelCell.border = THIN_BORDER;

    const isHeaderLine = sideText.startsWith('Instructions') || sideText.startsWith('Questions');
    const isNoteLine = sideText.startsWith('NOTE');

    panelCell.font = {
      name: 'Calibri',
      size: 8.5,
      bold: isHeaderLine || isNoteLine,
      color: isNoteLine ? { argb: COLOR_ABSENT_RED } : { argb: 'FF000000' }
    };
  });

  // Fill in any remaining side panel rows if sidePanelRows > roster.length
  const lastStudentRow = startRow + roster.length - 1;
  let nextRow = lastStudentRow + 1;

  if (sidePanelRows.length > roster.length) {
    for (let rIdx = roster.length; rIdx < sidePanelRows.length; rIdx++) {
      const pCell = ws.getCell(nextRow, panelColIdx);
      const sideText = sidePanelRows[rIdx];
      pCell.value = sideText;
      pCell.alignment = { horizontal: 'left', vertical: 'middle' };
      pCell.border = THIN_BORDER;

      const isHeaderLine = sideText.startsWith('Instructions') || sideText.startsWith('Questions');
      const isNoteLine = sideText.startsWith('NOTE');
      pCell.font = {
        name: 'Calibri',
        size: 8.5,
        bold: isHeaderLine || isNoteLine,
        color: isNoteLine ? { argb: COLOR_ABSENT_RED } : { argb: 'FF000000' }
      };

      // Empty left cells with borders
      for (let c = 1; c <= totalColIdx; c++) {
        ws.getCell(nextRow, c).border = THIN_BORDER;
      }
      nextRow++;
    }
  }

  // ── BOTTOM SUMMARY ROW: Class Average, Present, Absent, Total ──
  const summaryRow = Math.max(nextRow, lastStudentRow + 1);
  const sRow = ws.getRow(summaryRow);
  sRow.height = 22;

  // Merge across columns 1 to (totalColIdx - 1)
  ws.mergeCells(summaryRow, 1, summaryRow, totalColIdx - 1);
  const avgLabel = ws.getCell(summaryRow, 1);
  avgLabel.value = 'Average of the class (Only present students)';
  avgLabel.font = { name: 'Calibri', size: 10, bold: true };
  avgLabel.alignment = { horizontal: 'right', vertical: 'middle' };

  // Total column: Average formula =AVERAGEIF(H6:H34, ">0")
  const avgValCell = ws.getCell(summaryRow, totalColIdx);
  const totColLetter = ws.getColumn(totalColIdx).letter;
  avgValCell.value = {
    formula: `AVERAGEIF(${totColLetter}${startRow}:${totColLetter}${lastStudentRow}, ">0")`,
    result: presentCount > 0 ? Number((roster.reduce((acc, st) => acc + (st.is_absent ? 0 : Number(st.marks_obtained || 0)), 0) / presentCount).toFixed(2)) : 0
  };
  avgValCell.font = { name: 'Calibri', size: 10, bold: true };
  avgValCell.alignment = { horizontal: 'center', vertical: 'middle' };
  avgValCell.numFmt = '0.00';

  // Summary breakdown in right panel cell
  const statCell = ws.getCell(summaryRow, panelColIdx);
  statCell.value = `Present: ${presentCount}   |   Absent: ${absentCount}   |   Total: ${roster.length}`;
  statCell.font = { name: 'Calibri', size: 10, bold: true };
  statCell.alignment = { horizontal: 'center', vertical: 'middle' };

  for (let c = 1; c <= totalColsCount; c++) {
    const cell = ws.getCell(summaryRow, c);
    cell.border = THIN_BORDER;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GRAY_BG } };
  }

  return await wb.xlsx.writeBuffer();
}

/**
 * Generates the Comprehensive Student Progress / Internal Evaluation Sheet (Image 2 format)
 * @param {Object} data - Register metadata, students, assignments, unit tests, custom columns
 * @returns {Promise<Buffer>} - Excel workbook buffer
 */
async function generateInternalEvaluationExcel(data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Smart College Attendance System';
  wb.lastModifiedBy = 'Faculty Examination Portal';
  wb.created = new Date();

  const ws = wb.addWorksheet('Internal Evaluation Sheet', {
    views: [{ showGridLines: true }],
    pageSetup: { orientation: 'landscape', fitToPage: true }
  });

  const institutionName = data.institution_name || 'Government Polytechnic Nainital';
  const sessionLabel = data.session_label || 'Internal Evaluation Sheet 2026-27 (Odd Semester)';
  const deptName = data.department_name || 'Information Technology';
  const deptCode = data.department_code || 'IT';
  const subjectName = data.subject_name || 'Internet of Things';
  const semester = data.semester || 3;

  // Determine dynamic columns
  const assignments = Array.isArray(data.assignments) && data.assignments.length > 0
    ? data.assignments
    : [{ id: 1, name: '1' }, { id: 2, name: '2' }, { id: 3, name: '3' }, { id: 4, name: '4' }, { id: 5, name: '5' }];

  const exams = Array.isArray(data.exams) && data.exams.length > 0
    ? data.exams
    : [{ id: 1, name: '1' }, { id: 2, name: '2' }, { id: 3, name: '3' }, { id: 4, name: '4' }];

  const customCols = Array.isArray(data.custom_columns) ? data.custom_columns : [];

  const aCount = assignments.length;
  const eCount = exams.length;

  // Total columns calculation:
  // Col 1: SRNO
  // Col 2: REG NO
  // Col 3: ROLL
  // Col 4: CNAME
  // Col 5..(4+aCount): Assignments 1..N
  // Col (5+aCount): Assignment Total Marks (Avg)
  // Col (6+aCount)..(5+aCount+eCount): Unit Tests 1..M
  // Col (6+aCount+eCount): UT Total Marks (Avg)
  // Col (7+aCount+eCount): Total Attendance (10)
  // Col (8+aCount+eCount): Problem Solving Skills / Presentation (5)
  // [Custom Cols...]
  // Last Col: Total Marks (50)
  const assignStartCol = 5;
  const assignEndCol = 4 + aCount;
  const assignAvgCol = assignEndCol + 1;

  const utStartCol = assignAvgCol + 1;
  const utEndCol = assignAvgCol + eCount;
  const utAvgCol = utEndCol + 1;

  const attCol = utAvgCol + 1;
  const presCol = attCol + 1;

  const customStartCol = presCol + 1;
  const totalColsCount = presCol + customCols.length + 1;
  const grandTotalCol = totalColsCount;

  // Column widths
  ws.getColumn(1).width = 9;   // ROLL NO
  ws.getColumn(2).width = 16;  // ENROLLMENT NO
  ws.getColumn(3).width = 16;  // REG NO
  ws.getColumn(4).width = 28;  // STUDENT NAME
  for (let c = assignStartCol; c <= assignEndCol; c++) ws.getColumn(c).width = 6;
  ws.getColumn(assignAvgCol).width = 13; // Assignment Avg
  for (let c = utStartCol; c <= utEndCol; c++) ws.getColumn(c).width = 6;
  ws.getColumn(utAvgCol).width = 12; // UT Avg
  ws.getColumn(attCol).width = 13;   // Attendance
  ws.getColumn(presCol).width = 15;  // Presentation
  for (let i = 0; i < customCols.length; i++) {
    ws.getColumn(customStartCol + i).width = 14;
  }
  ws.getColumn(grandTotalCol).width = 13; // Total Marks (50)

  // ── ROW 1: Institution Name (Centered, Bold) ──
  ws.mergeCells(1, 1, 1, totalColsCount);
  const r1 = ws.getCell(1, 1);
  r1.value = institutionName;
  r1.font = { name: 'Calibri', size: 12, bold: true };
  r1.alignment = { horizontal: 'center', vertical: 'middle' };
  r1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_HEADER } };
  ws.getRow(1).height = 22;

  // ── ROW 2: Internal Evaluation Sheet Term ──
  ws.mergeCells(2, 1, 2, totalColsCount);
  const r2 = ws.getCell(2, 1);
  r2.value = sessionLabel;
  r2.font = { name: 'Calibri', size: 11, bold: true };
  r2.alignment = { horizontal: 'center', vertical: 'middle' };
  r2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_HEADER } };
  ws.getRow(2).height = 20;

  // ── ROW 3: Department, Semester, Subject ──
  ws.mergeCells(3, 1, 3, totalColsCount);
  const r3 = ws.getCell(3, 1);
  const defaultMeta = `Department (${deptCode}) - ${semester === 1 ? '1st' : semester === 2 ? '2nd' : semester === 3 ? '3rd' : semester + 'th'} Semester - ${subjectName}`;
  r3.value = data.dept_semester_text ? `${data.dept_semester_text} - ${subjectName}` : defaultMeta;
  r3.font = { name: 'Calibri', size: 11, bold: true };
  r3.alignment = { horizontal: 'center', vertical: 'middle' };
  r3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_HEADER } };
  ws.getRow(3).height = 20;

  // Apply borders and fill to header rows 1-3 (all cells across merged banner)
  for (let rowNum = 1; rowNum <= 3; rowNum++) {
    for (let c = 1; c <= totalColsCount; c++) {
      const cell = ws.getCell(rowNum, c);
      cell.border = THIN_BORDER;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_HEADER } };
    }
  }

  // ── ROW 4 & 5: Multi-Tier Headers ──
  ws.getRow(4).height = 24;
  ws.getRow(5).height = 20;

  // Merged Vertically (Rows 4-5) for Identifiers
  const vertHeaders = [
    { col: 1, text: 'ROLL NO' },
    { col: 2, text: 'ENROLLMENT NO' },
    { col: 3, text: 'REG NO' },
    { col: 4, text: 'STUDENT NAME' }
  ];

  vertHeaders.forEach(h => {
    ws.mergeCells(4, h.col, 5, h.col);
    const cell = ws.getCell(4, h.col);
    cell.value = h.text;
    cell.font = { name: 'Calibri', size: 9.5, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  const scheme = data.marks_scheme || data.scheme || {};
  // avg max = target weight for the AVERAGE in final marks
  const assignAvgMax = scheme.assign_avg_max !== undefined ? Number(scheme.assign_avg_max)
    : (scheme.assign_max !== undefined ? Number(scheme.assign_max) : 15);
  const examAvgMax = scheme.exam_avg_max !== undefined ? Number(scheme.exam_avg_max)
    : (scheme.exam_max !== undefined ? Number(scheme.exam_max) : 20);
  const attMax = scheme.att_max !== undefined ? Number(scheme.att_max) : 10;
  const presMax = scheme.pres_max !== undefined ? Number(scheme.pres_max) : 5;
  const customSum = customCols.reduce((sum, c) => sum + (Number(c.max || c.max_marks || 5) || 0), 0);
  const totalMax = scheme.total_max !== undefined ? Number(scheme.total_max) : (assignAvgMax + examAvgMax + attMax + presMax + customSum);

  // Assignment Marks Group Header (no individual max in group header — each sub-header shows its own)
  ws.mergeCells(4, assignStartCol, 4, assignEndCol);
  const aHead = ws.getCell(4, assignStartCol);
  aHead.value = 'Assignment Marks';
  aHead.font = { name: 'Calibri', size: 9.5, bold: true };
  aHead.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  // Sub-headers for Assignments — show each assignment's own max_marks
  for (let i = 0; i < aCount; i++) {
    const c = ws.getCell(5, assignStartCol + i);
    const aMaxMark = Number(assignments[i].max_marks || 25);
    c.value = `${assignments[i].name || String(i + 1)}\n(${aMaxMark})`;
    c.font = { name: 'Calibri', size: 9, bold: true };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }

  // Assignment Avg Header — shows target avg weight
  ws.mergeCells(4, assignAvgCol, 5, assignAvgCol);
  const aAvgHead = ws.getCell(4, assignAvgCol);
  aAvgHead.value = `Assign\nAvg\n(${assignAvgMax})`;
  aAvgHead.font = { name: 'Calibri', size: 9, bold: true };
  aAvgHead.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  // Unit Test Marks Group Header (no individual max in group header)
  ws.mergeCells(4, utStartCol, 4, utEndCol);
  const utHead = ws.getCell(4, utStartCol);
  utHead.value = 'Unit Test Marks';
  utHead.font = { name: 'Calibri', size: 9.5, bold: true };
  utHead.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  // Sub-headers for Unit Tests — show each exam's own max_marks
  for (let i = 0; i < eCount; i++) {
    const c = ws.getCell(5, utStartCol + i);
    const eMaxMark = Number(exams[i].max_marks || 25);
    c.value = `${exams[i].name || String(i + 1)}\n(${eMaxMark})`;
    c.font = { name: 'Calibri', size: 9, bold: true };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }

  // UT Avg Header — shows target avg weight
  ws.mergeCells(4, utAvgCol, 5, utAvgCol);
  const utAvgHead = ws.getCell(4, utAvgCol);
  utAvgHead.value = `UT\nAvg\n(${examAvgMax})`;
  utAvgHead.font = { name: 'Calibri', size: 9, bold: true };
  utAvgHead.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  // Total Attendance Header
  ws.mergeCells(4, attCol, 5, attCol);
  const attHead = ws.getCell(4, attCol);
  attHead.value = `Total\nAttendance\n(${attMax})`;
  attHead.font = { name: 'Calibri', size: 9, bold: true };
  attHead.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  // Problem Solving / Presentation Header
  ws.mergeCells(4, presCol, 5, presCol);
  const presHead = ws.getCell(4, presCol);
  presHead.value = `Problem Solving\nSkills/\nPresentation (${presMax})`;
  presHead.font = { name: 'Calibri', size: 9, bold: true };
  presHead.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  // Custom Teacher-added Columns Headers (if any)
  customCols.forEach((col, idx) => {
    const targetCol = customStartCol + idx;
    ws.mergeCells(4, targetCol, 5, targetCol);
    const cCell = ws.getCell(4, targetCol);
    const colName = col.name || col.title || col.label || 'Custom';
    const colMax = col.max || col.max_marks || 5;
    cCell.value = `${colName}\n(${colMax})`;
    cCell.font = { name: 'Calibri', size: 9, bold: true };
    cCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  // Grand Total Header
  ws.mergeCells(4, grandTotalCol, 5, grandTotalCol);
  const totHead = ws.getCell(4, grandTotalCol);
  totHead.value = `Total\nMarks\n(${totalMax})`;
  totHead.font = { name: 'Calibri', size: 10, bold: true };
  totHead.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  // Apply borders and fill for table header rows 4-5
  for (let r = 4; r <= 5; r++) {
    for (let c = 1; c <= totalColsCount; c++) {
      const cell = ws.getCell(r, c);
      cell.border = THIN_BORDER;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GRAY_BG } };
    }
  }

  // ── ROWS 6+: Student Evaluation Data ──
  const roster = Array.isArray(data.roster) && data.roster.length > 0
    ? data.roster
    : (Array.isArray(data.students) ? data.students : []);
  const startRow = 6;
  const lastRow = Math.max(startRow, startRow + roster.length - 1);

  // AutoFilter on row 5 (sub-header row) spanning full student data range — lets users filter/sort by any marks column
  ws.autoFilter = {
    from: { row: 5, column: 1 },
    to: { row: lastRow, column: totalColsCount }
  };

  // Freeze panes: keep rows 1-5 (header) and columns 1-4 (student ID) fixed while scrolling
  ws.views = [{
    state: 'frozen',
    xSplit: 4,
    ySplit: 5,
    topLeftCell: 'E6',
    showGridLines: true
  }];

  roster.forEach((st, idx) => {
    const currentRow = startRow + idx;
    const r = ws.getRow(currentRow);
    r.height = 18;

    // 1. ROLL NO (Class Roll No moved to first)
    const cRoll = ws.getCell(currentRow, 1);
    cRoll.value = String(st.class_roll_no || idx + 1);
    cRoll.alignment = { horizontal: 'center', vertical: 'middle' };

    // 2. ENROLLMENT NO (added)
    const cEnr = ws.getCell(currentRow, 2);
    cEnr.value = String(st.official_enrollment_no || '—');
    cEnr.alignment = { horizontal: 'center', vertical: 'middle' };

    // 3. REG NO (UBTER Official Registration No)
    const cReg = ws.getCell(currentRow, 3);
    cReg.value = String(st.registration_no || '—');
    cReg.alignment = { horizontal: 'center', vertical: 'middle' };

    // 4. STUDENT NAME (renamed from CNAME)
    const cName = ws.getCell(currentRow, 4);
    cName.value = (st.full_name || st.name || '').toUpperCase();
    cName.alignment = { horizontal: 'left', vertical: 'middle' };

    [cRoll, cEnr, cReg, cName].forEach(cell => {
      cell.font = { name: 'Calibri', size: 9 };
      cell.border = THIN_BORDER;
    });

    // 5.. Assignment Scores
    const assignScores = Array.isArray(st.assignment_scores) ? st.assignment_scores : [];
    let assignSum = 0;
    let assignCount = 0;

    for (let a = 0; a < aCount; a++) {
      const cell = ws.getCell(currentRow, assignStartCol + a);
      const score = assignScores[a] !== undefined && assignScores[a] !== null && assignScores[a] !== '' ? Number(assignScores[a]) : null;
      if (score !== null) {
        cell.value = score;
        assignSum += score;
        assignCount++;
      } else {
        cell.value = '';
      }
      cell.font = { name: 'Calibri', size: 9 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = THIN_BORDER;
    }

    // Assignment Avg Column — scaled: (earned / total_possible) * assignAvgMax
    const assignAvgCell = ws.getCell(currentRow, assignAvgCol);
    // Compute total possible = sum of each assignment's own max_marks
    let aPossible = 0;
    for (let a = 0; a < aCount; a++) {
      const score = assignScores[a] !== undefined && assignScores[a] !== null && assignScores[a] !== '' ? Number(assignScores[a]) : null;
      if (score !== null) aPossible += Number(assignments[a].max_marks || 25);
    }
    const computedAssignAvg = aPossible > 0 ? Number(((assignSum / aPossible) * assignAvgMax).toFixed(1)) : 0;
    // Excel formula: plain AVERAGE of individual scores (descriptive), prefilled with JS computed scaled value
    const aFirstColLetter = ws.getColumn(assignStartCol).letter;
    const aLastColLetter = ws.getColumn(assignEndCol).letter;
    assignAvgCell.value = {
      formula: `IFERROR(ROUND(${assignAvgMax}*(SUM(${aFirstColLetter}${currentRow}:${aLastColLetter}${currentRow})/SUMPRODUCT((${assignments.map((a,i) => ws.getColumn(assignStartCol+i).letter + currentRow + '<>""').join(',')})*{${assignments.map(a => a.max_marks || 25).join(',')}})),1),0)`,
      result: computedAssignAvg
    };
    assignAvgCell.font = { name: 'Calibri', size: 9, bold: true };
    assignAvgCell.alignment = { horizontal: 'center', vertical: 'middle' };
    assignAvgCell.border = THIN_BORDER;

    // Unit Test Scores (with AB in bold RED)
    const utScores = Array.isArray(st.exam_scores) ? st.exam_scores : [];
    let utSum = 0;
    let utPresentCount = 0;

    for (let e = 0; e < eCount; e++) {
      const cell = ws.getCell(currentRow, utStartCol + e);
      const item = utScores[e];
      const isAbsent = Boolean(
        item?.is_absent ||
        (Array.isArray(st.exam_absent) && st.exam_absent[e]) ||
        String(item?.marks || item).toUpperCase() === 'AB'
      );

      if (isAbsent) {
        cell.value = 'AB';
        cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: COLOR_ABSENT_RED } };
      } else if (item !== undefined && item !== null && item !== '') {
        const score = typeof item === 'object' && item !== null ? Number(item.marks || 0) : Number(item);
        cell.value = score;
        utSum += score;
        utPresentCount++;
        cell.font = { name: 'Calibri', size: 9 };
      } else {
        cell.value = '';
        cell.font = { name: 'Calibri', size: 9 };
      }
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = THIN_BORDER;
    }

    // UT Avg Column — scaled: (earned / total_possible) * examAvgMax
    const utAvgCell = ws.getCell(currentRow, utAvgCol);
    // Total possible = sum of each present exam's own max_marks
    let ePossible = 0;
    for (let e = 0; e < eCount; e++) {
      const item = utScores[e];
      const isAb = Boolean(item?.is_absent || (Array.isArray(st.exam_absent) && st.exam_absent[e]) || String(item?.marks || item).toUpperCase() === 'AB');
      if (!isAb && item !== undefined && item !== null && item !== '') {
        ePossible += Number(exams[e].max_marks || 25);
      }
    }
    const computedUtAvg = ePossible > 0 ? Number(((utSum / ePossible) * examAvgMax).toFixed(1)) : 0;
    const uFirstColLetter = ws.getColumn(utStartCol).letter;
    const uLastColLetter = ws.getColumn(utEndCol).letter;
    utAvgCell.value = {
      formula: `IFERROR(ROUND(${examAvgMax}*(SUMIF(${uFirstColLetter}${currentRow}:${uLastColLetter}${currentRow},"<>AB")/SUMPRODUCT((${exams.map((ex,i) => ws.getColumn(utStartCol+i).letter + currentRow + '<>"AB"').join(',')})*{${exams.map(ex => ex.max_marks || 25).join(',')}})),1),0)`,
      result: computedUtAvg
    };
    utAvgCell.font = { name: 'Calibri', size: 9, bold: true };
    utAvgCell.alignment = { horizontal: 'center', vertical: 'middle' };
    utAvgCell.border = THIN_BORDER;

    // Attendance Score — scaled properly to attMax
    const attCell = ws.getCell(currentRow, attCol);
    const attPct = st.attendance_percentage !== undefined ? Number(st.attendance_percentage) : 85;
    const attScore = Math.round(((attPct / 100) * attMax) * 10) / 10;
    attCell.value = attScore;
    attCell.font = { name: 'Calibri', size: 9 };
    attCell.alignment = { horizontal: 'center', vertical: 'middle' };
    attCell.border = THIN_BORDER;

    // Presentation / Problem Solving (out of 5)
    const presCell = ws.getCell(currentRow, presCol);
    const presScore = st.presentation_score !== undefined && st.presentation_score !== null ? Number(st.presentation_score) : 4;
    presCell.value = presScore;
    presCell.font = { name: 'Calibri', size: 9 };
    presCell.alignment = { horizontal: 'center', vertical: 'middle' };
    presCell.border = THIN_BORDER;

    // Custom Columns
    let customSum = 0;
    customCols.forEach((col, cIdx) => {
      const targetCol = customStartCol + cIdx;
      const cell = ws.getCell(currentRow, targetCol);
      const val = st.custom_scores?.[col.key || col.id] !== undefined ? Number(st.custom_scores[col.key || col.id]) : (col.default_value || 0);
      cell.value = val;
      customSum += val;
      cell.font = { name: 'Calibri', size: 9 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = THIN_BORDER;
    });

    // Grand Total (out of 50)
    const totCell = ws.getCell(currentRow, grandTotalCol);
    const aAvgLetter = ws.getColumn(assignAvgCol).letter;
    const utAvgLetter = ws.getColumn(utAvgCol).letter;
    const attLetter = ws.getColumn(attCol).letter;
    const presLetter = ws.getColumn(presCol).letter;

    const computedGrandTotal = Math.round(computedAssignAvg + computedUtAvg + attScore + presScore + customSum);
    const formulaParts = [
      `${aAvgLetter}${currentRow}`,
      `${utAvgLetter}${currentRow}`,
      `${attLetter}${currentRow}`,
      `${presLetter}${currentRow}`
    ];
    for (let c = 0; c < customCols.length; c++) {
      formulaParts.push(`${ws.getColumn(customStartCol + c).letter}${currentRow}`);
    }
    totCell.value = {
      formula: `ROUND(${formulaParts.join(' + ')}, 0)`,
      result: computedGrandTotal
    };
    totCell.font = { name: 'Calibri', size: 9.5, bold: true };
    totCell.alignment = { horizontal: 'center', vertical: 'middle' };
    totCell.border = THIN_BORDER;
  });

  return await wb.xlsx.writeBuffer();
}

/**
 * Generate All Unit Tests Summary Excel (.xlsx)
 * Clean institutional replica without side section, showing each Unit Test column,
 * total marks sum, and normalized UT Total Marks (Avg) scaled to teacher's configured target max.
 */
async function generateUnitTestsSummaryExcel(data = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'College ERP Attendance & Exam Portal';
  wb.created = new Date();

  const ws = wb.addWorksheet('Unit Test Summary', {
    pageSetup: { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 }
  });

  const institutionName = data.institution_name || 'Uttarakhand Government Institute of Polytechnic, Srinagar Garhwal';
  const sessionLabel = data.session_label || 'Internal Evaluation Sheet 2026 Session';
  const deptName = data.department_name || 'Information Technology';
  const deptCode = data.department_code || 'IT';
  const subjectName = data.subject_name || 'Subject';
  const year = data.year || 3;
  const semester = data.semester || 5;
  const targetAvgMax = Number(data.target_avg_max || 20);

  const exams = Array.isArray(data.exams) ? data.exams : [];
  const eCount = exams.length;

  // Cols: 1: ROLL NO, 2: REGISTRATION NO, 3: ENROLLMENT NO, 4: STUDENT NAME,
  // 5..(4+eCount): Unit Tests, (5+eCount): UT Total Sum, (6+eCount): UT Total Marks (Avg - [targetAvgMax])
  const utStartCol = 5;
  const utEndCol = 4 + eCount;
  const sumCol = utEndCol + 1;
  const avgCol = sumCol + 1;
  const totalColsCount = avgCol;

  ws.getColumn(1).width = 12; // ROLL NO
  ws.getColumn(2).width = 18; // REGISTRATION NO
  ws.getColumn(3).width = 16; // ENROLLMENT NO
  ws.getColumn(4).width = 28; // STUDENT NAME
  for (let i = 0; i < eCount; i++) {
    ws.getColumn(utStartCol + i).width = 16;
  }
  ws.getColumn(sumCol).width = 16;
  ws.getColumn(avgCol).width = 20;

  // ROW 1: Institution Header
  ws.mergeCells(1, 1, 1, totalColsCount);
  const r1 = ws.getCell(1, 1);
  r1.value = `${institutionName} | ${sessionLabel}`;
  r1.font = { name: 'Calibri', size: 12, bold: true };
  r1.alignment = { horizontal: 'center', vertical: 'middle' };
  r1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_HEADER } };
  ws.getRow(1).height = 24;

  // ROW 2: Department & Subject (Says "Internal Evaluation - Unit Test", NOT "Unit Test 1")
  ws.mergeCells(2, 1, 2, totalColsCount);
  const r2 = ws.getCell(2, 1);
  r2.value = `Department (${deptCode}) | Internal Evaluation - Unit Test | Subject : ${subjectName}`;
  r2.font = { name: 'Calibri', size: 11, bold: true };
  r2.alignment = { horizontal: 'center', vertical: 'middle' };
  r2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_HEADER } };
  ws.getRow(2).height = 20;

  // ROW 3: Year & Semester
  ws.mergeCells(3, 1, 3, totalColsCount);
  const r3 = ws.getCell(3, 1);
  r3.value = `${deptName} Year ${year} | Semester ${semester}`;
  r3.font = { name: 'Calibri', size: 11, bold: true };
  r3.alignment = { horizontal: 'center', vertical: 'middle' };
  r3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_HEADER } };
  ws.getRow(3).height = 20;

  for (let rowNum = 1; rowNum <= 3; rowNum++) {
    for (let c = 1; c <= totalColsCount; c++) {
      const cell = ws.getCell(rowNum, c);
      cell.border = THIN_BORDER;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_HEADER } };
    }
  }

  // ROW 4: Column Headers (Tan fill)
  const r4 = ws.getRow(4);
  r4.height = 24;
  ws.getCell(4, 1).value = 'ROLL NO.';
  ws.getCell(4, 2).value = 'REGISTRATION NO.';
  ws.getCell(4, 3).value = 'ENROLLMENT NO.';
  ws.getCell(4, 4).value = 'STUDENT NAME';

  exams.forEach((ex, idx) => {
    const c = ws.getCell(4, utStartCol + idx);
    c.value = `${ex.name || 'Unit Test ' + (idx + 1)} (${ex.max_marks || 20})`;
  });

  ws.getCell(4, sumCol).value = 'Total Marks (Sum)';
  ws.getCell(4, avgCol).value = `UT Total Marks (Avg - ${targetAvgMax})`;

  for (let c = 1; c <= totalColsCount; c++) {
    const cell = ws.getCell(4, c);
    cell.font = { name: 'Calibri', size: 10, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_TAN_HEADER } };
    cell.border = THIN_BORDER;
  }

  // ROW 5+: Student Rows
  const startRow = 5;
  const roster = Array.isArray(data.roster) ? data.roster : [];
  const lastRow = Math.max(startRow, startRow + roster.length - 1);

  // AutoFilter on row 4 spanning full student data range
  ws.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: lastRow, column: totalColsCount }
  };

  roster.forEach((st, idx) => {
    const currentRow = startRow + idx;
    const r = ws.getRow(currentRow);
    r.height = 20;

    const cRoll = ws.getCell(currentRow, 1);
    cRoll.value = String(st.class_roll_no || idx + 1).replace(/^#/, '');
    cRoll.alignment = { horizontal: 'center', vertical: 'middle' };

    const cReg = ws.getCell(currentRow, 2);
    cReg.value = st.registration_no || '—';
    cReg.alignment = { horizontal: 'center', vertical: 'middle' };

    const cEnr = ws.getCell(currentRow, 3);
    cEnr.value = st.official_enrollment_no || '—';
    cEnr.alignment = { horizontal: 'center', vertical: 'middle' };

    const cName = ws.getCell(currentRow, 4);
    cName.value = (st.full_name || st.name || '').toUpperCase();
    cName.alignment = { horizontal: 'left', vertical: 'middle' };

    [cRoll, cReg, cEnr, cName].forEach(cell => {
      cell.font = { name: 'Calibri', size: 9.5 };
      cell.border = THIN_BORDER;
    });

    let sumMarks = 0;
    let pctSum = 0;

    exams.forEach((ex, exIdx) => {
      const qCell = ws.getCell(currentRow, utStartCol + exIdx);
      const scoreObj = st.exam_scores ? st.exam_scores[ex.id] : null;
      const isAbsent = Boolean(scoreObj?.is_absent || scoreObj?.status === 'ABSENT');
      const val = isAbsent ? 'AB' : (scoreObj?.marks !== undefined && scoreObj?.marks !== null ? Number(scoreObj.marks) : 0);

      qCell.value = val;
      qCell.alignment = { horizontal: 'center', vertical: 'middle' };
      qCell.border = THIN_BORDER;

      if (isAbsent) {
        qCell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFFF0000' } };
      } else {
        qCell.font = { name: 'Calibri', size: 9.5 };
        const numVal = Number(val) || 0;
        sumMarks += numVal;
        const exMax = Number(ex.max_marks) || 20;
        pctSum += (numVal / exMax);
      }
    });

    // Sum
    const sumCell = ws.getCell(currentRow, sumCol);
    sumCell.value = Math.round(sumMarks * 10) / 10;
    sumCell.font = { name: 'Calibri', size: 9.5, bold: true };
    sumCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sumCell.border = THIN_BORDER;

    // Scaled Avg
    const avgScore = eCount > 0 ? (pctSum / eCount) * targetAvgMax : 0;
    const avgCell = ws.getCell(currentRow, avgCol);
    avgCell.value = Math.round(avgScore * 10) / 10;
    avgCell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF1E40AF' } };
    avgCell.alignment = { horizontal: 'center', vertical: 'middle' };
    avgCell.border = THIN_BORDER;
  });

  return await wb.xlsx.writeBuffer();
}

module.exports = {
  generateClassTestExcel,
  generateInternalEvaluationExcel,
  generateUnitTestsSummaryExcel
};
