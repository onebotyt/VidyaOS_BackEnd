const fs = require('fs');
const path = require('path');

const moduleMetadata = {
  'auth.js': {
    prefix: '/api/v1/auth',
    title: 'Authentication & Access Security',
    icon: '🔐',
    desc: 'Handles student, faculty, HOD, and master admin logins, Google OAuth ID token verification, OTP issuance, JWT refresh, and cohort registration status.'
  },
  'admin.js': {
    prefix: '/api/v1/admin',
    title: 'Institutional Administration',
    icon: '🏛️',
    desc: 'Master system controls: department CRUD, appointing & removing HODs, autonomous academic session management, immutable audit logs, and college-wide settings.'
  },
  'hod.js': {
    prefix: '/api/v1/hod',
    title: 'HOD Department Management',
    icon: '👔',
    desc: 'Department-level administration: teacher rosters, faculty registrations, student promotion/demotion engine, roll number re-indexing, and department statistics.'
  },
  'teachingGroups.js': {
    prefix: '/api/v1/teaching-groups',
    title: 'Teaching Groups Hub (Virtual Classrooms)',
    icon: '👥',
    desc: 'Modern Google Classroom-style groups: stream discussions, broadcast announcements, direct cohort auto-enrollment, student comments, and group archival.'
  },
  'attendance.js': {
    prefix: '/api/v1/attendance',
    title: 'Digital Attendance Matrix & IoT Sessions',
    icon: '📋',
    desc: 'Live attendance engine: concurrent dynamic QR codes, 6-digit rolling PINs, student claim adjudication, 31-day attendance matrix updates, and ESP32 sync.'
  },
  'faculty.js': {
    prefix: '/api/v1/faculty',
    title: 'Faculty Workspace & Roster Operations',
    icon: '👨‍🏫',
    desc: 'Personal faculty portal: active registers, cohort students, biometric terminal status, teacher profile info, and cohort registration gates.'
  },
  'exams.js': {
    prefix: '/api/v1/exams',
    title: 'Class Tests & Evaluation Marksheets',
    icon: '📊',
    desc: 'Internal assessments & marksheets: test scheduling, custom question breakdown (Q1-Q10), marks entry, class statistics, and Excel (.xlsx) export.'
  },
  'assignments.js': {
    prefix: '/api/v1/assignments',
    title: 'Coursework & Student Assignments',
    icon: '📝',
    desc: 'Assignment management: file attachment uploads (PDF/DOCX), student submission dropboxes, grading, feedback remarks, and status tracking.'
  },
  'students.js': {
    prefix: '/api/v1/students',
    title: 'Student Directory & Lifecycles',
    icon: '🎓',
    desc: 'Student lifecycle management: enrollment rosters, single & bulk CSV admissions, self-registration approval queue, biometric mappings, and password resets.'
  },
  'reports.js': {
    prefix: '/api/v1/reports',
    title: 'Analytics, Defaulters & Executive Reports',
    icon: '📈',
    desc: 'Institutional analytics: attendance percentages, defaulter threshold alerts (<75%), monthly matrix downloads, and parent communication escalation logs.'
  },
  'devices.js': {
    prefix: '/api/v1/devices',
    title: 'IoT Biometric Hardware Terminals',
    icon: '📟',
    desc: 'ESP32 biometric hardware management: terminal heartbeat monitoring, department assignment, student finger slot allocation, and offline punch synchronization.'
  },
  'leave.js': {
    prefix: '/api/v1/leave',
    title: 'Student Leave Applications',
    icon: '🏖️',
    desc: 'Formal leave workflows: medical and personal leave requests by students, teacher approvals, and attendance adjustments.'
  },
  'timetable.js': {
    prefix: '/api/v1/timetable',
    title: 'Weekly Academic Timetable',
    icon: '📅',
    desc: 'Class timetables: weekly lecture slot scheduling, room numbers, teacher allocations, and student schedule views.'
  },
  'curriculum.js': {
    prefix: '/api/v1/curriculum',
    title: 'IRDT Curriculum & Syllabus',
    icon: '📚',
    desc: 'Uttarakhand IRDT Polytechnic syllabus: official booklet PDF links, preloaded subject catalog seed engine, and scheme toggles (2026-27 vs 2019-20).'
  },
  'notifications.js': {
    prefix: '/api/v1/notifications',
    title: 'System Notifications & Alerts',
    icon: '🔔',
    desc: 'Real-time alert dispatch: unread notification badges, mark as read, automated attendance warnings, and administrative announcements.'
  }
};

const routesDir = path.resolve(__dirname, '../src/routes');
const endpoints = [];

// Also add top-level server.js endpoints
endpoints.push({
  id: 'ep-health',
  method: 'GET',
  path: '/api/v1/health',
  moduleKey: 'admin.js',
  category: 'System Health',
  icon: '💓',
  role: 'Public',
  summary: 'System health check and live status',
  description: 'Returns real-time status of VidyaOS institutional REST API server and current server timestamp.',
  dataFlow: {
    input: 'None (no parameters required)',
    action: 'Checks server process uptime & memory status',
    storage: 'In-memory process state',
    output: 'JSON object with status: "ONLINE", timestamp, service name'
  },
  sampleRequest: { method: 'GET', url: '/api/v1/health' },
  defaultBody: null,
  hasLiveTry: true
});

