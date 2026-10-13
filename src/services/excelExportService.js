/**
 * Institutional Excel Export Service
 * 
 * Generates pixel-perfect, fully styled Microsoft Excel & Google Sheets (.xlsx) workbooks
 * matching the Uttarakhand Polytechnic institutional format:
 * 1. Class Test Marksheet (Image 1 reference): Question breakdown, instructions panel, red absent highlighting.
 * 2. Student Progress / Internal Evaluation Sheet (Image 2 reference): Combined assignments, unit tests, attendance, presentation.
 */

const ExcelJS = require('exceljs');
const { spawn } = require('child_process');
const path = require('path');
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
 * Dynamically resolves the institution name from system_settings if not explicitly provided
 */
async function getDefaultInstitutionName() {
  try {
    const rows = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'institution_name'");
    if (rows && rows[0]?.setting_value) return rows[0].setting_value;
  } catch (e) {}
  return 'Government Polytechnic';
}

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

  // Extract metadata with fallbacks & deduplicate session string if already present
  let cleanInst = data.institution_name || (await getDefaultInstitutionName());
  let cleanSession = data.session_label || 'Internal Evaluation Sheet';
  if (cleanInst.includes(' | ')) {
    const parts = cleanInst.split(/\s*\|\s*/);
    cleanInst = parts[0];
    if (!data.session_label && parts[1]) {
      cleanSession = parts.slice(1).join(' | ');
    }
  }

  const deptName = data.department_name || '';
  const deptCode = data.department_code || '';
  const subjectName = data.subject_name || 'Subject';
  const year = data.year || 1;
  const semester = data.semester || 1;
  const examTitle = data.title || data.name || 'Unit Test';
  const maxMarks = Number(data.max_marks || 20);
  const examDate = data.exam_date ? new Date(data.exam_date).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB');
  const duration = data.duration || '50 minutes';
  const mode = data.mode || 'OFFLINE';

  // Questions configuration (Dynamic: allows Q1..QN)
  const questions = Array.isArray(data.questions) && data.questions.length > 0
    ? data.questions
    : [
        { num: 1, label: 'Q1', max: maxMarks / 4 },
        { num: 2, label: 'Q2', max: maxMarks / 4 },
        { num: 3, label: 'Q3', max: maxMarks / 4 },
        { num: 4, label: 'Q4', max: maxMarks / 4 }
      ];

  const qCount = questions.length;
  // Columns: Col 1: SR NO, Col 2: ROLL NO, Col 3: ENROLLMENT NO, Col 4: REG. NO., Col 5: STUDENT NAME, Cols 6..(5+qCount): Questions, Col (6+qCount): Total, Col (7+qCount): Details Side Panel
  const nameColIdx = 5;                    // STUDENT NAME
  const firstQColIdx = 6;                  // First question column
  const totalColIdx = firstQColIdx + qCount;  // Total
  const panelColIdx = totalColIdx + 1;        // Side Panel
  const totalColsCount = panelColIdx;

  // Set column widths matching institutional standard
  ws.getColumn(1).width = 8;   // SR. NO.
  ws.getColumn(2).width = 12;  // ROLL NO.
  ws.getColumn(3).width = 18;  // ENROLLMENT NO.
  ws.getColumn(4).width = 18;  // REG. NO.
  ws.getColumn(5).width = 24;  // STUDENT NAME
  for (let i = 0; i < qCount; i++) {
    ws.getColumn(firstQColIdx + i).width = 8; // Q1..QN
  }
  ws.getColumn(totalColIdx).width = 10; // Total
  ws.getColumn(panelColIdx).width = 62; // Side Panel (Instructions & Questions large cell)

  // ── ROW 1: Institution & Session (Light Blue Fill) ──
  ws.mergeCells(1, 1, 1, totalColsCount);
  const r1 = ws.getCell(1, 1);
  r1.value = `${cleanInst} | ${cleanSession}`;
  r1.font = { name: 'Calibri', size: 12, bold: true };
  r1.alignment = { horizontal: 'center', vertical: 'middle' };
  r1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_HEADER } };
  ws.getRow(1).height = 24;

  // ── ROW 2: Department, Class Test, Subject ──
  ws.mergeCells(2, 1, 2, totalColsCount);
  const r2 = ws.getCell(2, 1);
  const deptLabel = deptCode ? `Department (${deptCode})` : (deptName ? `Department of ${deptName}` : 'Department');
  r2.value = `${deptLabel} | Internal Evaluation - Class Test | Subject : ${subjectName}`;
  r2.font = { name: 'Calibri', size: 11, bold: true };
  r2.alignment = { horizontal: 'center', vertical: 'middle' };
  r2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_HEADER } };
  ws.getRow(2).height = 20;

  // ── ROW 3: Year & Semester ──
  ws.mergeCells(3, 1, 3, totalColsCount);
  const r3 = ws.getCell(3, 1);
  const yrPrefix = deptCode ? `${deptCode} ` : (deptName ? `${deptName} ` : '');
  r3.value = `${yrPrefix}${year === 1 ? '1st' : year === 2 ? '2nd' : year === 3 ? '3rd' : year + 'th'} Year | ${semester === 1 ? '1st' : semester === 2 ? '2nd' : semester === 3 ? '3rd' : semester + 'th'} Semester`;
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
  ws.getCell(4, 3).value = 'ENROLLMENT NO.';
  ws.getCell(4, 4).value = 'REG. NO.';
  ws.getCell(4, 5).value = 'STUDENT NAME';

  // Merge over questions and Total for Exam Title
  ws.mergeCells(4, firstQColIdx, 4, totalColIdx);
  const examHeadCell = ws.getCell(4, firstQColIdx);
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
  r5.height = 22;

  // Vertically merge columns 1 to nameColIdx (SR. NO., ROLL NO., ENROLLMENT NO., REG. NO., STUDENT NAME) across Rows 4 & 5
  for (let c = 1; c <= nameColIdx; c++) {
    ws.mergeCells(4, c, 5, c);
  }

  for (let i = 0; i < qCount; i++) {
    const qCell = ws.getCell(5, firstQColIdx + i);
    qCell.value = questions[i].label || String(i + 1);
    qCell.font = { name: 'Calibri', size: 10, bold: true };
    qCell.alignment = { horizontal: 'center', vertical: 'middle' };
  }

  const totHead = ws.getCell(5, totalColIdx);
  totHead.value = `(${maxMarks})`;
  totHead.font = { name: 'Calibri', size: 10, bold: true };
  totHead.alignment = { horizontal: 'center', vertical: 'middle' };

  const metaHead = ws.getCell(5, panelColIdx);
  metaHead.value = `Max Marks : ${maxMarks} | Time : ${duration} | Date : ${examDate}`;
  metaHead.font = { name: 'Calibri', size: 9, bold: true };
  metaHead.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  for (let c = 1; c <= totalColsCount; c++) {
    const cell = ws.getCell(5, c);
    cell.border = THIN_BORDER;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9E6' } };
  }

  // ── INSTRUCTIONS & QUESTIONS PREPARATION ──
  const defaultInstructions = [
    'All questions are compulsory.',
    'Write your Roll Number and Name clearly.',
    'Check question marks against each column.',
    'Neat handwriting and clear steps expected.'
  ];

  const rawInstructions = Array.isArray(data.instructions) && data.instructions.length > 0
    ? data.instructions
    : defaultInstructions;

  const cleanInstructions = rawInstructions
    .filter(i => !i.startsWith('Instructions'))
    .map((ins, i) => `${i + 1}. ${ins.replace(/^\d+\.\s*/, '')}`)
    .join('\n');

  const cleanQuestions = questions.map(q => 
    `• ${q.label}: ${q.text ? q.text + ' ' : ''}Max ${q.max} marks`
  ).join('\n');

  const sidePanelFullText = `Instructions :\n${cleanInstructions}\n\nQuestions Breakdown :\n${cleanQuestions}\n\nNOTE : All marked as RED were absent.`;

  // ── ROWS 6+: Student Scores ──
  const roster = Array.isArray(data.roster) ? data.roster : [];
  const startRow = 6;
  let presentCount = 0;
  let absentCount = 0;
  let sumScores = 0;

  roster.forEach((st, idx) => {
    const currentRow = startRow + idx;
    const r = ws.getRow(currentRow);
    r.height = 24;

    const isAbsent = Boolean(st.is_absent || st.status === 'ABSENT' || String(st.marks_obtained).toUpperCase() === 'AB');
    if (isAbsent) absentCount++; else presentCount++;

    // 1. SR NO
    const cSr = ws.getCell(currentRow, 1);
    cSr.value = idx + 1;
    cSr.alignment = { horizontal: 'center', vertical: 'middle' };

    // 2. ROLL NO
    const cRoll = ws.getCell(currentRow, 2);
    cRoll.value = String(st.class_roll_no || (idx + 1)).replace(/^#/, '');
    cRoll.alignment = { horizontal: 'center', vertical: 'middle' };

    // 3. ENROLLMENT NO. (dedicated column)
    const cEnrl = ws.getCell(currentRow, 3);
    cEnrl.value = String(st.official_enrollment_no || '-');
    cEnrl.alignment = { horizontal: 'center', vertical: 'middle' };

    // 4. REG. NO. (dedicated column)
    const cReg = ws.getCell(currentRow, 4);
    cReg.value = String(st.registration_no || '-');
    cReg.alignment = { horizontal: 'center', vertical: 'middle' };

    // 5. STUDENT NAME
    const cName = ws.getCell(currentRow, nameColIdx);
    const studentName = (st.full_name || st.name || '').toUpperCase();
    cName.value = studentName;
    cName.alignment = { horizontal: 'left', vertical: 'middle' };

    [cSr, cRoll, cEnrl, cReg, cName].forEach(cell => {
      cell.font = { name: 'Calibri', size: 9.5 };
      cell.border = THIN_BORDER;
    });

    // 6+. Question Columns
    const qScores = Array.isArray(st.question_scores) && st.question_scores.length === qCount
      ? st.question_scores
      : null;

    let computedTotal = 0;

    for (let q = 0; q < qCount; q++) {
      const qCell = ws.getCell(currentRow, firstQColIdx + q);
      let val;

      if (isAbsent) {
        val = 0;
      } else if (qScores) {
        val = Number(qScores[q] || 0);
      } else {
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

    if (!isAbsent) {
      sumScores += (st.marks_obtained !== undefined && st.marks_obtained !== null ? Number(st.marks_obtained) : computedTotal);
    }

    // Total Column
    const totCell = ws.getCell(currentRow, totalColIdx);
    const firstQColLetter = ws.getColumn(firstQColIdx).letter;
    const lastQColLetter = ws.getColumn(firstQColIdx - 1 + qCount).letter;

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
      color: isAbsent ? { argb: COLOR_ABSENT_RED } : { argb: 'FF1E40AF' }
    };
  });

  // ── MERGED SIDE PANEL: Large single cell below Unit Test Details for Instructions & Questions ──
  const lastStudentRow = Math.max(startRow, startRow + roster.length - 1);
  const panelBottomRow = Math.max(lastStudentRow, startRow + 9); // Ensure generous height

  ws.mergeCells(startRow, panelColIdx, panelBottomRow, panelColIdx);
  const panelCell = ws.getCell(startRow, panelColIdx);
  panelCell.value = sidePanelFullText;
  panelCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
  panelCell.font = { name: 'Calibri', size: 9 };
  panelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCFCFC' } };

  // Apply borders to all perimeter cells of the merged panel
  for (let r = startRow; r <= panelBottomRow; r++) {
    ws.getCell(r, panelColIdx).border = THIN_BORDER;
    // If panelBottomRow > lastStudentRow, border empty student rows as well
    if (r > lastStudentRow) {
      for (let c = 1; c <= totalColIdx; c++) {
        ws.getCell(r, c).border = THIN_BORDER;
      }
    }
  }

  // ── BOTTOM SUMMARY ROW: Class Average, Present, Absent, Total ──
  const summaryRow = panelBottomRow + 1;
  const sRow = ws.getRow(summaryRow);
  sRow.height = 22;

  // Merge across columns 1 to (totalColIdx - 1): covers SR, ROLL, ENROLLMENT, REG, NAME, all Q columns
  ws.mergeCells(summaryRow, 1, summaryRow, totalColIdx - 1);
  const avgLabel = ws.getCell(summaryRow, 1);
  avgLabel.value = 'Average of the class (Only present students)';
  avgLabel.font = { name: 'Calibri', size: 10, bold: true };
  avgLabel.alignment = { horizontal: 'right', vertical: 'middle' };

  // Total column: Safe average formula using IFERROR to completely prevent #DIV/0!
  const avgValCell = ws.getCell(summaryRow, totalColIdx);
  const totColLetter = ws.getColumn(totalColIdx).letter;
  const presentAvg = presentCount > 0 ? (sumScores / presentCount) : 0;

  avgValCell.value = {
    formula: `IFERROR(ROUND(AVERAGEIF(${totColLetter}${startRow}:${totColLetter}${lastStudentRow}, ">0"), 1), 0)`,
    result: Math.round(presentAvg * 10) / 10
  };
  avgValCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1E40AF' } };
  avgValCell.alignment = { horizontal: 'center', vertical: 'middle' };
  avgValCell.numFmt = '0.0';

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

  const institutionName = data.institution_name || (await getDefaultInstitutionName());
  const sessionLabel = data.session_label || 'Internal Evaluation Sheet';
  const deptName = data.department_name || '';
  const deptCode = data.department_code || '';
  const subjectName = data.subject_name || 'Subject';
  const semester = data.semester || 1;

  // Determine dynamic columns
  const assignments = Array.isArray(data.assignments) && data.assignments.length > 0
    ? data.assignments
    : [{ id: 1, name: '1' }, { id: 2, name: '2' }, { id: 3, name: '3' }, { id: 4, name: '4' }, { id: 5, name: '5' }];

  const exams = Array.isArray(data.exams) && data.exams.length > 0
    ? data.exams
    : [{ id: 1, name: '1' }, { id: 2, name: '2' }, { id: 3, name: '3' }, { id: 4, name: '4' }];

  const hasAssessmentColumns = Array.isArray(data.assessment_columns) && data.assessment_columns.length > 0;
  const assessCols = hasAssessmentColumns ? data.assessment_columns : null;
  const customCols = Array.isArray(data.custom_columns) ? data.custom_columns : [];

  const aCount = assignments.length;
  const eCount = exams.length;

  const assignStartCol = 5;
  const assignEndCol = 4 + aCount;
  const assignAvgCol = assignEndCol + 1;

  const utStartCol = assignAvgCol + 1;
  const utEndCol = assignAvgCol + eCount;
  const utAvgCol = utEndCol + 1;

  let totalColsCount, grandTotalCol, attCol, presCol, customStartCol, assessStartCol;

  if (hasAssessmentColumns) {
    assessStartCol = utAvgCol + 1;
    totalColsCount = assessStartCol + assessCols.length;
    grandTotalCol = totalColsCount;
  } else {
    attCol = utAvgCol + 1;
    presCol = attCol + 1;
    customStartCol = presCol + 1;
    totalColsCount = presCol + customCols.length + 1;
    grandTotalCol = totalColsCount;
  }

  // Column widths
  ws.getColumn(1).width = 9;   // ROLL NO
  ws.getColumn(2).width = 16;  // ENROLLMENT NO
  ws.getColumn(3).width = 16;  // REG NO
  ws.getColumn(4).width = 28;  // STUDENT NAME
  for (let c = assignStartCol; c <= assignEndCol; c++) ws.getColumn(c).width = 6;
  ws.getColumn(assignAvgCol).width = 13; // Assignment Avg
  for (let c = utStartCol; c <= utEndCol; c++) ws.getColumn(c).width = 6;
  ws.getColumn(utAvgCol).width = 12; // UT Avg
  if (hasAssessmentColumns) {
    for (let i = 0; i < assessCols.length; i++) {
      ws.getColumn(assessStartCol + i).width = 14;
    }
  } else {
    ws.getColumn(attCol).width = 13;   // Attendance
    ws.getColumn(presCol).width = 15;  // Presentation
    for (let i = 0; i < customCols.length; i++) {
      ws.getColumn(customStartCol + i).width = 14;
    }
  }
  ws.getColumn(grandTotalCol).width = 13; // Total Marks (50)

  // ── ROW 1: Institution Name & Session Header (Centered, Bold) ──
  ws.mergeCells(1, 1, 1, totalColsCount);
  const r1 = ws.getCell(1, 1);
  r1.value = data.institution_header || `${institutionName} | ${sessionLabel}`;
  r1.font = { name: 'Calibri', size: 12, bold: true };
  r1.alignment = { horizontal: 'center', vertical: 'middle' };
  r1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_HEADER } };
  ws.getRow(1).height = 22;

  // ── ROW 2: Department & Subject ──
  ws.mergeCells(2, 1, 2, totalColsCount);
  const r2 = ws.getCell(2, 1);
  const deptLabel = deptCode ? `Department (${deptCode})` : (deptName ? `Department of ${deptName}` : 'Department');
  r2.value = `${deptLabel} | Subject : ${subjectName}`;
  r2.font = { name: 'Calibri', size: 11, bold: true };
  r2.alignment = { horizontal: 'center', vertical: 'middle' };
  r2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_HEADER } };
  ws.getRow(2).height = 20;

  // ── ROW 3: Department Full Name, Year, and Semester ──
  ws.mergeCells(3, 1, 3, totalColsCount);
  const r3 = ws.getCell(3, 1);
  const yr = data.year || Math.ceil(semester / 2) || 3;
  r3.value = `${deptName} Year ${yr} | Semester ${semester}`;
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
  const assessMaxSum = hasAssessmentColumns
    ? assessCols.reduce((sum, c) => sum + (Number(c.max || c.max_marks || 10) || 0), 0)
    : (attMax + presMax + customSum);
  const totalMax = scheme.total_max !== undefined ? Number(scheme.total_max) : (assignAvgMax + examAvgMax + assessMaxSum);

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

  if (hasAssessmentColumns) {
    // Continuous Assessment / Practical Columns Headers
    assessCols.forEach((col, idx) => {
      const targetCol = assessStartCol + idx;
      ws.mergeCells(4, targetCol, 5, targetCol);
      const cCell = ws.getCell(4, targetCol);
      const colName = col.name || col.title || 'Assessment';
      const colMax = col.max || col.max_marks || 10;
      cCell.value = `${colName}\n(${colMax})`;
      cCell.font = { name: 'Calibri', size: 9, bold: true };
      cCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
  } else {
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
  }

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

    if (hasAssessmentColumns) {
      let assessSum = 0;
      assessCols.forEach((col, cIdx) => {
        const targetCol = assessStartCol + cIdx;
        const cell = ws.getCell(currentRow, targetCol);
        let val = 0;
        if (Array.isArray(st.assessment_scores) && st.assessment_scores[cIdx] !== undefined && st.assessment_scores[cIdx] !== null && st.assessment_scores[cIdx] !== '') {
          val = Number(st.assessment_scores[cIdx]);
        } else if (st.custom_scores && (st.custom_scores[cIdx] !== undefined || st.custom_scores[col.key || col.id] !== undefined)) {
          val = Number(st.custom_scores[cIdx] ?? st.custom_scores[col.key || col.id]);
        } else if (/attendance/i.test(col.name)) {
          const attPct = st.attendance_percentage !== undefined ? Number(st.attendance_percentage) : 85;
          val = Math.round(((attPct / 100) * Number(col.max || 5)) * 10) / 10;
        } else if (/viva/i.test(col.name)) {
          val = st.presentation_score !== undefined ? Number(st.presentation_score) : 4;
        } else {
          val = col.default_value || 0;
        }
        cell.value = val;
        assessSum += val;
        cell.font = { name: 'Calibri', size: 9 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = THIN_BORDER;
      });

      // Grand Total
      const totCell = ws.getCell(currentRow, grandTotalCol);
      const aAvgLetter = ws.getColumn(assignAvgCol).letter;
      const utAvgLetter = ws.getColumn(utAvgCol).letter;
      const computedGrandTotal = Math.round(computedAssignAvg + computedUtAvg + assessSum);
      const formulaParts = [
        `${aAvgLetter}${currentRow}`,
        `${utAvgLetter}${currentRow}`
      ];
      for (let c = 0; c < assessCols.length; c++) {
        formulaParts.push(`${ws.getColumn(assessStartCol + c).letter}${currentRow}`);
      }
      totCell.value = {
        formula: `ROUND(${formulaParts.join(' + ')}, 0)`,
        result: computedGrandTotal
      };
      totCell.font = { name: 'Calibri', size: 9.5, bold: true };
      totCell.alignment = { horizontal: 'center', vertical: 'middle' };
      totCell.border = THIN_BORDER;
    } else {
      // Legacy path with Total Attendance + Presentation + Custom columns
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
    }
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

  const institutionName = data.institution_name || (await getDefaultInstitutionName());
  const sessionLabel = data.session_label || 'Internal Evaluation Sheet';
  const deptName = data.department_name || '';
  const deptCode = data.department_code || '';
  const subjectName = data.subject_name || 'Subject';
  const year = data.year || 1;
  const semester = data.semester || 1;
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
  const utDeptLabel = deptCode ? `Department (${deptCode})` : (deptName ? `Department of ${deptName}` : 'Department');
  r2.value = `${utDeptLabel} | Internal Evaluation - Unit Test | Subject : ${subjectName}`;
  r2.font = { name: 'Calibri', size: 11, bold: true };
  r2.alignment = { horizontal: 'center', vertical: 'middle' };
  r2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_HEADER } };
  ws.getRow(2).height = 20;

  // ROW 3: Year & Semester
  ws.mergeCells(3, 1, 3, totalColsCount);
  const r3 = ws.getCell(3, 1);
  const utYrPrefix = deptCode ? `${deptCode} ` : (deptName ? `${deptName} ` : '');
  r3.value = `${utYrPrefix}Year ${year} | Semester ${semester}`;
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

function buildClassTestMarksheetHtml(data) {
  // Deduplicate institution and session if already embedded
  let cleanInst = data.institution_name || 'Government Polytechnic';
  let cleanSession = data.session_label || 'Internal Evaluation Sheet';
  if (cleanInst.includes(' | ')) {
    const parts = cleanInst.split(/\s*\|\s*/);
    cleanInst = parts[0];
    if (!data.session_label && parts[1]) {
      cleanSession = parts.slice(1).join(' | ');
    }
  }

  const deptName = data.department_name || '';
  const deptCode = data.department_code || '';
  const subjectName = data.subject_name || 'Subject';
  const year = data.year || 1;
  const semester = data.semester || 1;
  const examTitle = data.title || data.name || 'Unit Test';
  const maxMarks = Number(data.max_marks || 20);
  const examDate = data.exam_date ? new Date(data.exam_date).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB');
  const duration = data.duration || '50 minutes';
  const mode = data.mode || 'OFFLINE';

  const questions = Array.isArray(data.questions) && data.questions.length > 0
    ? data.questions
    : [
        { num: 1, label: 'Q1', max: maxMarks / 4 },
        { num: 2, label: 'Q2', max: maxMarks / 4 },
        { num: 3, label: 'Q3', max: maxMarks / 4 },
        { num: 4, label: 'Q4', max: maxMarks / 4 }
      ];

  const qCount = questions.length;
  // Cols: SR, ROLL, ENROLLMENT, REG, NAME, Q1..QN, Total, Side Panel
  const totalCols = 7 + qCount;

  const defaultInstructions = [
    'All questions are compulsory.',
    'Write your Roll Number and Name clearly.',
    'Check question marks against each column.',
    'Neat handwriting and clear steps expected.'
  ];
  const rawInstructions = Array.isArray(data.instructions) && data.instructions.length > 0
    ? data.instructions
    : defaultInstructions;

  const instructionsList = rawInstructions
    .filter(i => !i.startsWith('Instructions'))
    .map(ins => ins.replace(/^\d+\.\s*/, ''));

  const roster = Array.isArray(data.roster) ? data.roster : [];
  let presentCount = 0;
  let absentCount = 0;
  let sumScores = 0;

  const studentRows = roster.map((st, idx) => {
    const isAb = Boolean(st.is_absent || st.status === 'ABSENT' || String(st.marks_obtained).toUpperCase() === 'AB');
    if (isAb) absentCount++; else presentCount++;

    const roll = String(st.class_roll_no || (idx + 1)).replace(/^#/, '');
    const name = String(st.full_name || st.name || '').toUpperCase();
    const qScores = Array.isArray(st.question_scores) ? st.question_scores : [];

    let rowTotal = 0;
    const qCells = questions.map((q, qIdx) => {
      const val = isAb ? 0 : (qScores[qIdx] !== undefined && qScores[qIdx] !== null ? Number(qScores[qIdx]) : 0);
      rowTotal += val;
      return `<td style="text-align:center;padding:5px 3px;border:1px solid #777;">${isAb ? '<span style="color:#dc2626;font-weight:bold;">AB</span>' : val}</td>`;
    }).join('');

    if (!isAb) sumScores += rowTotal;

    const sideCard = (idx === 0) ? `
      <td rowspan="${roster.length || 1}" style="vertical-align:top;background:#fcfcfc;padding:10px 14px;font-size:8pt;line-height:1.55;color:#334155;border:1px solid #777;width:380px;">
        <div style="font-weight:bold;color:#1e293b;margin-bottom:5px;font-size:8.5pt;">Instructions :</div>
        <ol style="margin:0 0 10px 18px;padding:0;">
          ${instructionsList.map(ins => `<li style="margin-bottom:3px;">${ins}</li>`).join('')}
        </ol>
        <div style="font-weight:bold;color:#1e293b;margin-bottom:5px;font-size:8.5pt;">Questions Breakdown :</div>
        <div style="margin-bottom:10px;">
          ${questions.map(q => `<div style="margin-bottom:2px;">• <strong>${q.label}:</strong> ${q.text ? q.text + ' ' : ''}Max ${q.max} marks</div>`).join('')}
        </div>
        <div style="margin-top:10px;font-weight:bold;color:#dc2626;font-size:8pt;">NOTE : All marked as RED were absent.</div>
      </td>
    ` : '';

    return `
      <tr style="${isAb ? 'background:#fef2f2;' : (idx % 2 === 1 ? 'background:#fbfbfb;' : '')}">
        <td style="text-align:center;padding:5px 3px;border:1px solid #777;font-weight:bold;">${idx + 1}</td>
        <td style="text-align:center;padding:5px 3px;border:1px solid #777;font-weight:bold;">${roll}</td>
        <td style="text-align:center;padding:4px 5px;border:1px solid #777;font-size:7.5pt;">${st.official_enrollment_no || '-'}</td>
        <td style="text-align:center;padding:4px 5px;border:1px solid #777;font-size:7.5pt;">${st.registration_no || '-'}</td>
        <td style="padding:4px 8px;border:1px solid #777;font-weight:bold;text-align:left;">${name}</td>
        ${qCells}
        <td style="text-align:center;padding:5px 3px;border:1px solid #777;font-weight:bold;${isAb ? 'color:#dc2626;' : 'color:#1e40af;'}">${isAb ? '0 (AB)' : (Math.round(rowTotal * 10) / 10)}</td>
        ${sideCard}
      </tr>
    `;
  }).join('');

  const classAvg = presentCount > 0 ? (sumScores / presentCount).toFixed(1) : '0.0';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${examTitle} - Internal Evaluation Marksheet</title>
  <style>
    @page { size: A4 landscape; margin: 8mm; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
    body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 8.5pt; color: #1e293b; margin: 0; padding: 0; background: #fff; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    th, td { box-sizing: border-box; border: 1px solid #444; }
    .hdr-blue { background-color: #DDEBF7; color: #1e293b; font-weight: bold; text-align: center; border: 1px solid #444; }
    .hdr-tan { background-color: #FFF2CC; color: #1e293b; font-weight: bold; text-align: center; border: 1px solid #444; }
  </style>
</head>
<body>
  <table>
    <colgroup>
      <col style="width: 38px;">
      <col style="width: 52px;">
      <col style="width: 100px;">
      <col style="width: 100px;">
      <col style="width: 140px;">
      ${questions.map(() => `<col style="width: 44px;">`).join('')}
      <col style="width: 52px;">
      <col style="width: 300px;">
    </colgroup>
    <thead>
      <tr class="hdr-blue">
        <th colspan="${totalCols}" style="padding:6px;font-size:11.5pt;">${cleanInst} | ${cleanSession}</th>
      </tr>
      <tr class="hdr-blue">
        <th colspan="${totalCols}" style="padding:4px;font-size:9.5pt;">${deptCode ? `Department (${deptCode})` : (deptName ? `Department of ${deptName}` : 'Department')} | Internal Evaluation - Class Test | Subject : ${subjectName}</th>
      </tr>
      <tr class="hdr-blue">
        <th colspan="${totalCols}" style="padding:4px;font-size:9.5pt;">${deptCode ? deptCode + ' ' : (deptName ? deptName + ' ' : '')}Year ${year} | Semester ${semester}</th>
      </tr>
      <tr class="hdr-tan">
        <th rowspan="2" style="padding:5px 3px;vertical-align:middle;">SR. NO.</th>
        <th rowspan="2" style="padding:5px 3px;vertical-align:middle;">ROLL NO.</th>
        <th rowspan="2" style="padding:5px 4px;vertical-align:middle;">ENROLLMENT NO.</th>
        <th rowspan="2" style="padding:5px 4px;vertical-align:middle;">REG. NO.</th>
        <th rowspan="2" style="padding:5px 6px;vertical-align:middle;">STUDENT NAME</th>
        <th colspan="${qCount}" style="padding:5px 3px;">${examTitle} (Total Marks : ${maxMarks})</th>
        <th style="padding:5px 3px;">Total</th>
        <th style="padding:5px 8px;">Unit Test Details (Mode : ${mode})</th>
      </tr>
      <tr class="hdr-tan" style="background:#FFF9E6;">
        ${questions.map(q => `<th style="padding:3px;font-size:8pt;border:1px solid #444;"><div>${q.label}</div><div style="font-size:7pt;font-weight:normal;">(${q.max})</div></th>`).join('')}
        <th style="padding:3px;font-size:8pt;border:1px solid #444;">(${maxMarks})</th>
        <th style="padding:4px 8px;font-size:8pt;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:1px solid #444;">Max Marks : ${maxMarks} | Time : ${duration} | Date : ${examDate}</th>
      </tr>
    </thead>
    <tbody>
      ${studentRows}
    </tbody>
    <tfoot>
      <tr style="background:#f1f5f9;font-weight:bold;">
        <td colspan="${5 + qCount}" style="text-align:right;padding:5px 8px;border:1px solid #777;font-size:8.5pt;">
          Average of the class (Only present students)
        </td>
        <td style="text-align:center;padding:5px 3px;border:1px solid #777;color:#1e40af;font-size:9pt;">
          ${classAvg} / ${maxMarks}
        </td>
        <td style="text-align:center;padding:5px 8px;border:1px solid #777;font-size:8pt;">
          Present: <strong>${presentCount}</strong> | Absent: <strong style="color:#dc2626;">${absentCount}</strong> | Total: <strong>${roster.length}</strong>
        </td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;
}

async function generateClassTestPdf(data) {
  const { chromium } = require('playwright');
  const html = buildClassTestMarksheetHtml(data);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' }
    });
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

async function generateClassTestDoc(data) {
  const html = buildClassTestMarksheetHtml(data);
  const docHtml = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'>
<title>${(data.title || data.name || 'Class_Test')}</title>
<!--[if gte mso 9]>
<xml><w:WordDocument><w:View>Print</w:View><w:Orientation>Landscape</w:Orientation></w:WordDocument></xml>
<![endif]-->
<style>
@page Section1 { size: 11.0in 8.5in; mso-page-orientation: landscape; margin: 0.5in; }
div.Section1 { page: Section1; }
body { font-family: Calibri, Arial, sans-serif; font-size: 9pt; }
table { border-collapse: collapse; width: 100%; table-layout: fixed; }
th, td { border: 1px solid #777777; padding: 4px; font-size: 8.5pt; box-sizing: border-box; }
.hdr-blue { background-color: #DDEBF7; font-weight: bold; text-align: center; }
.hdr-tan { background-color: #FFF2CC; font-weight: bold; text-align: center; }
</style>
</head>
<body>
<div class="Section1">
${html.slice(html.indexOf('<table>'), html.indexOf('</table>') + 8)}
</div>
</body>
</html>`;
  return Buffer.from(docHtml, 'utf8');
}

async function getOrGenerateChartImages(data) {
  let chartTrend = data.chart_trend || null;
  let chartCohort = data.chart_cohort || null;

  if (chartTrend && chartCohort) {
    return { chartTrend, chartCohort };
  }

  // Fallback to python chartRenderer
  try {
    const pyScript = path.join(__dirname, '../utils/chartRenderer.py');
    const py = spawn('python', [pyScript]);

    let stdout = '';
    let stderr = '';
    py.stdout.on('data', d => stdout += d);
    py.stderr.on('data', d => stderr += d);

    const pyPromise = new Promise((resolve, reject) => {
      py.on('close', code => {
        if (code === 0 && stdout) {
          try {
            const res = JSON.parse(stdout);
            resolve(res);
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error(stderr || `Python exit code ${code}`));
        }
      });
      py.on('error', reject);
    });

    py.stdin.write(JSON.stringify({
      daily_trend: data.daily_trend || [],
      cohort_summaries: data.cohort_summaries || data.cohort_summary || []
    }));
    py.stdin.end();

    const pyResult = await Promise.race([
      pyPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Chart render timeout')), 4000))
    ]);

    if (pyResult && pyResult.success) {
      if (!chartTrend && pyResult.chart_trend) chartTrend = pyResult.chart_trend;
      if (!chartCohort && pyResult.chart_cohort) chartCohort = pyResult.chart_cohort;
    }
  } catch (err) {
    console.warn('Fallback chart generation skipped:', err.message);
  }

  return { chartTrend, chartCohort };
}

async function generateNativeExcelWithPython(data) {
  const pyScript = path.join(__dirname, '../utils/generateNativeExcelReport.py');
  const py = spawn('python', [pyScript]);

  const chunks = [];
  let stderr = '';

  py.stdout.on('data', d => chunks.push(d));
  py.stderr.on('data', d => stderr += d);

  const pyPromise = new Promise((resolve, reject) => {
    py.on('close', code => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(stderr || `Python exit code ${code}`));
      }
    });
    py.on('error', reject);
  });

  py.stdin.write(JSON.stringify(data));
  py.stdin.end();

  const buffer = await Promise.race([
    pyPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Native Excel generation timeout')), 8000))
  ]);

  return buffer;
}

async function generateDepartmentReportsExcel(data) {
  // 1. Try Native Microsoft Excel Charts Engine (xlsxwriter)
  try {
    const nativeBuf = await generateNativeExcelWithPython(data);
    if (nativeBuf && nativeBuf.length > 1000) {
      return nativeBuf;
    }
  } catch (err) {
    console.warn('Native Excel generator notice, using ExcelJS fallback:', err.message);
  }

  // 2. ExcelJS Fallback
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VidyaOS Institutional Campus Operating System';
  wb.lastModifiedBy = 'Administrator Analytics';
  wb.created = new Date();

  const instName = data.institution_name || (await getDefaultInstitutionName());
  const reportDate = new Date().toLocaleDateString('en-GB');
  const kpis = data.kpis || {};
  const cohorts = data.cohort_summaries || data.cohort_summary || [];
  const trend = data.daily_trend || [];
  const records = data.records || [];
  const filterDesc = data.filter_description || 'All Recorded Attendance';

  // 1. Resolve or Generate Charts
  const { chartTrend, chartCohort } = await getOrGenerateChartImages(data);

  // Calculate cohort aggregates
  let sumEnrolled = 0;
  let sumPresent = 0;
  let sumScans = 0;
  cohorts.forEach(c => {
    sumEnrolled += Number(c.enrolled_students || c.total_students || 0);
    sumPresent += Number(c.present_students || c.scanned_students || 0);
    sumScans += Number(c.total_scans || 0);
  });
  const overallTurnout = sumEnrolled > 0 ? Math.round((sumPresent / sumEnrolled) * 100) : (kpis.unique_students > 0 ? 100 : 0);

  // ─────────────────────────────────────────────────────────────
  // SHEET 1: EXECUTIVE COHORT ANALYSIS & VISUAL DASHBOARD
  // ─────────────────────────────────────────────────────────────
  const wsCohorts = wb.addWorksheet('Cohort Analysis', {
    views: [{ showGridLines: true }],
    pageSetup: { orientation: 'landscape', fitToPage: true }
  });

  wsCohorts.columns = [
    { key: 'col1', width: 8 },   // A: Sr No
    { key: 'col2', width: 34 },  // B: Department / Branch
    { key: 'col3', width: 14 },  // C: Code
    { key: 'col4', width: 12 },  // D: Year
    { key: 'col5', width: 12 },  // E: Semester
    { key: 'col6', width: 16 },  // F: Enrolled
    { key: 'col7', width: 16 },  // G: Present
    { key: 'col8', width: 18 },  // H: Turnout %
    { key: 'col9', width: 16 },  // I: Total Scans
    { key: 'col10', width: 18 }, // J: Online Terminals
    { key: 'col11', width: 24 }  // K: Turnout Performance
  ];

  // Title Banner (Row 1)
  wsCohorts.mergeCells('A1:K1');
  const r1 = wsCohorts.getCell('A1');
  r1.value = `${instName.toUpperCase()} — INSTITUTIONAL ATTENDANCE & TELEMETRY DASHBOARD`;
  r1.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  r1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }; // Deep Navy
  r1.alignment = { horizontal: 'center', vertical: 'middle' };
  wsCohorts.getRow(1).height = 28;

  // Subtitle Banner (Row 2)
  wsCohorts.mergeCells('A2:K2');
  const r2 = wsCohorts.getCell('A2');
  r2.value = `EXECUTIVE BIOMETRIC ANALYTICS & HARDWARE DEVICE MONITORING • ${filterDesc.toUpperCase()}`;
  r2.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1F4E79' } };
  r2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }; // Light Ice Blue
  r2.alignment = { horizontal: 'center', vertical: 'middle' };
  wsCohorts.getRow(2).height = 20;

  // Metadata Row (Row 3)
  wsCohorts.mergeCells('A3:E3');
  wsCohorts.getCell('A3').value = `Generated On: ${reportDate} | Platform: VidyaOS Biometric Engine`;
  wsCohorts.getCell('A3').font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF595959' } };
  wsCohorts.getCell('A3').alignment = { horizontal: 'left', vertical: 'middle' };

  wsCohorts.mergeCells('F3:K3');
  wsCohorts.getCell('F3').value = `Total Scans: ${kpis.total_scans || sumScans || 0}  |  Unique Students: ${kpis.unique_students || sumPresent || 0}  |  Active Terminals: ${kpis.active_terminals || 1}`;
  wsCohorts.getCell('F3').font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF1F4E79' } };
  wsCohorts.getCell('F3').alignment = { horizontal: 'right', vertical: 'middle' };
  wsCohorts.getRow(3).height = 18;

  // Spacer (Row 4)
  wsCohorts.getRow(4).height = 8;

  // ─────────────────────────────────────────────────────────────
  // 4 EXECUTIVE KPI SCORECARD VISUAL CARDS (Rows 5-7)
  // ─────────────────────────────────────────────────────────────
  wsCohorts.getRow(5).height = 18;
  wsCohorts.getRow(6).height = 26;
  wsCohorts.getRow(7).height = 16;

  // Helper to format KPI card
  function formatKpiCard(colStart, colEnd, title, val, subtitle, bgColor, textColor) {
    wsCohorts.mergeCells(`${colStart}5:${colEnd}5`);
    const cTitle = wsCohorts.getCell(`${colStart}5`);
    cTitle.value = title;
    cTitle.font = { name: 'Calibri', size: 9, bold: true, color: { argb: textColor } };
    cTitle.alignment = { horizontal: 'center', vertical: 'middle' };

    wsCohorts.mergeCells(`${colStart}6:${colEnd}6`);
    const cVal = wsCohorts.getCell(`${colStart}6`);
    cVal.value = val;
    cVal.font = { name: 'Calibri', size: 18, bold: true, color: { argb: textColor } };
    cVal.alignment = { horizontal: 'center', vertical: 'middle' };

    wsCohorts.mergeCells(`${colStart}7:${colEnd}7`);
    const cSub = wsCohorts.getCell(`${colStart}7`);
    cSub.value = subtitle;
    cSub.font = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF595959' } };
    cSub.alignment = { horizontal: 'center', vertical: 'middle' };

    const startIdx = wsCohorts.getColumn(colStart).number;
    const endIdx = wsCohorts.getColumn(colEnd).number;
    for (let r = 5; r <= 7; r++) {
      for (let c = startIdx; c <= endIdx; c++) {
        const cell = wsCohorts.getRow(r).getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.border = THIN_BORDER;
      }
    }
  }

  // Card 1: Total Scans (Cols B-C)
  formatKpiCard('B', 'C', '⚡ TOTAL SCANS', (kpis.total_scans || sumScans || 0).toLocaleString(), 'Verified Biometric Events', 'FFEBF1F5', 'FF1F4E79');

  // Card 2: Unique Attendees (Cols D-E)
  formatKpiCard('D', 'E', '👥 UNIQUE ATTENDEES', (kpis.unique_students || sumPresent || 0).toLocaleString(), 'Verified Students In-Person', 'FFE8F8F5', 'FF16A34A');

  // Card 3: Online Terminals (Cols F-H)
  formatKpiCard('F', 'H', '🖥️ ONLINE TERMINALS', `${kpis.active_terminals || 1} Online`, 'ESP32 IoT Network', 'FFF4ECF7', 'FF8E44AD');

  // Card 4: Turnout Rate (Cols I-K)
  formatKpiCard('I', 'K', '📊 OVERALL TURNOUT', `${overallTurnout}%`, overallTurnout >= 75 ? 'Healthy Turnout (>=75%)' : 'Needs Review (<75%)', 'FFFEF9E7', 'FFD35400');

  // Spacer (Row 8)
  wsCohorts.getRow(8).height = 10;

  // ─────────────────────────────────────────────────────────────
  // EMBEDDED GRAPH CHARTS (Rows 9-25)
  // ─────────────────────────────────────────────────────────────
  // Chart Section Titles (Row 9)
  wsCohorts.getRow(9).height = 22;
  wsCohorts.mergeCells('B9:F9');
  const chartHdr1 = wsCohorts.getCell('B9');
  chartHdr1.value = '📈 DAILY BIOMETRIC ATTENDANCE TIMELINE (SCANS & ATTENDEES)';
  chartHdr1.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  chartHdr1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
  chartHdr1.alignment = { horizontal: 'center', vertical: 'middle' };
  for (let c = 2; c <= 6; c++) wsCohorts.getRow(9).getCell(c).border = THIN_BORDER;

  wsCohorts.mergeCells('G9:K9');
  const chartHdr2 = wsCohorts.getCell('G9');
  chartHdr2.value = '🍩 COHORT PRESENCE & ATTENDANCE SHARE';
  chartHdr2.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  chartHdr2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
  chartHdr2.alignment = { horizontal: 'center', vertical: 'middle' };
  for (let c = 7; c <= 11; c++) wsCohorts.getRow(9).getCell(c).border = THIN_BORDER;

  // Ensure rows 10-25 have consistent heights for chart display
  for (let r = 10; r <= 25; r++) {
    wsCohorts.getRow(r).height = 18;
  }

  // Embed Chart 1: Daily Trend Timeline
  if (chartTrend) {
    const cleanB64 = chartTrend.replace(/^data:image\/\w+;base64,/, '');
    const imgId1 = wb.addImage({
      base64: cleanB64,
      extension: 'png'
    });
    wsCohorts.addImage(imgId1, {
      tl: { col: 1, row: 9 },   // B10 (0-indexed col 1, row 9)
      br: { col: 6, row: 25 },  // F26
      editAs: 'oneCell'
    });
  }

  // Embed Chart 2: Cohort Presence Share
  if (chartCohort) {
    const cleanB64 = chartCohort.replace(/^data:image\/\w+;base64,/, '');
    const imgId2 = wb.addImage({
      base64: cleanB64,
      extension: 'png'
    });
    wsCohorts.addImage(imgId2, {
      tl: { col: 6, row: 9 },   // G10 (0-indexed col 6, row 9)
      br: { col: 11, row: 25 }, // K26
      editAs: 'oneCell'
    });
  }

  // Spacer (Row 26)
  wsCohorts.getRow(26).height = 10;

  // ─────────────────────────────────────────────────────────────
  // COHORT MATRIX DATA TABLE (Rows 27+)
  // ─────────────────────────────────────────────────────────────
  // Table Section Header (Row 27)
  wsCohorts.mergeCells('A27:K27');
  const tblSectionHdr = wsCohorts.getCell('A27');
  tblSectionHdr.value = '📋 ACADEMIC COHORT & DEPARTMENT ATTENDANCE MATRIX';
  tblSectionHdr.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  tblSectionHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  tblSectionHdr.alignment = { horizontal: 'center', vertical: 'middle' };
  wsCohorts.getRow(27).height = 24;

  // Table Column Headers (Row 28)
  const cohortHeaders = [
    'SR.', 'DEPARTMENT / COHORT', 'CODE', 'YEAR', 'SEMESTER',
    'ENROLLED', 'PRESENT', 'TURNOUT RATE', 'TOTAL SCANS', 'ONLINE TERMINALS', 'PERFORMANCE'
  ];
  const r28 = wsCohorts.getRow(28);
  r28.height = 24;
  cohortHeaders.forEach((text, idx) => {
    const cell = r28.getCell(idx + 1);
    cell.value = text;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } }; // Medium Slate Blue
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = THIN_BORDER;
  });

  // Table Data Rows (Starting at Row 29)
  let curRow = 29;

  cohorts.forEach((c, idx) => {
    const row = wsCohorts.getRow(curRow);
    row.height = 20;

    const enrolled = Number(c.enrolled_students || c.total_students || 0);
    const present = Number(c.present_students || c.scanned_students || 0);
    const turnout = Math.round(Number(c.turnout_rate ?? c.attendance_percentage ?? (enrolled > 0 ? (present / enrolled) * 100 : 0)));
    const totalScans = Number(c.total_scans || 0);
    const termCount = (c.terminal_uids || c.devices || []).length || Number(c.active_terminals || 0);

    let perfText = 'High Turnout (>=75%)';
    let perfColor = 'FF27AE60'; // Green
    if (turnout < 50) {
      perfText = 'Critical (<50%)';
      perfColor = 'FFE74C3C'; // Red
    } else if (turnout < 75) {
      perfText = 'Moderate (50-74%)';
      perfColor = 'FFF39C12'; // Amber
    }

    const rowData = [
      idx + 1,
      c.department_name || c.branch_name || 'Department',
      c.department_code || c.branch_code || '--',
      c.year ? `Year ${c.year}` : '--',
      c.semester ? `Sem ${c.semester}` : '--',
      enrolled,
      present,
      `${turnout}%`,
      totalScans,
      `${termCount} Online`,
      perfText
    ];

    rowData.forEach((val, cIdx) => {
      const cell = row.getCell(cIdx + 1);
      cell.value = val;
      cell.font = { name: 'Calibri', size: 9.5 };
      cell.border = THIN_BORDER;

      if (curRow % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FBFD' } };
      }

      if (cIdx === 0 || cIdx === 2 || cIdx === 3 || cIdx === 4 || cIdx === 7 || cIdx === 9 || cIdx === 10) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (cIdx === 5 || cIdx === 6 || cIdx === 8) {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else {
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      }

      if (cIdx === 10) {
        cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: perfColor } };
      }
    });

    curRow++;
  });

  // Summary Total Row
  if (cohorts.length > 0) {
    const totalRow = wsCohorts.getRow(curRow);
    totalRow.height = 22;
    wsCohorts.mergeCells(`A${curRow}:E${curRow}`);
    const totLabelCell = totalRow.getCell(1);
    totLabelCell.value = 'TOTAL / WEIGHTED AVERAGE';
    totLabelCell.font = { name: 'Calibri', size: 10, bold: true };
    totLabelCell.alignment = { horizontal: 'right', vertical: 'middle' };
    totLabelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAECEE' } };

    for (let c = 1; c <= 5; c++) totalRow.getCell(c).border = THIN_BORDER;

    const avgTurnout = sumEnrolled > 0 ? Math.round((sumPresent / sumEnrolled) * 100) : 0;

    const totals = {
      6: sumEnrolled,
      7: sumPresent,
      8: `${avgTurnout}%`,
      9: sumScans,
      10: `${kpis.active_terminals || 1} Total`,
      11: avgTurnout >= 75 ? 'Healthy Turnout' : 'Needs Attention'
    };

    Object.entries(totals).forEach(([colIdx, val]) => {
      const cell = totalRow.getCell(Number(colIdx));
      cell.value = val;
      cell.font = { name: 'Calibri', size: 10, bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAECEE' } };
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: colIdx == 8 || colIdx >= 10 ? 'center' : 'right', vertical: 'middle' };
    });
  }

  // ─────────────────────────────────────────────────────────────
  // SHEET 2: DAILY ATTENDANCE TREND TIMELINE
  // ─────────────────────────────────────────────────────────────
  const wsTrend = wb.addWorksheet('Daily Activity Trend', {
    views: [{ showGridLines: true }]
  });

  wsTrend.columns = [
    { key: 'date', width: 18 },
    { key: 'day', width: 16 },
    { key: 'scans', width: 20 },
    { key: 'students', width: 20 },
    { key: 'avg', width: 22 }
  ];

  wsTrend.mergeCells('A1:E1');
  const tr1 = wsTrend.getCell('A1');
  tr1.value = `${instName} — DAILY ATTENDANCE & TELEMETRY TIMELINE`;
  tr1.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
  tr1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  tr1.alignment = { horizontal: 'center', vertical: 'middle' };
  wsTrend.getRow(1).height = 24;

  const trendHeaders = ['DATE', 'DAY OF WEEK', 'TOTAL SCANS', 'UNIQUE ATTENDEES', 'AVG SCANS / ATTENDEE'];
  const tr3 = wsTrend.getRow(3);
  tr3.height = 22;
  trendHeaders.forEach((text, idx) => {
    const cell = tr3.getCell(idx + 1);
    cell.value = text;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = THIN_BORDER;
  });

  let tRow = 4;
  trend.forEach(t => {
    const row = wsTrend.getRow(tRow);
    row.height = 19;
    const dObj = new Date(t.date + 'T00:00:00');
    const dayName = isNaN(dObj.getTime()) ? '--' : dObj.toLocaleDateString('en-US', { weekday: 'long' });
    const sCount = Number(t.scan_count || 0);
    const uCount = Number(t.unique_students || 0);
    const ratio = uCount > 0 ? (sCount / uCount).toFixed(1) : '1.0';

    const vals = [t.date, dayName, sCount, uCount, `${ratio} scans/student`];
    vals.forEach((v, idx) => {
      const cell = row.getCell(idx + 1);
      cell.value = v;
      cell.font = { name: 'Calibri', size: 9.5 };
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: idx === 0 || idx === 1 || idx === 4 ? 'center' : 'right', vertical: 'middle' };
    });
    tRow++;
  });

  // ─────────────────────────────────────────────────────────────
  // SHEET 3: RAW BIOMETRIC SCAN LOGS
  // ─────────────────────────────────────────────────────────────
  const wsLogs = wb.addWorksheet('Biometric Logs', {
    views: [{ showGridLines: true }]
  });

  wsLogs.columns = [
    { key: 'scan_id', width: 12 },
    { key: 'scan_time', width: 22 },
    { key: 'roll_no', width: 14 },
    { key: 'enrollment', width: 18 },
    { key: 'name', width: 26 },
    { key: 'dept', width: 18 },
    { key: 'year', width: 10 },
    { key: 'sem', width: 10 },
    { key: 'uid', width: 20 },
    { key: 'terminal', width: 24 },
    { key: 'status', width: 14 }
  ];

  wsLogs.mergeCells('A1:K1');
  const lr1 = wsLogs.getCell('A1');
  lr1.value = `${instName} — BIOMETRIC HARDWARE SCANNED LOGS`;
  lr1.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
  lr1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  lr1.alignment = { horizontal: 'center', vertical: 'middle' };
  wsLogs.getRow(1).height = 24;

  const logHeaders = [
    'SCAN ID', 'SCAN TIME', 'ROLL NO', 'ENROLLMENT NO', 'STUDENT NAME',
    'DEPARTMENT', 'YEAR', 'SEMESTER', 'TERMINAL UID', 'TERMINAL NAME', 'STATUS'
  ];
  const lr3 = wsLogs.getRow(3);
  lr3.height = 22;
  logHeaders.forEach((text, idx) => {
    const cell = lr3.getCell(idx + 1);
    cell.value = text;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = THIN_BORDER;
  });

  let lRow = 4;
  records.forEach(r => {
    const row = wsLogs.getRow(lRow);
    row.height = 18;
    const vals = [
      r.scan_id,
      r.scan_time,
      r.class_roll_no || '--',
      r.official_enrollment_no || '--',
      r.student_name || '--',
      r.department_code || r.department_name || '--',
      r.year || '--',
      r.semester || '--',
      r.device_uid || '--',
      r.device_name || '--',
      r.status || 'PRESENT'
    ];

    vals.forEach((v, idx) => {
      const cell = row.getCell(idx + 1);
      cell.value = v;
      cell.font = { name: 'Calibri', size: 9 };
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: idx === 0 || idx === 1 || idx === 2 || idx === 3 || idx === 6 || idx === 7 || idx === 10 ? 'center' : 'left', vertical: 'middle' };
    });
    lRow++;
  });

  return await wb.xlsx.writeBuffer();
}

module.exports = {
  generateClassTestExcel,
  generateClassTestPdf,
  generateClassTestDoc,
  generateInternalEvaluationExcel,
  generateUnitTestsSummaryExcel,
  generateDepartmentReportsExcel
};
