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

### Failure handling

- `deploy.sh` locks against concurrent deploys (including legacy ones) and shared Nginx
  edits, detects concurrent site changes, and snapshots before installing.
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
