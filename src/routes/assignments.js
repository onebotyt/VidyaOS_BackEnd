/**
 * Assignment Routes (/api/v1/assignments/*)
 * Delegates request processing to AssignmentController.
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { makeUploader } = require('../middleware/upload');
const assignmentController = require('../controllers/assignmentController');

const uploadAttachment = makeUploader('assignments');
const uploadSubmission = makeUploader('submissions');

router.use(auth);

// @route   POST /api/v1/assignments
// @desc    Teacher/Admin: Create a coursework assignment
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler AssignmentController.createAssignment() -> AssignmentModel.create()
router.post(
  '/',
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  uploadAttachment.single('attachment'),
  [
    body('title').trim().isLength({ min: 2 }).withMessage('Title is required'),
    body('department_id').isInt(),
    body('year').isInt(),
    body('semester').isInt(),
    body('academic_year_id').isInt(),
    validate
  ],
  (req, res) => assignmentController.createAssignment(req, res)
);

// @route   GET /api/v1/assignments
// @desc    List assignments for authenticated student or faculty
// @access  Protected (All Authenticated Users)
// @handler AssignmentController.listAssignments() -> AssignmentModel.listForStudent() / AssignmentModel.listForTeacher()
router.get('/', (req, res) => assignmentController.listAssignments(req, res));

// @route   GET /api/v1/assignments/:id/submissions
// @desc    Teacher/Admin: View submissions roster for an assignment
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler AssignmentController.getSubmissions() -> AssignmentModel.getSubmissionsRoster()
router.get('/:id/submissions', requireRole('TEACHER', 'SYSTEM_ADMIN'), (req, res) => assignmentController.getSubmissions(req, res));

// @route   POST /api/v1/assignments/upload-document
// @desc    Upload an arbitrary document attachment
// @access  Protected (STUDENT, TEACHER, SYSTEM_ADMIN)
// @handler AssignmentController.uploadDocument()
router.post('/upload-document', requireRole('STUDENT', 'TEACHER', 'SYSTEM_ADMIN'), uploadSubmission.single('file'), (req, res) => assignmentController.uploadDocument(req, res));

// @route   POST /api/v1/assignments/:id/submit
// @desc    Student: Submit file for assignment
// @access  Protected (STUDENT)
// @handler AssignmentController.submitAssignment() -> AssignmentModel.upsertSubmission()
router.post('/:id/submit', requireRole('STUDENT'), uploadSubmission.single('file'), (req, res) => assignmentController.submitAssignment(req, res));

// @route   POST /api/v1/assignments/:id/submit-final-docs
// @desc    Student: Finalize and submit all required final documents
// @access  Protected (STUDENT)
// @handler AssignmentController.submitFinalDocs() -> AssignmentModel.upsertSubmission()
router.post('/:id/submit-final-docs', requireRole('STUDENT'), (req, res) => assignmentController.submitFinalDocs(req, res));

// @route   POST /api/v1/assignments/:id/unsubmit
// @desc    Student: Unsubmit assignment to withdraw submission
// @access  Protected (STUDENT)
// @handler AssignmentController.unsubmitAssignment() -> AssignmentModel.deleteSubmission()
router.post('/:id/unsubmit', requireRole('STUDENT'), (req, res) => assignmentController.unsubmitAssignment(req, res));

// @route   PUT /api/v1/assignments/submissions/:submissionId/grade
// @desc    Teacher/Admin: Grade submission and record feedback
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler AssignmentController.gradeSubmission() -> AssignmentModel.gradeSubmission()
router.put('/submissions/:submissionId/grade', requireRole('TEACHER', 'SYSTEM_ADMIN'), (req, res) => assignmentController.gradeSubmission(req, res));

// @route   DELETE /api/v1/assignments/:id
// @desc    Teacher/Admin: Delete an assignment and related submissions
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler AssignmentController.deleteAssignment() -> AssignmentModel.deleteAssignment()
router.delete('/:id', requireRole('TEACHER', 'SYSTEM_ADMIN'), (req, res) => assignmentController.deleteAssignment(req, res));

module.exports = router;
