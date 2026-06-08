#!/usr/bin/env bash
# Start beeper-crm dev server when needed, then open Todo Chat in the default browser.
#
# Usage:
#   ./scripts/start-todochat.sh
#   pnpm run dev:todo
#
# Terminal / Shortcuts (full path):
#   "/Users/personalcoding.de/Library/CloudStorage/GoogleDrive-dawid@personalcoding.de/Andere Computer/Mein MacBook Air/DEV/beeper-crm/scripts/start-todochat.sh"
#
# Environment:
#   TODOCHAT_URL   default http://localhost:3002/todo
#   BEEPER_CRM_PORT default 3002

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCAL_DIR="${PROJECT_ROOT}/.local"
LOG_FILE="${LOCAL_DIR}/dev-server.log"
PID_FILE="${LOCAL_DIR}/dev-server.pid"

TODOCHAT_URL="${TODOCHAT_URL:-http://localhost:3002/todo}"
BEEPER_CRM_PORT="${BEEPER_CRM_PORT:-3002}"

LSOF="/usr/sbin/lsof"
CURL="/usr/bin/curl"
OPEN="/usr/bin/open"
PNPM=""

bootstrap_path() {
  # Shortcuts runs with a minimal PATH (often missing /usr/sbin and nvm).
  export PATH="/usr/sbin:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:${HOME}/.nvm/versions/node/v20.20.0/bin:${HOME}/.nvm/versions/node/v22.22.3/bin:${PATH:-}"

  if [[ -x "${HOME}/.nvm/versions/node/v20.20.0/bin/pnpm" ]]; then
    PNPM="${HOME}/.nvm/versions/node/v20.20.0/bin/pnpm"
  elif [[ -x "${HOME}/.nvm/versions/node/v22.22.3/bin/pnpm" ]]; then
    PNPM="${HOME}/.nvm/versions/node/v22.22.3/bin/pnpm"
  elif command -v pnpm >/dev/null 2>&1; then
    PNPM="$(command -v pnpm)"
  fi
}

require_tools() {
  [[ -x "$LSOF" ]] || {
    echo "Missing required command: lsof (${LSOF})" >&2
    exit 1
  }
  [[ -x "$CURL" ]] || {
    echo "Missing required command: curl (${CURL})" >&2
    exit 1
  }
  [[ -x "$OPEN" ]] || {
    echo "Missing required command: open (${OPEN})" >&2
    exit 1
  }
}

port_open() {
  "$LSOF" -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

server_running() {
  port_open "$BEEPER_CRM_PORT"
}

wait_for_server() {
  local attempts="${1:-120}"
  local i=0
  while (( i < attempts )); do
    if "$CURL" -sf "$TODOCHAT_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
    i=$((i + 1))
  done
  return 1
}

start_dev_server() {
  mkdir -p "$LOCAL_DIR"

  if [[ -z "$PNPM" || ! -x "$PNPM" ]]; then
    echo "Missing required command: pnpm" >&2
    exit 1
  fi

  if [[ ! -f "${PROJECT_ROOT}/.env" ]]; then
    echo "Warning: ${PROJECT_ROOT}/.env not found — Beeper API settings may be missing." >&2
  fi

  if [[ -f "$PID_FILE" ]]; then
    local old_pid
    old_pid="$(cat "$PID_FILE")"
    if kill -0 "$old_pid" 2>/dev/null; then
      echo "Dev server is starting (pid ${old_pid})…"
      if wait_for_server 120; then
        return 0
      fi
      echo "Timed out waiting for dev server. See ${LOG_FILE}" >&2
      exit 1
    fi
  fi

  echo "Starting beeper-crm dev server…"
  (
    cd "$PROJECT_ROOT"
    nohup "$PNPM" run dev >>"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"
  )

  if ! wait_for_server 120; then
    echo "Dev server did not become ready at ${TODOCHAT_URL}. See ${LOG_FILE}" >&2
    exit 1
  fi

  echo "Dev server ready → ${TODOCHAT_URL}"
}

open_todochat_in_browser() {
  "$OPEN" "$TODOCHAT_URL"
}

main() {
  bootstrap_path
  require_tools

  if server_running; then
    echo "Dev server already running (${TODOCHAT_URL})."
  else
    start_dev_server
  fi

  echo "Opening Todo Chat in default browser…"
  open_todochat_in_browser
}

main "$@"
