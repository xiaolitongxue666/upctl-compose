#!/bin/bash
# cleanup_in_progress.sh — Remove stale in_progress label from closed tickets
#
# Scans closed tickets that still have the "in_progress" label and removes it.
# Runs every 5 minutes via cron as a safety net — when the agent closes a ticket
# but forgets to remove the in_progress label, this script cleans it up.
#
# This prevents false "already in_progress" detection on the next cycle.
#
# Requirements:
#   - curl, python3
#   - GITEA_API_BASE (e.g. https://ci.example.com/api/v1/repos/owner/repo)
#   - GITEA_AUTH_HEADER or GITEA_AUTH_BASIC (one must be set)
#
# Environment Variables:
#   GITEA_API_BASE      — Gitea API base URL for the tickets repo (required)
#   GITEA_AUTH_HEADER   — Full Authorization header value, e.g. "token xyz" or "Bearer xyz"
#   GITEA_AUTH_BASIC    — Basic auth string "user:token" (alternative to AUTH_HEADER)
#   LABEL_NAME          — Label name to clean up (default: in_progress)
#   LABEL_ID            — Label numeric ID for DELETE endpoint (default: auto-detect)
#
# Examples:
#   export GITEA_API_BASE="https://ci.moicen.com/api/v1/repos/weli/tickets"
#   export GITEA_AUTH_BASIC="ai-bot:your-token-here"
#   bash scripts/cleanup_in_progress.sh

set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

# ── Configuration (from env) ──
GITEA_API_BASE="${GITEA_API_BASE:-}"
GITEA_AUTH_HEADER="${GITEA_AUTH_HEADER:-}"
GITEA_AUTH_BASIC="${GITEA_AUTH_BASIC:-}"
LABEL_NAME="${LABEL_NAME:-in_progress}"
LABEL_ID="${LABEL_ID:-}"

# ── Logging ──
LOG_DIR="${HOME}/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/cleanup_in_progress.log"

log() {
  echo "[cleanup] $(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG_FILE"
}

# ── Validate ──
if [ -z "$GITEA_API_BASE" ]; then
  log "ERROR: GITEA_API_BASE not set"
  exit 1
fi

if [ -z "$GITEA_AUTH_HEADER" ] && [ -z "$GITEA_AUTH_BASIC" ]; then
  log "ERROR: Neither GITEA_AUTH_HEADER nor GITEA_AUTH_BASIC set"
  exit 1
fi

# ── Build curl auth args ──
CURL_AUTH=()
if [ -n "$GITEA_AUTH_HEADER" ]; then
  CURL_AUTH=(-H "Authorization: ${GITEA_AUTH_HEADER}")
elif [ -n "$GITEA_AUTH_BASIC" ]; then
  CURL_AUTH=(-u "${GITEA_AUTH_BASIC}")
fi

# ── Auto-detect label ID if not specified ──
if [ -z "$LABEL_ID" ]; then
  log "LABEL_ID not set, auto-detecting..."
  LABEL_ID=$(curl -sfS --connect-timeout 10 "${CURL_AUTH[@]}" \
    "${GITEA_API_BASE}/labels" 2>/dev/null | python3 -c "
import json, sys
try:
    labels = json.load(sys.stdin)
    for l in labels:
        if l.get('name') == '${LABEL_NAME}':
            print(l['id'])
except: pass
" 2>/dev/null || true)

  if [ -z "$LABEL_ID" ]; then
    log "ERROR: Could not detect label ID for '${LABEL_NAME}'"
    exit 1
  fi
  log "Detected label '${LABEL_NAME}' → id=${LABEL_ID}"
fi

# ── Scan closed tickets and remove stale label ──
log "检查已关闭但仍有 ${LABEL_NAME} 标签的工单..."

PYTHON_SCRIPT=$(cat << 'PYEOF'
import json, urllib.request, sys, os

API_BASE = os.environ['GITEA_API_BASE']
LABEL_NAME = os.environ.get('LABEL_NAME', 'in_progress')
LABEL_ID = os.environ.get('LABEL_ID', '')

AUTH_HEADER = os.environ.get('GITEA_AUTH_HEADER', '')
AUTH_BASIC = os.environ.get('GITEA_AUTH_BASIC', '')

opener = urllib.request.build_opener()

# Configure auth
if AUTH_HEADER:
    opener.addheaders = [('Authorization', AUTH_HEADER)]
elif AUTH_BASIC:
    user, token = AUTH_BASIC.split(':', 1)
    password_mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
    password_mgr.add_password(None, API_BASE, user, token)
    handler = urllib.request.HTTPBasicAuthHandler(password_mgr)
    opener = urllib.request.build_opener(handler)

page = 1
total_cleaned = 0

while True:
    url = f"{API_BASE}/issues?state=closed&page={page}&limit=50"
    try:
        resp = opener.open(url, timeout=15)
        issues = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"ERROR: HTTP {e.code} on page {page}: {e.reason}", file=sys.stderr)
        break
    except Exception as e:
        print(f"ERROR: page {page} failed: {e}", file=sys.stderr)
        break

    if not issues:
        break

    for issue in issues:
        labels = [l.get('name', '') for l in issue.get('labels', [])]
        if LABEL_NAME in labels:
            num = issue['number']
            del_url = f"{API_BASE}/issues/{num}/labels/{LABEL_ID}"
            del_req = urllib.request.Request(del_url, method='DELETE')
            try:
                del_resp = opener.open(del_req, timeout=10)
                code = del_resp.getcode()
                if code in (200, 204):
                    print(f"OK {num}")
                    total_cleaned += 1
                else:
                    print(f"ERR {num} HTTP {code}", file=sys.stderr)
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    pass  # label already removed
                else:
                    print(f"ERR {num} HTTP {e.code}", file=sys.stderr)
            except Exception as e:
                print(f"ERR {num} {e}", file=sys.stderr)

    page += 1

print(f"DONE {total_cleaned}", file=sys.stderr)
PYEOF
)

export GITEA_API_BASE GITEA_AUTH_HEADER GITEA_AUTH_BASIC LABEL_NAME LABEL_ID
RESULT=$(python3 -c "$PYTHON_SCRIPT" 2>&1)

CLEANED=$(echo "$RESULT" | grep -c "^OK " || true)
DONE_LINE=$(echo "$RESULT" | grep "^DONE " || true)

if [ -n "$DONE_LINE" ]; then
  log "完成：清理了 ${CLEANED} 个工单的 ${LABEL_NAME} 标签"
else
  ERR_MSGS=$(echo "$RESULT" | grep "^ERROR\|^ERR " | head -5 || true)
  if [ -n "$ERR_MSGS" ]; then
    log "执行出错"
    echo "$ERR_MSGS" >> "$LOG_FILE"
  else
    log "没有需要清理的工单 ✓"
  fi
fi

if [ "$CLEANED" -gt 0 ]; then
  echo "$RESULT" | grep "^OK " || true | while IFS=' ' read -r _ num; do
    log "  #${num} ✓ ${LABEL_NAME} 已移除"
  done
fi