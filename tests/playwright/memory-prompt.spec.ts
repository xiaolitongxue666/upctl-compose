/**
 * memory-prompt.spec.ts — 验证 MEMORY.md 和默认 prompt 是否生效
 *
 * 测试内容:
 * 1. MEMORY.md 已配置且可访问
 * 2. prompt_prefix 已配置且出现在组装提示词中
 * 3. agent_prompt dry_run 输出的组装提示词包含记忆上下文和指令前缀
 * 4. 截图保存验证过程，供人工审查
 */
import { test, expect, type Page } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

const BASE_URL = "http://localhost:8088";
const API_BASE = `${BASE_URL}/api/v2/upctl/api`;

/** 通过表单登录获取 JWT */
async function loginViaForm(page: Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForSelector('input[placeholder="用户名"]');
  await page.locator('input[placeholder="用户名"]').fill("demo");
  await page.locator('input[placeholder="密码"]').fill("demo123");
  await page.locator('button:has-text("登录")').click();
  await page.waitForFunction(
    () => !!window.localStorage.getItem("Authorization"),
    { timeout: 10_000 },
  );
}

/**
 * 注入一个带样式的验证结果页面并截图。
 * 这样人眼可以看到每个检查项的状态。
 */
async function showResultsAndScreenshot(
  page: Page,
  title: string,
  checks: { label: string; status: "✅" | "❌"; detail: string }[],
  screenshotName: string,
) {
  const rows = checks
    .map(
      (c) =>
        `<tr>
          <td style="padding:6px 12px;border:1px solid #444;font-size:14px">${c.status}</td>
          <td style="padding:6px 12px;border:1px solid #444;font-size:14px">${c.label}</td>
          <td style="padding:6px 12px;border:1px solid #444;font-size:14px;color:#aaa">${c.detail}</td>
        </tr>`,
    )
    .join("\n");

  await page.evaluate(
    ({ title, rows }) => {
      document.body.innerHTML = `
        <div style="font-family:monospace;padding:24px;background:#1a1a2e;color:#e0e0e0;min-height:100vh">
          <h1 style="color:#4fc3f7;font-size:22px;margin-bottom:8px">🧪 ${title}</h1>
          <p style="color:#888;margin-bottom:20px">${new Date().toISOString()}</p>
          <table style="border-collapse:collapse;width:100%;max-width:900px">
            <thead>
              <tr style="background:#2d2d44">
                <th style="padding:8px 12px;border:1px solid #444;text-align:left;color:#81c784">状态</th>
                <th style="padding:8px 12px;border:1px solid #444;text-align:left;color:#81c784">检查项</th>
                <th style="padding:8px 12px;border:1px solid #444;text-align:left;color:#81c784">详情</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      `;
    },
    { title, rows },
  );

  const screenshotDir = path.resolve(__dirname, "screenshots");
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
  const filePath = path.join(screenshotDir, screenshotName);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`📸 Screenshot saved: ${filePath}`);
}

