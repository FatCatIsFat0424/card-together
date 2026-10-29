import { OM_DEALS } from '@shared/rules/oldmaid';
import type { ClientGame } from '../client-game';
import { NO_RULES_OPTION, STANDARD_HAND_ORDER } from '../client-game-helpers';
import { deriveOldMaidRounds } from './oldmaid-rounds';

export const oldMaidClient: ClientGame<'oldmaid'> = {
  gameType: 'oldmaid',
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    oldMaid: retain(state.oldMaid, game),
  }),
  observedView: (game) => ({ oldMaidHands: game.observedHands ?? null }),
  spectatorPatch: (view, seat) => ({ myHand: [...view.oldMaidHands?.[seat] ?? []] }),
  rules: {
    summary: (_context, t) => [t('oldmaid.rulesDeal'), t('oldmaid.rulesDraw'),
      t('oldmaid.rulesScore', { total: String(OM_DEALS) })],
    roomContext: () => NO_RULES_OPTION,
    matchContext: () => NO_RULES_OPTION,
  },
  roundHistory: { derive: deriveOldMaidRounds, followsPresentation: true },
  // The hand's order is private and must stay unpredictable to whoever draws from it, so it is never sorted for the player.
  handSort: { order: STANDARD_HAND_ORDER, bySuit: true, initial: 'rank', unsortable: true },
  handBeside: false,
  lobbyIcon: { glyph: '🃏' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: false,
    summary: (result, mySeat) => ({
      kind: 'winners',
      winners: result.winners,
      detail: mySeat && result.seats.includes(mySeat) ? { key: 'history.score', n: String(result.totals[mySeat]) } : null,
    }),
  },
};
