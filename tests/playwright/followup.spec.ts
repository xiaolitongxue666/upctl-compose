import { test, expect } from '@playwright/test';

/** Follow-up (追问) feature E2E test.
 *  Requires TEST_TOKEN env var with an auth token that has ADMIN/TESTER role.
 *  Usage: TEST_TOKEN=xxx npx playwright test followup.spec.ts
 */

const BASE = process.env.TICKET_BASE_URL || 'http://localhost:8088';

test.describe('Follow-up (追问) feature', () => {
  test('follow-up button navigates to create page with pre-filled ref', async ({ page }) => {
    const token = process.env.TEST_TOKEN;
    test.skip(!token, 'TEST_TOKEN not set');

    // Create a test ticket via API
    const createResp = await page.request.post(`${BASE}/api/v2/upctl/api/tickets`, {
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      data: { title: `Follow-up test ${Date.now()}`, body: 'Source ticket for follow-up test' },
    });
    const createData = await createResp.json();
    expect(createResp.status()).toBe(200);
    const ticketNum = createData.d?.number;
    expect(ticketNum).toBeGreaterThan(0);

    // Navigate to the ticket detail page
    await page.goto(`${BASE}/tickets/${ticketNum}`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((t) => window.localStorage.setItem('Authorization', t), token as string);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Check the follow-up button exists and is visible
    const btn = page.locator('.btn-followup');
    await expect(btn).toBeVisible({ timeout: 5000 });
    await expect(btn).toHaveText(/追问/);

    // Click the follow-up button
    await btn.click();
    await page.waitForTimeout(2000);

    // Should navigate to the create page with ?ref= param
    expect(page.url()).toContain(`/tickets/new?ref=${ticketNum}`);

    // Body textarea should be pre-filled with the reference
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });
    const bodyValue = await textarea.inputValue();
    expect(bodyValue).toContain(`追问自 #${ticketNum}`);
    expect(bodyValue).toContain('Source ticket for follow-up test');
  });
});
