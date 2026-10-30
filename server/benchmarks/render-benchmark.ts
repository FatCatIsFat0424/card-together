import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import type { Browser, CDPSession, Page } from 'playwright-core';
import { io as connectSocket } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { build, preview } from 'vite';
import { SHOP_SERIES, getShopItem, isAvatarBorderId } from '@shared/constants';
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
const GAMES: readonly GameType[] = ['liarsdeck', 'holdem', 'liarsdice', 'xiangqi', 'chinesecheckers'];
/** Further board games for comparing piece, board, and dice effects; not traced unless asked for. */
const EXTRA_GAMES: readonly GameType[] = ['reversi', 'gomoku', 'banqi'];
const ALL_GAMES: readonly GameType[] = [...GAMES, ...EXTRA_GAMES];
/** `idle` traces a quiet turn; `moves` lets the bots play the player's seat too, so moves land during the trace. */
type Mode = 'idle' | 'moves';
const FIXTURE_HASH = `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`;

type Equipment = 'plain' | ShopSeries;
type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Equipment slots of a collection; `--slots` equips only some of them, to attribute a cost to one product. */
const SLOTS = [
  'cardBackStyle', 'tableBackgroundStyle', 'seatBackgroundStyle', 'nameplate', 'cardFaceStyle', 'chipStyle', 'seatFrame',
  'chatFrame', 'victoryEffect', 'soundPack', 'pieceStyle', 'boardStyle', 'diceStyle', 'avatarBorder',
] as const;
type Slot = typeof SLOTS[number];

interface Options {
  games: readonly GameType[];
  sets: readonly Equipment[];
  samples: number;
  mode: Mode;
  slots: readonly Slot[];
  /** Emulates `prefers-reduced-motion`, which keeps static styles but stops every animation and move effect. */
  reducedMotion: boolean;
  /** Keeps each raw trace as `<game>-<set>-<sample>.json` for DevTools. */
  traceDir: string | null;
}

