/**
 * ══════════════════════════════════════════════════════════════
 * HOD-FACULTY ARCHIVE CONTROLLER (hod-faculty-archive.js)
 * Shared Controller for Student Alumni & Passout Archive
 * Base Routes:
 *   - GET /api/v1/hod/archive/batches
 *   - GET /api/v1/hod/archive
 * Access: TEACHER, FACULTY, HOD, SYSTEM_ADMIN
 * ══════════════════════════════════════════════════════════════
 */

const HodModel = require('../models/hodModel');

function resolveHodDeptId(req) {
  let deptId = req.hod_department_id || req.user?.department_id || req.user?.hod_department_id || req.query?.department_id;
  if (!deptId && req.user?.roles?.includes('SYSTEM_ADMIN')) {
    return req.query?.department_id || null;
  }
  return deptId || null;
}

class HodFacultyArchiveController {
  /**
   * List distinct graduation years for alumni students in department
   * @route GET /api/v1/hod/archive/batches
   * @access Protected (TEACHER, HOD, FACULTY, SYSTEM_ADMIN)
   */
  static async getArchiveBatches(req, res) {
    try {
      const deptId = resolveHodDeptId(req);
      const batches = await HodModel.getArchiveBatches(deptId);
      res.json({ success: true, data: batches });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }

  /**
   * Retrieve archived alumni students with lifetime attendance stats and KPI metrics
   * @route GET /api/v1/hod/archive
   * @access Protected (TEACHER, HOD, FACULTY, SYSTEM_ADMIN)
   */
  static async getArchive(req, res) {
    try {
      const deptId = resolveHodDeptId(req);
      const result = await HodModel.getArchive(deptId, req.query);
      res.json({
        success: true,
        data: result.students,
        kpis: result.kpis
      });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = HodFacultyArchiveController;
