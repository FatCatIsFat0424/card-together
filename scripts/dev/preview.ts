import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Throwaway preview for browser verification: Vite dev (hot reload) and a SQLite backend in a temporary state
 * directory, started once, waited on until ready, and seeded with synthetic friends whose signed-in sessions are
 * saved as Playwright storage states. Only processes this script started are ever stopped.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
/** Synthetic preview credential; never used outside the throwaway preview database. */
export const PREVIEW_PASSWORD = 'preview-pass-2026';
export const PREVIEW_ACCOUNTS = ['preview1', 'preview2', 'preview3', 'preview4'] as const;
const READY_TIMEOUT_MS = 90_000;

export interface PreviewOptions {
  readonly command: 'start' | 'stop' | 'status';
  readonly slot: number;
  readonly host: string;
  readonly reset: boolean;
}

export interface PreviewLayout {
  readonly clientPort: number;
  readonly serverPort: number;
  readonly clientOrigin: string;
  readonly stateDir: string;
}

export function parsePreviewArgs(args: readonly string[]): PreviewOptions {
  const [command, ...rest] = args;
  if (command !== 'start' && command !== 'stop' && command !== 'status') {
    throw new Error('Usage: npm run dev:preview -- start|stop|status [--slot 0-49] [--host 127.0.0.1] [--reset]');
  }
  let slot = 0;
  let host = '127.0.0.1';
  let reset = false;
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (flag === '--reset') { reset = true; continue; }
    const value = rest[++index];
    if (value === undefined) throw new Error(`${flag} needs a value.`);
    if (flag === '--slot') {
      slot = Number(value);
      if (!Number.isInteger(slot) || slot < 0 || slot > 49) throw new Error('--slot must be an integer from 0 to 49.');
    } else if (flag === '--host') {
      if (!/^(?:\d{1,3}\.){3}\d{1,3}$|^localhost$/.test(value)) throw new Error('--host must be an IPv4 address or localhost.');
      host = value;
    } else {
      throw new Error(`Unknown option ${flag}.`);
    }
  }
  return { command, slot, host, reset };
}

/** Slots keep concurrent previews (one per agent worktree) apart: client 6200+slot, server 4200+slot. */
export function previewLayout(options: Pick<PreviewOptions, 'slot' | 'host'>, temporary = tmpdir()): PreviewLayout {
  const clientPort = 6200 + options.slot;
  return {
    clientPort,
    serverPort: 4200 + options.slot,
    clientOrigin: `http://${options.host}:${clientPort}`,
    stateDir: join(temporary, `card-together-preview-${options.slot}`),
  };
}

/** A Playwright `storageState` holding one session cookie, so browser scripts skip the rate-limited sign-in. */
export function storageState(cookieHeader: string, host: string): object {
  const [pair, ...attributes] = cookieHeader.split(';').map((part) => part.trim());
  const separator = pair.indexOf('=');
  const expires = attributes.find((part) => /^expires=/i.test(part));
  return {
    cookies: [{
      name: pair.slice(0, separator), value: pair.slice(separator + 1), domain: host, path: '/',
      expires: expires ? Math.floor(Date.parse(expires.slice(8)) / 1000) : -1,
      httpOnly: true, secure: false, sameSite: 'Lax',
    }],
    origins: [],
  };
}

function pidFile(layout: PreviewLayout): string {
  return join(layout.stateDir, 'pids.json');
}

function running(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function launch(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, log: string): number {
  const output = openSync(log, 'a');
  // Its own process group, so stopping it also stops the children it spawns (esbuild, workers).
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', output, output] });
  closeSync(output);
  child.unref();
  if (child.pid === undefined) throw new Error(`Could not start ${args.join(' ')}.`);
  return child.pid;
}

async function waitFor(url: string, label: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* not listening yet */ }
    await new Promise((done) => setTimeout(done, 300));
  }
  throw new Error(`${label} did not become ready at ${url}; see its log in the state directory.`);
}

