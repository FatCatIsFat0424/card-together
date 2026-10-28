import { gameSeatValue } from '@shared/rules/seats';
import { svOrder } from '@shared/rules/sevens';
import type { ClientGame } from '../client-game';
import { STANDARD_HAND_ORDER } from '../client-game-helpers';
import { deriveSevensRounds } from './sevens-rounds';

export const sevensClient: ClientGame<'sevens'> = {
  gameType: 'sevens',
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    sevens: retain(state.sevens, game),
  }),
  observedView: (game) => ({ hands: game.observedHands ?? null, covered: game.observedCovered ?? null }),
  spectatorPatch: (view, seat) => ({
    myHand: [...view.hands?.[seat] ?? []],
    myCovered: [...view.covered?.[seat] ?? []],
  }),
  rules: {
    summary: (context, t) => [t('sevens.rulesOpen'), t('sevens.rulesExtend'), t('sevens.rulesCover'),
      t('sevens.rulesScore'), ...(context?.option?.enabled ? [t('sevens.rulesCloseOnEnd')] : [])],
    roomContext: (room) => ({ option: { label: 'sevens.closeOnEnd', enabled: room.gameOptions?.sevens?.closeOnEnd ?? false } }),
    matchContext: (game) => ({ option: { label: 'sevens.closeOnEnd', enabled: game.options?.closeOnEnd ?? false } }),
  },
  roundHistory: { derive: deriveSevensRounds },
  // Aces are low in Sevens, so a hand reads K down to A.
  handSort: { order: { rank: svOrder, suit: STANDARD_HAND_ORDER.suit }, bySuit: true, initial: 'suit' },
  handBeside: true,
  lobbyIcon: { glyph: '7️⃣', icon: 'seven' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: false,
    summary: (result, mySeat) => ({
      kind: 'winners',
      winners: result.winners,
      detail: mySeat ? { key: 'history.penalty', n: String(gameSeatValue(result.penalties, mySeat) ?? 0) } : null,
    }),
  },
};