endpoints.push({
  id: 'ep-departments-public',
  method: 'GET',
  path: '/api/v1/departments',
  moduleKey: 'admin.js',
  category: 'Institutional Administration',
  icon: '🏛️',
  role: 'Public',
  summary: 'Public active departments list for registration',
  description: 'Returns active institutional departments (IT, CE, ME, EE, ECE, PHARM) for student self-registration and public catalog.',
  dataFlow: {
    input: 'None',
    action: 'Queries active departments from SQLite',
    storage: 'departments table (WHERE is_active = 1)',
    output: 'Array of departments with id, name, code, degree_duration_years, active_term'
  },
  sampleRequest: { method: 'GET', url: '/api/v1/departments' },
  defaultBody: null,
  hasLiveTry: true
});

for (const [fileName, meta] of Object.entries(moduleMetadata)) {
  const filePath = path.join(routesDir, fileName);
  if (!fs.existsSync(filePath)) continue;

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  let commentAccumulator = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      const cleanComment = trimmed.replace(/^(\/\/|\*|\/\*|\*\/)\s*/, '');
      if (cleanComment && !cleanComment.includes('eslint') && !cleanComment.includes('===')) {
        commentAccumulator.push(cleanComment);
      }
    } else {
      // Check for route definition
      const routeMatch = trimmed.match(/router\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/i);
      if (routeMatch) {
        const method = routeMatch[1].toUpperCase();
        const subpath = routeMatch[2];
        const fullPath = meta.prefix + (subpath === '/' ? '' : subpath);

        // Analyze surrounding lines for roles and params
        const snippet = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 10)).join('\n');
        
        let role = 'Authenticated';
        if (snippet.includes("'SYSTEM_ADMIN'") || snippet.includes('requireAdmin')) {
          role = 'Master Admin';
        } else if (snippet.includes('requireHOD') || (snippet.includes('HOD') && snippet.includes('requireRole'))) {
          role = 'Department HOD';
        } else if (snippet.includes("'TEACHER'")) {
          role = 'Faculty / Teacher';
        } else if (snippet.includes("'STUDENT'")) {
          role = 'Student';
        } else if (!snippet.includes('auth') && (fullPath.includes('/login') || fullPath.includes('/register') || fullPath.includes('/public') || fullPath.includes('/booklets'))) {
          role = 'Public';
        }

        const summaryText = commentAccumulator.length > 0 
          ? commentAccumulator[commentAccumulator.length - 1].replace(/^(GET|POST|PUT|DELETE)\s+[^\s]+\s*/i, '').trim()
          : ${method} ;

        const fullDescription = commentAccumulator.join(' ').replace(/^(GET|POST|PUT|DELETE)\s+[^\s]+\s*/i, '').trim() || ${method} operation for ;

        // Infer parameters from path (e.g. :id, :department_id)
        const pathParams = (subpath.match(/:[a-zA-Z0-9_]+/g) || []).map(p => p.slice(1));
        
        // Infer data flow
        let actionDesc = 'Processes request and executes database query';
        let storageTable = 'SQLite database';
        if (fileName === 'auth.js') {
          storageTable = 'users, students, teachers tables';
          actionDesc = 'Verifies credentials, generates signed JWT bearer token';
        } else if (fileName === 'attendance.js') {
          storageTable = 'attendance_sessions, register_attendance, live_student_checkins';
          actionDesc = 'Calculates attendance, updates matrix cells, streams check-in events';
        } else if (fileName === 'exams.js') {
          storageTable = 'exams, exam_marks tables';
          actionDesc = 'Calculates total & average scores, records individual question marks';
        } else if (fileName === 'assignments.js') {
          storageTable = 'assignments, assignment_submissions tables';
          actionDesc = 'Stores file paths, manages deadlines, records evaluation scores';
        } else if (fileName === 'teachingGroups.js') {
          storageTable = 'teaching_groups, group_members, group_posts, post_comments';
          actionDesc = 'Coordinates virtual classroom members, posts discussions, auto-enrolls cohorts';
        } else if (fileName === 'admin.js') {
          storageTable = 'departments, academic_years, audit_logs, system_settings';
          actionDesc = 'Enforces governance rules, updates institutional architecture, logs actions';
        } else if (fileName === 'hod.js') {
          storageTable = 'teachers, teacher_assignments, students tables';
          actionDesc = 'Authorizes department changes, coordinates academic progression';
        }

        endpoints.push({
          id: ep--,
          method,
          path: fullPath,
          moduleKey: fileName,
          category: meta.title,
          icon: meta.icon,
          role,
          pathParams,
          summary: summaryText.slice(0, 100),
          description: fullDescription.slice(0, 220),
          dataFlow: {
            input: pathParams.length ? Path parameters:  : (method === 'GET' ? 'Query parameters / Filters' : 'JSON payload / Form data'),
            action: actionDesc,
            storage: storageTable,
            output: 'Standard JSON response ({ success: true, data: ... })'
          },
          sampleRequest: {
            method,
            url: fullPath
          },
          hasLiveTry: true
        });

        commentAccumulator = [];
      } else if (!trimmed) {
        commentAccumulator = [];
      }
    }
  }
}

console.log(Parsed total of  endpoints across all modules!);
fs.writeFileSync('backend/scripts/api-registry.json', JSON.stringify({ modules: moduleMetadata, endpoints }, null, 2), 'utf8');
console.log('Saved to backend/scripts/api-registry.json');