test.describe("MEMORY.md & 默认 Prompt 验证", () => {
  test("MEMORY.md 和 prompt_prefix 在 agent_prompt 组装中生效", async ({ page }) => {
    // ── 1. 登录 ──
    await loginViaForm(page);
    const jwt = await page.evaluate(() => localStorage.getItem("Authorization"));
    expect(jwt).toBeTruthy();
    console.log("✅ 登录成功，JWT 已获取");

    // ── 2. 通过 API 获取配置和组装提示词 ──
    const results = await page.evaluate(
      async ({ apiBase, jwt }) => {
        const headers = {
          Authorization: jwt!,
          "Content-Type": "application/json",
        };

        // 2a. 获取 prompt prefix 配置
        const prefixResp = await fetch(`${apiBase}/config/prompt-prefix`, {
          headers,
        });
        const prefixData = await prefixResp.json();

        // 2b. 获取 memory dir 配置
        const memoryResp = await fetch(`${apiBase}/config/memory-dir`, {
          headers,
        });
        const memoryData = await memoryResp.json();

        // 2c. 调用 agent/prompt dry_run 获取组装后的完整提示词
        const promptResp = await fetch(`${apiBase}/agent/prompt`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            prompt: "查看当前部署环境的配置信息，确认各服务运行状态",
            dry_run: true,
          }),
        });
        const promptData = await promptResp.json();
        const assembledRaw = promptData.d ? JSON.parse(promptData.d) : null;
        const assembledPrompt = assembledRaw?.assembled_prompt || "";

        return {
          prefix: prefixData.d?.prefix || "",
          memoryDir: memoryData.d?.memory_dir || "",
          assembledPrompt,
        };
      },
      { apiBase: API_BASE, jwt },
    );

    // ── 3. 断言验证 ──
    const checks: { label: string; status: "✅" | "❌"; detail: string }[] = [];

    // 3a. Prompt prefix
    const prefixContainsExpectation =
      results.prefix.includes("不要进入plan mode") &&
      results.prefix.includes("直接干活");
    checks.push({
      label: "prompt_prefix 配置正确",
      status: prefixContainsExpectation ? "✅" : "❌",
      detail: prefixContainsExpectation
        ? `prefix="${results.prefix.slice(0, 60)}..."`
        : `实际值="${results.prefix}"`,
    });
    expect(prefixContainsExpectation).toBeTruthy();
    console.log(`✅ Prompt prefix: ${results.prefix}`);

    // 3b. Memory dir
    const memoryConfigured = results.memoryDir.length > 0;
    checks.push({
      label: "memory_dir 已配置",
      status: memoryConfigured ? "✅" : "❌",
      detail: memoryConfigured
        ? `memory_dir="${results.memoryDir}"`
        : "未配置",
    });
    expect(memoryConfigured).toBeTruthy();
    console.log(`✅ Memory dir: ${results.memoryDir}`);

    // 3c. 组装提示词中包含 Memory 上下文指令
    const hasMemorySection = results.assembledPrompt.includes("Memory 上下文");
    checks.push({
      label: "组装提示词包含 Memory 上下文指令",
      status: hasMemorySection ? "✅" : "❌",
      detail: hasMemorySection
        ? "已包含「## Memory 上下文」段落"
        : "未找到 Memory 上下文段落",
    });
    expect(hasMemorySection).toBeTruthy();

    // 3d. 组装提示词中包含 MEMORY.md 文件路径
    const memoryDirPath = results.memoryDir.replace(/\/+$/, "");
    const hasMemFilePath =
      results.assembledPrompt.includes(`${memoryDirPath}/MEMORY.md`) ||
      results.assembledPrompt.includes("MEMORY.md");
    checks.push({
      label: "Memory 指令包含 MEMORY.md 路径",
      status: hasMemFilePath ? "✅" : "❌",
      detail: hasMemFilePath ? "cat 指令指向 MEMORY.md" : "未找到 MEMORY.md 引用",
    });
    expect(hasMemFilePath).toBeTruthy();

    // 3e. 组装提示词中包含 claude_prompt_prefix
    const hasPrefixInPrompt =
      results.assembledPrompt.includes("不要进入plan mode");
    checks.push({
      label: "组装提示词包含 prompt_prefix",
      status: hasPrefixInPrompt ? "✅" : "❌",
      detail: hasPrefixInPrompt
        ? "前缀「不要进入plan mode」出现在提示词中"
        : "未找到前缀",
    });
    expect(hasPrefixInPrompt).toBeTruthy();

    // 3f. 组装提示词中包含用户原始提示
    const hasUserPrompt = results.assembledPrompt.includes("查看当前部署环境");
    checks.push({
      label: "组装提示词包含用户提示内容",
      status: hasUserPrompt ? "✅" : "❌",
      detail: hasUserPrompt
        ? "用户提示「查看当前部署环境…」可见"
        : "用户提示未出现在组装结果中",
    });
    expect(hasUserPrompt).toBeTruthy();

    // 3g. 组装提示词的结构顺序：prefix → memory → user
    const idxPrefix = results.assembledPrompt.indexOf("不要进入plan mode");
    const idxMemory = results.assembledPrompt.indexOf("## Memory 上下文");
    const idxUser = results.assembledPrompt.indexOf("查看当前部署环境");
    const structureCorrect =
      idxPrefix >= 0 &&
      idxMemory >= 0 &&
      idxUser >= 0 &&
      idxPrefix < idxMemory &&
      idxMemory < idxUser;
    checks.push({
      label: "提示词结构顺序正确 (prefix → memory → user)",
      status: structureCorrect ? "✅" : "❌",
      detail: structureCorrect
        ? `顺序: prefix(${idxPrefix}) < memory(${idxMemory}) < user(${idxUser})`
        : `prefix=${idxPrefix} memory=${idxMemory} user=${idxUser}`,
    });
    expect(structureCorrect).toBeTruthy();

    console.log(
      `📋 Assembled prompt (${results.assembledPrompt.length} chars):\n${results.assembledPrompt.slice(0, 800)}...`,
    );

    // ── 4. 截图保存验证结果 ──
    await showResultsAndScreenshot(
      page,
      "MEMORY.md & Prompt 验证",
      checks,
      "memory-prompt-verification.png",
    );
  });

  test("dry_run 返回的组装提示词包含完整 sections（带截图）", async ({ page }) => {
    await loginViaForm(page);
    const jwt = await page.evaluate(() => localStorage.getItem("Authorization"));
    expect(jwt).toBeTruthy();

    // 抓取完整组装提示词
    const result = await page.evaluate(
      async ({ apiBase, jwt }) => {
        const resp = await fetch(`${apiBase}/agent/prompt`, {
          method: "POST",
          headers: {
            Authorization: jwt!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: "Deploy the latest build to staging",
            dry_run: true,
          }),
        });
        const data = await resp.json();
        const assembled: string = data.d
          ? JSON.parse(data.d).assembled_prompt
          : "";
        return assembled;
      },
      { apiBase: API_BASE, jwt },
    );

    expect(result.length).toBeGreaterThan(50);

    // 按空行切分段落，验证结构
    const sections = result
      .split("\n\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const checks: { label: string; status: "✅" | "❌"; detail: string }[] = [];

    const hasPrefix = sections.some((s) => s.includes("不要进入plan mode"));
    checks.push({
      label: "Section: prompt_prefix 指令",
      status: hasPrefix ? "✅" : "❌",
      detail: hasPrefix ? "存在" : "缺失",
    });

    const hasMemory = sections.some((s) => s.includes("Memory 上下文"));
    checks.push({
      label: "Section: Memory 上下文",
      status: hasMemory ? "✅" : "❌",
      detail: hasMemory ? "存在" : "缺失",
    });

    const hasUserPrompt = sections.some((s) => s.includes("Deploy the latest build"));
    checks.push({
      label: "Section: 用户提示",
      status: hasUserPrompt ? "✅" : "❌",
      detail: hasUserPrompt ? "存在" : "缺失",
    });

    checks.push({
      label: "段落数量",
      status: sections.length >= 3 ? "✅" : "❌",
      detail: `共 ${sections.length} 个段落`,
    });

    // 显示完整组装提示词（截取前 1500 字符）
    const promptPreview =
      result.length > 1500
        ? result.slice(0, 1500) + `\n\n... (${result.length - 1500} more chars)`
        : result;

    // 注入组装提示词正文到页面中截图
    await page.evaluate(
      ({ checks, promptPreview }) => {
        const rowsHtml = checks
          .map(
            (c: any) =>
              `<tr>
                <td style="padding:6px 12px;border:1px solid #444;font-size:14px">${c.status}</td>
                <td style="padding:6px 12px;border:1px solid #444;font-size:14px">${c.label}</td>
                <td style="padding:6px 12px;border:1px solid #444;font-size:14px;color:#aaa">${c.detail}</td>
              </tr>`,
          )
          .join("\n");

        document.body.innerHTML = `
          <div style="font-family:monospace;padding:24px;background:#1a1a2e;color:#e0e0e0;min-height:100vh">
            <h1 style="color:#4fc3f7;font-size:22px;margin-bottom:8px">📄 Agent Prompt 组装验证</h1>
            <p style="color:#888;margin-bottom:20px">${new Date().toISOString()}</p>
            <table style="border-collapse:collapse;width:100%;max-width:900px;margin-bottom:24px">
              <thead>
                <tr style="background:#2d2d44">
                  <th style="padding:8px 12px;border:1px solid #444;text-align:left;color:#81c784">状态</th>
                  <th style="padding:8px 12px;border:1px solid #444;text-align:left;color:#81c784">Section</th>
                  <th style="padding:8px 12px;border:1px solid #444;text-align:left;color:#81c784">详情</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
            <h2 style="color:#ffb74d;font-size:16px;margin-bottom:8px">组装提示词预览</h2>
            <pre style="background:#2d2d44;padding:12px;border-radius:4px;font-size:13px;line-height:1.5;max-height:500px;overflow-y:auto;white-space:pre-wrap;word-break:break-word">${promptPreview}</pre>
          </div>
        `;
      },
      { checks, promptPreview },
    );

    const screenshotDir = path.resolve(__dirname, "screenshots");
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    await page.screenshot({
      path: path.join(screenshotDir, "prompt-sections-verification.png"),
      fullPage: true,
    });
    console.log("📸 Screenshot: prompt-sections-verification.png");

    // 最终断言
    expect(hasPrefix).toBeTruthy();
    expect(hasMemory).toBeTruthy();
    expect(hasUserPrompt).toBeTruthy();
    expect(sections.length).toBeGreaterThanOrEqual(3);
  });
});
