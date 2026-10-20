import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import type { Browser, CDPSession, Page } from 'playwright-core';
import { io as connectSocket } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { build, preview } from 'vite';
import { SHOP_SERIES, getShopItem } from '@shared/constants';
import type { GameType, ShopItemId, ShopSeries } from '@shared/types';
import type { ClientToServerEvents, ServerToClientEvents } from '@shared/types/socket-events';
import { uiTranslations } from '../../client/src/ui-i18n';
import { createApplication } from '../src/app';
import { SESSION_COOKIE_NAME, tokenHash } from '../src/auth/auth-service';
import { createJsonRepository } from '../src/database/json-repository';
import type { Repository } from '../src/database/repository';

// Opt-in render cost benchmark: a production client build against a real server, a bot game at a
// phone viewport in headless Chromium with 4x CPU throttling, traced while it is the player's turn.

const VIEWPORT = { width: 706, height: 336 };
const CPU_THROTTLE = 4;
const TRACE_MS = 5_000;
/** Lets the deal and the turn banner settle before tracing. */
const SETTLE_MS = 2_500;
const GAMES: readonly GameType[] = ['liarsdeck', 'holdem'];
const FIXTURE_HASH = `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`;

type Equipment = 'plain' | ShopSeries;
type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface Options {
  games: readonly GameType[];
  sets: readonly Equipment[];
  samples: number;
}

function parseOptions(args: readonly string[]): Options {
  const options: Options = { games: GAMES, sets: ['plain', 'starfleet', 'neoncity'], samples: 1 };
  for (let index = 0; index < args.length; index += 2) {
    const [flag, value] = [args[index], args[index + 1]];
    if (!value) throw new Error(`${flag} needs a value.`);
    if (flag === '--games') {
      options.games = value.split(',').map((game) => {
        if (!GAMES.includes(game as GameType)) throw new Error(`--games accepts ${GAMES.join(', ')}.`);
        return game as GameType;
      });
    } else if (flag === '--sets') {
      options.sets = value.split(',').map((set) => {
        if (set !== 'plain' && !SHOP_SERIES.includes(set as ShopSeries)) {
          throw new Error(`--sets accepts plain or ${SHOP_SERIES.join(', ')}.`);
        }
        return set as Equipment;
      });
    } else if (flag === '--samples') {
      options.samples = Number(value);
      if (!Number.isInteger(options.samples) || options.samples < 1 || options.samples > 10) {
        throw new Error('--samples must be an integer from 1 to 10.');
      }
    } else throw new Error(`Unknown option ${flag}. Use --games, --sets, or --samples.`);
  }
  return options;
}

/** Every equippable item of one collection, so all of its animations are on screen. */
function equipment(set: Equipment): Record<string, unknown> {
  if (set === 'plain') return { ownedShopItems: [], ownedAvatarBorders: [] };
  const slots = {
    cardBackStyle: `card-back-${set}`, tableBackgroundStyle: `table-${set}`, seatBackgroundStyle: `seat-${set}`,
    nameplate: `nameplate-${set}`, cardFaceStyle: `card-face-${set}`, chipStyle: `chips-${set}`,
    seatFrame: `seat-frame-${set}`, chatFrame: `chat-frame-${set}`, victoryEffect: `victory-${set}`,
    soundPack: `sound-${set}`,
  };
  for (const item of Object.values(slots)) {
    if (!getShopItem(item as ShopItemId)) throw new Error(`Missing shop item ${item}.`);
  }
  return { ...slots, avatarBorder: set, ownedAvatarBorders: [set], ownedShopItems: Object.values(slots) };
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => address && typeof address === 'object' ? resolvePort(address.port) : reject(new Error('No port')));
    });
  });
}

async function createPlayer(repository: Repository, name: string, set: Equipment): Promise<string> {
  const now = Date.now();
  const token = randomBytes(32).toString('base64url');
  await repository.createAccount({
    id: name, username: name, usernameNormalized: name, passwordHash: FIXTURE_HASH, nickname: name,
    avatar: 'cat', avatarImage: null, tableBackground: null, tableBackgroundOpacity: 100, cardBack: null,
    cardBackOpacity: 100, matchesPublic: false, color: '#2563eb', createdAt: now, updatedAt: now,
    ...equipment(set),
  });
  await repository.createSession({
    tokenHash: tokenHash(token), accountId: name, createdAt: now, expiresAt: now + 3_600_000,
  }, FIXTURE_HASH);
  return token;
}

