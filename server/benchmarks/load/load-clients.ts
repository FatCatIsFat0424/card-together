import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { GameActionEnvelope } from '@shared/games/actions';
import { getPresentationEndsAt } from '@shared/game-presentation';
import { bjSitsIn } from '@shared/rules/blackjack';
import { identifyCombo, legalPlays } from '@shared/rules/bigtwo';
import { roomSeatInfo } from '@shared/rules/seats';
import { GAME_SEAT_ORDER } from '@shared/constants';
import type { GameType, PlayerVisibleGameState, Seat } from '@shared/types';
import type { ActionResult, PlayerSnapshot } from '@shared/types/socket-events';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { firstLegalAction } from '../../src/runtime/automated-action';
import { connectClient, SEATS, TEST_ORIGIN } from '../../tests/performance/socket-harness';
import type { TestClient } from '../../tests/performance/socket-harness';
import type { LoadPlan } from './load-plan';
import type { LoadAccount } from './synthetic-database';

// Scripted clients for `bench:load`. Seated humans take their moves from the production bot
// strategies applied to the snapshot they received, after the presentation and a think delay.

export interface WorkloadOptions {
  readonly baseUrl: string;
  readonly thinkMs: readonly [number, number];
  readonly chatEveryMs: readonly [number, number];
  readonly lobbyEveryMs: readonly [number, number];
  readonly socialEveryMs: readonly [number, number];
  readonly reconnectEveryMs: number;
  readonly ackTimeoutMs: number;
}

type Role = 'host' | 'seat' | 'spectator' | 'lobby';

interface Player {
  readonly account: LoadAccount;
  readonly role: Role;
  readonly room: number | null;
  readonly seat: Seat | null;
  /** Friends with accepted friendships in the synthetic database. */
  readonly friends: readonly string[];
  client: TestClient | null;
  snapshot: PlayerSnapshot | null;
  busy: boolean;
  /** Requests sent and not yet answered. */
  pending: number;
  reconnecting: boolean;
  expectedDisconnect: boolean;
  plannedKey: string | null;
  planTimer: ReturnType<typeof setTimeout> | null;
  /** Keys already attempted and when they may be retried; successful keys never are. */
  attempted: Map<string, number>;
  wasScoring: boolean;
  /** Completed matches seen, so each match gets fresh continue, ready, and start keys. */
  games: number;
}

interface Intent {
  readonly key: string;
  readonly at: number;
  readonly run: (player: Player) => Promise<boolean>;
}

export interface EventRecord {
  readonly latencies: number[];
  failures: number;
}

export interface Recorder {
  readonly events: Map<string, EventRecord>;
  readonly failureMessages: Map<string, number>;
}

export interface WorkloadResults {
  readonly setup: Recorder;
  readonly window: Recorder;
  readonly unexpectedDisconnects: readonly string[];
  readonly reconnects: number;
  readonly gamesCompleted: Readonly<Record<string, number>>;
  readonly snapshotsReceived: number;
  readonly chatMessagesReceived: number;
}

export interface Workload {
  /** Connects every client, creates rooms, seats players and bots; recorded as setup. */
  setup(): Promise<void>;
  /** Starts every agent; results from here on belong to the measurement window. */
  start(): void;
  /** Stops scheduling and waits up to the ack timeout for requests already sent. */
  stop(): Promise<void>;
  close(): void;
  results(): WorkloadResults;
}

function createRecorder(): Recorder {
  return { events: new Map(), failureMessages: new Map() };
}

