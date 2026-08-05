# Pipe Laying — mobile app (Pour Card)

Field-data app for the **Pour Card** system on `jewipl.duxdigitech.in`
(Frappe app `pipe_laying_inhouse`). Offline-capable, DUX-branded.

| | |
|---|---|
| **Live app** | <https://jewipl.duxdigitech.in/pipe-laying/m> |
| **APK** | `dist/PipeLaying-v1.0.0.apk` — package `com.dux.pipelaying` |
| **Deploy** | `./deploy.sh` |

---

## Architecture

A React SPA hosted **by** the Frappe site, wrapped once in a thin Capacitor
shell whose `server.url` points at the live URL. The APK contains no business
code (only a 1.7 KB "can't reach the server" fallback), so **every change —
backend or UI — reaches every phone by deploying to the server.** The APK is
built and signed once.

```
┌──────────────┐   loads URL   ┌────────────────────────────────────┐
│ Android APK  │ ────────────► │ React SPA served by Frappe         │
│ (Capacitor,  │               │  /pipe-laying/m                    │
│  never       │ ◄── cookie ── │  → mobile_api.py (whitelisted)     │
│  rebuilt)    │   session     │  → Pour Card doctypes              │
└──────────────┘               └────────────────────────────────────┘
        │                                    ▲
        │ IndexedDB outbox                   │ sync_batch (idempotent replay)
        └────────────────────────────────────┘
```

### Why the URL has no `hooks.py` route rule

`/pipe-laying/m` is served by plain files at
`pipe_laying_inhouse/www/pipe-laying/{index,m}.html` with **no Python
controller**. Frappe resolves `www/` paths straight off the filesystem per
request, so a new page needs only `clear-cache` — **no worker restart, and no
impact on the other 7 sites on this bench.** A `website_route_rules` entry in
`hooks.py` would have required restarting gunicorn.

The CSRF token still arrives without a controller: Frappe rewrites the
`<!-- csrf_token -->` comment into a script tag *after* rendering
(`base_template_page.add_csrf_token`). A controller is impossible here anyway —
Frappe derives the module name from the folder path, and `pipe-laying` contains a
hyphen, which is not importable.

---

## Layout

```
frontend/            React 18 + TS + Vite
  src/api.ts         the ONLY place backend method names live
  src/db.ts          IndexedDB: read caches + the write outbox
  src/sync.ts        offline engine — queue, reachability, replay, backoff
  src/calc.ts        client mirror of the Pour Card formulas
  src/store.tsx      capabilities, masters, the New Card cascade
  src/components/    Sheet, Picker (Link/Select), Fields, Feedback
  src/screens/       Home, Cards, NewCard, CardDetail, LayingDetails,
                     Backfilling, SyncScreen, Settings, Login
backend/
  mobile_api.py      whitelisted, screen-shaped, permission-checked
  shell.html         the hosted page (build stamp substituted at deploy)
  index_redirect.html
android-shell/       Capacitor wrapper (build once)
deploy.sh            build + upload + clear-cache + verify
```

---

## Offline behaviour

**Reads** — masters, capabilities, the card list and each opened card are cached
in IndexedDB. The app boots from cache and reconciles in the background, so it
opens instantly on a weak connection and works fully with none.

**Writes** — never go straight to the network. They enter an outbox and render
immediately as *pending*. `sync.ts` drains it whenever the connection is
genuinely usable (verified with a real ping, because Android reports "online"
for a radio that can't reach anything).

**Replay is idempotent**, so a retry after a dropped connection can't double-post:

- **Card creation** dedupes on the doctype's own natural key — the same 8 fields
  `pour_card.py` already rejects duplicates on. A replay resolves to the existing
  card instead of creating a second one.
- **Laying batches** carry a client-generated uid, ledgered as a Comment on the
  Pour Card (`plm-batch:<uid>`). A repeat is recognised and skipped. Bonus: the
  desk timeline gains an audit trail of mobile entries.
- Neither needs a schema change.

A card created with no signal gets a `NEW-…` placeholder. `sync_batch` maps
placeholders to real names *within one round trip*, so "create card, add two
entries, submit" — all recorded offline — replays in a single request. The app
then redirects any screen still addressed by a placeholder.

**Cold start offline** is handled by `plm-sw.js`, served from the site root so it
may claim the narrow `/pipe-laying/` scope (a root-scoped worker would collide
with other apps on this bench). It caches the shell and the bundle, and never
touches `/api/**` — the IndexedDB layer owns that data and knows what is stale.

---

## Business logic

Every formula and validation is taken from the **live** desk client scripts, not
from the mock, and is **recomputed server-side on write** so a stale or tampered
client can't persist a wrong figure:

| | |
|---|---|
| Total Excavation | `L × W × D` |
| Pipe Volume | `(3.14 × d² / 4) × L`, `d` parsed from the item name ("200mm HDPE") |
| CC / Soft / Hard / Murum | `L × W × D` |
| Soil Excavation | `Total Excavation − CC − Soft − Hard` |
| Backfilling | `Total Excavation − Murum − Pipe Volume` |
| Total Quantity | `sum(items.qauntity)` |
| Pipe ID | one `PIPE-00n` shared by all 7 child rows in a batch |

Also enforced: no sub-length may exceed the pipe length; From/To Junction are
digits-only and must differ; the duplicate-card rule.

### Divergences, and why

- **CC is always visible; Murum sits behind the "Include Murum" toggle.** The
  prototype had these reversed. The live popup and the soil formula depend on
  this arrangement, so the backend wins.
- **Bedding writes to `custom_bedding`.** The repo's `api.py` and the "Show
  Bedding Field" client script both reference `bedding_depthmtr`, which **does
  not exist** on this site — those writes are silently dropped. Backfilling needs
  bedding, and the desk popup has no way to enter it, so the app adds the field.
- **Backfilling does not persist by default**, matching the desk button (which
  only calculates). "Save to Pour Card" writes into `custom__backfilling_details`
  when you want it stored.

---

## Deploying

```bash
./deploy.sh              # everything
./deploy.sh backend      # Python only
./deploy.sh frontend      # assets + shell only
```

Builds the SPA, stamps the shell with a fresh build number (cache-buster), uploads,
clears the site cache, and verifies the URLs. **No worker or bench restart** —
whitelisted methods import on demand and `www/` pages are plain files.

Users pick up a new build on their next app launch.

## Rebuilding the APK (rarely needed)

Only if the app id, name, icon, or the hosted URL changes.

```bash
cd android-shell
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" npx cap sync android
cd android && ./gradlew assembleRelease
```

`pipe-laying.keystore` + `android/keystore.properties` are **git-ignored and
irreplaceable** — back them up. Without them you cannot ship an update to
`com.dux.pipelaying`.

Notes: `local.properties` must use forward slashes (backslashes are escapes in a
properties file). `targetSdkVersion` is pinned to **34** on purpose — 35 forces
Android 15 edge-to-edge and pushes the WebView under the status bar.

---

## Permissions

`capabilities()` drives UI gating only; every endpoint enforces permissions
server-side and lists use permission-scoped `get_list`.

Effective Pour Card permissions on this site (Custom DocPerms replace the
standard ones):

| Role | read | write | create | submit |
|---|---|---|---|---|
| System Manager | ✓ | ✓ | ✓ | — |
| Website Manager | ✓ | ✓ | ✓ | ✓ |
| Demo User | ✓ | — | ✓ | — |

**Only Website Manager can submit.** Field staff who need to submit from the app
must be granted submit on Pour Card — a backend config change, not an app change.
Users with no role above see an empty list, which is correct behaviour.
