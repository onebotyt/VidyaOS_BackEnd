/**
 * System Role Verification Middleware
 */

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !req.user.roles) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'User authentication required'
        }
      });
    }

    // System Admins always pass
    if (req.user.roles.includes('SYSTEM_ADMIN') || req.user.roles.includes('ADMIN')) {
      return next();
    }

    // HODs pass for HOD, TEACHER, and FACULTY roles
    if (req.user.is_hod && (allowedRoles.includes('HOD') || allowedRoles.includes('DEPT_HEAD') || allowedRoles.includes('TEACHER') || allowedRoles.includes('FACULTY'))) {
      return next();
    }

    const hasRole = req.user.roles.some(role => allowedRoles.includes(role));
    if (!hasRole) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Access denied. Requires one of roles: ${allowedRoles.join(', ')}`
        }
      });
    }

    next();
  };
}

module.exports = requireRole;
