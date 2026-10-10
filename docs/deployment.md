# Deployment

Target: **https://acserver.csie.org/card-together/** on the existing acserver host.
Run from the repository root as the deployment user. Required tools: npm, the exact Node.js version in `.node-version`,
Python 3, rsync, util-linux (`flock`), sudo, systemd, and Nginx.
DNS/TLS/certificate renewal and an HTTPS virtual host for `acserver.csie.org` must
already work; these scripts do not provision them.

## Build and deploy

```sh
cd /home/acaccel/card-together
npm exec --yes --package="node@$(cat .node-version)" -- bash deploy/build.sh &&
bash deploy/deploy.sh
```

Build installs locked dependencies including devDependencies, checks shell/Python
helpers, runs typecheck/lint/tests, builds the `/card-together/` frontend, and prepares
`.deploy/node`. Build on the target OS/architecture. The backend runs TypeScript through
`tsx`, so runtime dependencies include development tools. The frontend build imports owner
music and [site emoji](media.md#site-provided-emoji); the generated emoji catalog lives in
`shared/src/`, which `install.sh` copies for the backend. Previous site emoji files, like
hashed assets, stay published until `prune-assets.sh` removes them after the grace period.

`deploy.sh` obtains sudo, validates existing configuration, backs up application/settings/
state (the application copy is taken before the service stops), stops writers, installs artifacts, starts the new service, installs Nginx snippets,
updates managed includes in `/etc/nginx/sites-enabled/acserver.csie.org`, runs `nginx -t`,
reloads Nginx, and checks local/public health. This briefly interrupts service.
Build alone and `publish-client.sh` do not update Nginx.

| Location | Purpose |
| --- | --- |
| `/opt/card-together` | Root-owned application, dependencies, copied Node binary |
| `/opt/card-together/www/card-together` | Served frontend |
| `/etc/card-together/server.env` | Root-only runtime configuration |
| `/var/lib/card-together/` | Database and uploaded `media/` |
| `/var/backups/card-together/` | Protected deployment snapshots (`deploy-*`, newest 5), frontend entry points (`frontend-*`, newest 5), and daily data snapshots (`data/`) |
| `journalctl -u card-together.service` | Backend logs |

systemd uses the `card-together` service user, read-only application files, a writable
state directory, restart handling, and a 60-second graceful shutdown limit. The unit also
restricts devices, kernel interfaces, cgroups, address families (Unix, IPv4/IPv6, netlink),
namespaces, and personalities. `MemoryDenyWriteExecute` is intentionally not set because
V8's JIT needs writable executable memory. `MemoryHigh=768M` throttles and `MemoryMax=1G`
kills the backend if it leaks, protecting the other applications on the shared host
(the unit restarts it). Raise both in `card-together.service` if journald shows memory
kills under normal load. Only one
backend may own the JSON database.

## Runtime settings

The standard production environment is:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
TRUST_PROXY_LOOPBACK=true
CLIENT_ORIGIN=https://acserver.csie.org
DATABASE_PATH=/var/lib/card-together/database.json
```

Use literal `KEY=value` entries without `export` or shell expansion. `CLIENT_ORIGIN`
is an exact origin with no application path or trailing slash. The database must remain
under the writable state directory. Keep the backend private on loopback; the local proxy
must overwrite `X-Forwarded-For` before enabling loopback trust. If changing port, update
runtime settings, Nginx upstreams, and health commands together.

Frontend build uses `VITE_BASE_PATH=/card-together/`, empty `VITE_SERVER_URL`, and
`VITE_SOCKET_PATH=/card-together/socket.io`. Public TURN configuration belongs in
`client/.env.local`; see [media](media.md#voice).

## Existing state and rename compatibility

The full wrapper handles an existing `/var/lib/bridge-online` installation. It preserves
legacy runtime settings/comments, changes only the standard database path, disables/stops
`bridge-online.service`, and backs up both complete state directories. It copies legacy
state atomically only when the destination has no database and is empty. Existing new
state is never overwritten. Custom paths/proxy settings or conflicting state require
operator review. Old application/settings/state remain for rollback; the new unit conflicts
with the old unit to prevent concurrent writers.

For an earlier repository-local database, first stop its actual process, build, and
install without starting the service:

```sh
sudo bash deploy/install.sh "$PWD/.deploy/node"
sudo install -d -m 0700 /var/backups/card-together
sudo cp -a server/data "/var/backups/card-together/pre-systemd-$(date -u +%Y%m%dT%H%M%SZ)"
sudo python3 deploy/migrate-state.py --legacy server/data --current /var/lib/card-together
sudo chown -R card-together:card-together /var/lib/card-together
bash deploy/deploy.sh
```

Direct installation refuses active/unmigrated legacy configuration; use the full wrapper
for a legacy systemd installation. The state helper rejects symlinks/partially populated
destinations, keeps the source, and copies database **and media** together. See
[storage](storage.md#backup-and-restore) before resolving existing destination state.

The former `/bridge_online/` URL is no longer served: Nginx has no routes for it and the
backend has no session-migration endpoint, so browsers that only hold a session from that
path sign in again. Cookies on API responses follow the proxy path. Existing new browser
preferences take precedence over migrated `bridge.*` values.

## Manual Nginx installation

For routine updates use `deploy.sh`. If performing a reviewed manual install, `install.sh`
preserves `server.env`, stops the service, and does not migrate state or change Nginx.
Install snippets and include them once in the existing virtual host:

```sh
sudo install -d -m 0755 /etc/nginx/snippets
sudo install -m 0644 deploy/nginx/card-together.conf /etc/nginx/snippets/card-together.conf
sudo install -m 0644 deploy/nginx/card-together-http.conf /etc/nginx/snippets/card-together-http.conf
sudo nginx -T
sudoedit /etc/nginx/sites-enabled/acserver.csie.org
```

HTTPS server block: `include /etc/nginx/snippets/card-together.conf;`
HTTP server block: `include /etc/nginx/snippets/card-together-http.conf;`
Preserve TLS/other applications. Never put these at `http` scope or create a duplicate
host. Snippets provide SPA fallback, prefix removal, WebSocket headers, cookie scope,
and a 3 MiB upload limit for base64-encoded 2 MiB background and emoji images.

The snippet also serves `/card-together/assets/` and the content-hashed
`/card-together/provided-emoji/` with `try_files $uri =404` and
`Cache-Control: public, max-age=31536000, immutable` (hashed files; a missing file is a
404, never `index.html`), gzips CSS/JS/JSON/SVG, and sends `X-Content-Type-Options`,
`Referrer-Policy`, and a **report-only** Content-Security-Policy (including
`frame-ancestors`). Watch the browser console for CSP violations before enforcing it by
renaming the header to `Content-Security-Policy`. Nginx drops inherited headers in any
location that calls `add_header`, so each such location repeats the full set.
After reviewing runtime configuration and completing any required state migration,
finish the manual installation:

```sh
sudo nginx -t
sudo systemctl enable --now card-together.service
sudo systemctl reload nginx
```

Then run the health and browser checks below.

## Verify

```sh
sudo nginx -t
sudo systemctl status card-together.service --no-pager
curl --fail --show-error http://127.0.0.1:3001/health
curl --fail --show-error https://acserver.csie.org/card-together/health
```

Health returns `{"status":"ok"}`. Deployment polls for up to 30 seconds to tolerate
startup and Nginx worker changes. In a browser verify login, room creation, refresh at
`/card-together/login`, Socket connectivity, persisted resume, uploaded images, site emoji,
and music.
Test voice with real devices/networks; TURN may be needed. Verify browser preference
migration on an existing client.

## Operations and rollback

```sh
sudo journalctl -u card-together.service -n 100 --no-pager
sudo journalctl -u card-together.service -f
sudo systemctl restart card-together.service
sudo systemctl stop card-together.service
```

The wrapper locks new/legacy deploys and shared Nginx edits, checks concurrent site changes,
and preserves snapshots before installation. On failure after shutdown it stops the new
service and restores changed Nginx configuration, while preserving application/state for
inspection. Services remain stopped to avoid restarting a writer against older state.

A deployment backup contains site/snippets, runtime configuration, units/enabled states,
`application/` when a previous new installation exists, and complete
`card-together-data/`/`bridge-online-data/` snapshots. `application/` omits `node_modules/`,
the copied `node` binary, and `provided-music/` duplicates; rebuild them by checking out the
matching revision and running `deploy/build.sh`. Only the newest five `deploy-*` snapshots
are kept (older ones are removed after a successful deployment). A deployment interrupted by
`SIGINT`/`SIGTERM` follows the same recovery path as a failure. Keep a separate off-host backup.

### Daily data backup

`install.sh` installs `/opt/card-together/backup-data.sh` and the
`card-together-backup.service`/`.timer` units; `deploy.sh` enables the timer
(`systemctl enable --now card-together-backup.timer`; a failure only prints a warning).
To enable it without a full deployment, run `sudo bash deploy/install.sh "$PWD/.deploy/node"`
and `sudo systemctl enable --now card-together-backup.timer`. At about 04:15 each day the
service copies `database.json` (validated as JSON) and `media/` into
`/var/backups/card-together/data/data-<UTC stamp>/` while the backend keeps running: the
database is replaced by atomic rename and media files are content-addressed, so the copy is
consistent. Unchanged media is hard-linked to the previous snapshot. The newest 14 snapshots
(`KEEP`, default 14) are retained. Inspect with:

```sh
systemctl list-timers card-together-backup.timer
sudo journalctl -u card-together-backup.service -n 20 --no-pager
sudo ls /var/backups/card-together/data
```

This protects against corruption and mistakes on the same disk only; copy the snapshots
off-host as well. Restore follows [storage](storage.md#backup-and-restore).

Rollback requires stopping both services, selecting compatible application/dependencies/
unit/configuration/Nginx, and reviewing the complete state. Use current state if the old
revision supports its schema. Revisions before Sevens and Chinese Poker (or Liar's Deck, Blackjack, or Texas Hold'em) reject state that
contains those rooms, games, or match results, so they cannot start against it. Restoring a snapshot discards newer writes; restore database
and media together only after that operational decision. Preserve mode `0700` for state
directories, `0600` for private files, and ownership matching the selected service user.
Run `systemctl daemon-reload`, test/reload Nginx, and start only the chosen service.
For pre-rename rollback, reconcile newer state before restarting the untouched old
application; its old database is only a pre-migration snapshot.

After repeated startup failures, inspect logs/configuration/schema/port/permissions, then
use `sudo systemctl reset-failed card-together.service` if needed. Never delete data as a fix.

## Frontend-only publication

For UI or music updates without backend/Nginx changes:

```sh
VITE_BASE_PATH=/card-together/ VITE_SERVER_URL='' VITE_SOCKET_PATH=/card-together/socket.io npm run build:client
bash deploy/publish-client.sh
```

The sudo publisher syncs assets before atomically replacing `index.html`, retains previous
hashed assets for 14 days (then `prune-assets.sh` removes files missing from the current
build) and the newest five entry-point backups under `/var/backups/card-together/frontend-*`,
and uses the deployment lock. It does not restart
the backend or reload Nginx. Importing owner music alone does not publish it. The publisher
refuses a build whose site emoji catalog differs from the installed backend's, because the
backend would reject the new emoji; publish emoji changes with `deploy.sh`.

## Repository and compatibility

The canonical repository is [FatCatIsFat0424/card-together](https://github.com/FatCatIsFat0424/card-together).
Use its current SSH URL when configuring a checkout:

```sh
git remote set-url origin git@github.com:FatCatIsFat0424/card-together.git
git ls-remote origin HEAD
```

The production service and public route use `card-together`. Retain the preference
migration and stopped legacy state for compatibility and reviewed rollback; they are
not incomplete renames. Browser migration, music playback, and real-device voice
acceptance follow the checks in [Verify](#verify).
