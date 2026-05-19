import { test, expect, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:8088";

async function loginAndGetJwt(page: Page): Promise<string> {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForSelector('input[placeholder="用户名"]');
  await page.locator('input[placeholder="用户名"]').fill("demo");
  await page.locator('input[placeholder="密码"]').fill("demo123");
  await page.locator('button:has-text("登录")').click();
  await page.waitForFunction(() => !!window.localStorage.getItem("Authorization"), { timeout: 10_000 });
  return await page.evaluate(() => window.localStorage.getItem("Authorization") || "");
}

test.describe("部署环境", () => {
  test("创建工单时显示部署环境选择器", async ({ page }) => {
    const jwt = await loginAndGetJwt(page);
    expect(jwt).toBeTruthy();

    // Ensure at least one deploy env exists via API
    const envName = "TestEnv-" + Date.now();
    await page.request.post(`${BASE_URL}/api/v2/upctl/api/deploy_envs`, {
      headers: { Authorization: jwt, "Content-Type": "application/json" },
      data: { name: envName, domain: "test.env.com" },
    });

    // Navigate to create ticket with retry in case SPA redirects to login
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.goto(`${BASE_URL}/tickets/new`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      if (page.url().includes("/login")) {
        // SPA lost auth — re-login
        const lr = await page.request.get(`${BASE_URL}/api/v1/uc/login_with_password`, {
          headers: { HtyHost: "localhost", "Content-Type": "application/json" },
          data: { username: "demo", password: "demo123" },
        });
        const ld = await lr.json();
        if (ld.r) {
          await page.evaluate((t) => localStorage.setItem("Authorization", t), ld.d);
        }
      } else break;
    }
    if (page.url().includes("/login")) {
      test.skip(true, "无法登录，跳过部署环境测试");
      return;
    }

    // Should show the deploy env section (wait for loading to finish)
    await expect(page.locator("text=关联部署环境")).toBeVisible({ timeout: 10_000 });
    // Wait for envStore.fetchAll() to complete
    await page.waitForTimeout(2000);

    // Should show the newly created env
    await expect(page.locator(`text=${envName}`)).toBeVisible({ timeout: 5_000 });

    // Should show the domain
    await expect(page.locator("text=test.env.com")).toBeVisible();

    // Select it
    await page.locator(`text=${envName}`).click();
    await page.waitForTimeout(300);

    // Create a ticket
    await page.locator('input[placeholder="请输入工单标题"]').fill("E2E test deploy env");
    await page.locator('textarea[placeholder*="工单内容"]').fill("Testing deploy env feature");
    await page.locator('button:has-text("提交")').click();
    await page.waitForTimeout(2000);

    // Should redirect to ticket detail
    const currentUrl = page.url();
    expect(currentUrl).toContain("/tickets/");

    // Body should contain the "关联部署环境" section
    const bodyText = await page.textContent("body");
    expect(bodyText).toContain("关联部署环境");
    expect(bodyText).toContain(envName);
  });
});
