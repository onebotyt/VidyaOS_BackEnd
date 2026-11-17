/**
 * Student Records Express Router
 * Defines routes for querying student records, dossiers, and exports
 * Base URL: /api/v1/student-records
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const StudentRecordController = require('../controllers/studentRecordController');

// All student records routes require TEACHER or SYSTEM_ADMIN authentication
router.use(auth, requireRole('TEACHER', 'SYSTEM_ADMIN'));

// @route   GET /api/v1/student-records/filters
// @desc    Retrieve filter options (Sessions, Years, Semesters, Batches)
router.get('/filters', StudentRecordController.getFilters);

// @route   GET /api/v1/student-records/export
// @desc    Retrieve cohort records for export (PDF, DOC, Excel)
router.get('/export', StudentRecordController.exportCohort);

// @route   GET /api/v1/student-records/:id/dossier
// @desc    Retrieve a single student's complete historical dossier (Profile, Tests, Assignments, Attendance, Documents)
router.get('/:id/dossier', StudentRecordController.getStudentDossier);

// @route   GET /api/v1/student-records
// @desc    Retrieve paginated student records matching filters
router.get('/', StudentRecordController.getStudents);

module.exports = router;
