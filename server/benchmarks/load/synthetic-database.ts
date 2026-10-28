import { randomBytes, randomUUID } from 'node:crypto';
import { stat, unlink, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { getPresentationEndsAt } from '@shared/game-presentation';
import { GAME_TYPES, SHOP_ITEMS } from '@shared/constants';
import type { AnyGameState, GameSeat, GameType, MatchReplay, MatchResult, PlayerInfo, ShopItemId } from '@shared/types';
import { SESSION_COOKIE_NAME, tokenHash } from '../../src/auth/auth-service';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { DatabaseEngine } from '../../src/config';
import { CURRENT_SCHEMA_VERSION } from '../../src/database/migrations';
import { importJsonDocument } from '../../src/database/sqlite-import';
import { createReplayStore } from '../../src/database/replay-store';
import type {
  AccountRecord, DirectMessageRecord, FriendshipRecord, MatchRecord, SessionRecord,
} from '../../src/database/repository';
import { MAX_MATCHES_PER_ACCOUNT } from '../../src/database/repository';
import type { DatabaseDocument } from '../../src/database/schema';
import { validateDocument } from '../../src/database/schema';
import { getTurnSeat } from '../../src/managers/game-clock';
import * as gameManager from '../../src/managers/game-manager';
import * as blackjack from '../../src/managers/games/blackjack-game';
import * as chinesepoker from '../../src/managers/games/chinesepoker-game';
import * as napoleon from '../../src/managers/games/napoleon-game';
import { applyAutomatedAction, firstLegalAction } from '../../src/runtime/automated-action';
import { captureMatchReplay } from '../../src/runtime/match-replay';
import { recordReplayStep } from '../../src/runtime/replay-recording';

// Synthetic state only: every account, session, and message is generated, never copied from real data.

/** Matches the stored hash format; fixture sessions never derive it, so the value is arbitrary. */
const FIXTURE_PASSWORD_HASH = `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`;
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_SPAN_MS = 60 * 24 * 60 * 60 * 1000;
const TEMPLATE_SEATS = ['N', 'E', 'S', 'W'] as const;
const AVATARS = ['cat', 'fox', 'owl', 'bear', 'rabbit', 'panda'] as const;
const MAX_TEMPLATE_ACTIONS = 5_000;

export interface SyntheticDatabaseOptions {
  /** Total accounts, including the load accounts. */
  readonly accounts: number;
  /** Accounts with a known session token, used by load clients. */
  readonly loadAccounts: number;
  /** Average accepted friends per account. */
  readonly friendsPerAccount: number;
  /** Completed matches each account appears in; at most the retention cap. */
  readonly matchesPerAccount: number;
  /** Retained direct messages sent per account. */
  readonly messagesPerAccount: number;
  /** Newest matches that get a replay archive file. */
  readonly replays: number;
  /** Real matches played per game type to take results and replay archives from. */
  readonly templatesPerGame: number;
}

export interface LoadAccount {
  readonly id: string;
  readonly username: string;
  readonly cookie: string;
}

export interface MatchTemplate {
  readonly gameType: GameType;
  readonly result: MatchResult;
  readonly replay: MatchReplay;
  readonly durationMs: number;
}

export interface SyntheticDatabaseSummary {
  readonly accounts: number;
  readonly sessions: number;
  readonly friendships: number;
  readonly matches: number;
  readonly directMessages: number;
  readonly replayArchives: number;
  readonly rewardedGameIds: number;
  /** The generated JSON document; the same as `databaseBytes` for the JSON engine. */
  readonly jsonBytes: number;
  readonly databaseBytes: number;
  /** Milliseconds to import the JSON document into SQLite; null for the JSON engine. */
  readonly importMs: number | null;
  readonly templateMatches: number;
}

function shuffle<T>(values: T[]): T[] {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [values[index], values[other]] = [values[other], values[index]];
  }
  return values;
}

function pick<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}

function roomCode(): string {
  return randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
}

