import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GAME_TYPES } from '@shared/constants';
import { gameDefinition } from '@shared/games/registry';
import type { PresentationFrame } from '@shared/game-presentation';
import type { GameType, PlayerVisibleGameState, RoomInfo } from '@shared/types';
import { CLIENT_GAMES, clientGame, gamesInCategory } from '../../../client/src/games/registry';
import { GAME_UIS, gameUi } from '../../../client/src/games/ui-registry';
import { frameCue } from '../../../client/src/games/frame-cue';
import { createRoundBuilder } from '../../../client/src/games/round-builder';
import { HIDDEN_GOD_VIEW } from '../../../client/src/stores/god-view-store';

// The UI registry reaches components that read the account; the registry itself never does.
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (state: { account: null }) => unknown) => select({ account: null }),
}));

const CLIENT_SRC = resolve(__dirname, '../../../client/src');

function frame(kind: PresentationFrame['kind'], extra: Partial<PresentationFrame> = {}): PresentationFrame {
  return { key: `${kind}:0`, kind, durationMs: 1000, cards: [], ...extra };
}

describe('client game registries', () => {
  it.each(GAME_TYPES)('registers %s in both registries under its own game type', (gameType) => {
    expect(CLIENT_GAMES[gameType].gameType).toBe(gameType);
    expect(GAME_UIS[gameType].gameType).toBe(gameType);
    expect(clientGame(gameType)).toBe(CLIENT_GAMES[gameType]);
    expect(gameUi(gameType)).toBe(GAME_UIS[gameType]);
  });

  it('registers exactly the game types the shared definitions know', () => {
    expect(Object.keys(CLIENT_GAMES).sort()).toEqual([...GAME_TYPES].sort());
    expect(Object.keys(GAME_UIS).sort()).toEqual([...GAME_TYPES].sort());
  });

  it.each(GAME_TYPES)('gives %s a lazy table, a lobby icon, and rule lines', (gameType) => {
    expect(gameUi(gameType).table).toHaveProperty('$$typeof');
    expect(clientGame(gameType).lobbyIcon.glyph).not.toBe('');
    const lines = clientGame(gameType).rules.summary(undefined, (key) => key);
    expect(Array.isArray(lines)).toBe(true);
  });

  it('keeps tables out of the eager client registry', () => {
    const seen = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/^import (?!type\b)[^;]*?from '(\.[^']+)';/gms)) {
        const base = resolve(dirname(file), match[1]);
        for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
          try {
            readFileSync(candidate);
            visit(candidate);
            break;
          } catch { /* try the next extension */ }
        }
      }
    };
    visit(resolve(CLIENT_SRC, 'games/registry.ts'));
    const loaded = [...seen].map((file) => file.slice(CLIENT_SRC.length + 1));
    expect(loaded).toContain('games/holdem/holdem-rounds.ts');
    expect(loaded.filter((file) => /Table\.tsx$|ui-registry|-ui\.tsx?$|Frame\.tsx$|History\.tsx$/.test(file))).toEqual([]);
    expect(loaded.filter((file) => file.endsWith('.tsx'))).toEqual([]);
  });

  describe('categories', () => {
    it('lists every current game as a card game and none as dice or board', () => {
      expect(gamesInCategory('cards')).toEqual(GAME_TYPES);
      expect(gamesInCategory('dice')).toEqual([]);
      expect(gamesInCategory('board')).toEqual([]);
    });

    it('follows the shared definition', () => {
      for (const gameType of GAME_TYPES) {
        expect(gamesInCategory(gameDefinition(gameType).category)).toContain(gameType);
      }
    });
  });

  describe('game rules', () => {
    it('reports no option for games without room rules', () => {
      expect(clientGame('bigtwo').rules.roomContext({} as RoomInfo)).toEqual({ option: null });
    });

    it('sizes a Blackjack match from the seated players and the dealer rule', () => {
      const seat = (nickname: string | null): RoomInfo['seats']['N'] => ({
        player: nickname ? { id: nickname, nickname } as never : null, isReady: false,
      });
      const room = {
        seats: { N: seat('a'), E: seat('b'), S: seat(null), W: seat(null) },
        additionalSeats: [seat('c')],
        gameOptions: { blackjack: { playerDealer: true } },
      } as unknown as RoomInfo;
      const context = clientGame('blackjack').rules.roomContext(room);
      expect(context.option).toEqual({ label: 'blackjack.playerDealer', enabled: true });
      expect(context.blackjackHands).toBe(3 * 2);
    });
  });

  describe('hand sorting', () => {
    it('offers suit sorting everywhere except Liar\'s Deck', () => {
      expect(GAME_TYPES.filter((gameType) => !clientGame(gameType).handSort.bySuit)).toEqual(['liarsdeck']);
    });

    it('orders Big Two ranks with twos high and everything else by face value', () => {
      const two = { suit: 'clubs', rank: 2 } as const;
      const ace = { suit: 'clubs', rank: 14 } as const;
      const bigTwo = clientGame('bigtwo').handSort.order;
      const standard = clientGame('bridge').handSort.order;
      expect(bigTwo.rank(two)).toBeGreaterThan(bigTwo.rank(ace));
      expect(standard.rank(two)).toBeLessThan(standard.rank(ace));
    });
  });

  describe('settlement', () => {
    it('stamps the game type on a Bridge result and passes other results through', () => {
      const result = { declarerTeamWins: true } as never;
      const bridge = { gameType: 'bridge', result } as unknown as PlayerVisibleGameState;
      expect(clientGame('bridge').settlement(bridge as never)).toEqual({ declarerTeamWins: true, gameType: 'bridge' });
      expect(clientGame('bridge').settlement({ gameType: 'bridge', result: null } as never)).toBeNull();
      const holdem = { gameType: 'holdem', result: { winners: ['N'] } };
      expect(clientGame('holdem').settlement(holdem as never)).toBe(holdem.result);
    });

    it('marks only side-based games as never tying', () => {
      expect(GAME_TYPES.filter((gameType) => clientGame(gameType).result.sidesWin)).toEqual(['bridge', 'napoleon']);
    });
  });

  describe('god view and spectators', () => {
    it('gives each game the observed fields it exposes', () => {
      expect(clientGame('blackjack').observedView({ observedHole: { suit: 'clubs', rank: 5 } } as never))
        .toEqual({ hole: { suit: 'clubs', rank: 5 } });
      expect(clientGame('liarsdeck').observedView({} as never)).toEqual({ liarHands: null });
      expect(clientGame('napoleon').observedView({ observedHands: {} } as never)).toEqual({ napoleonHands: {} });
      expect(clientGame('sevens').observedView({} as never)).toEqual({ hands: null, covered: null });
      expect(clientGame('bridge').observedView({} as never)).toEqual({ hands: null });
    });

    it('projects the watched seat\'s cards without touching other fields', () => {
      const view = { ...HIDDEN_GOD_VIEW, hands: { E: [{ suit: 'clubs', rank: 5 }] } } as const;
      expect(clientGame('chinesepoker').spectatorPatch(view as never, 'E'))
        .toEqual({ myHand: [{ suit: 'clubs', rank: 5 }], myArrangement: null });
      expect(clientGame('blackjack').spectatorPatch(view as never, 'E')).toEqual({});
      expect(clientGame('napoleon').spectatorPatch(view as never, 'E')).toEqual({ myHand: [], validCards: [] });
    });
  });

  describe('frame sounds', () => {
    it('plays card, soft, and out sounds from the shared frame kinds', () => {
      expect(frameCue(null, frame('play'))).toBe('card');
      expect(frameCue(null, frame('showdown'))).toBe('card');
      expect(frameCue(null, frame('pass'))).toBe('soft');
      expect(frameCue(null, frame('fold'))).toBe('soft');
      expect(frameCue(null, frame('eliminated'))).toBe('out');
      expect(frameCue(null, frame('shot', { survived: false }))).toBe('out');
      expect(frameCue(null, frame('shot', { survived: true }))).toBeNull();
      expect(frameCue(null, frame('deal'))).toBeNull();
    });

    it('lets Hold\'em add its deal sound and knock-out award sound', () => {
      const holdem = (log: unknown[]): PlayerVisibleGameState => ({ gameType: 'holdem', log }) as never;
      expect(frameCue(holdem([]), frame('deal'))).toBe('card');
      expect(frameCue({ gameType: 'bridge' } as never, frame('deal'))).toBeNull();
      const award = frame('award', { key: 'action:0' });
      expect(frameCue(holdem([{ type: 'award', eliminated: ['E'] }]), award)).toBe('out');
      expect(frameCue(holdem([{ type: 'award', eliminated: [] }]), award)).toBeNull();
    });
  });

  describe('round builder', () => {
    it('opens, reuses, and releases rounds', () => {
      const builder = createRoundBuilder();
      expect(builder.current()).toBeUndefined();
      const first = builder.open();
      expect(builder.open()).toBe(first);
      builder.release();
      const second = builder.open();
      expect(second).not.toBe(first);
      expect(builder.start().number).toBe(3);
      expect(builder.rounds.map((round) => round.number)).toEqual([1, 2, 3]);
    });

    it.each(GAME_TYPES)('keeps %s history optional only where tricks or results are listed elsewhere', (gameType: GameType) => {
      const hasHistory = Boolean(clientGame(gameType).roundHistory);
      expect(hasHistory).toBe(Boolean(gameUi(gameType).roundsView));
      expect(hasHistory).toBe(!['bridge', 'chinesepoker', 'napoleon'].includes(gameType));
    });
  });
});
