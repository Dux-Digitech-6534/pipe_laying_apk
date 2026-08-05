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
# No worker restart and no bench restart: whitelisted methods are imported on
# demand, and the www/ pages are plain files resolved per request. Other sites on
# this bench are never touched.

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

# --------------------------------------------------------------------- verify

say "Verifying"
for path in /pipe-laying/m /plm-sw.js /assets/pipe_laying_inhouse/plm/index.js; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "https://$SITE$path")"
  printf '  %s  %s\n' "$code" "$path"
done

say "Done — build $BUILD live at https://$SITE/pipe-laying/m"