/** The seat that must act next on the full state, mirroring the bot scheduler's choice. */
function actingSeat(game: AnyGameState): GameSeat | null {
  if (game.phase === 'scoring') return null;
  if (game.gameType === 'chinesepoker') return chinesepoker.pendingSeats(game)[0] ?? null;
  if (game.gameType === 'blackjack' && game.phase === 'betting') return blackjack.pendingBetSeats(game)[0] ?? null;
  if (game.gameType === 'napoleon' && game.phase === 'reviewing') return napoleon.pendingReviewSeats(game)[0] ?? null;
  return getTurnSeat(game);
}

/**
 * Plays complete four-seat matches through the game manager with the production bot strategies,
 * recording replays the way runtime commits do. A simulated clock skips presentation waits.
 */
export function playTemplateMatches(perGame: number, gameTypes: readonly GameType[] = GAME_TYPES): MatchTemplate[] {
  const realNow = Date.now;
  let now = realNow();
  Date.now = (): number => now;
  const templates: MatchTemplate[] = [];
  try {
    for (const gameType of gameTypes) {
      for (let sample = 0; sample < perGame; sample += 1) {
        const code = `TPL${sample}`;
        const players = Object.fromEntries(TEMPLATE_SEATS.map((seat, index): [GameSeat, PlayerInfo] => [seat, {
          id: `template-${index}`, username: `template_${index}`, nickname: `Player ${index + 1}`,
          color: '#2563eb', avatar: AVATARS[index], avatarImage: null,
        }]));
        const started = gameManager.startGame(code, gameType, players);
        if (!started.success) throw new Error(`Unable to start a ${gameType} template: ${started.reason}`);
        const startedAt = now;
        recordReplayStep(gameManager.getGameState(code)!, undefined);
        let actions = 0;
        for (;;) {
          const game = gameManager.getGameState(code);
          if (!game) throw new Error(`The ${gameType} template disappeared.`);
          const seat = actingSeat(game);
          if (!seat) break;
          if (actions++ >= MAX_TEMPLATE_ACTIONS) throw new Error(`The ${gameType} template did not finish.`);
          now = Math.max(now + 1_000, getPresentationEndsAt(game) + 1);
          const visible = gameManager.getPlayerVisibleState(code, seat);
          if (!visible) throw new Error(`No ${gameType} view for ${seat}.`);
          const action = getBotAction(visible) ?? firstLegalAction(visible);
          if (!action) throw new Error(`No ${gameType} action for ${seat} in ${game.phase}.`);
          const before = structuredClone(game);
          const applied = applyAutomatedAction(code, seat, action);
          if (!applied.success) throw new Error(`${gameType} ${seat} ${action.type}: ${applied.reason}`);
          recordReplayStep(gameManager.getGameState(code)!, before);
        }
        const game = gameManager.getGameState(code)!;
        const replay = captureMatchReplay(game);
        if (!game.result || !replay) throw new Error(`The ${gameType} template has no result or replay.`);
        const result = (game.gameType === 'bridge' ? { ...game.result, gameType: 'bridge' } : game.result) as MatchResult;
        templates.push({ gameType, result: structuredClone(result), replay, durationMs: now - startedAt });
        gameManager.removeGame(code);
      }
    }
  } finally {
    Date.now = realNow;
  }
  return templates;
}

function ownedItems(): ShopItemId[] {
  const items = SHOP_ITEMS.filter((item) => item.type !== 'avatarBorder').map((item) => item.id as ShopItemId);
  return shuffle([...items]).slice(0, Math.floor(Math.random() * 6));
}

