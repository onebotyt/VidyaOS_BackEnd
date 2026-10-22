/**
 * Teaching Groups REST API Routes (/api/v1/teaching-groups/*)
 * Pure declarative router delegating to TeachingGroupController.
 *
 * Architecture Role: Router (Routing Layer)
 * Interacts With:
 *   - Controllers: controllers/teachingGroupController.js
 *   - Models: models/teachingGroupModel.js
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requireTeachingGroupOwner } = require('../middleware/requireScope');
const validate = require('../middleware/validate');
const { makeUploader } = require('../middleware/upload');
const TeachingGroupController = require('../controllers/teachingGroupController');

const uploadStream = makeUploader('stream', 100);

// ==========================================
// Overview & Group Listings
// ==========================================

// @route   GET /api/v1/teaching-groups/overview
// @desc    Retrieve faculty overview stats (classes, recent work, attendance rates)
// @access  Protected (Authenticated)
// @handler TeachingGroupController.getOverview() -> TeachingGroupModel.getOverviewData()
router.get('/overview', auth, TeachingGroupController.getOverview);

// @route   GET /api/v1/teaching-groups
// @desc    List all teaching groups accessible to user (ACTIVE, ARCHIVED, or TRASH)
// @access  Protected (Authenticated)
// @handler TeachingGroupController.listGroups() -> TeachingGroupModel.listGroups()
router.get(['/', '/teacher/my-groups', '/my-groups'], auth, TeachingGroupController.listGroups);

// ==========================================
// Group Creation
// ==========================================

// @route   POST /api/v1/teaching-groups
// @desc    Create a new teaching group with linked official attendance register
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler TeachingGroupController.createGroup() -> TeachingGroupModel.createGroupTransaction()
router.post(
  '/',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Group name required (2-100 chars)'),
    body('subject_name').trim().isLength({ min: 2, max: 100 }).withMessage('Subject name required (2-100 chars)'),
    body('subject_code').optional().trim(),
    body('component').optional().isIn(['THEORY', 'PRACTICAL', 'THEORY_PRACTICAL']).withMessage('Component must be THEORY, PRACTICAL, or THEORY_PRACTICAL'),
    body('semester').isInt({ min: 1, max: 6 }).withMessage('Semester must be between 1 and 6'),
    body('enrollment_mode').optional().isIn(['INVITE_CODE', 'COHORT']).withMessage('Enrollment mode must be INVITE_CODE or COHORT'),
    body('department_id').optional({ nullable: true }).isInt(),
    body('academic_year_id').optional().isInt(),
    validate
  ],
  TeachingGroupController.createGroup
);

// ==========================================
// Student Self-Service & Enrollment
// ==========================================

// @route   POST /api/v1/teaching-groups/join
// @desc    Join a teaching group via 6-character invite code
// @access  Protected (STUDENT)
// @handler TeachingGroupController.joinGroup() -> TeachingGroupModel.findGroupByInviteCode(), TeachingGroupModel.addMember()
router.post(
  '/join',
  auth,
  requireRole('STUDENT'),
  [
    body('invite_code').trim().isLength({ min: 4, max: 10 }).withMessage('Valid invite code required'),
    validate
  ],
  TeachingGroupController.joinGroup
);

// @route   GET /api/v1/teaching-groups/student/my-groups
// @desc    Retrieve all teaching groups the student is enrolled in
// @access  Protected (STUDENT)
// @handler TeachingGroupController.getStudentGroups() -> TeachingGroupModel.getStudentEnrolledGroups()
router.get('/student/my-groups', auth, requireRole('STUDENT'), TeachingGroupController.getStudentGroups);

// ==========================================
// Group Details & Members Management
// ==========================================

// @route   GET /api/v1/teaching-groups/:id
// @desc    Retrieve teaching group profile, linked register, and members
// @access  Protected (Authenticated)
// @handler TeachingGroupController.getGroupDetails() -> TeachingGroupModel.getGroupById(), TeachingGroupModel.getGroupMembers()
router.get('/:id', auth, TeachingGroupController.getGroupDetails);

// @route   PUT /api/v1/teaching-groups/:id
// @desc    Update teaching group name, subject, or component
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler TeachingGroupController.editGroup() -> TeachingGroupModel.updateGroup()
router.put(
  '/:id',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('name').optional().trim().isLength({ min: 2, max: 100 }),
    body('subject_name').optional().trim().isLength({ min: 2, max: 100 }),
    body('component').optional().isIn(['THEORY', 'PRACTICAL', 'THEORY_PRACTICAL']),
    validate
  ],
  TeachingGroupController.editGroup
);

// @route   GET /api/v1/teaching-groups/:id/members
// @desc    Retrieve enrolled students list for a teaching group
// @access  Protected (Authenticated)
// @handler TeachingGroupController.getMembers() -> TeachingGroupModel.getGroupMembers()
router.get('/:id/members', auth, TeachingGroupController.getMembers);

// @route   POST /api/v1/teaching-groups/:id/members
// @desc    Manually add student(s) to teaching group by IDs or enrollment number
// @access  Protected (TEACHER, SYSTEM_ADMIN, TeachingGroupOwner)
// @handler TeachingGroupController.addMembers() -> TeachingGroupModel.addMember()
router.post('/:id/members', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), requireTeachingGroupOwner('id'), TeachingGroupController.addMembers);

// @route   DELETE /api/v1/teaching-groups/:id/members/:studentId
// @desc    Remove a student from a teaching group
// @access  Protected (TEACHER, SYSTEM_ADMIN, TeachingGroupOwner)
// @handler TeachingGroupController.removeMember() -> TeachingGroupModel.removeMember()
router.delete('/:id/members/:studentId', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), requireTeachingGroupOwner('id'), TeachingGroupController.removeMember);

// @route   GET /api/v1/teaching-groups/:id/unenrolled-students
// @desc    Find students in the cohort who have not yet joined this teaching group
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler TeachingGroupController.getUnenrolledStudents() -> TeachingGroupModel.getUnenrolledStudents()
router.get('/:id/unenrolled-students', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), TeachingGroupController.getUnenrolledStudents);

// ==========================================
// Lifecycle: Archive, Trash, Restore, Delete, Promote
// ==========================================

// @route   POST /api/v1/teaching-groups/:id/archive
// @desc    Archive teaching group and deactivate linked register
// @access  Protected (Authenticated: Owner, Admin, HOD)
// @handler TeachingGroupController.archiveGroup() -> TeachingGroupModel.setArchiveStatus()
router.post('/:id/archive', auth, TeachingGroupController.archiveGroup);

// @route   POST /api/v1/teaching-groups/:id/unarchive
// @desc    Restore archived teaching group back to active status
// @access  Protected (Authenticated: Owner, Admin, HOD)
// @handler TeachingGroupController.unarchiveGroup() -> TeachingGroupModel.setArchiveStatus()
router.post('/:id/unarchive', auth, TeachingGroupController.unarchiveGroup);

// @route   POST /api/v1/teaching-groups/:id/trash
// @desc    Move teaching group to 7-day recoverable Trash Bin
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler TeachingGroupController.trashGroup() -> TeachingGroupModel.setTrashStatus()
router.post(['/:id/trash', '/:id/delete'], auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), TeachingGroupController.trashGroup);
router.delete('/:id', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), TeachingGroupController.trashGroup);

// @route   POST /api/v1/teaching-groups/:id/restore
// @desc    Restore soft-deleted teaching group from Trash Bin
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler TeachingGroupController.restoreGroup() -> TeachingGroupModel.setTrashStatus()
router.post('/:id/restore', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), TeachingGroupController.restoreGroup);

// @route   DELETE /api/v1/teaching-groups/:id/permanent
// @desc    Permanently delete teaching group while preserving historical attendance
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler TeachingGroupController.permanentDelete() -> TeachingGroupModel.permanentDeleteGroupTransaction()
router.delete('/:id/permanent', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), TeachingGroupController.permanentDelete);

// @route   POST /api/v1/teaching-groups/:id/promote
// @desc    Promote cohort to next semester teaching group and archive current group
// @access  Protected (TEACHER, SYSTEM_ADMIN, TeachingGroupOwner)
// @handler TeachingGroupController.promoteCohort() -> TeachingGroupModel.promoteCohortTransaction()
router.post(
  '/:id/promote',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  requireTeachingGroupOwner('id'),
  [
    body('new_name').trim().isLength({ min: 2, max: 100 }).withMessage('New group name required'),
    body('new_semester').isInt({ min: 1, max: 6 }).withMessage('Valid next semester (1-6) required'),
    body('student_ids').isArray().withMessage('Array of selected student_ids required'),
    validate
  ],
  TeachingGroupController.promoteCohort
);

// @route   POST /api/v1/teaching-groups/broadcast-notice
// @desc    Broadcast announcement to multiple teaching groups and student notifications
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler TeachingGroupController.broadcastNotice() -> TeachingGroupModel.createStreamPost()
router.post(
  '/broadcast-notice',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('title').trim().isLength({ min: 2, max: 200 }).withMessage('Notice title required (2-200 chars)'),
    body('content').trim().isLength({ min: 5, max: 3000 }).withMessage('Notice content required (5-3000 chars)'),
    validate
  ],
  TeachingGroupController.broadcastNotice
);

// @route   POST /api/v1/teaching-groups/auto-archive-expired
// @desc    Automatically archive active teaching groups belonging to closed academic years
// @access  Protected (Authenticated)
// @handler TeachingGroupController.autoArchiveExpired() -> TeachingGroupModel.autoArchiveExpiredGroups()
router.post('/auto-archive-expired', auth, TeachingGroupController.autoArchiveExpired);

// ==========================================
// Stream & Comments
// ==========================================

// @route   GET /api/v1/teaching-groups/:id/stream
// @desc    Retrieve classroom stream announcements and attachments
// @access  Protected (Authenticated)
// @handler TeachingGroupController.getStreamPosts() -> TeachingGroupModel.getStreamPosts()
router.get('/:id/stream', auth, TeachingGroupController.getStreamPosts);

// @route   POST /api/v1/teaching-groups/:id/stream
// @desc    Publish a message or attachment to classroom stream
// @access  Protected (Authenticated)
// @handler TeachingGroupController.createStreamPost() -> TeachingGroupModel.createStreamPost()
router.post(
  '/:id/stream',
  auth,
  (req, res, next) => {
    const ct = req.headers['content-type'] || '';
    if (ct.includes('multipart/form-data')) {
      uploadStream.single('attachment')(req, res, (err) => {
        if (err) {
          return res.status(400).json({ success: false, error: { code: 'UPLOAD_ERROR', message: err.message } });
        }
        if (req.file && (!req.body.content || !req.body.content.trim())) {
          req.body.content = req.file.originalname;
        }
        next();
      });
    } else {
      next();
    }
  },
  [
    body('content').trim().isLength({ min: 1, max: 2000 }).withMessage('Post content required (1-2000 chars)'),
    validate
  ],
  TeachingGroupController.createStreamPost
);

// @route   DELETE /api/v1/teaching-groups/:id/stream/:postId
// @desc    Delete an announcement from classroom stream
// @access  Protected (Authenticated)
// @handler TeachingGroupController.deleteStreamPost() -> TeachingGroupModel.deleteStreamPost()
router.delete('/:id/stream/:postId', auth, TeachingGroupController.deleteStreamPost);

// @route   GET /api/v1/teaching-groups/posts/:postId/comments
// @desc    Retrieve discussion comments for a stream post
// @access  Protected (Authenticated)
// @handler TeachingGroupController.getPostComments() -> TeachingGroupModel.getPostComments()
router.get(['/posts/:postId/comments', '/:id/stream/:postId/comments', '/:id/posts/:postId/comments'], auth, TeachingGroupController.getPostComments);

// @route   POST /api/v1/teaching-groups/posts/:postId/comments
// @desc    Add a comment to a stream post
// @access  Protected (Authenticated)
// @handler TeachingGroupController.createPostComment() -> TeachingGroupModel.createPostComment()
router.post(
  ['/posts/:postId/comments', '/:id/stream/:postId/comments', '/:id/posts/:postId/comments'],
  auth,
  [
    body('content').trim().isLength({ min: 1, max: 1000 }).withMessage('Comment content required (1-1000 chars)'),
    validate
  ],
  TeachingGroupController.createPostComment
);

// ==========================================
// Coursework & Assignments
// ==========================================

// @route   GET /api/v1/teaching-groups/:id/assignments
// @desc    Retrieve coursework items (assignments, practicals, final docs)
// @access  Protected (Authenticated)
// @handler TeachingGroupController.getAssignments() -> TeachingGroupModel.getGroupAssignments()
router.get('/:id/assignments', auth, TeachingGroupController.getAssignments);

// @route   POST /api/v1/teaching-groups/:id/assignments
// @desc    Publish a new coursework item to teaching group
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler TeachingGroupController.createAssignment() -> TeachingGroupModel.createGroupAssessment()
router.post(
  '/:id/assignments',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('title').trim().isLength({ min: 2, max: 200 }).withMessage('Title required'),
    body('type').optional().isIn(['ASSIGNMENT', 'PRACTICAL', 'FINAL_DOCS']).withMessage('Invalid work type'),
    validate
  ],
  TeachingGroupController.createAssignment
);

// @route   PUT /api/v1/teaching-groups/:id/assignments/:assignmentId
// @desc    Update coursework item title, description, or due date
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler TeachingGroupController.editAssignment() -> TeachingGroupModel.updateGroupAssessment()
router.put('/:id/assignments/:assignmentId', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), TeachingGroupController.editAssignment);

// @route   GET /api/v1/teaching-groups/:id/assignments/:assignmentId/submissions
// @desc    Retrieve student submission roster for a coursework item
// @access  Protected (Authenticated)
// @handler TeachingGroupController.getAssignmentSubmissions() -> TeachingGroupModel.getAssessmentSubmissionsRoster()
router.get(['/:id/assignments/:assignmentId/submissions', '/:id/assignments/:assignmentId/scores'], auth, TeachingGroupController.getAssignmentSubmissions);

// @route   POST /api/v1/teaching-groups/:id/assignments/:assignmentId/scores
// @desc    Save student marks and feedback for a coursework item
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler TeachingGroupController.saveAssignmentScores() -> TeachingGroupModel.saveAssignmentScoresTransaction()
router.post(
  '/:id/assignments/:assignmentId/scores',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('scores').isArray().withMessage('scores array is required'),
    validate
  ],
  TeachingGroupController.saveAssignmentScores
);

// @route   DELETE /api/v1/teaching-groups/:id/assignments/:assignmentId
// @desc    Delete a coursework assignment and its submissions
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler TeachingGroupController.deleteAssignment() -> TeachingGroupModel.deleteAssessment()
router.delete('/:id/assignments/:assignmentId', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), TeachingGroupController.deleteAssignment);

// ==========================================
// Class Tests / Exams
// ==========================================

// @route   GET /api/v1/teaching-groups/:id/tests
// @desc    Retrieve scheduled class tests with average scores and pass rates
// @access  Protected (Authenticated)
// @handler TeachingGroupController.getTests() -> TeachingGroupModel.getGroupTests()
router.get('/:id/tests', auth, TeachingGroupController.getTests);

// @route   POST /api/v1/teaching-groups/:id/tests
// @desc    Schedule a new unit test / exam with question distributions
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler TeachingGroupController.scheduleTest() -> TeachingGroupModel.createGroupAssessment()
router.post(
  '/:id/tests',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('name').trim().isLength({ min: 2, max: 200 }).withMessage('Test name required'),
    body('max_marks').optional().isFloat({ min: 1 }).withMessage('Max marks must be positive number'),
    validate
  ],
  TeachingGroupController.scheduleTest
);

// @route   PUT /api/v1/teaching-groups/:id/tests/:testId
// @desc    Update class test details, dates, and instructions
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler TeachingGroupController.editTest() -> TeachingGroupModel.updateGroupTest()
router.put('/:id/tests/:testId', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), TeachingGroupController.editTest);

// @route   DELETE /api/v1/teaching-groups/:id/tests/:testId
// @desc    Delete a class test and its recorded marks
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler TeachingGroupController.deleteTest() -> TeachingGroupModel.deleteAssessment()
router.delete('/:id/tests/:testId', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), TeachingGroupController.deleteTest);

// @route   GET /api/v1/teaching-groups/:id/tests/:testId/scores
// @desc    Retrieve recorded student test marks
// @access  Protected (Authenticated)
// @handler TeachingGroupController.getTestScores() -> TeachingGroupModel.getTestScores()
router.get('/:id/tests/:testId/scores', auth, TeachingGroupController.getTestScores);

// @route   POST /api/v1/teaching-groups/:id/tests/:testId/scores
// @desc    Save student marks and question scores for a class test
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler TeachingGroupController.saveTestScores() -> TeachingGroupModel.saveTestScoresTransaction()
router.post(
  '/:id/tests/:testId/scores',
  auth,
  requireRole('TEACHER', 'SYSTEM_ADMIN'),
  [
    body('scores').isArray().withMessage('scores array is required'),
    validate
  ],
  TeachingGroupController.saveTestScores
);

// @route   ALL /api/v1/teaching-groups/:id/tests/:testId/export/:format
// @desc    Export official class test marksheet in Excel, PDF, or Word format
// @access  Protected (TEACHER, SYSTEM_ADMIN)
// @handler TeachingGroupController.exportTest() -> TeachingGroupModel.getTestExportMetadata()
router.all('/:id/tests/:testId/export/:format', auth, requireRole('TEACHER', 'SYSTEM_ADMIN'), TeachingGroupController.exportTest);

module.exports = router;
