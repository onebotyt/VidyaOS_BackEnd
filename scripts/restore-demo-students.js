const { query } = require('../src/config/db');

async function restore() {
  console.log('Restoring demo students 1 to 10 and 28 to active ENROLLED status...');

  // Reset students 1 to 10
  await query(`
    UPDATE enrollments 
    SET status = 'ENROLLED', year = 3, semester = 5, department_id = 4, class_roll_no = student_id
    WHERE student_id BETWEEN 1 AND 10
  `);

  await query(`
    UPDATE users 
    SET status = 'ACTIVE' 
    WHERE id BETWEEN 5 AND 14
  `);

  await query(`
    UPDATE students 
    SET graduation_year = NULL, class_roll_no = id
    WHERE id BETWEEN 1 AND 10
  `);

  // Reset student 28
  await query(`
    UPDATE enrollments 
    SET status = 'ENROLLED', class_roll_no = 11
    WHERE student_id = 28 AND department_id = 4
  `);

  await query(`
    UPDATE users 
    SET status = 'ACTIVE' 
    WHERE id = 120
  `);

  const enrollments = await query(`
    SELECT e.id, e.student_id, s.full_name, e.year, e.semester, e.class_roll_no, e.status, u.status as account_status
    FROM enrollments e
    JOIN students s ON e.student_id = s.id
    JOIN users u ON s.user_id = u.id
    WHERE e.department_id = 4
    ORDER BY e.year, e.semester, e.class_roll_no
  `);

  console.log('✔ Restored enrollments in IT:');
  console.table(enrollments);
}

restore().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