/** Builds a document in the current schema and validates it with the production validator. */
export function buildSyntheticDocument(options: SyntheticDatabaseOptions, templates: readonly MatchTemplate[], now = Date.now()): {
  document: DatabaseDocument; loadAccounts: LoadAccount[]; archives: Map<string, MatchReplay>;
} {
  if (options.loadAccounts > options.accounts) throw new Error('Load accounts cannot exceed total accounts.');
  if (options.matchesPerAccount > MAX_MATCHES_PER_ACCOUNT) {
    throw new Error(`Matches per account cannot exceed the retention cap of ${MAX_MATCHES_PER_ACCOUNT}.`);
  }
  if (templates.length === 0 && options.matchesPerAccount > 0) throw new Error('Match history needs templates.');
  const accounts: AccountRecord[] = [];
  const sessions: SessionRecord[] = [];
  const loadAccounts: LoadAccount[] = [];
  for (let index = 0; index < options.accounts; index += 1) {
    const id = randomUUID();
    const username = `load_${index}`;
    const createdAt = now - HISTORY_SPAN_MS - Math.floor(Math.random() * HISTORY_SPAN_MS);
    accounts.push({
      id, username, usernameNormalized: username, passwordHash: FIXTURE_PASSWORD_HASH,
      nickname: `Load ${index}`, color: `#${randomBytes(3).toString('hex')}`, avatar: pick(AVATARS),
      avatarImage: null, tableBackground: null, tableBackgroundOpacity: 100, cardBack: null, cardBackOpacity: 100,
      // Load clients browse each other's history, so theirs is public.
      matchesPublic: index < options.loadAccounts || Math.random() < 0.8, coins: Math.floor(Math.random() * 2_000), coinRevision: Math.floor(Math.random() * 200),
      ownedShopItems: ownedItems(), lastSeenAt: now - Math.floor(Math.random() * HISTORY_SPAN_MS),
      achievements: { games: options.matchesPerAccount, wins: Math.floor(options.matchesPerAccount / 4),
        gameTypes: shuffle([...GAME_TYPES]).slice(0, 1 + Math.floor(Math.random() * GAME_TYPES.length)), dailyTasks: 0 },
      createdAt, updatedAt: createdAt,
    });
    const token = randomBytes(32).toString('base64url');
    sessions.push({ tokenHash: tokenHash(token), accountId: id, createdAt: now, expiresAt: now + SESSION_LIFETIME_MS });
    if (index < options.loadAccounts) loadAccounts.push({ id, username, cookie: `${SESSION_COOKIE_NAME}=${token}` });
  }

  // Load accounts befriend their neighbours so private messages have accepted recipients.
  const friendships: FriendshipRecord[] = [];
  const pairs = new Set<string>();
  function befriend(first: number, second: number, status: FriendshipRecord['status']): void {
    if (first === second) return;
    const key = first < second ? `${first}:${second}` : `${second}:${first}`;
    if (pairs.has(key)) return;
    pairs.add(key);
    const createdAt = now - Math.floor(Math.random() * HISTORY_SPAN_MS);
    friendships.push({ id: randomUUID(), requesterId: accounts[first].id, recipientId: accounts[second].id,
      status, createdAt, updatedAt: createdAt });
  }
  for (let index = 0; index < options.loadAccounts; index += 1) {
    for (let offset = 1; offset <= 3; offset += 1) befriend(index, (index + offset) % options.loadAccounts, 'accepted');
  }
  const order = shuffle(accounts.map((_account, index) => index));
  const half = Math.max(0, Math.round(options.friendsPerAccount / 2));
  for (let position = 0; position < order.length; position += 1) {
    for (let offset = 1; offset <= half; offset += 1) {
      befriend(order[position], order[(position + offset) % order.length], Math.random() < 0.05 ? 'pending' : 'accepted');
    }
  }

  const directMessages: DirectMessageRecord[] = [];
  const accepted = friendships.filter((friendship) => friendship.status === 'accepted');
  for (let index = 0; index < accounts.length * options.messagesPerAccount && accepted.length > 0; index += 1) {
    const friendship = pick(accepted);
    const forward = Math.random() < 0.5;
    directMessages.push({
      id: randomUUID(), clientId: randomBytes(12).toString('base64url'),
      senderId: forward ? friendship.requesterId : friendship.recipientId,
      recipientId: forward ? friendship.recipientId : friendship.requesterId,
      timestamp: now - Math.floor(Math.random() * 80 * 24 * 60 * 60 * 1000),
      content: `Synthetic message ${index}`,
    });
  }
  directMessages.sort((first, second) => first.timestamp - second.timestamp);

  // Each round seats every account once, so every account ends exactly at matchesPerAccount.
  const matches: MatchRecord[] = [];
  for (let round = 0; round < options.matchesPerAccount; round += 1) {
    const seating = shuffle(accounts.map((account) => account.id));
    for (let start = 0; start < seating.length; start += 4) {
      const accountIds = seating.slice(start, start + 4);
      while (accountIds.length < 4) accountIds.push(`bot:${randomUUID()}`);
      const template = pick(templates);
      const finishedAt = now - HISTORY_SPAN_MS + Math.floor(((round + Math.random()) / options.matchesPerAccount) * HISTORY_SPAN_MS);
      matches.push({ id: randomUUID(), roomCode: roomCode(), accountIds, result: structuredClone(template.result), finishedAt });
    }
  }
  matches.sort((first, second) => first.finishedAt - second.finishedAt);

  const archives = new Map<string, MatchReplay>();
  const flagged = new Set(matches.slice(Math.max(0, matches.length - options.replays)).map((match) => match.id));
  const withReplays = matches.map((match): MatchRecord => {
    if (!flagged.has(match.id)) return match;
    const template = templates.find((entry) => entry.gameType === match.result.gameType) ?? templates[0];
    archives.set(match.id, { ...structuredClone(template.replay), startedAt: Math.max(0, match.finishedAt - template.durationMs) });
    return { ...match, hasReplay: true };
  });

  const document: DatabaseDocument = {
    schemaVersion: CURRENT_SCHEMA_VERSION, accounts, sessions, friendships, matches: withReplays, emojis: [],
    directMessages, messageReads: [], friendNotifications: [], gameStats: [], accountStats: [], runtime: null,
    // Every completed match leaves a reward receipt that is never pruned.
    rewardedGameIds: withReplays.map((match) => match.id),
  };
  validateDocument(document);
  return { document, loadAccounts, archives };
}

