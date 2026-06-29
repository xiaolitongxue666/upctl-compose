import { test, expect, type Page } from "@playwright/test";
import * as crypto from "crypto";

const BASE_URL = "http://localhost:8088";

/** Generate a dev JWT (fallback for non-login test scenarios). */
function generateJwt(): string {
  const jwtKey = process.env.JWT_KEY || "upctl-dev-jwt-key-change-in-production";
  const htyToken = {
    token_id: "e2e-test",
    hty_id: null,
    app_id: null,
    ts: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    roles: [{ role_key: "ADMIN" }],
    tags: [],
    current_org_id: null,
    current_org_role_keys: null,
    current_department_id: null,
  };
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: JSON.stringify(htyToken), exp: now + 3600, iat: now };

  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o))
      .toString("base64url")
      .replace(/=+$/, "");

  const header = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = crypto
    .createHmac("sha256", jwtKey)
    .update(`${header}.${body}`)
    .digest("base64url")
    .replace(/=+$/, "");

  return `${header}.${body}.${sig}`;
}

/** Log in via the username/password form and wait for redirect. */
async function loginViaForm(page: Page, username = "demo", password = "demo123") {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForSelector('input[placeholder="用户名"]');
  await page.locator('input[placeholder="用户名"]').fill(username);
  await page.locator('input[placeholder="密码"]').fill(password);
  await page.locator('button:has-text("登录")').click();
  // Wait for JWT to be stored (login API succeeded)
  await page.waitForFunction(
    () => !!window.localStorage.getItem("Authorization"),
    { timeout: 10_000 },
  );
}

test.describe("Login page", () => {
  test("renders the login page with title and form", async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await expect(page.locator("h1")).toContainText("工单管理系统");
    await expect(page.locator('input[placeholder="用户名"]')).toBeVisible();
    await expect(page.locator('button:has-text("登录")')).toBeVisible();
  });

  test("redirects unauthenticated users to /login", async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page).toHaveURL(/\/login/);
  });

  test("shows username/password login form (compose/dev mode)", async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await expect(page.locator('input[placeholder="用户名"]')).toBeVisible();
    await expect(page.locator('input[placeholder="密码"]')).toBeVisible();
    await expect(page.locator('button:has-text("登录")')).toBeVisible();
  });

  test("logs in with demo credentials and lands on ticket list", async ({ page }) => {
    await loginViaForm(page);
    // After successful login should redirect to /
    await expect(page).not.toHaveURL(/\/login/);
    // Check for header nav to confirm logged-in state (no h1 in ticket list)
    await expect(page.locator('a:has-text("工单列表")')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Ticket list", () => {
  test("loads and shows tickets with valid login", async ({ page }) => {
    await loginViaForm(page);
    await page.goto(`${BASE_URL}/`);
    // Should show header nav, not redirect back to /login
    await expect(page.locator('a:has-text("工单列表")')).toBeVisible({ timeout: 10_000 });
    await expect(page).not.toHaveURL(/\/login/);
  });
});
