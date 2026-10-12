# Deployment

Target: **https://acserver.csie.org/card-together/** on the existing acserver host.

- Run from the repository root as the deployment user.
- Required: npm, the exact Node.js version in `.node-version`, Python 3, rsync,
  util-linux (`flock`), sudo, systemd, and Nginx.
- DNS, TLS/certificate renewal, and the HTTPS virtual host must already work;
  these scripts do not provision them.

## Build and deploy

```sh
cd /home/acaccel/card-together
npm exec --yes --package="node@$(cat .node-version)" -- bash deploy/build.sh &&
bash deploy/deploy.sh
```

| Stage | Actions |
| --- | --- |
| Build | Install locked dependencies including devDependencies; run the complete [testing gate](testing.md#complete-gate-and-caches), including shell/Python checks; build with production base/Socket paths; prepare `.deploy/node` |
| Backup | Obtain sudo, validate configuration, back up application/settings/state; copy the application before stopping the service |
| Install | Stop writers, install artifacts, and start the new service |
| Proxy and health | Install snippets, update managed includes in `/etc/nginx/sites-enabled/acserver.csie.org`, test/reload Nginx, and check local/public health |

- Build on the target OS/architecture. The backend runs TypeScript through `tsx`, so
  runtime dependencies include development tools.
- The frontend build imports owner music and [site emoji](media.md#site-provided-emoji).
  `install.sh` copies the generated `shared/src/` emoji catalog for the backend.
- Previous site emoji and hashed assets remain published until `prune-assets.sh`
  removes them after the grace period.
- Deployment briefly interrupts service. Build alone and `publish-client.sh` do not
  update Nginx.

| Location | Purpose |
| --- | --- |
| `/opt/card-together` | Root-owned application, dependencies, copied Node binary |
| `/opt/card-together/www/card-together` | Served frontend |
| `/etc/card-together/server.env` | Root-only runtime configuration |
| `/var/lib/card-together/` | Database and uploaded `media/` |
| `/var/backups/card-together/` | Deployment snapshots (`deploy-*`, newest 5), frontend entry points (`frontend-*`, newest 5), and daily data snapshots (`data/`) |
| `journalctl -u card-together.service` | Backend logs |

systemd runs as `card-together` with read-only application files, a writable state
directory, restart handling, and a 60-second graceful shutdown limit.

- Restrictions cover devices, kernel interfaces, cgroups, namespaces, personalities,
  and address families (Unix, IPv4/IPv6, netlink).
- `MemoryDenyWriteExecute` is unset because V8's JIT needs writable executable memory.
- `MemoryHigh=768M` throttles; `MemoryMax=1G` kills and restarts a leaking backend to
  protect the shared host. Raise both in `card-together.service` if journald shows
  memory kills under normal load.
- **Only one backend may own the JSON database.**

## Runtime settings

Standard production environment:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
TRUST_PROXY_LOOPBACK=true
CLIENT_ORIGIN=https://acserver.csie.org
DATABASE_PATH=/var/lib/card-together/database.json
```

| Setting | Rule |
| --- | --- |
| Environment file | Literal `KEY=value`; no `export` or shell expansion |
| `CLIENT_ORIGIN` | Exact origin; no application path or trailing slash |
| `DATABASE_PATH` | Keep under the writable state directory |
| Backend/proxy | Keep the backend on loopback; the local proxy must overwrite `X-Forwarded-For` before enabling loopback trust |
| Port changes | Update runtime settings, Nginx upstreams, and health commands together |
| Frontend build | `VITE_BASE_PATH=/card-together/`, empty `VITE_SERVER_URL`, `VITE_SOCKET_PATH=/card-together/socket.io` |
| TURN | Public configuration in `client/.env.local`; see [voice](media.md#voice) |

## Existing state and rename compatibility

For an existing `/var/lib/bridge-online` installation, the full wrapper:

- Preserves legacy runtime settings/comments; changes only the standard database path.
- Disables/stops `bridge-online.service` and backs up both complete state directories.
- Copies legacy state atomically only if the destination is empty and has no database;
  never overwrites existing new state.
- Keeps old application/settings/state for rollback. The new unit conflicts with the
  old unit to prevent concurrent writers.

Custom paths, proxy settings, or conflicting state require operator review.

For a repository-local database, **stop its actual process first**, build, then install
without starting the service:

```sh
sudo bash deploy/install.sh "$PWD/.deploy/node"
sudo install -d -m 0700 /var/backups/card-together
sudo cp -a server/data "/var/backups/card-together/pre-systemd-$(date -u +%Y%m%dT%H%M%SZ)"
sudo python3 deploy/migrate-state.py --legacy server/data --current /var/lib/card-together
sudo chown -R card-together:card-together /var/lib/card-together
bash deploy/deploy.sh
```

- Direct installation refuses active/unmigrated legacy configuration; use the full
  wrapper for a legacy systemd installation.
- The state helper rejects symlinks and partially populated destinations, keeps the
  source, and copies **database and media together**. Review
  [backup and restore](storage.md#backup-and-restore) before resolving destination state.
- `/bridge_online/` is no longer served. There is no session-migration endpoint;
  browsers holding only that path's session must sign in again.
- API cookies follow the proxy path. Existing new browser preferences take precedence
  over migrated `bridge.*` values.

## Manual Nginx installation

Use `deploy.sh` for routine updates. For a reviewed manual install, `install.sh`
preserves `server.env` and stops the service; it does not migrate state or change Nginx.

1. Install snippets and inspect the virtual host:

   ```sh
   sudo install -d -m 0755 /etc/nginx/snippets
   sudo install -m 0644 deploy/nginx/card-together.conf /etc/nginx/snippets/card-together.conf
   sudo install -m 0644 deploy/nginx/card-together-http.conf /etc/nginx/snippets/card-together-http.conf
   sudo nginx -T
   sudoedit /etc/nginx/sites-enabled/acserver.csie.org
   ```

2. Include each snippet **once**, preserving TLS and other applications:

   | Server block | Include |
   | --- | --- |
   | HTTPS | `include /etc/nginx/snippets/card-together.conf;` |
   | HTTP | `include /etc/nginx/snippets/card-together-http.conf;` |

   Never add them at `http` scope or create a duplicate host.

3. Review runtime configuration, complete any state migration, then start:

   ```sh
   sudo nginx -t
   sudo systemctl enable --now card-together.service
   sudo systemctl reload nginx
   ```

4. Run the [health and browser checks](#verify).

| Snippet behavior | Details |
| --- | --- |
| Routing/uploads | SPA fallback, prefix removal, WebSocket headers, cookie scope; 3 MiB upload limit for base64-encoded 2 MiB backgrounds/emoji |
| Hashed assets | `/card-together/assets/` and `/card-together/provided-emoji/` use `try_files $uri =404` and `Cache-Control: public, max-age=31536000, immutable`; missing files return 404, never `index.html` |
| Compression | CSS, JS, JSON, SVG |
| Headers | `X-Content-Type-Options`, `Referrer-Policy`, **report-only** CSP including `frame-ancestors` |

Check browser CSP violations before renaming the header to `Content-Security-Policy`
for enforcement. Nginx drops inherited headers wherever `add_header` appears; each such
location repeats the full set.

## Verify

```sh
sudo nginx -t
sudo systemctl status card-together.service --no-pager
curl --fail --show-error http://127.0.0.1:3001/health
curl --fail --show-error https://acserver.csie.org/card-together/health
```

- Health must return `{"status":"ok"}`. Deployment polls for up to 30 seconds to
  tolerate startup and Nginx worker changes.
- In a browser, check login, room creation, refresh at `/card-together/login`, Socket
  connectivity, persisted resume, uploaded images, site emoji, and music.
- Check preference migration on an existing client.
- Test voice with real devices/networks; TURN may be needed.

## Operations and rollback

```sh
sudo journalctl -u card-together.service -n 100 --no-pager
sudo journalctl -u card-together.service -f
sudo systemctl restart card-together.service
sudo systemctl stop card-together.service
```

**Failure handling:** the wrapper locks new/legacy deploys and shared Nginx edits,
checks concurrent site changes, and preserves snapshots before installation.

- Failure after shutdown stops the new service and restores changed Nginx configuration.
- Application/state remain for inspection; services stay stopped to avoid writing
  against older state.
- `SIGINT`/`SIGTERM` interruptions follow the same recovery path.

| Deployment backup | Contents/retention |
| --- | --- |
| Configuration | Site/snippets, runtime configuration, units and enabled states |
| Application | `application/` if a previous new installation exists; excludes `node_modules/`, copied `node`, and `provided-music/` duplicates |
| State | Complete `card-together-data/` and `bridge-online-data/` snapshots |
| Retention | Newest five `deploy-*`; older snapshots removed after successful deployment |

Rebuild omitted files from the matching revision with `deploy/build.sh`.
Keep a separate off-host backup.

### Daily data backup

| Item | Behavior |
| --- | --- |
| Installed by | `install.sh`: `/opt/card-together/backup-data.sh`, `card-together-backup.service` and `.timer` |
| Enabled by | `deploy.sh`; timer enable failure prints a warning |
| Schedule | About 04:15 daily |
| Contents | JSON-validated `database.json` and `media/` |
| Destination | `/var/backups/card-together/data/data-<UTC stamp>/` |
| Consistency | Backend stays running; database uses atomic rename and media is content-addressed |
| Storage | Unchanged media hard-linked to the previous snapshot |
| Retention | Newest 14 snapshots (`KEEP`, default 14) |

To enable without a full deployment:

```sh
sudo bash deploy/install.sh "$PWD/.deploy/node"
sudo systemctl enable --now card-together-backup.timer
```

Inspect backups:

```sh
systemctl list-timers card-together-backup.timer
sudo journalctl -u card-together-backup.service -n 20 --no-pager
sudo ls /var/backups/card-together/data
```

Same-disk snapshots protect against corruption and mistakes only; also copy them
off-host. Restore follows [storage](storage.md#backup-and-restore).

**Rollback checklist:**

1. Stop both services. Select compatible application, dependencies, unit, configuration,
   and Nginx; review the complete state.
2. Keep current state only if the old revision supports its schema. Revisions before
   Sevens, Chinese Poker, Liar's Deck, Blackjack, or Texas Hold'em reject state containing
   those rooms, games, or match results.
3. If restoring a snapshot, accept that newer writes will be discarded, then restore
   **database and media together**. Keep state directories `0700`, private files `0600`,
   and ownership matching the chosen service user.
4. Run `systemctl daemon-reload`, test/reload Nginx, and start only the chosen service.

For pre-rename rollback, reconcile newer state before restarting the old application:
its untouched database is only a pre-migration snapshot.

After repeated startup failures, inspect logs, configuration, schema, port, and permissions.
Use `sudo systemctl reset-failed card-together.service` if needed; **never delete data as a fix**.

## Frontend-only publication

For UI or music updates without backend/Nginx changes:

```sh
VITE_BASE_PATH=/card-together/ VITE_SERVER_URL='' VITE_SOCKET_PATH=/card-together/socket.io npm run build:client
bash deploy/publish-client.sh
```

- The sudo publisher uses the deployment lock, syncs assets, then atomically replaces
  `index.html`; it does not restart the backend or reload Nginx.
- Previous hashed assets remain for 14 days; `prune-assets.sh` then removes files missing
  from the current build. Keep the newest five `/var/backups/card-together/frontend-*`
  entry-point backups.
- Importing owner music alone does not publish it.
- A changed site emoji catalog requires `deploy.sh`. The frontend-only publisher refuses
  catalogs that differ from the installed backend, which would reject the new emoji.

## Repository and compatibility

Canonical repository: [FatCatIsFat0424/card-together](https://github.com/FatCatIsFat0424/card-together).
Configure a checkout with its current SSH URL:

```sh
git remote set-url origin git@github.com:FatCatIsFat0424/card-together.git
git ls-remote origin HEAD
```

- Production service and public route use `card-together`.
- Keep preference migration and stopped legacy state for compatibility and reviewed
  rollback; these are not incomplete renames.
- Browser migration, music playback, and real-device voice acceptance follow [Verify](#verify).
