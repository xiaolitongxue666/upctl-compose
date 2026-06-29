import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:8088';
const ADMIN_URL = 'https://admin.moicen.com';

test.describe('Attachment rendering', () => {
  test('file attachment renders as box with icon + filename + download button', async ({ page }) => {
    test.skip(!process.env.MOICEN_E2E_UNIONID, '需要 MOICEN_E2E_UNIONID');
    // Login via API
    const lr = await page.request.get(ADMIN_URL + '/api/v1/uc/login2_with_unionid', {
      headers: { Unionid: process.env.MOICEN_E2E_UNIONID || '' }
    });
    const ld = await lr.json();
    const token = ld.d;
    const sr = await page.request.post(ADMIN_URL + '/api/v1/uc/sudo', {
      headers: { Authorization: token }
    });
    const sd = await sr.json();
    const sudo = sd.d;
    
    // Create a ticket with an attachment link in the body
    const createResp = await page.request.post(BASE_URL + '/api/v2/upctl/api/tickets', {
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      data: {
        title: 'E2E attachment test ' + Date.now(),
        body: 'Test attachment [test.pdf](/api/v2/upctl/api/attachment/test.pdf?token=demo123)'
      }
    });
    const createData = await createResp.json();
    const ticketNum = createData.d?.number;
    expect(ticketNum).toBeGreaterThan(0);
    
    // Navigate and inject auth
    await page.goto(BASE_URL + '/tickets/' + ticketNum, { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ t, s }) => {
      window.localStorage.setItem('Authorization', t);
      window.localStorage.setItem('HtySudoerToken', s);
    }, { t: token, s: sudo });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    // Verify file attachment box renders
    const box = page.locator('.file-attachment-box');
    await expect(box).toBeVisible({ timeout: 10000 });
    
    // Verify icon
    await expect(page.locator('.file-attachment-icon')).toBeVisible();
    
    // Verify filename
    await expect(page.locator('.file-attachment-name')).toContainText('test.pdf');
    
    // Verify meta text
    await expect(page.locator('.file-attachment-meta')).toContainText('PDF');
    
    // Verify download link has token
    const href = await page.locator('.file-attachment-dl').getAttribute('href');
    expect(href).toContain('token=');
    expect(href).toContain('test.pdf');
  });
});
