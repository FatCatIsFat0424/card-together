import { SUIT_SYMBOLS } from '@shared/constants';
import { DEFAULT_NAPOLEON_OPTIONS } from '@shared/napoleon-options';
import type { ClientGame } from '../client-game';
import { STANDARD_HAND_ORDER } from '../client-game-helpers';

export const napoleonClient: ClientGame<'napoleon'> = {
  gameType: 'napoleon',
  // Exchanging, reviewing, and calling run inside the active match; reviewing has no single turn.
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase === 'bidding' || game.phase === 'scoring' ? game.phase : 'playing',
    dealerSeat: game.dealerSeat,
    currentTurnSeat: game.currentTurnSeat
      ?? (game.phase === 'bidding' ? game.bidding?.currentBidderSeat ?? null : null),
    napoleon: retain(state.napoleon, game),
  }),
  observedView: (game) => ({ napoleonHands: game.observedHands ?? null }),
  spectatorPatch: (view, seat) => ({ myHand: [...view.napoleonHands?.[seat] ?? []], validCards: [] }),
  rules: {
    // Joker summoning is on by default, so the lobby lists it too.
    summary: (context, t) => [t('napoleon.rulesDeal'), t('napoleon.rulesBid'), t('napoleon.rulesSecretary'),
      t('napoleon.rulesPlay'), ...(context?.option?.enabled ?? true ? [t('napoleon.rulesSummon')] : []),
      t('napoleon.rulesWin')],
    roomContext: (room) => ({ option: { label: 'napoleon.jokerSummon',
      enabled: (room.napoleonOptions ?? DEFAULT_NAPOLEON_OPTIONS).jokerSummon } }),
    matchContext: (game) => ({ option: { label: 'napoleon.jokerSummon', enabled: game.options.jokerSummon } }),
  },
  handSort: { order: STANDARD_HAND_ORDER, bySuit: true },
  handBeside: true,
  lobbyIcon: { glyph: '👑' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: true,
    summary: (result, _mySeat, t) => ({
      kind: 'text',
      text: `${result.contract.level}${result.contract.suit === 'nt' ? 'NT' : SUIT_SYMBOLS[result.contract.suit]}`
        + ` · ${result.napoleonPoints}/${result.contract.level} · `
        + t(result.napoleonWins ? 'napoleon.napoleonWins' : 'napoleon.defendersWin'),
    }),
  },
};
