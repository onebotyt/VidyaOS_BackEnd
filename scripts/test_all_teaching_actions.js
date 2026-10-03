const http = require('http');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (_) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function login(username, password) {
  const res = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { identifier: username, password });
  return res.body?.data?.tokens?.access_token || res.body?.data?.access_token || res.body?.access_token;
}

async function run() {
  console.log('Testing authentication and teaching groups across accounts...\n');

  const accounts = [
    { name: 'Admin', user: 'admin@gmail.com', pass: 'Admin@123' },
    { name: 'HOD', user: 'hod@gmail.com', pass: 'Password@123' },
    { name: 'ClassTeacher', user: 'classteacher@gmail.com', pass: 'Password@123' },
    { name: 'Teacher', user: 'teacher@gmail.com', pass: 'Password@123' }
  ];

  for (const acc of accounts) {
    console.log(`\n================================`);
    console.log(`Testing Account: ${acc.name} (${acc.user})`);
    console.log(`================================`);
    const token = await login(acc.user, acc.pass);
    if (!token) {
      console.log(`❌ Login FAILED for ${acc.user}`);
      continue;
    }
    console.log(`✓ Login success`);

    // 1. GET /overview
    const ovRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/teaching-groups/overview',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log(`GET /overview -> HTTP ${ovRes.status}`, ovRes.body?.success ? '✓' : `❌ ${JSON.stringify(ovRes.body)}`);

    // 2. GET / (list)
    const listRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/teaching-groups?status=ALL',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log(`GET /?status=ALL -> HTTP ${listRes.status}`, listRes.body?.success ? `✓ (${listRes.body.data?.length} groups)` : `❌ ${JSON.stringify(listRes.body)}`);

    // 3. POST / (create teaching group)
    const createRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/teaching-groups',
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }, {
      name: `Test Class ${acc.name} ${Date.now()}`,
      subject_name: 'Software Engineering',
      component: 'THEORY',
      semester: 5,
      enrollment_mode: 'INVITE_CODE',
      department_id: 4
    });
    console.log(`POST / (Create Group) -> HTTP ${createRes.status}`, createRes.body?.success ? `✓ Created #${createRes.body.data?.id}` : `❌ ${JSON.stringify(createRes.body)}`);

    if (createRes.body?.success) {
      const gId = createRes.body.data.id;

      // 4. PUT /:id (Edit)
      const editRes = await request({
        hostname: 'localhost',
        port: 3000,
        path: `/api/v1/teaching-groups/${gId}`,
        method: 'PUT',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }, {
        name: `Edited Class ${acc.name}`,
        subject_name: 'Advanced Software Engineering',
        component: 'PRACTICAL'
      });
      console.log(`PUT /:id (Edit Group) -> HTTP ${editRes.status}`, editRes.body?.success ? '✓' : `❌ ${JSON.stringify(editRes.body)}`);

      // 5. POST /:id/archive
      const archRes = await request({
        hostname: 'localhost',
        port: 3000,
        path: `/api/v1/teaching-groups/${gId}/archive`,
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log(`POST /:id/archive -> HTTP ${archRes.status}`, archRes.body?.success ? '✓' : `❌ ${JSON.stringify(archRes.body)}`);

      // 6. POST /:id/unarchive
      const unarchRes = await request({
        hostname: 'localhost',
        port: 3000,
        path: `/api/v1/teaching-groups/${gId}/unarchive`,
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log(`POST /:id/unarchive -> HTTP ${unarchRes.status}`, unarchRes.body?.success ? '✓' : `❌ ${JSON.stringify(unarchRes.body)}`);

      // 7. POST /:id/trash
      const trashRes = await request({
        hostname: 'localhost',
        port: 3000,
        path: `/api/v1/teaching-groups/${gId}/trash`,
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log(`POST /:id/trash -> HTTP ${trashRes.status}`, trashRes.body?.success ? '✓' : `❌ ${JSON.stringify(trashRes.body)}`);

      // 8. POST /:id/restore
      const restRes = await request({
        hostname: 'localhost',
        port: 3000,
        path: `/api/v1/teaching-groups/${gId}/restore`,
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log(`POST /:id/restore -> HTTP ${restRes.status}`, restRes.body?.success ? '✓' : `❌ ${JSON.stringify(restRes.body)}`);

      // 9. DELETE /:id/permanent
      const delRes = await request({
        hostname: 'localhost',
        port: 3000,
        path: `/api/v1/teaching-groups/${gId}/permanent`,
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log(`DELETE /:id/permanent -> HTTP ${delRes.status}`, delRes.body?.success ? '✓' : `❌ ${JSON.stringify(delRes.body)}`);
    }
  }
}

run().catch(console.error);
