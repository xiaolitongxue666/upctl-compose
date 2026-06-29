#!/usr/bin/env python3
"""Test that agent prompt content appears exactly once in tmux pane.

This test simulates the send_prompt behavior with activity detection:
1. Send prompt text via tmux literal mode
2. Send first Enter to submit
3. Capture pane twice with a gap to detect if agent started processing
4. If pane content changes → agent is working → skip second Enter
5. If no change → send second Enter as fallback safety net

Usage (from upctl-compose root):
  docker compose cp tests/agent_dup_test.py ai-agent:/app/agent_dup_test.py
  docker compose exec -T ai-agent python3 /app/agent_dup_test.py <ticket_num> <jwt_token>
"""
import json, sys, os, time, subprocess

ticket_num = int(sys.argv[1])
jwt = sys.argv[2]

GITEA_API_BASE = os.environ.get("GITEA_API_BASE", "http://upctl-svc:3005/api/v2/upctl/api")
HEADERS = {"Authorization": jwt, "Content-Type": "application/json"}

import requests

# Fetch ticket details
resp = requests.get(f"{GITEA_API_BASE}/tickets/{ticket_num}", headers=HEADERS, timeout=15)
resp.raise_for_status()
d = resp.json().get("d", {})
issue = d.get("issue", {})
title = issue.get("title", "")
body_text = issue.get("body", "")
labels = [l["name"] for l in issue.get("labels", [])]
state = issue.get("state", "")

# Ensure tmux session exists
SESSION = "deepseek-agent"
has_session = subprocess.run(
    ["tmux", "has-session", "-t", SESSION],
    capture_output=True
)
if has_session.returncode != 0:
    subprocess.run(["tmux", "new-session", "-d", "-s", SESSION, "-c", "/app/workspace"], check=True)
    subprocess.run(["tmux", "send-keys", "-t", SESSION, "deepseek-tui", "Enter"], check=True)
    time.sleep(3)
    print("Started deepseek-tui in new tmux session")

# Extract unique marker from body
marker = body_text.strip()

# Build prompt (same structure as agent_prompt handler)
prompt = f"## 当前工单 #{ticket_num}\n标题: {title}\n状态: {state}\n"
if labels:
    prompt += f"标签: {', '.join(labels)}\n"
prompt += f"\n## 工单内容\n{body_text}\n"
prompt += f"\n请处理以上工单。\n"

print(f"PROMPT_LEN:{len(prompt)}")
print(f"MARKER_IN_PROMPT:{marker in prompt}")

# Capture pane BEFORE
result_before = subprocess.run(
    ["tmux", "capture-pane", "-t", SESSION, "-p", "-S", "-200"],
    capture_output=True, text=True
)
before = result_before.stdout
print(f"BEFORE_LEN:{len(before)}")

# ── Simulate new send_prompt with activity detection ──

# Step 1: Send prompt text (literal mode)
subprocess.run(["tmux", "send-keys", "-l", "-t", SESSION, "--", prompt], check=True)
time.sleep(1)

# Step 2: Send first Enter
subprocess.run(["tmux", "send-keys", "-t", SESSION, "Enter"], check=True)
print("FIRST_ENTER_SENT:true")

# Step 3: Wait, then detect agent activity via double capture
time.sleep(2)

first_capture = subprocess.run(
    ["tmux", "capture-pane", "-t", SESSION, "-p", "-S", "-200"],
    capture_output=True, text=True
).stdout

time.sleep(1.5)

second_capture = subprocess.run(
    ["tmux", "capture-pane", "-t", SESSION, "-p", "-S", "-200"],
    capture_output=True, text=True
).stdout

agent_working = first_capture != second_capture
print(f"AGENT_WORKING:{agent_working}")
print(f"FIRST_CAPTURE_LEN:{len(first_capture)}")
print(f"SECOND_CAPTURE_LEN:{len(second_capture)}")
print(f"CURRENT_EXECUTABLE:{second_capture}")

if not agent_working:
    # Fallback: send second Enter
    time.sleep(1)
    subprocess.run(["tmux", "send-keys", "-t", SESSION, "Enter"], check=True)
    print("SECOND_ENTER_SENT:true (fallback — no agent activity detected)")
else:
    print("SECOND_ENTER_SENT:false (agent is working, second Enter skipped)")

time.sleep(2)

# Capture pane AFTER
result_after = subprocess.run(
    ["tmux", "capture-pane", "-t", SESSION, "-p", "-S", "-200"],
    capture_output=True, text=True
)
after = result_after.stdout

# Find new content (everything after the previous capture)
new_content = after[len(before):] if len(after) > len(before) else after
print(f"NEW_CONTENT_LEN:{len(new_content)}")

# Count marker in new content
marker_count = new_content.count(marker)
print(f"MARKER_COUNT:{marker_count}")
print(f"NEW_CONTENT_PREVIEW:{new_content[:300]!r}")

# The marker should appear at most once in the new content.
# 0 = agent didn't echo prompt (normal for production TUI)
# 1 = prompt visible in pane (normal for local shell fallback)
# >1 = duplication detected
if marker_count > 1:
    print(f"DUPLICATION_DETECTED:true (marker appears {marker_count} times)")
    sys.exit(1)
else:
    print(f"DUPLICATION_DETECTED:false")
    print("DONE")