/**
 * Writes the database and its replay archives; the server opens them with the production repository.
 * For SQLite the JSON document is imported with the production import, then removed.
 */
export async function writeSyntheticDatabase(directory: string, options: SyntheticDatabaseOptions, engine: DatabaseEngine = 'json'): Promise<{
  databasePath: string; loadAccounts: LoadAccount[]; summary: SyntheticDatabaseSummary;
}> {
  const templates = options.matchesPerAccount > 0 ? playTemplateMatches(options.templatesPerGame) : [];
  const { document, loadAccounts, archives } = buildSyntheticDocument(options, templates);
  const jsonPath = join(directory, 'database.json');
  const text = `${JSON.stringify(document)}\n`;
  await writeFile(jsonPath, text, { mode: 0o600 });
  const store = createReplayStore(join(directory, 'replays'));
  for (const [matchId, replay] of archives) await store.write(matchId, replay);
  let databasePath = jsonPath;
  let importMs: number | null = null;
  if (engine === 'sqlite') {
    databasePath = join(directory, 'database.sqlite');
    const started = performance.now();
    await importJsonDocument(JSON.parse(text), databasePath);
    importMs = Math.round(performance.now() - started);
    await unlink(jsonPath);
  }
  return {
    databasePath, loadAccounts,
    summary: {
      accounts: document.accounts.length, sessions: document.sessions.length, friendships: document.friendships.length,
      matches: document.matches.length, directMessages: document.directMessages.length, replayArchives: archives.size,
      rewardedGameIds: document.rewardedGameIds?.length ?? 0, jsonBytes: Buffer.byteLength(text),
      databaseBytes: (await stat(databasePath)).size, importMs, templateMatches: templates.length,
    },
  };
}
