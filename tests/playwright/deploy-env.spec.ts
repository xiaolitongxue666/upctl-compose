import { test, expect, type Page } from "@playwright/test";
import * as crypto from "crypto";

const BASE_URL = "http://localhost:8088";

function generateJwt(): string {
  const jwtKey = process.env.JWT_KEY || "upctl-dev-jwt-key-change-in-production";
  const htyToken = {
    token_id: "e2e-test",
    hty_id: null,
    app_id: null,
    ts: new Date().toISOString().replace(/\.\d+Z$/, ""),
    roles: [{ role_key: "ADMIN" }],
    tags: [],
    current_org_id: null,
    current_org_role_keys: null,
    current_department_id: null,
  };
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: JSON.stringify(htyToken), exp: now + 3600, iat: now };
  const base64Url = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url").replace(/=+$/, "");
  const header = base64Url({ alg: "HS256", typ: "JWT" });
  const body = base64Url(payload);
  const signature = crypto
    .createHmac("sha256", jwtKey)
    .update(`${header}.${body}`)
    .digest("base64url")
    .replace(/=+$/, "");
  return `${header}.${body}.${signature}`;
}

async function loginAndGetJwt(page: Page): Promise<string> {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForSelector('input[placeholder="用户名"]');
  await page.locator('input[placeholder="用户名"]').fill("demo");
  await page.locator('input[placeholder="密码"]').fill("demo123");
  await page.locator('button:has-text("登录")').click();
  await page.waitForFunction(() => !!window.localStorage.getItem("Authorization"), { timeout: 10_000 });
  await expect(page.locator('a:has-text("工单列表"), h1:has-text("工单列表")')).toBeVisible({ timeout: 10_000 });
  return await page.evaluate(() => window.localStorage.getItem("Authorization") || "");
}

test.describe("部署环境", () => {
  test("创建工单时显示部署环境选择器", async ({ page }) => {
    const jwt = await loginAndGetJwt(page);
    expect(jwt).toBeTruthy();

    // Ensure at least one deploy env exists via API
    const envName = "TestEnv-" + Date.now();
    const createEnvResponse = await page.request.post(`${BASE_URL}/api/v2/upctl/api/deploy_envs`, {
      headers: { Authorization: generateJwt(), "Content-Type": "application/json" },
      data: { name: envName, domain: "test.env.com" },
    });
    expect(createEnvResponse.ok()).toBeTruthy();

    await page.locator('a:has-text("新建工单"), button:has-text("新建工单")').click();

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
