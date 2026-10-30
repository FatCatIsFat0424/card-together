import { SEAT_ORDER_CLOCKWISE, SUIT_SYMBOLS } from '@shared/constants';
import { equalSnapshotValue, retainSnapshotValue } from '../../stores/snapshot-equality';
import type { ClientGame } from '../client-game';
import { NO_RULES_OPTION, spectatorHand, STANDARD_HAND_ORDER } from '../client-game-helpers';

export const bridgeClient: ClientGame<'bridge'> = {
  gameType: 'bridge',
  // Bridge keeps its state in individual fields rather than one visible-state field.
  restoreSnapshot: (game, { state }) => ({
    phase: game.phase,
    dealerSeat: game.dealerSeat,
    myHand: equalSnapshotValue(state.myHand, game.myHand) ? state.myHand : [...game.myHand],
    log: equalSnapshotValue(state.log, game.log) ? state.log : [...game.log],
    currentTurnSeat: game.playing?.currentTurnSeat ?? game.bidding?.currentBidderSeat ?? null,
    validCards: equalSnapshotValue(state.validCards, game.validCards) ? state.validCards : [...game.validCards],
    bidding: retainSnapshotValue(state.bidding, game.bidding),
    contract: retainSnapshotValue(state.contract, game.contract),
    playing: retainSnapshotValue(state.playing, game.playing),
    result: retainSnapshotValue(state.result, game.result),
    redealPendingSeat: game.redealPendingSeat,
  }),
  observedView: (game) => ({ hands: game.observedHands ?? null }),
  spectatorPatch: spectatorHand,
  rules: {
    summary: (_context, t) => [t('bridge.rulesGoal'), t('bridge.rulesBid'), t('bridge.rulesPlay'), t('bridge.rulesEnd')],
    roomContext: () => NO_RULES_OPTION,
    matchContext: () => NO_RULES_OPTION,
  },
  handSort: { order: STANDARD_HAND_ORDER, bySuit: true, initial: 'suit' },
  handBeside: true,
  lobbyIcon: { glyph: '♠' },
  settlement: (game) => game.result ? { ...game.result, gameType: 'bridge' } : null,
  result: {
    winners: (result) => {
      const declarerParity = SEAT_ORDER_CLOCKWISE.indexOf(result.contract.declarer) % 2;
      return SEAT_ORDER_CLOCKWISE.filter((_, index) => (index % 2 === declarerParity) === result.declarerTeamWins);
    },
    sidesWin: true,
    summary: (result, _mySeat, t) => ({
      kind: 'text',
      text: `${result.contract.level}${result.contract.suit === 'nt' ? 'NT' : SUIT_SYMBOLS[result.contract.suit]}`
        + ` · ${result.declarerTeamTricks}/${result.requiredTricks} · `
        + t(result.declarerTeamWins ? 'score.declarerWins' : 'score.defenderWins'),
    }),
  },
};
