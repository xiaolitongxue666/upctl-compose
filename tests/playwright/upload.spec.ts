import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "http://localhost:8088";

const MINI_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** Log in via the username/password form. */
async function loginViaForm(page: Page, username = "demo", password = "demo123") {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForSelector('input[placeholder="用户名"]');
  await page.locator('input[placeholder="用户名"]').fill(username);
  await page.locator('input[placeholder="密码"]').fill(password);
  await page.locator('button:has-text("登录")').click();
  // Wait for JWT stored AND redirect away from /login
  await page.waitForFunction(
    () => !!window.localStorage.getItem("Authorization"),
    { timeout: 10_000 },
  );
  try {
    await page.waitForFunction(() => !window.location.href.includes("/login"), { timeout: 10_000 });
  } catch {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
  }
}

/** Navigate to a path on the app preserving SPA state. */
async function navigateTo(page: Page, path: string) {
  await page.evaluate((p) => {
    const app = (document.querySelector("#app") as any)?.__vue_app__;
    if (app?.config?.globalProperties?.$router) {
      app.config.globalProperties.$router.push(p);
    } else {
      window.location.href = p;
    }
  }, path);
  // Wait for SPA to render after navigation
  await page.waitForTimeout(2000);
  // Fallback: if SPA nav didn't work, try direct goto
  if (!page.url().includes(path.replace(/^\//, ''))) {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForTimeout(2000);
  }
}

test.describe("Image upload", () => {
  let tmpDir: string;

  test.beforeEach(() => {
    tmpDir = fs.mkdtempSync("upload-test-");
  });

  test.afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("uploads image when creating a ticket", async ({ page }) => {
    const pngPath = path.join(tmpDir, "test.png");
    fs.writeFileSync(pngPath, MINI_PNG);

    await loginViaForm(page);
    await navigateTo(page, "/tickets/new");
    // Page should show create ticket form (no h1 with page title)
    await expect(page.locator('input[placeholder="请输入工单标题"]')).toBeVisible({ timeout: 10_000 });

    // Fill title
    const title = `E2E upload test ${Date.now()}`;
    await page.locator('input[placeholder="请输入工单标题"]').fill(title);

    // Upload file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(pngPath);

    // Wait for upload to complete and markdown to appear in body
    await expect(page.locator("textarea")).toHaveValue(/!\[test\.png]\(/, { timeout: 10_000 });

    // Submit
    await page.locator('button:has-text("提交")').click();

    // Should navigate to ticket detail
    await expect(page).toHaveURL(/\/tickets\/\d+/);
    await expect(page.locator(".ticket-title")).toContainText(title);

    // Verify image rendered
    const images = page.locator(".ticket-body img");
    await expect(images).toHaveCount(1);
    await expect(images.first()).toBeVisible();
  });

  test("uploads image in comment", async ({ page }) => {
    const pngPath = path.join(tmpDir, "comment.png");
    fs.writeFileSync(pngPath, MINI_PNG);

    await loginViaForm(page);

    // First create a ticket via API
    const jwt = await page.evaluate(() => window.localStorage.getItem("Authorization") || "");
    const createResp = await page.evaluate(
      async ({ url, jwt }) => {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: jwt,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            title: `E2E comment upload ${Date.now()}`,
            body: "test body",
          }),
        });
        const data = await resp.json();
        return data?.d?.number || 0;
      },
      { url: `${BASE_URL}/api/v2/upctl/api/tickets`, jwt },
    );
    expect(createResp).toBeGreaterThan(0);

    // Navigate to ticket detail
    await navigateTo(page, `/tickets/${createResp}`);

    // Upload image in comment section
    const fileInputs = page.locator(".reply-section input[type='file']");
    await fileInputs.setInputFiles(pngPath);

    // Wait for markdown to appear
    await expect(page.locator(".reply-section textarea")).toHaveValue(/!\[comment\.png]\(/, { timeout: 10_000 });

    // Send comment
    await page.locator(".reply-section button:has-text('发送')").click();

    // Wait for comment to appear
    await expect(page.locator(".comment-card")).toBeVisible();
    const images = page.locator(".comment-body img");
    await expect(images).toHaveCount(1);
    await expect(images.first()).toBeVisible();
  });

  // FIXME: page.route + XHR doesn't work reliably for file uploads in CI
  test.skip("shows error message on upload failure", async ({ page }) => {
    const pngPath = path.join(tmpDir, "fail.png");
    fs.writeFileSync(pngPath, MINI_PNG);

    await loginViaForm(page);
    await navigateTo(page, "/tickets/new");

    // Intercept upload_attachment API to simulate failure
    // (upctl-web uses axios/XHR, so window.fetch override won't work)
    await page.route('**/api/v2/upctl/api/upload_attachment**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ r: false, e: "Upload failed" }),
      });
    });

    // Upload file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(pngPath);

    // Should NOT add image markdown
    await page.waitForTimeout(500);
    const bodyText = await page.locator("textarea").inputValue();
    expect(bodyText).not.toContain("![fail.png](");
  });
});