function between([minimum, maximum]: readonly [number, number]): number {
  return minimum + Math.random() * Math.max(0, maximum - minimum);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fingerprint(cards: readonly unknown[]): string {
  return JSON.stringify(cards);
}

/** Big Two passes with no legal answer are made by the server's forced-pass scheduler. */
function forcedBigTwoPass(game: Extract<PlayerVisibleGameState, { gameType: 'bigtwo' }>): boolean {
  if (game.phase !== 'playing' || !game.lastPlay || game.firstPlay || game.lastPlay.seat === game.mySeat) return false;
  const previous = identifyCombo(game.lastPlay.cards);
  return previous !== null && legalPlays(game.myHand, previous, false).length === 0;
}

/** When this seat owes a decision, keyed so one decision is sent at most once. */
export function pendingDecision(game: PlayerVisibleGameState): { key: string; at: number } | null {
  if (game.phase === 'scoring' || game.observer) return null;
  const presented = getPresentationEndsAt(game);
  if (game.gameType === 'chinesepoker') {
    return game.phase === 'arranging' && !game.submitted[game.mySeat]
      ? { key: `arrange:${fingerprint(game.myHand)}`, at: presented } : null;
  }
  if (game.gameType === 'blackjack' && game.phase === 'betting') {
    return !game.betPlaced[game.mySeat] && game.dealerSeat !== game.mySeat && bjSitsIn(game.chips[game.mySeat])
      ? { key: `bet:${game.hand}:${game.log.length}`, at: presented } : null;
  }
  if (game.gameType === 'tenhalf' && game.phase === 'betting') {
    return !game.betPlaced[game.mySeat] && game.banker !== game.mySeat && bjSitsIn(game.chips[game.mySeat])
      ? { key: `bet:${game.hand}:${game.log.length}`, at: presented } : null;
  }
  if (game.gameType === 'napoleon' && game.phase === 'reviewing') {
    return game.contract?.napoleon !== game.mySeat && !game.reviewed.includes(game.mySeat)
      ? { key: `review:${game.log.length}:${fingerprint(game.myHand)}`, at: presented } : null;
  }
  if (game.gameType === 'bigtwo' && forcedBigTwoPass(game)) return null;
  const turn = game.clock?.turn;
  return turn?.seat === game.mySeat ? { key: `turn:${turn.id}`, at: Math.max(turn.startsAt, presented) } : null;
}

type Emit = (client: TestClient) => Promise<ActionResult>;

/** Converts strategy decisions to the same typed envelope used by browser clients. */
function botActionPayload(action: BotAction): GameActionEnvelope {
  switch (action.type) {
    case 'game-action': return action.request;
    case 'bridge-redeal': return { gameType: 'bridge', action: { type: 'redeal', accept: action.accept } };
    case 'bridge-bid': return { gameType: 'bridge', action: { type: 'bid', bid: action.action } };
    case 'bridge-play': return { gameType: 'bridge', action: { type: 'play', card: action.card } };
    case 'bigtwo-play': return { gameType: 'bigtwo', action: { type: 'play', cards: [...action.cards] } };
    case 'bigtwo-pass': return { gameType: 'bigtwo', action: { type: 'pass' } };
    case 'redpoints-play': return { gameType: 'redpoints',
      action: { type: 'play', card: action.card, ...(action.capture ? { capture: action.capture } : {}) } };
    case 'redpoints-flip': return { gameType: 'redpoints', action: { type: 'chooseFlip', capture: action.capture } };
    case 'ninetynine-play': return { gameType: 'ninetynine',
      action: { type: 'play', card: action.card, ...(action.choice ? { choice: action.choice } : {}),
        ...(action.target ? { target: action.target } : {}) } };
    case 'sevens-play': return { gameType: 'sevens', action: { type: 'play', card: action.card } };
    case 'sevens-cover': return { gameType: 'sevens', action: { type: 'cover', card: action.card } };
    case 'chinesepoker-arrange': return { gameType: 'chinesepoker',
      action: { type: 'arrange', arrangement: action.arrangement } };
    case 'liarsdeck-play': return { gameType: 'liarsdeck', action: { type: 'play', cardIds: [...action.cardIds] } };
    case 'liarsdeck-challenge': return { gameType: 'liarsdeck', action: { type: 'challenge' } };
    case 'blackjack-bet': return { gameType: 'blackjack', action: { type: 'bet', amount: action.amount } };
    case 'blackjack-action': return { gameType: 'blackjack', action: { type: 'act', action: action.action } };
    case 'blackjack-dealer': return { gameType: 'blackjack', action: { type: 'dealerAct', action: action.action } };
    case 'holdem-action': return { gameType: 'holdem', action: action.action };
    case 'napoleon-action': return { gameType: 'napoleon', action: action.action };
  }
}

function botActionEmit(action: BotAction, timeout: number): { event: string; emit: Emit } {
  const payload = botActionPayload(action);
  return { event: 'game:action', emit: (client) => client.timeout(timeout).emitWithAck('game:action', payload) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWorkload(plan: LoadPlan, accounts: readonly LoadAccount[], options: WorkloadOptions): Workload {
  const setupRecorder = createRecorder();
  const windowRecorder = createRecorder();
  let recorder = setupRecorder;
  let running = false;
  let closed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const unexpectedDisconnects: string[] = [];
  const gamesCompleted: Record<string, number> = {};
  let reconnects = 0;
  let snapshotsReceived = 0;
  let chatMessagesReceived = 0;
  const inFlight = new Set<Promise<unknown>>();

  const players: Player[] = [];
  const friendsOf = (index: number): string[] => [1, 2, 3].map((offset) => accounts[(index + offset) % accounts.length].id)
    .concat([1, 2, 3].map((offset) => accounts[(index - offset + accounts.length * 3) % accounts.length].id))
    .filter((id) => id !== accounts[index].id);
  let next = 0;
  function addPlayer(role: Role, room: number | null, seat: Seat | null): void {
    const index = next++;
    players.push({ account: accounts[index], role, room, seat, friends: friendsOf(index), client: null, snapshot: null,
      busy: false, pending: 0, reconnecting: false, expectedDisconnect: false, plannedKey: null, planTimer: null,
      attempted: new Map(), wasScoring: false, games: 0 });
  }
  plan.rooms.forEach((room, roomIndex) => {
    for (let seat = 0; seat < room.humans; seat += 1) addPlayer(seat === 0 ? 'host' : 'seat', roomIndex, SEATS[seat]);
    for (let spectator = 0; spectator < room.spectators; spectator += 1) addPlayer('spectator', roomIndex, null);
  });
  for (let lobby = 0; lobby < plan.lobby; lobby += 1) addPlayer('lobby', null, null);
  if (next > accounts.length) throw new Error('The plan needs more load accounts than were generated.');

  function record(event: string, ms: number, success: boolean, error?: string): void {
    let entry = recorder.events.get(event);
    if (!entry) recorder.events.set(event, entry = { latencies: [], failures: 0 });
    entry.latencies.push(ms);
    if (!success) {
      entry.failures += 1;
      const key = `${event}: ${error ?? 'failed'}`;
      recorder.failureMessages.set(key, (recorder.failureMessages.get(key) ?? 0) + 1);
    }
  }

  function track<T>(promise: Promise<T>, player?: Player): Promise<T> {
    inFlight.add(promise);
    if (player) player.pending += 1;
    void promise.finally(() => {
      inFlight.delete(promise);
      if (player) player.pending -= 1;
    }).catch(() => undefined);
    return promise;
  }

  async function ack<T extends ActionResult>(player: Player, event: string, emit: (client: TestClient) => Promise<T>): Promise<T | null> {
    const client = player.client;
    if (!client) return null;
    const started = performance.now();
    try {
      const response = await track(emit(client), player);
      record(event, performance.now() - started, response.success, response.error);
      return response;
    } catch (error) {
      record(event, performance.now() - started, false, errorMessage(error));
      return null;
    }
  }

  async function http(player: Player, event: string, path: string, body?: unknown): Promise<boolean> {
    const started = performance.now();
    try {
      const response = await track(fetch(`${options.baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Cookie: player.account.cookie, Origin: TEST_ORIGIN,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(options.ackTimeoutMs),
      }), player);
      await response.arrayBuffer();
      record(event, performance.now() - started, response.ok, response.ok ? undefined : `HTTP ${response.status}`);
      return response.ok;
    } catch (error) {
      record(event, performance.now() - started, false, errorMessage(error));
      return false;
    }
  }

  function later(ms: number, callback: () => void): void {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (running && !closed) callback();
    }, Math.max(0, ms));
    timers.add(timer);
  }

  function seatedReady(snapshot: PlayerSnapshot): boolean {
    const room = snapshot.room;
    if (!room) return false;
    let seated = 0;
    for (const seat of GAME_SEAT_ORDER) {
      const entry = roomSeatInfo(room, seat);
      if (!entry?.player) continue;
      seated += 1;
      if (!entry.isReady) return false;
    }
    return seated >= 4;
  }

  /** The next thing a seated human does, from the latest snapshot only. */
  function nextIntent(player: Player): Intent | null {
    const snapshot = player.snapshot;
    const room = snapshot?.room;
    if (!snapshot?.success || !room || player.seat === null) return null;
    const game = snapshot.gameState;
    const think = between(options.thinkMs);
    if (game?.phase === 'scoring') {
      return { key: `continue:${player.games}`,
        at: getPresentationEndsAt(game) + think,
        run: async (current) => Boolean((await ack(current, 'game:continue',
          (client) => client.timeout(options.ackTimeoutMs).emitWithAck('game:continue')))?.success) };
    }
    if (room.status === 'playing' && game) {
      const decision = pendingDecision(game);
      if (!decision) return null;
      return { key: decision.key, at: Math.max(Date.now(), decision.at) + think, run: async (current) => {
        const visible = current.snapshot?.gameState;
        if (!visible) return false;
        const action = getBotAction(visible) ?? firstLegalAction(visible);
        if (!action) {
          record('client:no-action', 0, false, `${visible.gameType} ${visible.phase}`);
          return false;
        }
        const { event, emit } = botActionEmit(action, options.ackTimeoutMs);
        return Boolean((await ack(current, event, emit))?.success);
      } };
    }
    if (room.status !== 'waiting' || game) return null;
    const own = roomSeatInfo(room, player.seat);
    if (own?.player?.id === player.account.id && !own.isReady) {
      return { key: `ready:${player.games}`,
        at: Date.now() + think,
        run: async (current) => Boolean((await ack(current, 'room:ready',
          (client) => client.timeout(options.ackTimeoutMs).emitWithAck('room:ready')))?.success) };
    }
    if (room.hostId === player.account.id && seatedReady(snapshot)) {
      return { key: `start:${player.games}`, at: Date.now() + think,
        run: async (current) => Boolean((await ack(current, 'room:start',
          (client) => client.timeout(options.ackTimeoutMs).emitWithAck('room:start')))?.success) };
    }
    return null;
  }

  function schedule(player: Player): void {
    if (!running || closed || player.busy || player.reconnecting) return;
    let intent = nextIntent(player);
    const retryAt = intent ? player.attempted.get(intent.key) : undefined;
    if (intent && retryAt !== undefined) intent = retryAt === Infinity ? null : { ...intent, at: Math.max(intent.at, retryAt) };
    if (!intent) {
      if (player.planTimer) clearTimeout(player.planTimer);
      player.planTimer = null;
      player.plannedKey = null;
      return;
    }
    if (intent.key === player.plannedKey) return;
    if (player.planTimer) clearTimeout(player.planTimer);
    player.plannedKey = intent.key;
    const scheduled = intent;
    player.planTimer = setTimeout(() => {
      player.planTimer = null;
      void execute(player, scheduled);
    }, Math.max(0, scheduled.at - Date.now()));
  }

  async function execute(player: Player, scheduled: Intent): Promise<void> {
    player.plannedKey = null;
    if (!running || closed || player.busy || player.reconnecting) return;
    // Act on the newest snapshot: a later broadcast may have changed or removed this decision.
    if (nextIntent(player)?.key !== scheduled.key) { schedule(player); return; }
    player.busy = true;
    let success: boolean;
    try {
      success = await scheduled.run(player);
    } catch (error) {
      record('client:error', 0, false, errorMessage(error));
      success = false;
    } finally {
      player.busy = false;
    }
    if (player.attempted.size > 500) player.attempted.clear();
    player.attempted.set(scheduled.key, success ? Infinity : Date.now() + 3_000);
    schedule(player);
  }

  function onSnapshot(player: Player, snapshot: PlayerSnapshot): void {
    snapshotsReceived += 1;
    if (!snapshot.success) return;
    player.snapshot = snapshot;
    const scoring = snapshot.gameState?.phase === 'scoring';
    if (scoring && !player.wasScoring) {
      player.games += 1;
      if (player.role === 'host' && running) {
        const type: GameType = snapshot.gameState!.gameType;
        gamesCompleted[type] = (gamesCompleted[type] ?? 0) + 1;
      }
    }
    player.wasScoring = scoring;
    schedule(player);
  }

  async function connect(player: Player): Promise<void> {
    const client = await connectClient(options.baseUrl, player.account.cookie, (created) => { player.client = created; });
    player.expectedDisconnect = false;
    client.on('player:state', (snapshot) => onSnapshot(player, snapshot));
    client.on('chat:message', () => { chatMessagesReceived += 1; });
    client.on('disconnect', (reason) => {
      if (!player.expectedDisconnect && !closed) unexpectedDisconnects.push(`${player.account.username}: ${reason}`);
    });
    const resumed = await ack(player, 'player:resume', (current) => current.timeout(options.ackTimeoutMs).emitWithAck('player:resume'));
    if (!resumed?.success) throw new Error(`Resume failed for ${player.account.username}: ${resumed?.error ?? 'no response'}`);
    onSnapshot(player, resumed);
  }

  function expectSuccess<T extends ActionResult>(response: T | null, what: string): T {
    if (!response?.success) throw new Error(`${what} failed: ${response?.error ?? 'no response'}`);
    return response;
  }

  async function setupRoom(roomIndex: number): Promise<void> {
    const members = players.filter((player) => player.room === roomIndex);
    const host = members.find((player) => player.role === 'host')!;
    const timeout = options.ackTimeoutMs;
    const gameType = plan.rooms[roomIndex].gameType;
    const created = expectSuccess(await ack(host, 'room:create',
      (client) => client.timeout(timeout).emitWithAck('room:create', { gameType })), 'Room creation');
    const code = created.roomCode!;
    for (const member of members) {
      if (member !== host) {
        expectSuccess(await ack(member, 'room:join', (client) => client.timeout(timeout).emitWithAck('room:join', { roomCode: code })),
          'Joining a room');
      }
      if (member.seat) {
        const seat = member.seat;
        expectSuccess(await ack(member, 'room:changeSeat', (client) => client.timeout(timeout).emitWithAck('room:changeSeat', { seat })),
          'Taking a seat');
      }
    }
    for (const seat of SEATS.slice(plan.rooms[roomIndex].humans)) {
      expectSuccess(await ack(host, 'room:addBot', (client) => client.timeout(timeout).emitWithAck('room:addBot', { seat })), 'Adding a bot');
    }
  }

  function scheduleChat(player: Player): void {
    later(between(options.chatEveryMs), () => {
      if (!player.reconnecting) {
        void ack(player, 'chat:send', (client) => client.timeout(options.ackTimeoutMs)
          .emitWithAck('chat:send', { message: `Load chat ${randomBytes(3).toString('hex')}` }));
      }
      scheduleChat(player);
    });
  }

  async function socialAction(player: Player, lobby: boolean): Promise<void> {
    const roll = Math.random();
    const friend = player.friends[Math.floor(Math.random() * player.friends.length)];
    if (lobby && roll < 0.3) {
      await ack(player, 'player:resume', (client) => client.timeout(options.ackTimeoutMs).emitWithAck('player:resume'));
    } else if (roll < 0.5) await http(player, 'GET /api/friends', '/api/friends');
    else if (roll < 0.65) await http(player, 'GET /api/messages', '/api/messages');
    else if (roll < 0.8) {
      await http(player, 'POST /api/messages/:id', `/api/messages/${friend}`,
        { clientId: randomBytes(12).toString('base64url'), message: 'Synthetic load message' });
    } else if (roll < 0.9) await http(player, 'GET /api/account/history', '/api/account/history');
    else await http(player, 'GET /api/players/:id/history', `/api/players/${friend}/history`);
  }

  function scheduleSocial(player: Player): void {
    const lobby = player.role === 'lobby';
    later(between(lobby ? options.lobbyEveryMs : options.socialEveryMs), () => {
      if (!player.reconnecting && !(lobby && player.busy)) {
        if (lobby) player.busy = true;
        void socialAction(player, lobby).finally(() => { if (lobby) player.busy = false; });
      }
      scheduleSocial(player);
    });
  }

  async function reconnect(player: Player): Promise<void> {
    player.reconnecting = true;
    if (player.planTimer) clearTimeout(player.planTimer);
    player.planTimer = null;
    player.plannedKey = null;
    player.expectedDisconnect = true;
    player.client?.disconnect();
    await sleep(between([1_000, 3_000]));
    if (closed) return;
    const started = performance.now();
    try {
      await connect(player);
      record('reconnect', performance.now() - started, true);
      reconnects += 1;
    } catch (error) {
      record('reconnect', performance.now() - started, false, errorMessage(error));
    } finally {
      player.reconnecting = false;
      schedule(player);
    }
  }

  function scheduleReconnects(): void {
    if (options.reconnectEveryMs <= 0) return;
    later(options.reconnectEveryMs, () => {
      const candidates = players.filter((player) => !player.busy && player.pending === 0 && !player.reconnecting);
      const player = candidates[Math.floor(Math.random() * candidates.length)];
      if (player) void track(reconnect(player));
      scheduleReconnects();
    });
  }

  return {
    async setup(): Promise<void> {
      for (let start = 0; start < players.length; start += 10) {
        await Promise.all(players.slice(start, start + 10).map(connect));
      }
      await Promise.all(plan.rooms.map((_room, index) => setupRoom(index)));
    },
    start(): void {
      recorder = windowRecorder;
      running = true;
      for (const player of players) {
        if (player.seat) schedule(player);
        if (player.role !== 'lobby') scheduleChat(player);
        scheduleSocial(player);
      }
      scheduleReconnects();
    },
    async stop(): Promise<void> {
      running = false;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const player of players) {
        if (player.planTimer) clearTimeout(player.planTimer);
        player.planTimer = null;
      }
      await Promise.race([Promise.allSettled([...inFlight]), sleep(options.ackTimeoutMs)]);
    },
    close(): void {
      closed = true;
      for (const player of players) {
        player.expectedDisconnect = true;
        player.client?.disconnect();
      }
    },
    results(): WorkloadResults {
      return { setup: setupRecorder, window: windowRecorder, unexpectedDisconnects, reconnects, gamesCompleted,
        snapshotsReceived, chatMessagesReceived };
    },
  };
}
