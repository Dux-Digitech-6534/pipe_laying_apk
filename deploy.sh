#!/usr/bin/env bash
#
# Deploy the Pipe Laying mobile app to jewipl.duxdigitech.in.
#
# This is the whole release process. The APK never changes — it loads the live
# URL — so shipping a fix (backend OR frontend) means running this script.
#
#   ./deploy.sh          build + deploy everything
#   ./deploy.sh backend  Python only (skips the frontend build)
#   ./deploy.sh frontend assets + shell only
#
# Frontend changes need no reload — the www/ pages are plain files resolved per
# request. Backend (Python) changes DO: gunicorn runs with --preload, so a plain
# scp + clear-cache leaves the OLD module running in the workers' memory (console
# shows the new code, the live app does not). So after a backend deploy this
# script sends a graceful SIGHUP to the gunicorn MASTER: workers recycle and
# re-import mobile_api.py from disk with ZERO downtime (the master keeps the
# listening socket), and no full bench restart — the other sites on this bench are
# never 502'd.

set -euo pipefail

HOST="frappe@187.127.132.58"
SITE="jewipl.duxdigitech.in"
BENCH="/home/frappe/frappe-bench"
APP="$BENCH/apps/pipe_laying_inhouse/pipe_laying_inhouse"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-all}"

# One monotonic stamp per deploy, used to cache-bust index.js / index.css.
BUILD="$(date +%Y%m%d%H%M%S)"

say() { printf '\n\033[1;35m▸ %s\033[0m\n' "$1"; }

# --------------------------------------------------------------------- build

if [ "$MODE" = "all" ] || [ "$MODE" = "frontend" ]; then
  say "Building the SPA"
  (cd "$HERE/frontend" && npm run build)

  say "Stamping the shell pages with build $BUILD"
  STAGE="$(mktemp -d)"
  trap 'rm -rf "$STAGE"' EXIT

  sed "s/__BUILD__/$BUILD/g" "$HERE/backend/shell.html" > "$STAGE/m.html"
  cp "$HERE/backend/index_redirect.html" "$STAGE/index.html"

  say "Uploading assets + pages"
  # www/pipe-laying/ has NO Python controller on purpose: Frappe can't import a
  # module from a hyphenated folder, and going without one is exactly what lets
  # the app live at a pretty URL with no worker restart. The CSRF token still
  # arrives — Frappe rewrites the <!-- csrf_token --> comment after rendering.
  ssh "$HOST" "mkdir -p '$APP/public/plm' '$APP/www/pipe-laying'"
  scp -q -r "$HERE/pipe_laying_inhouse/public/plm/." "$HOST:$APP/public/plm/"
  scp -q "$STAGE/m.html" "$STAGE/index.html" "$HOST:$APP/www/pipe-laying/"
  # Root-served so it may claim the /pipe-laying/ scope it registers with.
  scp -q "$HERE/frontend/public/plm-sw.js" "$HOST:$APP/www/plm-sw.js"
fi

# ------------------------------------------------------------------- backend

if [ "$MODE" = "all" ] || [ "$MODE" = "backend" ]; then
  say "Uploading the API"
  scp -q "$HERE/backend/mobile_api.py" "$HOST:$APP/"

  say "Compile check"
  ssh "$HOST" "cd '$BENCH' && ./env/bin/python -m py_compile '$APP/mobile_api.py'"
fi

# --------------------------------------------------------------------- apply

say "Clearing cache"
ssh "$HOST" "cd '$BENCH' && bench --site '$SITE' clear-cache"

# --------------------------------------------------------------------- reload
# Only after a backend deploy, and only a graceful SIGHUP (never a bench restart).
# Finds the gunicorn MASTER robustly — the frappe.app worker whose parent is NOT
# itself gunicorn (i.e. supervisord) — so it stays correct after workers recycle.
# All handled branches exit 0: the code is already on disk, so a reload hiccup
# should warn, not fail the deploy.

if [ "$MODE" = "all" ] || [ "$MODE" = "backend" ]; then
  say "Reloading web workers (graceful SIGHUP — zero downtime)"
  ssh "$HOST" '
    pids=$(pgrep -f "gunicorn.*frappe.app:application" || true)
    if [ -z "$pids" ]; then
      echo "  ! gunicorn not found — reload the web workers manually"; exit 0
    fi
    master=""
    for pid in $pids; do
      ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d " ")
      if ! printf "%s\n" $pids | grep -qx "$ppid"; then master="$pid"; break; fi
    done
    if [ -z "$master" ]; then
      echo "  ! could not identify gunicorn master — reload manually"; exit 0
    fi
    if kill -HUP "$master" 2>/dev/null; then
      echo "  HUP sent to gunicorn master $master — workers re-importing new code"
    else
      echo "  ! HUP failed (permission?) — reload the web workers manually"
    fi
    exit 0
  '
fi

# --------------------------------------------------------------------- verify

say "Verifying"
for path in /pipe-laying/m /plm-sw.js /assets/pipe_laying_inhouse/plm/index.js; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "https://$SITE$path")"
  printf '  %s  %s\n' "$code" "$path"
done

say "Done — build $BUILD live at https://$SITE/pipe-laying/m"