/** Creates a room, fills it with bots, and starts the game over Socket, as the lobby buttons do. */
async function startGame(serverUrl: string, origin: string, token: string, gameType: GameType): Promise<string> {
  const socket: ClientSocket = connectSocket(serverUrl, {
    autoConnect: false, forceNew: true, reconnection: false, transports: ['websocket'],
    extraHeaders: { Origin: origin, Cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });
  try {
    await new Promise<void>((resolveConnect, reject) => {
      socket.once('connect', () => resolveConnect());
      socket.once('connect_error', reject);
      socket.connect();
    });
    const succeed = (response: { success: boolean; error?: string }): void => {
      if (!response.success) throw new Error(response.error ?? 'Room setup failed.');
    };
    succeed(await socket.timeout(5_000).emitWithAck('player:resume'));
    const created = await socket.timeout(5_000).emitWithAck('room:create', { gameType });
    succeed(created);
    if (!created.roomCode) throw new Error('Room setup returned no room code.');
    succeed(await socket.timeout(5_000).emitWithAck('room:changeSeat', { seat: 'N' }));
    succeed(await socket.timeout(5_000).emitWithAck('room:fillBots'));
    succeed(await socket.timeout(5_000).emitWithAck('room:ready'));
    succeed(await socket.timeout(5_000).emitWithAck('room:start'));
    return created.roomCode;
  } finally {
    socket.disconnect();
  }
}

async function trace(page: Page, cdp: CDPSession): Promise<Record<string, unknown>> {
  const browser = page.context().browser()!;
  const metric = async (): Promise<number> => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    return metrics.find((entry) => entry.name === 'TaskDuration')?.value ?? 0;
  };
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  const before = await metric();
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'viz'] });
  await page.waitForTimeout(TRACE_MS);
  const events = JSON.parse((await browser.stopTracing()).toString()).traceEvents as Array<{
    name: string; ph: string; dur?: number; pid: number; tid: number; args?: { name?: string; data?: { nodeName?: string } };
  }>;
  const mainTaskMs = (await metric() - before) * 1000;
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const threads = new Map(events.filter((event) => event.name === 'thread_name').map((event) => [`${event.pid}:${event.tid}`, event.args?.name ?? '']));
  const busy: Record<string, number> = {};
  const painted: Record<string, number> = {};
  let paints = 0;
  for (const event of events) {
    if (event.ph !== 'X' || !event.dur) continue;
    const thread = threads.get(`${event.pid}:${event.tid}`) ?? '';
    if (event.name === 'Paint' && thread === 'CrRendererMain') {
      paints += 1;
      const node = (event.args?.data?.nodeName ?? '?').replace(/ class='([^']*)'.*/, '.$1');
      painted[node] = (painted[node] ?? 0) + 1;
    }
    if (!['RunTask', 'ThreadControllerImpl::RunTask', 'TaskGraphRunner::RunTask'].includes(event.name)) continue;
    const key = thread.startsWith('CompositorTileWorker') ? 'raster' : thread;
    if (['CrRendererMain', 'Compositor', 'VizCompositorThread', 'raster'].includes(key)) busy[key] = (busy[key] ?? 0) + event.dur / 1000;
  }
  return {
    mainTaskMs: Math.round(mainTaskMs), paints,
    threadMs: Object.fromEntries(Object.entries(busy).map(([key, value]) => [key, Math.round(value)])),
    mostPainted: Object.entries(painted).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([node, count]) => `${count}x ${node}`),
  };
}

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ executablePath: process.env.CHROME || undefined });
  } catch (error) {
    throw new Error('Cannot start Chromium. Install it with `npx playwright install chromium-headless-shell`, '
      + 'or set CHROME to a Chromium executable (and LD_LIBRARY_PATH if system libraries are missing).', { cause: error });
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const directory = await mkdtemp(join(tmpdir(), 'card-together-render-'));
  const clientRoot = fileURLToPath(new URL('../../client', import.meta.url));
  const yourTurn = uiTranslations['zh-TW']['table.yourTurn'];
  let browser: Browser | undefined;
  /** Closed in reverse order; closing the application also closes its repository. */
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const repository = await createJsonRepository(join(directory, 'database.json'));
    const previewPort = await freePort();
    const origin = `http://127.0.0.1:${previewPort}`;
    let application: Awaited<ReturnType<typeof createApplication>>;
    try {
      application = await createApplication(repository, { allowedOrigins: [origin] });
    } catch (error) {
      await repository.close();
      throw error;
    }
    cleanup.push(() => application.close());
    await new Promise<void>((resolveListen, reject) => {
      application.httpServer.once('error', reject);
      application.httpServer.listen(0, '127.0.0.1', resolveListen);
    });
    const address = application.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected a server address.');
    const serverUrl = `http://127.0.0.1:${address.port}`;
    const outDir = join(directory, 'client');
    const configFile = join(clientRoot, 'vite.config.ts');
    await build({ root: clientRoot, configFile, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
    // The client config proxies /api and /socket.io to this origin.
    process.env.VITE_DEV_PROXY_TARGET = serverUrl;
    const server = await preview({
      root: clientRoot, configFile, logLevel: 'warn',
      build: { outDir }, preview: { host: '127.0.0.1', port: previewPort, strictPort: true },
    });
    cleanup.push(() => server.close());
    browser = await launch();
    let players = 0;
    for (const game of options.games) {
      for (let sample = 1; sample <= options.samples; sample += 1) {
        for (const set of options.sets) {
          players += 1;
          const name = `bench${players}`;
          const token = await createPlayer(repository, name, set);
          const roomCode = await startGame(serverUrl, origin, token, game);
          const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
          try {
            await context.addCookies([{ name: SESSION_COOKIE_NAME, value: token, url: origin }]);
            const page = await context.newPage();
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.goto(`${origin}/game/${roomCode}`);
            await page.getByText(yourTurn).first().waitFor({ timeout: 60_000 });
            await page.waitForTimeout(SETTLE_MS);
            const cdp = await context.newCDPSession(page);
            await cdp.send('Performance.enable');
            const result = await trace(page, cdp);
            if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
            process.stdout.write(`${JSON.stringify({
              node: process.version, chromium: browser.version(), game, equipment: set, sample,
              viewport: `${VIEWPORT.width}x${VIEWPORT.height}@3`, cpuThrottle: CPU_THROTTLE, traceMs: TRACE_MS, ...result,
            })}\n`);
          } finally {
            await context.close();
          }
        }
      }
    }
  } finally {
    await browser?.close();
    for (const close of cleanup.reverse()) await close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
