import { test, expect, type Page } from "@playwright/test";
import * as path from "path";

/** Root of the docker-compose project (contains docker-compose.yml). */
const COMPOSE_DIR = path.resolve(__dirname, "..", "..");

function triggerPickAndProcess(): void {
  try {
    const cp = require("child_process");
    cp.execSync(
      `docker compose exec -T ai-agent python3 -c "import sys; sys.path.insert(0, '/app'); from poll_worker import pick_and_process; pick_and_process()"`,
      { cwd: COMPOSE_DIR, timeout: 120_000, stdio: "pipe" },
    );
  } catch (e: unknown) {
    console.warn("triggerPickAndProcess failed — falling back to daemon poll:", e);
  }
}

const BASE_URL = "http://localhost:8088";

/** Log in via the username/password form and return the JWT from localStorage. */
async function loginAndGetJwt(page: Page): Promise<string> {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForSelector('input[placeholder="用户名"]');
  await page.locator('input[placeholder="用户名"]').fill("demo");
  await page.locator('input[placeholder="密码"]').fill("demo123");
  await page.locator('button:has-text("登录")').click();
  // Wait for JWT to be stored (login API succeeded)
  await page.waitForFunction(
    () => !!window.localStorage.getItem("Authorization"),
    { timeout: 10_000 },
  );
  // Extract JWT from localStorage
  const jwt = await page.evaluate(() => window.localStorage.getItem("Authorization") || "");
  return jwt;
}

const hasDeepSeekKey = !!process.env.DEEPSEEK_API_KEY;

test.describe("Full pipeline", () => {
  test("create approved ticket, ai-agent processes, verify via browser", async ({ page }) => {
    test.setTimeout(300_000); // 5 min
    test.skip(!hasDeepSeekKey, "DEEPSEEK_API_KEY not set — ai-agent cannot process");

    // 1. Log in via the form with demo credentials
    const jwt = await loginAndGetJwt(page);
    expect(jwt).toBeTruthy();
    expect(jwt.split(".").length).toBe(3); // valid JWT format

    const uniqueId = Date.now().toString(36);
    const title = `E2E Playwright pipeline test ${uniqueId}`;
    const body = "Please reply with exactly: PLAYWRIGHT-PIPE-OK";

    // 2. Create an approved ticket via browser-side fetch
    const ticketNum: number = await page.evaluate(
      async ({ url, jwt, title, body }) => {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: jwt,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ title, body, labels: ["approved", "urgent"] }),
        });
        const data = await resp.json();
        return data?.d?.number || 0;
      },
      {
        url: `${BASE_URL}/api/v2/upctl/api/tickets`,
        jwt,
        title,
        body,
      },
    );
    expect(ticketNum).toBeGreaterThan(0);

    // 3. Navigate to ticket detail page and confirm it's displayed correctly
    await page.goto(`${BASE_URL}/tickets/${ticketNum}`);
    await expect(page.locator("h1")).toContainText(`#${ticketNum}`);
    await expect(page.locator(".ticket-title")).toContainText(title);
    await expect(page.locator("strong.open")).toBeVisible();

    // 4. Trigger ai-agent processing
    triggerPickAndProcess();

    // 5. Poll the API until the ticket is closed
    let isClosed = false;
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(5_000);
      const state: string = await page.evaluate(
        async ({ url, jwt }) => {
          const resp = await fetch(url, {
            headers: { Authorization: jwt, Accept: "application/json" },
          });
          const data = await resp.json();
          const issue: Record<string, unknown> = data?.d?.issue || data?.d || {};
          return (issue.state as string) || "unknown";
        },
        { url: `${BASE_URL}/api/v2/upctl/api/tickets/${ticketNum}`, jwt },
      );
      if (state === "closed") {
        isClosed = true;
        break;
      }
    }
    expect(isClosed).toBeTruthy();

    // 6. Refresh and verify
    await page.goto(`${BASE_URL}/tickets/${ticketNum}`);
    await expect(page.locator("strong.closed")).toBeVisible();
    const commentsSection = page.locator(".comments-section");
    await expect(commentsSection).toBeVisible();
    const commentCards = page.locator(".comment-card");
    const count = await commentCards.count();
    expect(count).toBeGreaterThan(0);
    await expect(commentsSection).toContainText("Processing result");
  });
});
