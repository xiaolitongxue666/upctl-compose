import { test, expect } from "@playwright/test";
import * as crypto from "crypto";

const BASE_URL = "http://localhost:8088";

/** Generate a dev JWT for upctl-compose (JWT_KEY from docker-compose.yml). */
function generateJwt(roles?: { role_key: string }[]): string {
  const jwtKey = process.env.JWT_KEY || "upctl-dev-jwt-key-change-in-production";
  const htyToken = {
    token_id: "e2e-agent-test",
    hty_id: null,
    app_id: null,
    ts: new Date().toISOString().replace(/\.\d+Z$/, ""),
    roles: roles || [{ role_key: "ADMIN" }],
    tags: [],
    current_org_id: null,
    current_org_role_keys: null,
    current_department_id: null,
  };
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: JSON.stringify(htyToken), exp: now + 3600, iat: now };
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64url").replace(/=+$/, "");
  const header = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = crypto
    .createHmac("sha256", jwtKey)
    .update(`${header}.${body}`)
    .digest("base64url")
    .replace(/=+$/, "");
  return `${header}.${body}.${sig}`;
}

const APi_BASE = `${BASE_URL}/api/v2/upctl/api`;

// ── Auth tests ────────────────────────────────────────────────

test.describe("Agent endpoint auth", () => {
  test("agent_prompt returns 401 without Authorization header", async () => {
    const resp = await fetch(`${APi_BASE}/agent/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test", dry_run: true }),
    });
    expect(resp.status).toBe(401);
  });

  test("agent_prompt returns 401 with malformed JWT", async () => {
    const resp = await fetch(`${APi_BASE}/agent/prompt`, {
      method: "POST",
      headers: { Authorization: "not-a-valid-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test", dry_run: true }),
    });
    expect(resp.status).toBe(401);
  });

  test("agent_prompt returns 401 with wrong-key JWT", async () => {
    const resp = await fetch(`${APi_BASE}/agent/prompt`, {
      method: "POST",
      headers: { Authorization: generateJwt() + "x", "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test", dry_run: true }),
    });
    expect(resp.status).toBe(401);
  });

  test("agent_prompt returns 401 without admin/tester role", async () => {
    const noRoleJwt = generateJwt([{ role_key: "USER" }]);
    const resp = await fetch(`${APi_BASE}/agent/prompt`, {
      method: "POST",
      headers: { Authorization: noRoleJwt, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test", dry_run: true }),
    });
    expect(resp.status).toBe(401);
  });

  test("agent_capture returns 401 without auth", async () => {
    const resp = await fetch(`${APi_BASE}/tmux/test_session`);
    expect(resp.status).toBe(401);
  });

  test("agent_send_keys returns 401 without auth", async () => {
    const resp = await fetch(`${APi_BASE}/tmux/test_session/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: "test" }),
    });
    expect(resp.status).toBe(401);
  });
});

// ── Prompt assembly tests (dry_run) ────────────────────────────

test.describe("Agent prompt assembly (dry_run)", () => {
  const jwt = generateJwt([{ role_key: "ADMIN" }]);

  test.beforeEach(async () => {
    const resp = await fetch(`${APi_BASE}/config/memory-dir`, {
      method: "PUT",
      headers: { Authorization: jwt, "Content-Type": "application/json" },
      body: JSON.stringify({ memory_dir: "/app/data" }),
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.r).toBe(true);
  });

  test("assembled prompt contains claude_prompt_prefix and memory instruction", async () => {
    const userPrompt = "Implement feature X";
    const resp = await fetch(`${APi_BASE}/agent/prompt`, {
      method: "POST",
      headers: { Authorization: jwt, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userPrompt, dry_run: true }),
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.r).toBe(true);

    const assembled: string = JSON.parse(body.d).assembled_prompt;
    expect(assembled).toBeTruthy();

    // Should contain the claude_prompt_prefix (default: "不要进入plan mode，直接干活")
    expect(assembled).toContain("不要进入plan mode");
    expect(assembled).toContain("直接干活");

    // Should contain memory instruction (present when memory_instruction config is set)
    expect(assembled).toContain("Memory 上下文");

    // Should contain the user's prompt at the end
    expect(assembled).toContain(userPrompt);

    // claude_prompt_prefix should be first, user prompt should be last
    expect(assembled.indexOf("不要进入plan mode")).toBeLessThan(assembled.indexOf(userPrompt));
  });

  test("assembled prompt structure has three sections in order", async () => {
    const userPrompt = "Deploy the app";
    const resp = await fetch(`${APi_BASE}/agent/prompt`, {
      method: "POST",
      headers: { Authorization: jwt, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userPrompt, dry_run: true }),
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    const assembled: string = JSON.parse(body.d).assembled_prompt;

    // Two+ sections separated by double newlines:
    // 1. claude_prompt_prefix
    // 2. memory_instruction (if configured)
    // 3. user prompt
    const sections = assembled.split("\n\n").filter(s => s.length > 0);
    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(sections[0]).toContain("不要进入plan mode");
    expect(sections[sections.length - 1]).toContain(userPrompt);
  });

  test("dry_run does not include ticket context when no ticket_number", async () => {
    const resp = await fetch(`${APi_BASE}/agent/prompt`, {
      method: "POST",
      headers: { Authorization: jwt, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Deploy", dry_run: true }),
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    const assembled: string = JSON.parse(body.d).assembled_prompt;

    // Should NOT contain ticket context markers
    expect(assembled).not.toContain("## 工单上下文");
  });

  test("dry_run response returns expected metadata fields", async () => {
    const resp = await fetch(`${APi_BASE}/agent/prompt`, {
      method: "POST",
      headers: { Authorization: jwt, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Test", ticket_number: 1, dry_run: true }),
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    const data = JSON.parse(body.d);

    expect(data.session).toBeTruthy();
    expect(data.ticket_number).toBe(1);
    expect(data.assembled_prompt).toBeTruthy();
  });

  test("dry_run with tester role works", async () => {
    const testerJwt = generateJwt([{ role_key: "TESTER" }]);
    const resp = await fetch(`${APi_BASE}/agent/prompt`, {
      method: "POST",
      headers: { Authorization: testerJwt, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Test", dry_run: true }),
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.r).toBe(true);
  });
});
