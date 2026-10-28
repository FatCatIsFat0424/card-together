// ─── CrazyEightsHistory: each hand's starter, plays, draws, and leftover points ───

import type { ReactNode } from 'react';
import { SUIT_SYMBOLS } from '@shared/constants';
import type { GameSeat } from '@shared/types';
import { useI18nStore } from '../../stores/i18n-store';
import {
  CardChip, HistoryAction, HistoryActions, HistoryNote, HistoryOngoing, HistoryResult, HistoryRounds, HistoryTag,
} from '../HistoryRounds';
import type { HistoryAction as Action, HistoryRound } from '../round-history';
import { useSeatName } from '../seat-names';

export function CrazyEightsRounds({ rounds, mySeat }: {
  rounds: readonly HistoryRound[]; mySeat: GameSeat | null;
}): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();

  const effectNote = (action: Action): ReactNode => {
    if (action.effect === 'reverse') return <HistoryNote>{t('crazyeights.logReverse')}</HistoryNote>;
    if (!action.target) return null;
    return <HistoryNote>{action.effect === 'draw'
      ? t('crazyeights.logPenalty', { name: name(action.target), n: String(action.count ?? 0) })
      : t('crazyeights.logSkipped', { name: name(action.target) })}</HistoryNote>;
  };

  return <HistoryRounds rounds={rounds} summary={(round) => {
    const winner = round.actions.find((action) => action.kind === 'settle' && action.points === 0)?.seat;
    return winner ? <HistoryResult trophy>{name(winner)}</HistoryResult> : !round.complete && <HistoryOngoing />;
  }}>{(round) => <HistoryActions>{round.actions.map((action, index) => {
    if (!action.seat) return null;
    const card = action.cards[0];
    const common = { name: name(action.seat), nameTitle: name(action.seat), mine: action.seat === mySeat };
    switch (action.kind) {
      case 'deal':
        return <HistoryAction key={index} {...common}>
          <HistoryNote muted>{t('crazyeights.historyStarter')}</HistoryNote>{card && <CardChip card={card} />}
        </HistoryAction>;
      case 'play':
        return <HistoryAction key={index} {...common}>
          {card && <CardChip card={card} />}
          {action.suit && <HistoryTag>{t('crazyeights.logWild', { suit: SUIT_SYMBOLS[action.suit] })}</HistoryTag>}
          {effectNote(action)}
        </HistoryAction>;
      case 'hit':
        return <HistoryAction key={index} {...common} state="muted"><HistoryNote>{t('crazyeights.logDrew')}</HistoryNote></HistoryAction>;
      case 'pass':
        return <HistoryAction key={index} {...common} state="muted"><HistoryNote>{t('crazyeights.logPassed')}</HistoryNote></HistoryAction>;
      default:
        return <HistoryAction key={index} {...common} state={action.points === 0 ? 'won' : undefined}>
          <HistoryNote>{t('crazyeights.historyHandEnd', { n: String(action.points ?? 0) })}</HistoryNote>
        </HistoryAction>;
    }
  })}</HistoryActions>}</HistoryRounds>;
}
