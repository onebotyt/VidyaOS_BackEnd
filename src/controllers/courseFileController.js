/**
 * Course File Controller — HTTP request/response handlers for Course File preparation dossier.
 * Unified Academic Dossier & Multi-Module Merge Export Engine
 */

const path = require('path');
const fs = require('fs');
let PDFDocument, rgb, StandardFonts;
try {
  ({ PDFDocument, rgb, StandardFonts } = require('pdf-lib'));
} catch (err) {
  // Graceful fallback if pdf-lib is not yet installed in local environment
}
const courseFileModel = require('../models/courseFileModel');
const theoryClassModel = require('../models/theoryClassModel');
const labClassModel = require('../models/labClassModel');
const studentPerformanceModel = require('../models/studentPerformanceModel');
const assessmentProcessModel = require('../models/assessmentProcessModel');
const auditService = require('../services/auditService');
const logger = require('../utils/logger');

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function sanitizePdfText(str) {
  if (!str) return '';
  return String(str)
    .replace(/[•●]/g, '|')
    .replace(/[—–]/g, '-')
    .replace(/[✓✔]/g, '[OK]')
    .replace(/[⚠]/g, '[!]')
    .replace(/[⏳]/g, '[PENDING]')
    .replace(/[📦📁📄]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ') // replace non-printable/non-ascii with space
    .trim();
}

class CourseFileController {
  /**
   * Retrieves NBA/NAAC 18 standard course file item definitions.
   * @route GET /api/v1/course-files/definitions
   */
  getDefinitions(req, res) {
    return res.json({
      success: true,
      data: courseFileModel.getItemsDefinition()
    });
  }

  /**
   * Helper to resolve module data for any dossier type
   */
  async resolveModuleData(groupId, type) {
    const group = await courseFileModel.getGroupDetails(groupId);
    if (!group) return null;

    const baseParams = {
      groupId,
      subjectId: group.subject_id,
      teacherId: group.teacher_id,
      academicYearId: group.academic_year_id,
      departmentId: group.department_id,
      semester: group.semester
    };

    const t = (type || 'nba').toLowerCase();

    if (t === 'theory') {
      const file = await theoryClassModel.getOrCreateTheoryClass(baseParams);
      const docs = await theoryClassModel.getDocuments(file.id);
      const docMap = {};
      docs.forEach(d => { docMap[d.item_key] = d; });
      const defs = theoryClassModel.getItemsDefinition();
      const items = defs.map(d => ({
        ...d,
        module_type: 'theory',
        module_label: 'Theory Classes',
        is_completed: Boolean(docMap[d.key]),
        document: docMap[d.key] || null
      }));
      return {
        module_type: 'theory',
        module_title: 'Theory Classes, Syllabus & Lesson Plans',
        module_code: 'THEORY',
        group,
        file,
        docs,
        docMap,
        items,
        total_items: defs.length,
        completed_items: items.filter(i => i.is_completed).length
      };
    }

    if (t === 'lab') {
      const file = await labClassModel.getOrCreateLabClass(baseParams);
      const docs = await labClassModel.getDocuments(file.id);
      const docMap = {};
      docs.forEach(d => { docMap[d.item_key] = d; });
      const defs = labClassModel.getItemsDefinition();
      const items = defs.map(d => ({
        ...d,
        module_type: 'lab',
        module_label: 'Laboratory Classes',
        is_completed: Boolean(docMap[d.key]),
        document: docMap[d.key] || null
      }));
      return {
        module_type: 'lab',
        module_title: 'Laboratory Classes, Manuals & Practicals',
        module_code: 'PRACTICAL',
        group,
        file,
        docs,
        docMap,
        items,
        total_items: defs.length,
        completed_items: items.filter(i => i.is_completed).length
      };
    }

    if (t === 'performance') {
      const file = await studentPerformanceModel.getOrCreatePerformanceFile(baseParams);
      const docs = await studentPerformanceModel.getDocuments(file.id);
      const docMap = {};
      docs.forEach(d => { docMap[d.item_key] = d; });
      const defs = studentPerformanceModel.getItemsDefinition();
      const items = defs.map(d => ({
        ...d,
        module_type: 'performance',
        module_label: 'Student Performance',
        is_completed: Boolean(docMap[d.key]),
        document: docMap[d.key] || null
      }));
      return {
        module_type: 'performance',
        module_title: 'Student Performance & Remedial Actions',
        module_code: 'PERFORMANCE',
        group,
        file,
        docs,
        docMap,
        items,
        total_items: defs.length,
        completed_items: items.filter(i => i.is_completed).length
      };
    }

    if (t === 'direct') {
      const file = await assessmentProcessModel.getOrCreateAssessmentFile(baseParams);
      const docs = await assessmentProcessModel.getDocuments(file.id);
      const docMap = {};
      docs.forEach(d => { docMap[d.item_key] = d; });
      const defs = assessmentProcessModel.getDirectAssessmentItems();
      const items = defs.map(d => ({
        ...d,
        module_type: 'direct',
        module_label: 'Direct Assessment',
        is_completed: Boolean(docMap[d.key]),
        document: docMap[d.key] || null
      }));
      return {
        module_type: 'direct',
        module_title: 'Direct Assessment (Internal Exams, Tests, Rubrics)',
        module_code: 'DIRECT',
        group,
        file,
        docs,
        docMap,
        items,
        total_items: defs.length,
        completed_items: items.filter(i => i.is_completed).length
      };
    }

    if (t === 'indirect') {
      const file = await assessmentProcessModel.getOrCreateAssessmentFile(baseParams);
      const docs = await assessmentProcessModel.getDocuments(file.id);
      const docMap = {};
      docs.forEach(d => { docMap[d.item_key] = d; });
      const defs = assessmentProcessModel.getIndirectAssessmentItems();
      const items = defs.map(d => ({
        ...d,
        module_type: 'indirect',
        module_label: 'Indirect Assessment',
        is_completed: Boolean(docMap[d.key]),
        document: docMap[d.key] || null
      }));
      return {
        module_type: 'indirect',
        module_title: 'Indirect Assessment (Surveys & Stakeholder Feedback)',
        module_code: 'INDIRECT',
        group,
        file,
        docs,
        docMap,
        items,
        total_items: defs.length,
        completed_items: items.filter(i => i.is_completed).length
      };
    }

    // Default: 'nba'
    const file = await courseFileModel.getOrCreateCourseFile(baseParams);
    const docs = await courseFileModel.getDocuments(file.id);
    const docMap = {};
    docs.forEach(d => { docMap[d.item_key] = d; });
    const defs = courseFileModel.getItemsDefinition();

    const students = await courseFileModel.getGroupStudentsWithAttendance(group);
    const advancedLearners = students.filter(s => s.attendance_pct != null && s.attendance_pct >= 80);
    const slowLearners = students.filter(s => s.attendance_pct != null && s.attendance_pct < 75);
    const assignments = await courseFileModel.getGroupAssignments(group);
    const classTests = assignments.filter(a => a.type === 'EXAM' || a.title?.toLowerCase().includes('test'));

    let completedCount = 0;
    const items = defs.map(itemDef => {
      const doc = docMap[itemDef.key] || null;
      let hasData = false;
      if (itemDef.key === 'student_list' && students.length > 0) hasData = true;
      if (itemDef.key === 'assignment_schedule' && assignments.length > 0) hasData = true;
      if (itemDef.key === 'advanced_learners' && (advancedLearners.length > 0 || file.advanced_learners_json)) hasData = true;
      if (itemDef.key === 'slow_learners' && (slowLearners.length > 0 || file.slow_learners_json)) hasData = true;

      const isCompleted = !!doc || hasData;
      if (isCompleted) completedCount++;

      return {
        ...itemDef,
        module_type: 'nba',
        module_label: 'NBA Course File',
        is_completed: isCompleted,
        document: doc,
        has_system_data: hasData
      };
    });

    return {
      module_type: 'nba',
      module_title: 'NBA / NAAC Course File Dossier',
      module_code: 'NBA',
      group,
      file,
      docs,
      docMap,
      items,
      total_items: defs.length,
      completed_items: completedCount,
      system_data: {
        total_students: students.length,
        students,
        advanced_learners: advancedLearners,
        slow_learners: slowLearners,
        assignments,
        class_tests: classTests
      }
    };
  }

  /**
   * Retrieves or auto-provisions dossier for a teaching group.
   * Dynamically supports all 6 dossier modules via ?type=theory|lab|nba|performance|direct|indirect|all.
   * @route GET /api/v1/course-files
   */
  async getCourseFile(req, res) {
    try {
      const groupId = parseInt(req.query.group_id || req.query.teaching_group_id || req.query.groupId || req.query.id, 10);
      const subjectId = req.query.subject_id ? parseInt(req.query.subject_id, 10) : null;
      const type = (req.query.type || 'nba').toLowerCase();

      if (!groupId && !subjectId) {
        return res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'group_id or subject_id is required' }
        });
      }

      if (type === 'all') {
        const [theory, lab, nba, perf, direct, indirect] = await Promise.all([
          this.resolveModuleData(groupId, 'theory'),
          this.resolveModuleData(groupId, 'lab'),
          this.resolveModuleData(groupId, 'nba'),
          this.resolveModuleData(groupId, 'performance'),
          this.resolveModuleData(groupId, 'direct'),
          this.resolveModuleData(groupId, 'indirect')
        ]);

        const allModules = [theory, lab, nba, perf, direct, indirect].filter(Boolean);
        const group = allModules[0]?.group || {};
        const allItems = allModules.flatMap(m => m.items || []);
        const totalItems = allItems.length;
        const completedItems = allItems.filter(i => i.is_completed).length;
        const completionPct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

        return res.json({
          success: true,
          data: {
            dossier_type: 'all',
            dossier_title: 'Consolidated Academic Dossier (All 6 Modules)',
            group,
            course_file: {
              ...nba.file,
              total_items: totalItems,
              completed_items: completedItems,
              completion_pct: completionPct,
              status: nba.file?.status || 'IN_PROGRESS'
            },
            modules: allModules,
            items: allItems,
            system_data: nba?.system_data || null
          }
        });
      }

      const modData = await this.resolveModuleData(groupId, type);
      if (!modData) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Teaching group not found' }
        });
      }

      const completionPct = modData.total_items > 0
        ? Math.round((modData.completed_items / modData.total_items) * 100)
        : 0;

      return res.json({
        success: true,
        data: {
          dossier_type: modData.module_type,
          dossier_title: modData.module_title,
          group: modData.group,
          course_file: {
            ...modData.file,
            evaluation_scheme: modData.file?.evaluation_scheme ? JSON.parse(modData.file.evaluation_scheme) : null,
            copo_matrix: modData.file?.copo_matrix_json ? JSON.parse(modData.file.copo_matrix_json) : null,
            course_outcomes: modData.file?.cos_json ? JSON.parse(modData.file.cos_json) : null,
            total_items: modData.total_items,
            completed_items: modData.completed_items,
            completion_pct: completionPct
          },
          items: modData.items,
          system_data: modData.system_data || null
        }
      });
    } catch (err) {
      logger.error('[CourseFileController] getCourseFile error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Merges all uploaded documents for this classroom into one consolidated institutional PDF.
   * @route GET /api/v1/course-files/merge-export
   */
  async mergeExport(req, res) {
    try {
      const groupId = parseInt(req.query.group_id || req.query.groupId || req.query.id, 10);
      const type = (req.query.type || 'nba').toLowerCase();
      const scope = (req.query.scope || (type === 'all' ? 'all' : 'current')).toLowerCase();

      if (!groupId) {
        return res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'group_id is required for merge export' }
        });
      }

      const group = await courseFileModel.getGroupDetails(groupId);
      if (!group) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Teaching group not found' }
        });
      }

      // Collect modules to include
      let modulesToExport = [];
      if (scope === 'all' || type === 'all') {
        const [theory, lab, nba, perf, direct, indirect] = await Promise.all([
          this.resolveModuleData(groupId, 'theory'),
          this.resolveModuleData(groupId, 'lab'),
          this.resolveModuleData(groupId, 'nba'),
          this.resolveModuleData(groupId, 'performance'),
          this.resolveModuleData(groupId, 'direct'),
          this.resolveModuleData(groupId, 'indirect')
        ]);
        modulesToExport = [theory, lab, nba, perf, direct, indirect].filter(Boolean);
      } else {
        const mod = await this.resolveModuleData(groupId, type);
        if (mod) modulesToExport.push(mod);
      }

      const allItems = modulesToExport.flatMap(m => m.items || []);
      const uploadedItems = allItems.filter(i => i.document && i.document.file_path);
      const totalCount = allItems.length;
      const uploadedCount = uploadedItems.length;
      const completionPct = totalCount > 0 ? Math.round((uploadedCount / totalCount) * 100) : 0;

      // Initialize PDFDocument
      const mergedPdf = await PDFDocument.create();
      const fontBold = await mergedPdf.embedFont(StandardFonts.HelveticaBold);
      const fontRegular = await mergedPdf.embedFont(StandardFonts.Helvetica);

      const PAGE_W = 595.28;
      const PAGE_H = 841.89; // Standard A4

      // ─── 1. PAGE 1: INSTITUTIONAL TITLE & COVER PAGE ───
      const coverPage = mergedPdf.addPage([PAGE_W, PAGE_H]);

      // Top Institutional Banner
      coverPage.drawRectangle({
        x: 0,
        y: PAGE_H - 95,
        width: PAGE_W,
        height: 95,
        color: rgb(0.08, 0.22, 0.45) // Deep Navy
      });

      // Gold Accent Strip
      coverPage.drawRectangle({
        x: 0,
        y: PAGE_H - 100,
        width: PAGE_W,
        height: 5,
        color: rgb(0.85, 0.65, 0.15) // Institutional Gold
      });

      coverPage.drawText('UTTARAKHAND GOVERNMENT INSTITUTE OF POLYTECHNIC, NAINITAL', {
        x: 40,
        y: PAGE_H - 45,
        size: 13,
        font: fontBold,
        color: rgb(1, 1, 1)
      });

      const deptLabel = (group.department_name || 'Information Technology').toUpperCase();
      coverPage.drawText(sanitizePdfText(`NBA & NAAC ACCREDITED INSTITUTION | DEPARTMENT OF ${deptLabel}`), {
        x: 40,
        y: PAGE_H - 68,
        size: 9,
        font: fontRegular,
        color: rgb(0.85, 0.92, 1)
      });

      // Main Dossier Title
      let mainDossierTitle = 'CONSOLIDATED ACADEMIC CLASSROOM DOSSIER';
      if (scope !== 'all') {
        const modTitleMap = {
          theory: 'THEORY CLASSES ACADEMIC DOSSIER',
          lab: 'LABORATORY CLASSES & PRACTICAL JOURNAL DOSSIER',
          nba: 'NBA / NAAC CRITERIA COURSE FILE DOSSIER',
          performance: 'STUDENT PERFORMANCE & REMEDIAL MEASURES DOSSIER',
          direct: 'DIRECT ASSESSMENT & CO ATTAINMENT DOSSIER',
          indirect: 'INDIRECT ASSESSMENT & STAKEHOLDER FEEDBACK DOSSIER'
        };
        mainDossierTitle = modTitleMap[type] || 'ACADEMIC COURSE FILE DOSSIER';
      }

      coverPage.drawText(sanitizePdfText(mainDossierTitle), {
        x: 40,
        y: PAGE_H - 150,
        size: 17,
        font: fontBold,
        color: rgb(0.08, 0.22, 0.45)
      });

      coverPage.drawText(sanitizePdfText(`Course: ${group.subject_name || group.name} (${group.subject_code || 'IT500'}) | Semester ${group.semester || '--'}`), {
        x: 40,
        y: PAGE_H - 175,
        size: 11,
        font: fontRegular,
        color: rgb(0.3, 0.35, 0.45)
      });

      // Coursework & Demographic Information Box
      const boxY = PAGE_H - 365;
      const boxH = 170;
      coverPage.drawRectangle({
        x: 40,
        y: boxY,
        width: PAGE_W - 80,
        height: boxH,
        borderColor: rgb(0.78, 0.84, 0.92),
        borderWidth: 1,
        color: rgb(0.97, 0.98, 1.0)
      });

      coverPage.drawText('ACADEMIC CURRICULUM & AUDIT SPECIFICATIONS', {
        x: 55,
        y: boxY + boxH - 25,
        size: 10,
        font: fontBold,
        color: rgb(0.08, 0.22, 0.45)
      });

      const metaLines = [
        ['Teaching Group Identifier:', `Class ID #${group.id} | ${group.name || group.subject_name}`],
        ['Subject Code & Name:', `${group.subject_code || 'IT500'} - ${group.subject_name}`],
        ['Course Component:', `${group.component || 'Theory + Practical'}`],
        ['Semester & Academic Session:', `Semester ${group.semester} | AY ${group.academic_year_label || '2026-27 (Winter Session)'}`],
        ['Faculty In-Charge:', `${group.teacher_name || 'Assigned Faculty Member'}`],
        ['Department & Institute:', `${group.department_name || 'Information Technology'}, UGIP Nainital`],
        ['Audit Readiness Metric:', `${uploadedCount} of ${totalCount} Artifacts Uploaded (${completionPct}% Compiled)`]
      ];

      metaLines.forEach(([lbl, val], idx) => {
        const lineY = boxY + boxH - 48 - (idx * 16.5);
        coverPage.drawText(sanitizePdfText(lbl), {
          x: 55,
          y: lineY,
          size: 9,
          font: fontBold,
          color: rgb(0.2, 0.25, 0.35)
        });
        coverPage.drawText(sanitizePdfText(val), {
          x: 215,
          y: lineY,
          size: 9,
          font: fontRegular,
          color: rgb(0.12, 0.16, 0.22)
        });
      });

      // Audit Stamp Pill
      coverPage.drawRectangle({
        x: 40,
        y: boxY - 45,
        width: PAGE_W - 80,
        height: 32,
        color: completionPct === 100 ? rgb(0.92, 0.98, 0.94) : rgb(0.98, 0.95, 0.9)
      });

      const auditMsg = completionPct === 100
        ? `[OK] 100% COMPLIANT: All ${totalCount} required documents uploaded and verified for institutional inspection.`
        : `[!] AUDIT NOTICE: ${uploadedCount} of ${totalCount} documents uploaded (${totalCount - uploadedCount} pending upload).`;

      coverPage.drawText(sanitizePdfText(auditMsg), {
        x: 55,
        y: boxY - 33,
        size: 9,
        font: fontBold,
        color: completionPct === 100 ? rgb(0.1, 0.5, 0.2) : rgb(0.7, 0.35, 0.05)
      });

      // Institutional Signature & Verification Block (Page Bottom)
      const sigY = 65;
      const sigBoxW = (PAGE_W - 80 - 30) / 3;

      const sigBlocks = [
        ['Course Coordinator / Teacher', group.teacher_name || 'Faculty Member'],
        ['Head of Department (HOD)', 'Department Head'],
        ['Principal / Academic Dean', 'Institutional Authority']
      ];

      sigBlocks.forEach(([roleTitle, subText], idx) => {
        const xPos = 40 + idx * (sigBoxW + 15);
        coverPage.drawLine({
          start: { x: xPos, y: sigY + 35 },
          end: { x: xPos + sigBoxW, y: sigY + 35 },
          thickness: 1,
          color: rgb(0.65, 0.7, 0.75)
        });
        coverPage.drawText(roleTitle, {
          x: xPos,
          y: sigY + 20,
          size: 8.5,
          font: fontBold,
          color: rgb(0.1, 0.15, 0.25)
        });
        coverPage.drawText(subText, {
          x: xPos,
          y: sigY + 8,
          size: 7.5,
          font: fontRegular,
          color: rgb(0.45, 0.5, 0.55)
        });
      });

      // ─── 2. MERGE UPLOADED PDF DOCUMENTS & BUILD TOC ───
      const tocEntries = [];
      let currentPageNumber = 3; // Page 1 is Cover, Page 2 is TOC

      for (const item of allItems) {
        const doc = item.document;
        if (!doc || !doc.file_path) {
          tocEntries.push({
            item,
            status: 'PENDING',
            startPage: '—'
          });
          continue;
        }

        let pdfBuffer = null;
        let resolvedDiskPath = null;

        // Try local disk paths
        const cleanRelPath = String(doc.file_path).replace(/^\/+/, '');
        const candidate1 = path.resolve(__dirname, '../../uploads', cleanRelPath);
        const candidate2 = path.resolve(__dirname, '../../', cleanRelPath);
        const candidate3 = path.resolve(__dirname, '../../uploads', path.basename(cleanRelPath));

        if (fs.existsSync(candidate1)) {
          resolvedDiskPath = candidate1;
        } else if (fs.existsSync(candidate2)) {
          resolvedDiskPath = candidate2;
        } else if (fs.existsSync(candidate3)) {
          resolvedDiskPath = candidate3;
        }

        if (resolvedDiskPath) {
          try {
            pdfBuffer = fs.readFileSync(resolvedDiskPath);
          } catch (e) {
            logger.warn(`Could not read file ${resolvedDiskPath}: ${e.message}`);
          }
        } else if (String(doc.file_path).startsWith('http://') || String(doc.file_path).startsWith('https://')) {
          try {
            const resp = await fetch(doc.file_path);
            if (resp.ok) {
              const ab = await resp.arrayBuffer();
              pdfBuffer = Buffer.from(ab);
            }
          } catch (e) {
            logger.warn(`Could not fetch remote doc ${doc.file_path}: ${e.message}`);
          }
        }

        if (!pdfBuffer) {
          tocEntries.push({
            item,
            status: 'FILE NOT FOUND ON SERVER',
            startPage: '—'
          });
          continue;
        }

        try {
          const srcPdf = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
          const pageIndices = srcPdf.getPageIndices();
          if (pageIndices.length === 0) {
            tocEntries.push({ item, status: 'EMPTY DOCUMENT', startPage: '—' });
            continue;
          }

          const startPage = currentPageNumber;
          const copiedPages = await mergedPdf.copyPages(srcPdf, pageIndices);

          // Add each copied page to mergedPdf
          copiedPages.forEach((p) => {
            mergedPdf.addPage(p);
          });

          currentPageNumber += copiedPages.length;
          tocEntries.push({
            item,
            status: `✓ MERGED (${copiedPages.length} pg${copiedPages.length > 1 ? 's' : ''})`,
            startPage: String(startPage)
          });
        } catch (pdfErr) {
          logger.warn(`PDF parsing failed for ${doc.title || item.title}: ${pdfErr.message}`);
          tocEntries.push({
            item,
            status: 'UNSUPPORTED FORMAT / CORRUPT',
            startPage: '—'
          });
        }
      }

      // ─── 3. PAGE 2: TABLE OF CONTENTS & AUDIT COMPLIANCE INDEX ───
      // Insert TOC page at index 1 (between cover page and first merged document)
      const tocPage = mergedPdf.insertPage(1, [PAGE_W, PAGE_H]);

      // Header Banner
      tocPage.drawRectangle({
        x: 0,
        y: PAGE_H - 65,
        width: PAGE_W,
        height: 65,
        color: rgb(0.08, 0.22, 0.45)
      });

      tocPage.drawText('TABLE OF CONTENTS & AUDIT COMPLIANCE INDEX', {
        x: 40,
        y: PAGE_H - 38,
        size: 13,
        font: fontBold,
        color: rgb(1, 1, 1)
      });

      tocPage.drawText(sanitizePdfText(`Verified Checklist of Institutional Dossier Artifacts | Total Pages: ${mergedPdf.getPageCount()}`), {
        x: 40,
        y: PAGE_H - 53,
        size: 8.5,
        font: fontRegular,
        color: rgb(0.85, 0.92, 1)
      });

      // Table Header Row
      const tableTopY = PAGE_H - 95;
      tocPage.drawRectangle({
        x: 40,
        y: tableTopY - 18,
        width: PAGE_W - 80,
        height: 18,
        color: rgb(0.9, 0.93, 0.97)
      });

      tocPage.drawText('SEQ #', { x: 45, y: tableTopY - 13, size: 8, font: fontBold, color: rgb(0.1, 0.15, 0.25) });
      tocPage.drawText('DOCUMENT / ARTIFACT TITLE', { x: 80, y: tableTopY - 13, size: 8, font: fontBold, color: rgb(0.1, 0.15, 0.25) });
      tocPage.drawText('MODULE', { x: 280, y: tableTopY - 13, size: 8, font: fontBold, color: rgb(0.1, 0.15, 0.25) });
      tocPage.drawText('STATUS / FILE DETAILS', { x: 380, y: tableTopY - 13, size: 8, font: fontBold, color: rgb(0.1, 0.15, 0.25) });
      tocPage.drawText('PAGE', { x: 515, y: tableTopY - 13, size: 8, font: fontBold, color: rgb(0.1, 0.15, 0.25) });

      // Render TOC rows (limit to 32 rows on page 2)
      let curY = tableTopY - 34;
      tocEntries.slice(0, 32).forEach((entry, idx) => {
        const it = entry.item;
        const isUploaded = entry.status.startsWith('✓') || entry.status.startsWith('[OK]');

        // Alternating row background
        if (idx % 2 === 1) {
          tocPage.drawRectangle({
            x: 40,
            y: curY - 3,
            width: PAGE_W - 80,
            height: 14,
            color: rgb(0.98, 0.99, 1.0)
          });
        }

        tocPage.drawText(String(idx + 1).padStart(2, '0'), {
          x: 45,
          y: curY,
          size: 7.5,
          font: fontBold,
          color: rgb(0.3, 0.35, 0.4)
        });

        const truncTitle = it.title.length > 38 ? it.title.substring(0, 35) + '...' : it.title;
        tocPage.drawText(sanitizePdfText(truncTitle), {
          x: 80,
          y: curY,
          size: 8,
          font: isUploaded ? fontBold : fontRegular,
          color: isUploaded ? rgb(0.08, 0.22, 0.45) : rgb(0.35, 0.4, 0.45)
        });

        const modLbl = (it.module_label || 'Course File').substring(0, 18);
        tocPage.drawText(sanitizePdfText(modLbl), {
          x: 280,
          y: curY,
          size: 7.5,
          font: fontRegular,
          color: rgb(0.4, 0.45, 0.5)
        });

        tocPage.drawText(sanitizePdfText(entry.status), {
          x: 380,
          y: curY,
          size: 7.5,
          font: fontBold,
          color: isUploaded ? rgb(0.1, 0.5, 0.2) : rgb(0.7, 0.35, 0.05)
        });

        tocPage.drawText(sanitizePdfText(entry.startPage), {
          x: 520,
          y: curY,
          size: 8,
          font: fontBold,
          color: isUploaded ? rgb(0.08, 0.22, 0.45) : rgb(0.6, 0.65, 0.7)
        });

        curY -= 15;
      });

      // Save Merged PDF Bytes
      const mergedPdfBytes = await mergedPdf.save();

      // Format download filename
      const cleanSubCode = (group.subject_code || 'IT500').replace(/[^a-zA-Z0-9_-]/g, '_');
      const cleanType = scope === 'all' ? 'All_Modules_Consolidated_Dossier' : `${type.toUpperCase()}_Academic_Dossier`;
      const exportFilename = `${cleanSubCode}_${cleanType}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${exportFilename}"`);
      res.setHeader('Content-Length', mergedPdfBytes.length);

      return res.send(Buffer.from(mergedPdfBytes));
    } catch (err) {
      logger.error('[CourseFileController] mergeExport error:', { error: err.message, stack: err.stack });
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message: `Merge export failed: ${err.message}` }
      });
    }
  }

  /**
   * Uploads an artifact file for any dossier module (theory, lab, nba, performance, direct, indirect).
   * @route POST /api/v1/course-files/:id/documents
   */
  async uploadDocument(req, res) {
    try {
      const courseFileId = parseInt(req.params.id, 10);
      const { item_key, title, notes } = req.body;
      const type = (req.query.type || 'nba').toLowerCase();

      if (!req.file) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No document file uploaded' } });
      }
      if (!item_key) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'item_key is required' } });
      }

      const filePath = `/uploads/course_files/${req.file.filename}`;
      const fileName = req.file.originalname;
      const fileSize = req.file.size;
      const mimeType = req.file.mimetype;
      const docTitle = title || item_key.replace(/_/g, ' ').toUpperCase();

      // Handle based on type
      if (type === 'theory') {
        const { doc, oldFilePath } = await theoryClassModel.upsertDocument({
          theoryClassId: courseFileId,
          itemKey: item_key,
          docTitle,
          filePath,
          fileName,
          fileSize,
          mimeType,
          userId: req.user.id,
          notes
        });
        if (oldFilePath) {
          try {
            const oldDisk = path.join(__dirname, '../../', oldFilePath);
            if (fs.existsSync(oldDisk)) fs.unlinkSync(oldDisk);
          } catch (_) {}
        }
        return res.status(201).json({ success: true, data: doc, message: `${docTitle} uploaded successfully` });
      }

      if (type === 'lab') {
        const { doc, oldFilePath } = await labClassModel.upsertDocument({
          labClassId: courseFileId,
          itemKey: item_key,
          docTitle,
          filePath,
          fileName,
          fileSize,
          mimeType,
          userId: req.user.id,
          notes
        });
        if (oldFilePath) {
          try {
            const oldDisk = path.join(__dirname, '../../', oldFilePath);
            if (fs.existsSync(oldDisk)) fs.unlinkSync(oldDisk);
          } catch (_) {}
        }
        return res.status(201).json({ success: true, data: doc, message: `${docTitle} uploaded successfully` });
      }

      if (type === 'performance') {
        const { doc, oldFilePath } = await studentPerformanceModel.upsertDocument({
          performanceFileId: courseFileId,
          itemKey: item_key,
          docTitle,
          filePath,
          fileName,
          fileSize,
          mimeType,
          userId: req.user.id,
          notes
        });
        if (oldFilePath) {
          try {
            const oldDisk = path.join(__dirname, '../../', oldFilePath);
            if (fs.existsSync(oldDisk)) fs.unlinkSync(oldDisk);
          } catch (_) {}
        }
        return res.status(201).json({ success: true, data: doc, message: `${docTitle} uploaded successfully` });
      }

      if (type === 'direct' || type === 'indirect') {
        const { doc, oldFilePath } = await assessmentProcessModel.upsertDocument({
          assessmentFileId: courseFileId,
          itemKey: item_key,
          docTitle,
          filePath,
          fileName,
          fileSize,
          mimeType,
          userId: req.user.id,
          notes
        });
        if (oldFilePath) {
          try {
            const oldDisk = path.join(__dirname, '../../', oldFilePath);
            if (fs.existsSync(oldDisk)) fs.unlinkSync(oldDisk);
          } catch (_) {}
        }
        return res.status(201).json({ success: true, data: doc, message: `${docTitle} uploaded successfully` });
      }

      // Default: NBA Course File
      const cf = await courseFileModel.getById(courseFileId);
      if (!cf) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Course file dossier not found' } });
      }

      const isTeacher = req.user.teacher_id && req.user.teacher_id === cf.teacher_id;
      const isHod = req.user.roles?.includes('HOD') || req.user.roles?.includes('DEPT_HEAD');
      const isAdmin = req.user.roles?.includes('SYSTEM_ADMIN');

      if (!isTeacher && !isHod && !isAdmin) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to modify this course file' } });
      }

      const { doc, oldFilePath } = await courseFileModel.upsertDocument({
        courseFileId,
        itemKey: item_key,
        docTitle,
        filePath,
        fileName,
        fileSize,
        mimeType,
        userId: req.user.id,
        notes
      });

      if (oldFilePath) {
        try {
          const oldDiskPath = path.join(__dirname, '../../', oldFilePath);
          if (fs.existsSync(oldDiskPath)) fs.unlinkSync(oldDiskPath);
        } catch (_) {}
      }

      await auditService.logAudit({
        eventType: 'COURSE_FILE_DOCUMENT_UPLOADED',
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'TEACHER',
        targetType: 'course_files',
        targetId: courseFileId,
        details: { item_key, fileName, fileSize }
      });

      return res.status(201).json({
        success: true,
        data: doc,
        message: `${docTitle} uploaded successfully`
      });
    } catch (err) {
      logger.error('[CourseFileController] uploadDocument error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Deletes an uploaded document artifact.
   * @route DELETE /api/v1/course-files/:id/documents/:item_key
   */
  async deleteDocument(req, res) {
    try {
      const courseFileId = parseInt(req.params.id, 10);
      const itemKey = req.params.item_key;
      const type = (req.query.type || 'nba').toLowerCase();

      if (type === 'theory') {
        const deleted = await theoryClassModel.deleteDocument(courseFileId, itemKey);
        return res.json({ success: true, message: `Document ${itemKey} removed` });
      }
      if (type === 'lab') {
        const deleted = await labClassModel.deleteDocument(courseFileId, itemKey);
        return res.json({ success: true, message: `Document ${itemKey} removed` });
      }
      if (type === 'performance') {
        const deleted = await studentPerformanceModel.deleteDocument(courseFileId, itemKey);
        return res.json({ success: true, message: `Document ${itemKey} removed` });
      }
      if (type === 'direct' || type === 'indirect') {
        const deleted = await assessmentProcessModel.deleteDocument(courseFileId, itemKey);
        return res.json({ success: true, message: `Document ${itemKey} removed` });
      }

      const deleted = await courseFileModel.deleteDocument(courseFileId, itemKey);
      if (!deleted) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Document artifact not found' } });
      }

      if (deleted.file_path) {
        try {
          const diskPath = path.join(__dirname, '../../', deleted.file_path);
          if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
        } catch (_) {}
      }

      await auditService.logAudit({
        eventType: 'COURSE_FILE_DOCUMENT_DELETED',
        actorId: req.user.id,
        actorRole: req.user.roles?.[0] || 'TEACHER',
        targetType: 'course_files',
        targetId: courseFileId,
        details: { item_key: itemKey }
      });

      return res.json({ success: true, message: `Document ${itemKey} removed successfully` });
    } catch (err) {
      logger.error('[CourseFileController] deleteDocument error:', { error: err.message });
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  async updateEvaluationScheme(req, res) {
    try {
      const courseFileId = parseInt(req.params.id, 10);
      const scheme = req.body;
      await courseFileModel.updateEvaluationScheme(courseFileId, scheme);
      return res.json({ success: true, message: 'Evaluation scheme updated' });
    } catch (err) {
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  async updateStructuredData(req, res) {
    try {
      const courseFileId = parseInt(req.params.id, 10);
      const { type, data } = req.body;
      await courseFileModel.updateStructuredData(courseFileId, type, data);
      return res.json({ success: true, message: `${type} updated successfully` });
    } catch (err) {
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  async auditCourseFile(req, res) {
    try {
      const courseFileId = parseInt(req.params.id, 10);
      const { status, remarks } = req.body;
      const validStatuses = ['IN_PROGRESS', 'SUBMITTED', 'AUDITED', 'APPROVED', 'REVISION_REQUESTED'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: `Status must be one of: ${validStatuses.join(', ')}` }
        });
      }
      await courseFileModel.auditCourseFile(courseFileId, status, remarks, req.user.id);
      return res.json({
        success: true,
        message: `Course file marked as ${status}`,
        data: { status, remarks, audited_at: new Date().toISOString() }
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = new CourseFileController();