function parseOptions(args: readonly string[]): Options {
  const options: Options = {
    games: GAMES, sets: ['plain', 'starfleet', 'neoncity'], samples: 1, mode: 'idle', slots: SLOTS, reducedMotion: false,
    traceDir: null,
  };
  for (let index = 0; index < args.length; index += 2) {
    const [flag, value] = [args[index], args[index + 1]];
    if (!value) throw new Error(`${flag} needs a value.`);
    if (flag === '--games') {
      options.games = value.split(',').map((game) => {
        if (!ALL_GAMES.includes(game as GameType)) throw new Error(`--games accepts ${ALL_GAMES.join(', ')}.`);
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
    } else if (flag === '--mode') {
      if (value !== 'idle' && value !== 'moves') throw new Error('--mode accepts idle or moves.');
      options.mode = value;
    } else if (flag === '--slots') {
      options.slots = value.split(',').map((slot) => {
        if (!SLOTS.includes(slot as Slot)) throw new Error(`--slots accepts ${SLOTS.join(', ')}.`);
        return slot as Slot;
      });
    } else if (flag === '--reduced-motion') {
      if (value !== 'on' && value !== 'off') throw new Error('--reduced-motion accepts on or off.');
      options.reducedMotion = value === 'on';
    } else if (flag === '--trace-dir') {
      options.traceDir = resolve(process.env.INIT_CWD ?? process.cwd(), value);
    } else {
      throw new Error(`Unknown option ${flag}. Use --games, --sets, --samples, --mode, --slots, --reduced-motion, or --trace-dir.`);
    }
  }
  return options;
}

/**
 * The equippable items of one collection in `slots`, so all of their animations are on screen. A slot the
 * collection has no product for stays empty, unless `--slots` asked for it by name.
 */
function equipment(set: Equipment, slots: readonly Slot[]): Record<string, unknown> {
  if (set === 'plain') return { ownedShopItems: [], ownedAvatarBorders: [] };
  const items: Record<Exclude<Slot, 'avatarBorder'>, string> = {
    cardBackStyle: `card-back-${set}`, tableBackgroundStyle: `table-${set}`, seatBackgroundStyle: `seat-${set}`,
    nameplate: `nameplate-${set}`, cardFaceStyle: `card-face-${set}`, chipStyle: `chips-${set}`,
    seatFrame: `seat-frame-${set}`, chatFrame: `chat-frame-${set}`, victoryEffect: `victory-${set}`,
    soundPack: `sound-${set}`, pieceStyle: `pieces-${set}`, boardStyle: `board-${set}`, diceStyle: `dice-${set}`,
  };
  const equipped: Record<string, string> = {};
  for (const slot of slots) {
    if (slot === 'avatarBorder') continue;
    if (getShopItem(items[slot] as ShopItemId)) equipped[slot] = items[slot];
    else if (slots !== SLOTS) throw new Error(`Missing shop item ${items[slot]}.`);
  }
  const border = slots.includes('avatarBorder') && isAvatarBorderId(set);
  if (slots.includes('avatarBorder') && !border && slots !== SLOTS) throw new Error(`Missing avatar border ${set}.`);
  return {
    ...equipped, ...border ? { avatarBorder: set } : {}, ownedAvatarBorders: border ? [set] : [],
    ownedShopItems: Object.values(equipped),
  };
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

async function createPlayer(
  repository: Repository, name: string, set: Equipment, slots: readonly Slot[],
): Promise<string> {
  const now = Date.now();
  const token = randomBytes(32).toString('base64url');
  await repository.createAccount({
    id: name, username: name, usernameNormalized: name, passwordHash: FIXTURE_HASH, nickname: name,
    avatar: 'cat', avatarImage: null, tableBackground: null, tableBackgroundOpacity: 100, cardBack: null,
    cardBackOpacity: 100, matchesPublic: false, color: '#2563eb', createdAt: now, updatedAt: now,
    ...equipment(set, slots),
  });
  await repository.createSession({
    tokenHash: tokenHash(token), accountId: name, createdAt: now, expiresAt: now + 3_600_000,
  }, FIXTURE_HASH);
  return token;
}

const succeed = (response: { success: boolean; error?: string }): void => {
  if (!response.success) throw new Error(response.error ?? 'Room setup failed.');
};

async function connectPlayer(serverUrl: string, origin: string, token: string): Promise<ClientSocket> {
  const socket: ClientSocket = connectSocket(serverUrl, {
    autoConnect: false, forceNew: true, reconnection: false, transports: ['websocket'],
    extraHeaders: { Origin: origin, Cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });
  await new Promise<void>((resolveConnect, reject) => {
    socket.once('connect', () => resolveConnect());
    socket.once('connect_error', reject);
    socket.connect();
  });
  try {
    succeed(await socket.timeout(5_000).emitWithAck('player:resume'));
  } catch (error) {
    socket.disconnect();
    throw error;
  }
  return socket;
}

/**
 * Hands the player's seat to the bots from a second connection, so moves keep landing while the page is traced;
 * the returned function stops counting and reports the moves the trace saw.
 */
async function autoPlay(serverUrl: string, origin: string, token: string): Promise<() => number> {
  const socket = await connectPlayer(serverUrl, origin, token);
  let first: number | null = null;
  let last = 0;
  socket.on('player:state', (snapshot) => {
    const log = (snapshot.gameState as { log?: unknown } | undefined)?.log;
    if (!Array.isArray(log)) return;
    first ??= log.length;
    last = log.length;
  });
  try {
    succeed(await socket.timeout(5_000).emitWithAck('game:autoPlay', { enabled: true }));
  } catch (error) {
    socket.disconnect();
    throw error;
  }
  return () => {
    socket.disconnect();
    return first === null ? 0 : last - first;
  };
}

/** Creates a room, fills it with bots, and starts the game over Socket, as the lobby buttons do. */
async function startGame(serverUrl: string, origin: string, token: string, gameType: GameType): Promise<string> {
  const socket = await connectPlayer(serverUrl, origin, token);
  try {
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

/** Main-thread rendering steps; time inside an unlisted event counts toward its nearest listed ancestor. */
const MAIN_STEPS: Readonly<Record<string, string>> = {
  FunctionCall: 'script', EvaluateScript: 'script', TimerFire: 'script', EventDispatch: 'script', FireAnimationFrame: 'script',
  RunMicrotasks: 'script', MajorGC: 'gc', MinorGC: 'gc', UpdateLayoutTree: 'style', Layout: 'layout', PrePaint: 'prePaint',
  Paint: 'paint', Layerize: 'layerize', Commit: 'commit',
};

type TraceEvent = {
  name: string; ph: string; ts: number; dur?: number; tdur?: number; pid: number; tid: number;
  args?: { name?: string; data?: { nodeName?: string } };
};

/** Exclusive main-thread milliseconds per `MAIN_STEPS` step, from one thread's complete events. */
function stepTimes(events: readonly TraceEvent[]): Record<string, number> {
  const sorted = [...events].sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));
  const stack: Array<{ end: number; step: string | undefined }> = [];
  const steps: Record<string, number> = {};
  /** Running exclusive time of the open step owners, charged when a child starts or the owner ends. */
  let cursor = 0;
  const charge = (until: number): void => {
    const owner = stack[stack.length - 1];
    if (owner?.step && until > cursor) steps[owner.step] = (steps[owner.step] ?? 0) + (until - cursor) / 1000;
    cursor = Math.max(cursor, until);
  };
  for (const event of sorted) {
    const end = event.ts + (event.dur ?? 0);
    while (stack.length && stack[stack.length - 1].end <= event.ts) {
      charge(stack[stack.length - 1].end);
      stack.pop();
    }
    charge(event.ts);
    const parent = stack[stack.length - 1];
    stack.push({ end, step: MAIN_STEPS[event.name] ?? parent?.step });
  }
  while (stack.length) {
    charge(stack[stack.length - 1].end);
    stack.pop();
  }
  return Object.fromEntries(Object.entries(steps).map(([key, value]) => [key, Math.round(value)]));
}

async function trace(page: Page, cdp: CDPSession, savePath: string | null): Promise<Record<string, unknown>> {
  const browser = page.context().browser()!;
  const metric = async (): Promise<number> => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    return metrics.find((entry) => entry.name === 'TaskDuration')?.value ?? 0;
  };
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  const before = await metric();
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'viz'] });
  await page.waitForTimeout(TRACE_MS);
  const raw = await browser.stopTracing();
  if (savePath) await writeFile(savePath, raw);
  const events = JSON.parse(raw.toString()).traceEvents as TraceEvent[];
  const mainTaskMs = (await metric() - before) * 1000;
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const threads = new Map(events.filter((event) => event.name === 'thread_name').map((event) => [`${event.pid}:${event.tid}`, event.args?.name ?? '']));
  const busy: Record<string, number> = {};
  /** Main-thread CPU time; unlike wall time it barely moves when other processes load the machine. */
  let mainCpu = 0;
  const painted: Record<string, number> = {};
  let paints = 0;
  let svgPaints = 0;
  const main: TraceEvent[] = [];
  for (const event of events) {
    if (event.ph !== 'X' || !event.dur) continue;
    const thread = threads.get(`${event.pid}:${event.tid}`) ?? '';
    if (event.name === 'Paint' && thread === 'CrRendererMain') {
      paints += 1;
      const node = (event.args?.data?.nodeName ?? '?').replace(/ class='([^']*)'.*/, '.$1');
      painted[node] = (painted[node] ?? 0) + 1;
    }
    if (event.name === 'Paint' && thread === 'CrRendererMain' && event.args?.data?.nodeName?.startsWith('svg')) svgPaints += 1;
    if (thread === 'CrRendererMain') main.push(event);
    if (!['RunTask', 'ThreadControllerImpl::RunTask', 'TaskGraphRunner::RunTask'].includes(event.name)) continue;
    const key = thread.startsWith('CompositorTileWorker') ? 'raster' : thread;
    if (['CrRendererMain', 'Compositor', 'VizCompositorThread', 'raster'].includes(key)) busy[key] = (busy[key] ?? 0) + event.dur / 1000;
    if (key === 'CrRendererMain') mainCpu += (event.tdur ?? 0) / 1000;
  }
  return {
    mainTaskMs: Math.round(mainTaskMs), mainCpuMs: Math.round(mainCpu), paints, svgPaints,
    threadMs: Object.fromEntries(Object.entries(busy).map(([key, value]) => [key, Math.round(value)])),
    stepMs: stepTimes(main),
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
    if (options.traceDir) await mkdir(options.traceDir, { recursive: true });
    browser = await launch();
    let players = 0;
    for (const game of options.games) {
      for (let sample = 1; sample <= options.samples; sample += 1) {
        for (const set of options.sets) {
          players += 1;
          const name = `bench${players}`;
          const token = await createPlayer(repository, name, set, options.slots);
          const roomCode = await startGame(serverUrl, origin, token, game);
          const context = await browser.newContext({
            viewport: VIEWPORT, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
            reducedMotion: options.reducedMotion ? 'reduce' : 'no-preference',
          });
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
            const stop = options.mode === 'moves' ? await autoPlay(serverUrl, origin, token) : null;
            const result = await trace(page, cdp, options.traceDir && join(options.traceDir, `${game}-${set}-${sample}.json`));
            const moves = stop?.();
            if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
            process.stdout.write(`${JSON.stringify({
              node: process.version, chromium: browser.version(), game, equipment: set, sample, mode: options.mode,
              ...moves === undefined ? {} : { moves },
              ...options.slots === SLOTS ? {} : { slots: options.slots.join(',') },
              ...options.reducedMotion ? { reducedMotion: true } : {},
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
