async function test() {
  const r1 = await fetch('http://localhost:3000/api/v1/auth/faculty/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin@123' })
  });
  const d1 = await r1.json();
  console.log('Admin login with "admin":', r1.status, d1.data?.user?.full_name);

  const r2 = await fetch('http://localhost:3000/api/v1/auth/faculty/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'bdhami015@gmail.com', password: 'Demo@1234' })
  });
  const d2 = await r2.json();
  console.log('Dr Dhami login:', r2.status, d2.data?.user?.full_name, 'is_hod:', d2.data?.user?.is_hod, 'is_admin:', d2.data?.user?.roles?.includes('SYSTEM_ADMIN'));

  const r3 = await fetch('http://localhost:3000/api/v1/auth/student/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enrollment_no: '2024IT001', password: 'Student@2024' })
  });
  const d3 = await r3.json();
  console.log('Student 2024IT001 login:', r3.status, d3.data?.user?.full_name);

  const r4 = await fetch('http://localhost:3000/api/v1/auth/faculty/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'anil.patil@college.edu', password: 'Demo@1234' })
  });
  const d4 = await r4.json();
  console.log('CE HOD Dr. Patil login:', r4.status, d4.data?.user?.full_name, 'is_hod:', d4.data?.user?.is_hod);
}

test().catch(console.error);