async function api(layout: PreviewLayout, path: string, body: object, cookie?: string): Promise<Response> {
  const response = await fetch(`${layout.clientOrigin}/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: layout.clientOrigin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`POST ${path} failed: ${response.status} ${await response.text()}`);
  return response;
}

/** Registers the synthetic accounts and makes preview1 friends with everyone else. */
async function seed(layout: PreviewLayout, host: string): Promise<void> {
  const cookies = new Map<string, string>();
  for (const username of PREVIEW_ACCOUNTS) {
    const response = await api(layout, '/auth/register', { username, password: PREVIEW_PASSWORD });
    const header = response.headers.getSetCookie().find((value) => value.startsWith('card_together_session='));
    if (!header) throw new Error(`No session cookie for ${username}.`);
    cookies.set(username, header.split(';')[0]);
    writeFileSync(join(layout.stateDir, `${username}.storage.json`), `${JSON.stringify(storageState(header, host), null, 2)}\n`);
  }
  const [first, ...others] = PREVIEW_ACCOUNTS;
  for (const username of others) {
    const request = await api(layout, '/friends/requests', { username }, cookies.get(first));
    const { request: created } = await request.json() as { request: { id: string } };
    await api(layout, `/friends/requests/${encodeURIComponent(created.id)}/accept`, {}, cookies.get(username));
  }
}

function stop(layout: PreviewLayout): void {
  if (!existsSync(pidFile(layout))) { console.log('No preview is running in this slot.'); return; }
  const pids = JSON.parse(readFileSync(pidFile(layout), 'utf8')) as { client: number; server: number };
  for (const pid of [pids.client, pids.server]) {
    try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  rmSync(pidFile(layout), { force: true });
  console.log(`Stopped preview processes ${pids.client} and ${pids.server}.`);
}

async function start(options: PreviewOptions, layout: PreviewLayout): Promise<void> {
  if (existsSync(pidFile(layout))) {
    const pids = JSON.parse(readFileSync(pidFile(layout), 'utf8')) as { client: number; server: number };
    if (running(pids.client) && running(pids.server)) {
      console.log(`Already running: ${layout.clientOrigin} (state ${layout.stateDir}).`);
      return;
    }
    stop(layout);
  }
  if (options.reset) rmSync(layout.stateDir, { recursive: true, force: true });
  mkdirSync(layout.stateDir, { recursive: true });
  const database = join(layout.stateDir, 'preview.sqlite');
  const fresh = !existsSync(database);
  // Resolve every entry point before starting anything, so a failure leaves no process behind.
  const require = createRequire(join(ROOT, 'client', 'package.json'));
  const tsx = require.resolve('tsx/cli');
  const vite = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  const server = launch(process.execPath, [tsx, 'src/index.ts'], join(ROOT, 'server'), {
    PORT: String(layout.serverPort), HOST: '127.0.0.1', DATABASE_ENGINE: 'sqlite', DATABASE_PATH: database,
    CLIENT_ORIGIN: layout.clientOrigin,
  }, join(layout.stateDir, 'server.log'));
  writeFileSync(pidFile(layout), `${JSON.stringify({ client: server, server })}\n`);
  const client = launch(process.execPath, [vite, '--host', options.host, '--port', String(layout.clientPort), '--strictPort'],
    join(ROOT, 'client'), { VITE_DEV_PROXY_TARGET: `http://127.0.0.1:${layout.serverPort}` }, join(layout.stateDir, 'client.log'));
  writeFileSync(pidFile(layout), `${JSON.stringify({ client, server })}\n`);
  try {
    await waitFor(`http://127.0.0.1:${layout.serverPort}/health`, 'Server');
    await waitFor(`${layout.clientOrigin}/`, 'Client');
    if (fresh) await seed(layout, options.host);
  } catch (error) {
    stop(layout);
    throw error;
  }
  console.log(JSON.stringify({
    url: layout.clientOrigin,
    accounts: PREVIEW_ACCOUNTS, password: PREVIEW_PASSWORD,
    storageStates: PREVIEW_ACCOUNTS.map((username) => join(layout.stateDir, `${username}.storage.json`)),
    stateDir: layout.stateDir, pids: { client, server },
  }, null, 2));
}

async function main(): Promise<void> {
  const options = parsePreviewArgs(process.argv.slice(2));
  const layout = previewLayout(options);
  if (options.command === 'stop') { stop(layout); return; }
  if (options.command === 'status') {
    const live = existsSync(pidFile(layout))
      && Object.values(JSON.parse(readFileSync(pidFile(layout), 'utf8')) as Record<string, number>).every(running);
    console.log(live ? `Running: ${layout.clientOrigin} (state ${layout.stateDir}).` : 'Not running.');
    return;
  }
  await start(options, layout);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
