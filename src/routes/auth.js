/**
 * Authentication Routes (/api/v1/auth/*)
 * Pure declarative router delegating to AuthController.
 *
 * Architecture Role: Router (Routing Layer)
 * Interacts With:
 *   - Controllers: controllers/authController.js
 *   - Models: models/authModel.js
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimiter');
const auth = require('../middleware/auth');
const AuthController = require('../controllers/authController');

// ==========================================
// Logins & Active Sessions
// ==========================================

// @route   POST /api/v1/auth/faculty/login
// @desc    Faculty / Admin credential login
// @access  Public (Rate limited)
// @handler AuthController.facultyLogin() -> authService.facultyLogin()
router.post(
  '/faculty/login',
  authLimiter,
  [
    body('password').notEmpty().withMessage('Password is required'),
    validate
  ],
  AuthController.facultyLogin
);

// @route   GET /api/v1/auth/me
// @desc    Retrieve profile and roles of currently logged-in user
// @access  Protected (Authenticated)
// @handler AuthController.getMe() -> authService.getMe()
router.get('/me', auth, AuthController.getMe);

// @route   POST /api/v1/auth/student/login
// @desc    Student credential login (Gmail / Mobile / Enrollment)
// @access  Public (Rate limited)
// @handler AuthController.studentLogin() -> authService.studentLogin()
router.post(
  '/student/login',
  authLimiter,
  [
    body('password').notEmpty().withMessage('Password is required'),
    validate
  ],
  AuthController.studentLogin
);

// @route   POST /api/v1/auth/login
// @desc    Universal multi-role credential login
// @access  Public (Rate limited)
// @handler AuthController.login() -> authService.facultyLogin() / authService.studentLogin()
router.post(
  '/login',
  authLimiter,
  [
    body('password').notEmpty().withMessage('Password is required'),
    validate
  ],
  AuthController.login
);

// @route   POST /api/v1/auth/change-password
// @desc    Update password for logged-in user
// @access  Protected (Authenticated)
// @handler AuthController.changePassword() -> authService.changePassword()
router.post(
  '/change-password',
  auth,
  [
    body('new_password').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
    body('current_password').optional().trim(),
    validate
  ],
  AuthController.changePassword
);

// ==========================================
// Google OAuth Workflows
// ==========================================

// @route   GET /api/v1/auth/google/config
// @desc    Get Google OAuth configuration status and public client ID
// @access  Public
// @handler AuthController.getGoogleConfig()
router.get('/google/config', AuthController.getGoogleConfig);

// @route   GET /api/v1/auth/google/url
// @desc    Generate Google authorization URL
// @access  Public
// @handler AuthController.getGoogleUrl() -> authService.getGoogleAuthUrl()
router.get('/google/url', AuthController.getGoogleUrl);

// @route   GET /api/v1/auth/google/callback
// @desc    Handle Google OAuth callback redirect
// @access  Public
// @handler AuthController.handleGoogleCallback() -> authService.handleGoogleCallback()
router.get('/google/callback', AuthController.handleGoogleCallback);

// @route   POST /api/v1/auth/google/save-credentials
// @desc    Save Google Cloud OAuth client credentials to backend .env
// @access  System Administration
// @handler AuthController.saveGoogleCredentials()
router.post(
  '/google/save-credentials',
  [
    body('client_id').trim().notEmpty().withMessage('Client ID is required'),
    validate
  ],
  AuthController.saveGoogleCredentials
);

// @route   POST /api/v1/auth/google/link
// @desc    Link Google account to authenticated user account
// @access  Protected (Authenticated)
// @handler AuthController.linkGoogleAccount() -> authService.linkGoogleAccount()
router.post(
  '/google/link',
  auth,
  [
    body('id_token').notEmpty().withMessage('Google ID token required'),
    validate
  ],
  AuthController.linkGoogleAccount
);

// @route   POST /api/v1/auth/google
// @desc    Authenticate user via Google ID token
// @access  Public (Rate limited)
// @handler AuthController.googleLogin() -> authService.googleLogin()
router.post(
  '/google',
  authLimiter,
  [
    body('id_token').notEmpty().withMessage('Google ID token required'),
    validate
  ],
  AuthController.googleLogin
);

// ==========================================
// Tokens & Keep-Alive
// ==========================================

// @route   POST /api/v1/auth/refresh
// @desc    Refresh expired access token using refresh token
// @access  Public (Requires Refresh Token)
// @handler AuthController.refreshToken() -> authService.refreshTokens()
router.post('/refresh', AuthController.refreshToken);

// @route   POST /api/v1/auth/logout
// @desc    Revoke session and refresh token
// @access  Public
// @handler AuthController.logout() -> authService.logout()
router.post('/logout', AuthController.logout);

// @route   GET /api/v1/auth/heartbeat
// @desc    Liveness ping to verify active user session
// @access  Protected (Authenticated)
// @handler AuthController.heartbeat()
router.get('/heartbeat', auth, AuthController.heartbeat);

// @route   POST /api/v1/auth/student/activate
// @desc    Activate student account with permanent password
// @access  Protected (Authenticated)
// @handler AuthController.activateStudent() -> authService.changePassword()
router.post(
  '/student/activate',
  auth,
  [
    body('new_password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    validate
  ],
  AuthController.activateStudent
);

// ==========================================
// Public Self-Registration Discovery & Status
// ==========================================

// @route   GET /api/v1/auth/student/registration/cohorts
// @desc    List open cohorts accepting student self-registration
// @access  Public
// @handler AuthController.getRegistrationCohorts() -> AuthModel.getSettingsMatching()
router.get('/student/registration/cohorts', AuthController.getRegistrationCohorts);

// @route   GET /api/v1/auth/departments
// @desc    List active academic departments for registration dropdowns
// @access  Public
// @handler AuthController.getDepartments() -> AuthModel.getActiveDepartments()
router.get('/departments', AuthController.getDepartments);

// @route   GET /api/v1/auth/registration-gates
// @desc    Get registration gate statuses across all departments and admin tiers
// @access  Public
// @handler AuthController.getRegistrationGates() -> AuthModel.getRegistrationGatesData()
router.get('/registration-gates', AuthController.getRegistrationGates);

// @route   GET /api/v1/auth/student/registration/status
// @desc    Check whether registration is open for a department/semester cohort
// @access  Public
// @handler AuthController.getStudentRegistrationStatus() -> AuthModel.getDepartmentById()
router.get('/student/registration/status', AuthController.getStudentRegistrationStatus);

// ==========================================
// Public Self-Registration Submissions
// ==========================================

// @route   POST /api/v1/auth/student/register
// @desc    Submit student self-registration application
// @access  Public (Rate limited)
// @handler AuthController.registerStudent() -> AuthModel.registerStudentTransaction()
router.post(
  '/student/register',
  authLimiter,
  [
    body('full_name').trim().notEmpty().withMessage('Full name is required'),
    body('enrollment_not_available').optional().toBoolean(),
    body('official_enrollment_no').custom((val, { req }) => {
      const isNotAvailable = Boolean(req.body.enrollment_not_available || req.body.roll_no_not_available || req.body.ubter_roll_not_available);
      if (isNotAvailable) {
        return true;
      }
      const enroll = (val || req.body.ubter_roll_no || '').trim();
      if (!enroll) {
        throw new Error('UBTER Roll Number is required (or check "Roll number not available yet")');
      }
      if (!/^\d{11}$/.test(enroll)) {
        throw new Error('UBTER Roll Number must contain exactly 11 numeric digits (0–9)');
      }
      return true;
    }),
    body('registration_no').optional().trim(),
    body('class_roll_no').optional({ checkFalsy: true }).custom((val) => {
      if (val === undefined || val === null || val === '') return true;
      const str = String(val).trim();
      if (!/^\d{1,2}$/.test(str)) {
        throw new Error('Class roll number must be numeric and maximum 2 digits (e.g. 01 to 99)');
      }
      const num = parseInt(str, 10);
      if (isNaN(num) || num <= 0) {
        throw new Error('Class roll number must be a positive integer');
      }
      return true;
    }),
    body('email').isEmail().withMessage('Valid Gmail address is required').normalizeEmail({ gmail_remove_dots: false }),
    body('password').custom((value, { req }) => {
      const hasGoogle = Boolean(req.body.google_sub || req.body.google_id_token);
      if (hasGoogle && (!value || String(value).trim() === '')) {
        return true;
      }
      if (!value || String(value).length < 8) {
        throw new Error('Password must be at least 8 characters');
      }
      return true;
    }),
    body('phone')
      .trim()
      .notEmpty().withMessage('Mobile number is required')
      .customSanitizer(val => {
        if (!val) return '';
        let cleaned = String(val).trim().replace(/[^\d+]/g, '');
        if (cleaned.startsWith('+91')) cleaned = cleaned.slice(3);
        else if (cleaned.startsWith('0') && cleaned.length === 11) cleaned = cleaned.slice(1);
        return cleaned.length >= 10 ? cleaned.slice(-10) : cleaned;
      })
      .matches(/^[6-9]\d{9}$/).withMessage('Mobile number must be a valid 10-digit Indian number (starts with 6–9)'),
    body('parent_phone').optional().trim(),
    body('parent_name').optional().trim(),
    body('department_id').optional().isInt(),
    body('branch_id').optional().isInt(),
    body('year').optional().isInt({ min: 1, max: 3 }),
    body('semester').isInt({ min: 1, max: 6 }).withMessage('Semester must be between 1 and 6'),
    validate
  ],
  AuthController.registerStudent
);

// @route   POST /api/v1/auth/faculty/register
// @desc    Faculty self-registration disabled (Faculty accounts provisioned exclusively by Admin and Department HOD)
// @access  Disabled
router.post(
  '/faculty/register',
  (req, res) => {
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Faculty self-registration has been disabled. Faculty and HOD accounts are provisioned exclusively by Institutional Administrators and Department HODs.'
      }
    });
  }
);

// @route   GET /api/v1/auth/branding
// @desc    Public institution branding metadata (campus image, logo, college name)
// @access  Public
router.get('/branding', async (req, res) => {
  try {
    const { query } = require('../config/db');
    const rows = await query(
      `SELECT setting_key, setting_value FROM system_settings 
       WHERE setting_key IN ('institution_name', 'institution_tagline', 'institution_logo_url', 'institution_banner_url', 'campus_location')`
    );
    const map = {};
    (rows || []).forEach(r => { map[r.setting_key] = r.setting_value; });
    return res.json({
      success: true,
      data: {
        institution_name: map.institution_name || 'Government Polytechnic Nainital',
        institution_tagline: map.institution_tagline || '',
        institution_logo_url: map.institution_logo_url || '/images/college-logo.png',
        institution_banner_url: map.institution_banner_url || '/images/campus-nainital.jpg',
        campus_location: map.campus_location || 'Uttarakhand, India'
      }
    });
  } catch (err) {
    return res.json({
      success: true,
      data: {
        institution_banner_url: '/images/campus-nainital.jpg'
      }
    });
  }
});

module.exports = router;
