const http = require('http');

function request(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path: urlPath,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: body
      }));
    });

    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function simulate() {
  console.log('--- SIMULATING FACULTY REGISTERS WORKSPACE COMBINATION FLOW ---');

  // 1. Faculty Login
  const loginRes = await request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'hod@gmail.com', password: 'Password@123' })
  });
  const loginData = JSON.parse(loginRes.body);
  if (!loginData.success) throw new Error('Login failed: ' + loginRes.body);
  const token = loginData.data.access_token || loginData.data.token;
  const authHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  console.log('✓ Faculty logged in successfully.');

  // 2. Fetch Registers
  const regRes = await request('/api/v1/faculty/registers', { headers: authHeaders });
  const regData = JSON.parse(regRes.body);
  if (!regData.success || regData.data.length === 0) throw new Error('No registers found');
  const reg = regData.data[0];
  console.log(`✓ Using Register #${reg.id} - Subject: ${reg.subject_name} (ID: ${reg.subject_id})`);

  // 3. Create Coursework Assignment scoped to this register
  const assignPayload = {
    title: 'Consolidated Unit 1 Lab Assignment',
    description: 'Created inside consolidated Registers workspace.',
    due_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
    max_marks: 25,
    subject_id: reg.subject_id,
    department_id: reg.department_id,
    branch_id: reg.branch_id,
    year: reg.year,
    semester: reg.semester,
    academic_year_id: reg.academic_year_id
  };

  const createAssignRes = await request('/api/v1/assignments', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(assignPayload)
  });
  const createAssignData = JSON.parse(createAssignRes.body);
  if (!createAssignData.success) throw new Error('Assignment creation failed: ' + createAssignRes.body);
  console.log(`✓ Assignment created successfully (ID: ${createAssignData.data.id})`);

  // 4. Query Assignments scoped to this register
  const queryAssignRes = await request(`/api/v1/assignments?subject_id=${reg.subject_id}&department_id=${reg.department_id}&branch_id=${reg.branch_id}&year=${reg.year}&semester=${reg.semester}`, {
    headers: authHeaders
  });
  const queryAssignData = JSON.parse(queryAssignRes.body);
  const foundAssign = queryAssignData.data.find(a => a.id === createAssignData.data.id);
  if (!foundAssign) throw new Error('Created assignment not found in scoped query');
  console.log(`✓ Scoped query correctly returned assignment "${foundAssign.title}" with max marks ${foundAssign.max_marks}`);

  // 5. Create Exam / Class Test scoped to this register
  const examPayload = {
    name: 'Unit Test 1 (Registers Consolidation)',
    exam_type: 'CLASS_TEST',
    exam_date: new Date().toISOString().split('T')[0],
    max_marks: 30,
    weightage: 15,
    subject_id: reg.subject_id,
    department_id: reg.department_id,
    branch_id: reg.branch_id,
    year: reg.year,
    semester: reg.semester,
    academic_year_id: reg.academic_year_id
  };

  const createExamRes = await request('/api/v1/exams', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(examPayload)
  });
  const createExamData = JSON.parse(createExamRes.body);
  if (!createExamData.success) throw new Error('Exam creation failed: ' + createExamRes.body);
  console.log(`✓ Exam created successfully (ID: ${createExamData.data.id})`);

  // 6. Query Exams scoped to this register
  const queryExamRes = await request(`/api/v1/exams?subject_id=${reg.subject_id}&department_id=${reg.department_id}&branch_id=${reg.branch_id}&year=${reg.year}&semester=${reg.semester}`, {
    headers: authHeaders
  });
  const queryExamData = JSON.parse(queryExamRes.body);
  const foundExam = queryExamData.data.find(e => e.id === createExamData.data.id);
  if (!foundExam) throw new Error('Created exam not found in scoped query');
  console.log(`✓ Scoped query correctly returned exam "${foundExam.name}" with max marks ${foundExam.max_marks}`);

  // 7. Get roster and submit marks
  const rosterRes = await request(`/api/v1/exams/${createExamData.data.id}/roster`, { headers: authHeaders });
  const rosterData = JSON.parse(rosterRes.body);
  if (!rosterData.success) throw new Error('Failed to get exam roster: ' + rosterRes.body);
  console.log(`✓ Retrieved roster for exam: ${rosterData.data.roster.length} students enrolled`);

  if (rosterData.data.roster.length > 0) {
    const student = rosterData.data.roster[0];
    const scoreRes = await request(`/api/v1/exams/${createExamData.data.id}/scores`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        scores: [{ student_id: student.student_id, marks_obtained: 28 }]
      })
    });
    const scoreData = JSON.parse(scoreRes.body);
    if (!scoreData.success) throw new Error('Failed to submit scores: ' + scoreRes.body);
    console.log(`✓ Successfully recorded test marks (28/${foundExam.max_marks}) for student ID ${student.student_id}`);
  }

  console.log('\n🎉 ALL REGISTER CONSOLIDATION ENDPOINTS & ACTIONS VERIFIED SUCCESSFULLY!');
}

simulate().catch(err => {
  console.error('❌ Simulation Error:', err);
  process.exit(1);
});
