import { DEFAULT_DOUDIZHU_OPTIONS } from '@shared/doudizhu-options';
import { gameSeatValue } from '@shared/rules/seats';
import type { ClientGame } from '../client-game';
import { ddzHandOrder } from './doudizhu-order';
import { deriveDouDizhuRounds } from './doudizhu-rounds';

export const douDizhuClient: ClientGame<'doudizhu'> = {
  gameType: 'doudizhu',
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase === 'calling' ? 'bidding' : game.phase,
    currentTurnSeat: game.phase === 'scoring' ? null : game.currentTurnSeat,
    doudizhu: retain(state.doudizhu, game),
  }),
  observedView: (game) => ({ napoleonHands: game.observedHands ?? null }),
  spectatorPatch: (view, seat) => ({ myHand: [...view.napoleonHands?.[seat] ?? []] }),
  rules: {
    summary: (context, t) => [t('doudizhu.rulesDeal'),
      t(context?.option?.enabled ? 'doudizhu.rulesGrab' : 'doudizhu.rulesBid'),
      t('doudizhu.rulesPlay'), t('doudizhu.rulesScore')],
    roomContext: (room) => ({ option: { label: 'doudizhu.grabOption',
      enabled: (room.gameOptions?.doudizhu ?? DEFAULT_DOUDIZHU_OPTIONS).variant === 'grab' } }),
    matchContext: (game) => ({ option: { label: 'doudizhu.grabOption', enabled: game.options.variant === 'grab' } }),
  },
  roundHistory: { derive: deriveDouDizhuRounds, followsPresentation: true },
  handSort: { order: ddzHandOrder, bySuit: true, initial: 'rank' },
  handBeside: false,
  lobbyIcon: { glyph: '🂡' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: false,
    summary: (result, mySeat) => ({
      kind: 'winners',
      winners: result.winners,
      detail: mySeat ? { key: 'history.matchPoints', n: String(gameSeatValue(result.scores, mySeat) ?? 0) } : null,
    }),
  },
};
