/**
 * Course File Preparation Routes (/api/v1/course-files/*)
 * Milestone 163: Institutional NBA/NAAC Course File Dossier System
 * Delegates request processing to CourseFileController.
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { makeUploader } = require('../middleware/upload');
const courseFileController = require('../controllers/courseFileController');

const uploadCourseFile = makeUploader('course_files');

router.use(auth);

// @route   GET /api/v1/course-files/definitions
// @desc    Return standard 18 items schema definitions
// @access  Protected (All Authenticated Users)
// @handler CourseFileController.getDefinitions() -> CourseFileModel.getItemsDefinition()
router.get('/definitions', (req, res) => courseFileController.getDefinitions(req, res));

// @route   GET /api/v1/course-files
// @desc    Fetch or auto-provision course file dossier for a teaching group
// @access  Protected (All Authenticated Users)
// @handler CourseFileController.getCourseFile() -> CourseFileModel.getOrCreateCourseFile()
router.get('/', (req, res) => courseFileController.getCourseFile(req, res));

// @route   POST /api/v1/course-files/:id/documents
// @desc    Upload a document for one of the 18 Course File artifacts
// @access  Protected (Faculty/HOD/Admin)
// @handler CourseFileController.uploadDocument() -> CourseFileModel.upsertDocument()
router.post('/:id/documents', uploadCourseFile.single('file'), (req, res) => courseFileController.uploadDocument(req, res));

// @route   DELETE /api/v1/course-files/:id/documents/:item_key
// @desc    Remove an uploaded document from the course file
// @access  Protected (Faculty/HOD/Admin)
// @handler CourseFileController.deleteDocument() -> CourseFileModel.deleteDocument()
router.delete('/:id/documents/:item_key', (req, res) => courseFileController.deleteDocument(req, res));

// @route   PUT /api/v1/course-files/:id/evaluation-scheme
// @desc    Save internal assessment plan evaluation criteria
// @access  Protected (Faculty/HOD/Admin)
// @handler CourseFileController.updateEvaluationScheme() -> CourseFileModel.updateEvaluationScheme()
router.put('/:id/evaluation-scheme', (req, res) => courseFileController.updateEvaluationScheme(req, res));

// @route   PUT /api/v1/course-files/:id/structured-data
// @desc    Update Course Outcomes (COs), CO-PO matrix, or learner notes
// @access  Protected (Faculty/HOD/Admin)
// @handler CourseFileController.updateStructuredData() -> CourseFileModel.updateStructuredData()
router.put('/:id/structured-data', (req, res) => courseFileController.updateStructuredData(req, res));

// @route   POST /api/v1/course-files/:id/audit
// @desc    HOD / Auditor approves or requests revision on the Course File
// @access  Protected (HOD, DEPT_HEAD, SYSTEM_ADMIN)
// @handler CourseFileController.auditCourseFile() -> CourseFileModel.auditCourseFile()
router.post('/:id/audit', requireRole('HOD', 'DEPT_HEAD', 'SYSTEM_ADMIN'), (req, res) => courseFileController.auditCourseFile(req, res));

module.exports = router;
