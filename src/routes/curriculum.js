/**
 * Curriculum Routes — IRDT Uttarakhand Syllabus Integration
 * Base: /api/v1/curriculum
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const curriculumService = require('../services/curriculumService');
const { query } = require('../config/db');
const logger = require('../utils/logger');

/**
 * GET /api/v1/curriculum/booklets
 * Returns official IRDT booklet registry (PDF links) for all 6 departments.
 * Public — no authentication required (links are from the IRDT website).
 */
router.get('/booklets', function(req, res) {
  try {
    var registry = curriculumService.getBookletRegistry();
    res.json({ success: true, data: registry });
  } catch (err) {
    logger.error('[Curriculum] booklets error:', { error: err.message });
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

/**
 * GET /api/v1/curriculum/booklets/:deptCode
 * Returns booklet links for a specific department code (e.g. IT, CE, PHARM).
 */
router.get('/booklets/:deptCode', function(req, res) {
  try {
    var code = (req.params.deptCode || '').toUpperCase();
    var newUrl = curriculumService.getBookletUrl(code, 'new');
    var oldUrl = curriculumService.getBookletUrl(code, 'old');
    if (!newUrl && !oldUrl) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No booklet found for department: ' + code } });
    }
    res.json({
      success: true,
      data: {
        dept_code: code,
        new_scheme: { label: curriculumService.IRDT_BOOKLETS.new.label, url: newUrl },
        old_scheme: { label: curriculumService.IRDT_BOOKLETS.old.label, url: oldUrl }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/curriculum/seed
 * Admin-only: Seeds IRDT standard subjects into the database.
 * Body: { dept_code: 'IT' }  — optional, seeds all if omitted.
 * Body: { scheme: '2026-27' } — optional, defaults to '2026-27'.
 */
router.post('/seed', auth, requireRole('SYSTEM_ADMIN'), async function(req, res) {
  try {
    var deptCode = req.body.dept_code;
    var scheme = req.body.scheme || '2026-27';

    if (deptCode) {
      var depts = await query('SELECT id FROM departments WHERE code = ? AND is_active = 1', [deptCode.toUpperCase()]);
      if (!depts || !depts.length) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Department not found: ' + deptCode } });
      }
      var deptId = depts[0].id;
      await curriculumService.ensureSyllabusSchemeColumn();
      var count = await curriculumService.seedDepartmentSubjects(deptId, deptCode, scheme);
      return res.json({ success: true, data: { seeded: count, dept_code: deptCode, scheme: scheme } });
    }

    var total = await curriculumService.seedAllCurriculumSubjects(scheme);
    res.json({ success: true, data: { seeded: total, scheme: scheme } });
  } catch (err) {
    logger.error('[Curriculum] seed error:', { error: err.message });
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;
