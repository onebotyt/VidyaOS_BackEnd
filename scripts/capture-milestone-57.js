const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const ARTIFACT_DIR = 'C:/Users/GD/.gemini/antigravity-ide/brain/9335e967-4198-4b96-9cda-b53405b2c9a9';

async function captureMilestone57Screenshots() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log('Logging in...');
  await page.goto(`${BASE_URL}/login/faculty.html`, { waitUntil: 'networkidle' });
  await page.fill('#username', 'hod@gmail.com');
  await page.fill('#password', 'Password@123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1000);

  console.log('Navigating to evaluation.html...');
  await page.goto(`${BASE_URL}/faculty/evaluation.html?id=47`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#eval-table', { timeout: 10000 });
  await page.waitForTimeout(600);

  // 1. View Mode: Clean headers without T buttons or resizer bars
  const shot1 = path.join(ARTIFACT_DIR, 'evaluation_clean_headers_view_mode.png');
  await page.screenshot({ path: shot1 });
  console.log('Saved:', shot1);

  // 2. Edit Mode: Editable column headers
  await page.click('#btn-toggle-edit');
  await page.waitForTimeout(400);
  const shot2 = path.join(ARTIFACT_DIR, 'evaluation_editable_headers_edit_mode.png');
  await page.screenshot({ path: shot2 });
  console.log('Saved:', shot2);

  // 3. 2-Click Save Modal
  await page.click('#btn-toggle-edit'); // Click 1: Save
  await page.waitForTimeout(300);
  const shot3 = path.join(ARTIFACT_DIR, 'evaluation_2click_save_modal.png');
  await page.screenshot({ path: shot3 });
  console.log('Saved:', shot3);

  // Dismiss save modal to test cancel modal
  await page.click('#btn-cancel-save-modal');
  await page.waitForTimeout(300);

  // 4. 2-Click Cancel Modal
  await page.click('#btn-cancel-edit'); // Click 1: Cancel
  await page.waitForTimeout(300);
  const shot4 = path.join(ARTIFACT_DIR, 'evaluation_2click_cancel_modal.png');
  await page.screenshot({ path: shot4 });
  console.log('Saved:', shot4);

  // Dismiss cancel modal
  await page.click('#btn-keep-editing-modal');
  await page.waitForTimeout(200);

  await browser.close();
  console.log('Done capturing screenshots!');
}

captureMilestone57Screenshots().catch(console.error);
