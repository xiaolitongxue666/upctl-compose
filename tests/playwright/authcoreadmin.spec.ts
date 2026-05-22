import { test, expect, type Page } from "@playwright/test";

const BASE = "http://localhost:8088";
const AUTH_ADMIN_URL = `${BASE}/admin`;

/** Navigate using Vue Router (SPA) to preserve user roles in the store. */
async function spaNavigate(page: Page, path: string) {
  const destinationPath = path.startsWith("/") ? path : "/" + path;
  await page.evaluate((p) => {
    const app = (document.querySelector("#app") as any)?.__vue_app__;
    if (app?.config?.globalProperties?.$router) {
      app.config.globalProperties.$router.push(p);
    } else {
      window.location.href = `/admin${p.startsWith("/") ? p : "/" + p}`;
    }
  }, destinationPath);
  const urlPattern = destinationPath === "/"
    ? /\/admin\/?$/
    : new RegExp(`/admin${destinationPath.replace(/\//g, "\\/")}$`);
  await page.waitForURL(urlPattern, { timeout: 10_000 });
}

/** Log in via the username/password form. */
async function login(page: Page, destination?: string) {
  await page.goto(`${AUTH_ADMIN_URL}/login`, { waitUntil: "networkidle" });
  await page.waitForSelector('input[placeholder="用户名"]');
  await page.locator('input[placeholder="用户名"]').fill("demo");
  await page.locator('input[placeholder="密码"]').fill("demo123");
  await page.locator('button:has-text("登录")').click();
  // Wait for JWT stored
  await page.waitForFunction(
    () => !!window.localStorage.getItem("Authorization"),
    { timeout: 15_000 },
  );
  // After login the SPA redirects to dashboard; if the redirect lands on
  // the wrong URL, force-correct to /admin/ to ensure we're on the right SPA.
  const currentUrl = page.url();
  if (!currentUrl.includes("/admin")) {
    await page.goto(`${AUTH_ADMIN_URL}/`, { waitUntil: "networkidle" });
  }
  // Confirm the default admin page has fully rendered.
  await expect(page.locator("h1")).toContainText("用户管理");
  // Navigate to desired page via SPA to preserve user roles in the store
  if (destination) {
    await spaNavigate(page, destination);
  }
}

test.describe("AuthCoreAdmin — Login", () => {
  test("compose 默认显示用户名密码，无微信二维码", async ({ page }) => {
    await page.goto(`${AUTH_ADMIN_URL}/login`, { waitUntil: "networkidle" });
    await expect(page.locator('input[placeholder="用户名"]')).toBeVisible();
    await expect(page.locator('input[placeholder="密码"]')).toBeVisible();
    await expect(page.locator("#login-qr iframe")).toHaveCount(0);
  });

  test("demo 用户 ADMIN 登录成功", async ({ page }) => {
    await login(page);
    await expect(page.locator("h1")).toContainText("用户管理");
  });
});

test.describe("AuthCoreAdmin — App management", () => {
  test("navigates to apps page from default user page", async ({ page }) => {
    await login(page);
    await expect(page.locator("h1")).toContainText("用户管理");
    await page.locator('a:has-text("应用管理")').first().click();
    await expect(page).toHaveURL(/\/apps/);
  });

  test("shows app list after login", async ({ page }) => {
    await login(page, "/apps");
    await expect(page.locator("h1")).toContainText("应用管理");
    await expect(page.locator('button:has-text("新增应用")')).toBeVisible();
  });

  test("opens and closes create app modal", async ({ page }) => {
    await login(page, "/apps");
    await page.locator('button:has-text("新增应用")').click();
    await expect(page.locator("h3:has-text('新增应用')")).toBeVisible({ timeout: 5000 });
    await page.locator('button:has-text("取消")').click();
    await expect(page.locator("h3:has-text('新增应用')")).not.toBeVisible();
  });
});

test.describe("AuthCoreAdmin — Navigation", () => {
  test("navigation links work between pages", async ({ page }) => {
    await login(page);

    await page.locator('nav a:has-text("用户管理")').click();
    await expect(page).toHaveURL(/\/users/);
    await expect(page.locator("h1")).toContainText("用户管理");

    await page.locator('nav a:has-text("应用管理")').click();
    await expect(page).toHaveURL(/\/apps/);
    await expect(page.locator("h1")).toContainText("应用管理");

    // Use SPA navigation to return to the default admin page.
    await spaNavigate(page, "/");
    await expect(page).toHaveURL(/\/admin\/?$/);
    await expect(page.locator("h1")).toContainText("用户管理");
  });
});

test.describe("AuthCoreAdmin — User list sorting", () => {
  test("shows sort buttons on users page", async ({ page }) => {
    await login(page, "/users");
    await expect(page.locator("h1")).toContainText("用户管理");
    await expect(page.locator('button:has-text("姓名")')).toBeVisible();
    await expect(page.locator('button:has-text("创建时间")')).toBeVisible();
    await expect(page.locator('button:has-text("审核状态")')).toBeVisible();
  });

  test("sort by name toggles direction", async ({ page }) => {
    await login(page, "/users");
    // Default sort is by name ascending
    const nameBtn = page.locator('button:has-text("姓名")');
    await expect(nameBtn).toBeVisible();
    // Click to toggle to descending
    await nameBtn.click();
    // The button should show ↓ after toggle
    await expect(nameBtn).toContainText("↓");
    // Click again to go back to ascending
    await nameBtn.click();
    await expect(nameBtn).toContainText("↑");
  });

  test("sort by created_at changes order", async ({ page }) => {
    await login(page, "/users");
    const timeBtn = page.locator('button:has-text("创建时间")');
    await timeBtn.click();
    await expect(timeBtn).toContainText("↑");
    // Toggle to descending
    await timeBtn.click();
    await expect(timeBtn).toContainText("↓");
  });

  test("sort by status toggles direction", async ({ page }) => {
    await login(page, "/users");
    const statusBtn = page.locator('button:has-text("审核状态")');
    await statusBtn.click();
    await expect(statusBtn).toContainText("↑");
    // Toggle to descending
    await statusBtn.click();
    await expect(statusBtn).toContainText("↓");
  });
});
