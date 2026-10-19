# Deployment

Target: **https://acserver.csie.org/card-together/** on the existing acserver host.

**Prerequisites**

- Run from the repository root as the deployment user, on the target OS and architecture.
- npm, the Node.js version in `.node-version`, Python 3, rsync, util-linux (`flock`),
  sudo, systemd, and Nginx.
- DNS, TLS certificates, and the HTTPS virtual host must already work; these scripts do
  not provision them.

## Build and deploy

```sh
npm exec --yes --package="node@$(cat .node-version)" -- bash deploy/build.sh &&
bash deploy/deploy.sh
```

| Stage | Script | Actions |
| --- | --- | --- |
| Build | `build.sh` | Install locked dependencies including devDependencies (the backend runs TypeScript through `tsx`); run the [full gate](testing.md#full-gate); build with production paths, importing music and site emoji; prepare `.deploy/node` |
| Backup | `deploy.sh` | Request sudo, validate configuration, snapshot application, settings, and state |
| Install | `deploy.sh` | Stop the service (brief outage), install artifacts including the generated emoji catalog, start the new service |
| Proxy and health | `deploy.sh` | Install Nginx snippets, update managed includes in `/etc/nginx/sites-enabled/acserver.csie.org`, test and reload Nginx, poll local and public health |

The snippet also serves the domain-wide `/.well-known/assetlinks.json` and the APK
download for the [Android app](android.md).

Earlier hashed assets and site emoji stay published until `prune-assets.sh` removes them
after the grace period.

| Path | Contents |
| --- | --- |
| `/opt/card-together` | Root-owned application, dependencies, copied Node binary |
| `/opt/card-together/www/card-together` | Served frontend |
| `/etc/card-together/server.env` | Root-only runtime configuration |
| `/var/lib/card-together/` | `database.json` and `media/` |
| `/var/backups/card-together/` | `deploy-*`, `frontend-*`, and daily `data/` snapshots |

**systemd unit** (`card-together.service`)

- Runs as `card-together` with read-only application files, a writable state directory,
  automatic restart, and a 60-second graceful stop.
- Restricts devices, kernel interfaces, cgroups, namespaces, personalities, and address
  families (Unix, IPv4, IPv6, netlink). `MemoryDenyWriteExecute` stays off because V8's
  JIT needs it.
- `MemoryHigh=768M` throttles and `MemoryMax=1G` kills and restarts a leaking backend to
  protect the shared host. Raise both if the journal shows memory kills under normal load.
- **Only one backend may own the JSON database.**

## Runtime settings

`/etc/card-together/server.env`:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
TRUST_PROXY_LOOPBACK=true
CLIENT_ORIGIN=https://acserver.csie.org
DATABASE_PATH=/var/lib/card-together/database.json
```

- Literal `KEY=value` lines only: no `export` or shell expansion.
- `CLIENT_ORIGIN` is the exact origin, without path or trailing slash.
- Keep `DATABASE_PATH` inside the writable state directory.
- Keep the backend on loopback. Loopback trust requires Nginx to overwrite `X-Forwarded-For`.
- Changing the port means updating this file, the Nginx upstreams, and health commands together.
- Frontend build: `VITE_BASE_PATH=/card-together/`, empty `VITE_SERVER_URL`,
  `VITE_SOCKET_PATH=/card-together/socket.io`. TURN settings go in `client/.env.local`
  ([voice](media.md#voice)).

All variables: [development](development.md#configuration).

## Verify

```sh
sudo nginx -t
sudo systemctl status card-together.service --no-pager
curl --fail --show-error http://127.0.0.1:3001/health
curl --fail --show-error https://acserver.csie.org/card-together/health
```

- Health returns `{"status":"ok"}`. `deploy.sh` polls up to 30 seconds for startup and
  Nginx worker changes.
- In a browser: login, room creation, refresh at `/card-together/login`, Socket
  connection, resume after restart, uploaded images, site emoji, music, and preference
  migration on an existing client.
- Test voice with real devices on different networks; TURN may be required.

## Operations

```sh
sudo journalctl -u card-together.service -n 100 --no-pager
sudo journalctl -u card-together.service -f
sudo systemctl restart card-together.service
sudo systemctl stop card-together.service
```

After repeated startup failures, check logs, configuration, schema, port, and
permissions, then `sudo systemctl reset-failed card-together.service` if needed.
**Never delete data as a fix.**

### Automatic deployment after CI

Install from a reviewed checkout as the workstation operator (replace the username
and checkout paths):

```sh
sudo bash deploy/install-auto-deploy.sh acaccel \
  /home/acaccel/card-together /home/acaccel/card-together-release
```

Prerequisites: the deployment user can fetch `origin` without prompts, `gh auth login`
is configured for that user with repository Actions read access, and both
`local-music/` and `local-emoji/` exist. An empty directory is allowed only when the
empty catalog is intentional. No webhook endpoint is needed.

The installer provisions:

| Path | Purpose |
| --- | --- |
| `/usr/local/lib/card-together-auto-deploy/auto-deploy.py` | Stable controller, independent of edits in the development checkout |
| `/home/acaccel/card-together-release` | Detached linked worktree used only for release builds |
| `/etc/card-together-auto-deploy.json` | Non-secret configuration: repository, source/checkout/state/input paths, optional frontend environment path, required workflow filenames, optional [Discord notification](#deployment-notifications) |
| `/var/lib/card-together-auto-deploy/inputs/` | Independent owner music, emoji, and optional `frontend.env` snapshots |
| `/var/lib/card-together-auto-deploy/state.json` | Successful SHA, failed-build SHA, and unfinished-install marker |
| `/var/lib/card-together-auto-deploy/notifications.json` | Undelivered [notification](#deployment-notifications) updates awaiting resend; absent when none |
| `/etc/sudoers.d/card-together-auto-deploy` | Allows the deployment user to run only `/usr/bin/bash <release-checkout>/deploy/deploy.sh` without a password |

The service runs as the deployment user, with a timer one minute after boot and one
minute after each cycle finishes. It fetches only remote `main`, without changing the
development branch, index, or files. For a new SHA, it queries GitHub Actions `push`
runs for that exact `main` SHA. The latest run/attempt of every returned workflow must
be `completed` with `success`; the configured required workflows (initially `ci.yml`)
must also be present. Missing, queued, failed, cancelled, skipped, malformed, or
unavailable results never authorize deployment. Add newly required workflows to
`workflows` in the configuration so their absence also blocks deployment.

The controller snapshots inputs into the clean detached worktree, runs `build.sh`
with the revision's pinned Node.js and release gate, then rechecks CI before invoking
the existing `deploy.sh`. Only a successful install, including its local/public health
checks, records `last_success_sha`. A newer commit arriving during a build waits for
the next cycle. The first eligible SHA is deployed even if the existing manual
installation happens to use it. Full deployment still briefly disconnects players.

Development changes, including local commits not pushed to `main`, are excluded.
The worktrees share Git objects and refs, not working files or dependencies. Do not
edit or manually deploy from the release worktree while the timer is active. API
credentials remain in the user's existing `gh` credential storage; do not put tokens
in the configuration, repository, or command arguments.

**Trust boundary:** CI-approved code and deployment scripts from `main` are executed
on this workstation, and the deployment script runs as root. Only trusted maintainers
should be able to merge into `main`; protect that branch with review and required CI.
The deployment user must also be trusted as a host administrator: the allowed script
is in that user's writable worktree, so the command restriction is not a security
boundary against that user modifying it. Do not grant this rule to untrusted users.

Inspect or pause:

```sh
systemctl status card-together-auto-deploy.timer --no-pager
sudo journalctl -u card-together-auto-deploy.service -n 100 --no-pager
python3 -B /usr/local/lib/card-together-auto-deploy/auto-deploy.py --inspect
sudo systemctl stop card-together-auto-deploy.timer card-together-auto-deploy.service
```

`--inspect` checks credentials, CI, inputs, and an existing release worktree without
building or installing. It updates remote-tracking refs only. A whole-cycle lock
serializes polling, input copying, building, installation, inspection, and recovery.
Existing deployment/Nginx locks still serialize privileged installation.

Failure and recovery:

- Fetch/API errors wait for the next cycle and leave the installation untouched.
- A checkout/input/build error records `failed_build_sha`, blocking that SHA rather
  than rebuilding every minute. After fixing the cause, run the controller as the
  deployment user with `--retry-build`; a newer SHA is automatically eligible.
- Before installation, the controller durably writes `installing_sha`. An install
  error, interruption, timeout, or reboot leaves it in place and halts **all** further
  automatic deployments. Follow [failure handling](#failure-handling) and
  [rollback](#rollback), verify application/data compatibility and service health,
  then run the controller as the deployment user with `--resume`. Recovery commands
  clear a block but do not perform a deployment.
- Resume the timer with `sudo systemctl start card-together-auto-deploy.timer` after
  manual recovery. Use `disable --now` instead of `stop` to keep it disabled across boots.

Re-run the installer to update the stable controller and units; it pauses the timer
and preserves existing configuration, input snapshots, and receipts. It refuses to
interrupt a running cycle: wait for that cycle to finish and rerun the installer.
If reinstallation fails after pausing the timer, it stays stopped until the operator
fixes the failure and restarts it. The installer itself does not deploy the application.
To publish changed owner inputs, stop the timer/service, update the corresponding
snapshot under `inputs/`, and use the existing manual build/deploy process from the
release worktree. Input changes alone do not trigger automatic deployment; the
controller watches Git revisions. Never copy development database files into it.

For simultaneous development, use a separate backend port and database, and point
Vite's development proxy at it: [development](development.md#configuration).

#### Deployment notifications

Optionally, each deployment attempt sends structured progress to the BotFleet konata
notification relay, which posts one Discord message and edits it as stages progress:
target SHA and pending commit subjects, CI approval, build, CI recheck, install with
health checks, then the result (duration, or the failure's recovery step). Waiting for
CI and blocked or halted cycles send nothing. The relay owns rendering and the route's
Discord channel; see its documentation in BotFleet `docs/configuration.md`.

The installer does not add this setting. After updating the controller, add it to the
existing configuration:

```json
"notification": {
  "url": "http://127.0.0.1:4100/notifications/card-together-deploy",
  "key_file": "/var/lib/card-together-auto-deploy/notify.key"
}
```

- `url` is the relay route; plain HTTP is accepted only for loopback hosts. Each attempt
  appends its own key (`<SHA prefix>-<epoch>`) and sends `PUT` requests.
- `key_file` holds the relay's bearer key (the same value as konata's
  `NOTIFY_API_KEY`), readable only by the deployment user (`0600`). It is read at each
  update and never stored in this configuration.
- Notification failures are logged without the key and never change deployment results
  or receipts. Omit the key or set it to `null` to disable notifications.
- The latest undelivered update per attempt is kept in
  `/var/lib/card-together-auto-deploy/notifications.json` and resent at the start of each
  non-inspecting cycle, so a konata restart mid-deployment leaves no stale message. Updates
  older than an hour are dropped; a damaged file only loses those retries.

### Failure handling

- `deploy.sh` locks against concurrent deploys (including legacy ones) and shared Nginx
  edits, detects concurrent site changes, and snapshots before installing.
- A missing build or one without the `/card-together/` base fails before any service
  stops. `npm run check -- full` rebuilds `client/dist` with `/`, so run `build.sh`
  immediately before `deploy.sh`.
- A failure or `SIGINT`/`SIGTERM` after shutdown stops the new service and restores the
  changed Nginx configuration. Application and state stay in place for inspection, and
  services stay stopped so nothing writes against older state.

### Backups

| Snapshot | Contents | Retention |
| --- | --- | --- |
| `deploy-*` (each deployment) | Site and snippets, runtime configuration, units and enabled states; `application/` without `node_modules/`, `node`, and duplicate `provided-music/`; full `card-together-data/` and `bridge-online-data/` | Newest 5, pruned after success |
| `frontend-*` (each publication) | Previous frontend entry points | Newest 5 |
| `data/data-<UTC stamp>/` (daily, about 04:15) | JSON-validated `database.json` and `media/` | Newest 14 (`KEEP`) |

- Rebuild files omitted from `application/` by running `deploy/build.sh` at the matching revision.
- The daily backup runs with the backend online: the database is replaced by atomic
  rename and media is content-addressed. Unchanged media is hard-linked to the previous snapshot.
- `install.sh` installs `backup-data.sh` and `card-together-backup.service`/`.timer`;
  `deploy.sh` enables the timer and warns if that fails. To enable it alone:

  ```sh
  sudo bash deploy/install.sh "$PWD/.deploy/node"
  sudo systemctl enable --now card-together-backup.timer
  ```

- Inspect:

  ```sh
  systemctl list-timers card-together-backup.timer
  sudo journalctl -u card-together-backup.service -n 20 --no-pager
  sudo ls /var/backups/card-together/data
  ```

- Same-disk snapshots protect against corruption and mistakes only; keep an off-host
  copy. Restore steps: [storage](storage.md#backup-and-restore).

### Rollback

1. Stop both `card-together` and legacy `bridge-online` services. Pick a compatible
   application, dependencies, unit, configuration, and Nginx setup.
2. Keep current state only if the older revision supports its schema and fields
   ([compatibility](storage.md#data-compatibility)).
3. Otherwise restore a snapshot, accepting the loss of newer writes. Restore **database
   and media together**, with state directories `0700`, private files `0600`, and
   ownership matching the chosen service user.
4. Run `sudo systemctl daemon-reload`, test and reload Nginx, and start only the chosen service.

Rolling back to the pre-rename application: its untouched database is only a
pre-migration snapshot, so reconcile newer state first.

## Frontend-only publication

For UI or music changes without backend or Nginx changes:

```sh
VITE_BASE_PATH=/card-together/ VITE_SERVER_URL='' VITE_SOCKET_PATH=/card-together/socket.io npm run build:client
bash deploy/publish-client.sh
```

- Uses the deployment lock, syncs assets, then atomically replaces `index.html`. It does
  not restart the backend or reload Nginx.
- Earlier hashed assets stay for 14 days; `prune-assets.sh` then removes files missing
  from the current build.
- Importing music alone publishes nothing.
- A changed site emoji catalog needs `deploy.sh`; the publisher refuses catalogs that
  differ from the installed backend.

## Manual installation

Use `deploy.sh` for routine updates. `install.sh` alone keeps `server.env` and stops the
service, but neither migrates state nor changes Nginx.

1. Install the snippets and inspect the virtual host:

   ```sh
   sudo install -d -m 0755 /etc/nginx/snippets
   sudo install -m 0644 deploy/nginx/card-together.conf /etc/nginx/snippets/card-together.conf
   sudo install -m 0644 deploy/nginx/card-together-http.conf /etc/nginx/snippets/card-together-http.conf
   sudo nginx -T
   sudoedit /etc/nginx/sites-enabled/acserver.csie.org
   ```

2. Include each snippet **once** inside the existing server blocks, keeping TLS and other
   applications intact. Never add them at `http` scope or create a duplicate host.

   | Server block | Include |
   | --- | --- |
   | HTTPS | `include /etc/nginx/snippets/card-together.conf;` |
   | HTTP | `include /etc/nginx/snippets/card-together-http.conf;` |

3. Review runtime settings, finish any state migration, then start:

   ```sh
   sudo nginx -t
   sudo systemctl enable --now card-together.service
   sudo systemctl reload nginx
   ```

4. Run the [verification](#verify).

| Snippet | Behavior |
| --- | --- |
| Routing | SPA fallback, prefix removal, WebSocket headers, cookie path; 3 MiB request limit for base64 2 MiB images |
| Hashed assets | `/card-together/assets/` and `/card-together/provided-emoji/` use `try_files $uri =404` with `Cache-Control: public, max-age=31536000, immutable`; missing files return 404, never `index.html` |
| Compression | CSS, JS, JSON, SVG |
| Headers | `X-Content-Type-Options`, `Referrer-Policy`, and a **report-only** CSP including `frame-ancestors` |

- Review browser CSP reports before renaming the header to `Content-Security-Policy`.
- Nginx drops inherited headers in any location with its own `add_header`, so each such
  location repeats the full set.

## Migrating existing state

**From the legacy `bridge-online` service** (`/var/lib/bridge-online`), the full
`deploy.sh` wrapper:

- Keeps legacy runtime settings and comments, changing only the database path.
- Disables and stops `bridge-online.service` and backs up both state directories.
- Copies legacy state atomically only into an empty destination without a database;
  existing new state is never overwritten.
- Keeps the old application, settings, and state for rollback. The new unit conflicts
  with the old one, preventing two writers.

Custom paths, proxy settings, or conflicting state need operator review. Direct
`install.sh` refuses active or unmigrated legacy configuration.

**From a repository-local database:** stop the process that uses it, build, then:

```sh
sudo bash deploy/install.sh "$PWD/.deploy/node"
sudo install -d -m 0700 /var/backups/card-together
sudo cp -a server/data "/var/backups/card-together/pre-systemd-$(date -u +%Y%m%dT%H%M%SZ)"
sudo python3 deploy/migrate-state.py --legacy server/data --current /var/lib/card-together
sudo chown -R card-together:card-together /var/lib/card-together
bash deploy/deploy.sh
```

`migrate-state.py` rejects symlinks and partly populated destinations, keeps the source,
and copies **database and media together**.

**Rename compatibility**

- `/bridge_online/` is no longer served and its sessions cannot migrate; those browsers
  must sign in again.
- API cookies follow the proxy path. Existing `card-together.*` browser preferences take
  precedence over migrated `bridge.*` values.
- The preference migration and stopped legacy state are kept intentionally for
  compatibility and rollback.

## Repository

Canonical: [FatCatIsFat0424/card-together](https://github.com/FatCatIsFat0424/card-together).

```sh
git remote set-url origin git@github.com:FatCatIsFat0424/card-together.git
git ls-remote origin HEAD
```
