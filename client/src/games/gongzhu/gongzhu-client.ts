import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { isCompassSeat } from '@shared/rules/seats';
import type { ClientGame } from '../client-game';
import { NO_RULES_OPTION, spectatorHand, STANDARD_HAND_ORDER } from '../client-game-helpers';

export const gongZhuClient: ClientGame<'gongzhu'> = {
  gameType: 'gongzhu',
  restoreSnapshot: (game, { state, retain }) => ({ phase: game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null, gongzhu: retain(state.gongzhu, game) }),
  observedView: (game) => ({ hands: game.observedHands ?? null }),
  spectatorPatch: spectatorHand,
  rules: {
    summary: (_context, t) => [t('gongzhu.rulesDeal'), t('gongzhu.rulesPlay'), t('gongzhu.rulesScore'),
      t('gongzhu.rulesSpecial'), t('gongzhu.rulesFree')],
    roomContext: () => NO_RULES_OPTION, matchContext: () => NO_RULES_OPTION,
  },
  roundHistory: {
    followsPresentation: true,
    derive: (game, builder) => {
      for (const entry of game.log) {
        if (entry.type === 'deal') builder.start().actions.push({ kind: 'deal', seat: entry.first, cards: [] });
        else if (entry.type === 'play') builder.open().actions.push({ kind: 'play', seat: entry.seat, cards: [entry.card] });
        else if (entry.type === 'trick') builder.open().actions.push({ kind: 'award', seat: entry.winner,
          cards: entry.plays.map((play) => play.card) });
        else {
          const round = builder.open();
          for (const seat of SEAT_ORDER_CLOCKWISE) round.actions.push({ kind: 'settle', seat, cards: [], points: entry.scores[seat] });
          round.complete = true;
          builder.release();
        }
      }
    },
  },
  handSort: { order: STANDARD_HAND_ORDER, bySuit: true, initial: 'rank' },
  handBeside: true, lobbyIcon: { glyph: '♣' },
  settlement: (game) => game.result,
  result: { winners: (result) => result.winners, sidesWin: false,
    summary: (result, seat) => ({ kind: 'winners', winners: result.winners,
      detail: seat && isCompassSeat(seat) ? { key: 'gongzhu.currentScore', n: String(result.scores[seat]) } : null }) },
};
