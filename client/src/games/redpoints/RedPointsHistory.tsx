// ─── RedPointsHistory: each turn's play and stock flip with what they captured ───

import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { useI18nStore } from '../../stores/i18n-store';
import {
  CardChip, HistoryAction, HistoryActions, HistoryNote, HistoryOngoing, HistoryResult, HistoryRounds, HistorySubject,
  SignedValue,
} from '../HistoryRounds';
import type { HistoryRound } from '../round-history';
import { useSeatName } from '../seat-names';
import { redPointsRoundPoints } from './redpoints-view';

export function RedPointsRounds({ rounds, mySeat }: {
  rounds: readonly HistoryRound[]; mySeat: GameSeat | null;
}): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();
  return <HistoryRounds rounds={rounds} summary={(round) => {
    const seat = round.actions[0]?.seat;
    const points = redPointsRoundPoints(round);
    return <>
      {seat && <HistorySubject mine={seat === mySeat}>{name(seat)}</HistorySubject>}
      {!round.complete ? <HistoryOngoing />
        : <HistoryResult tone={points > 0 ? 'success' : 'neutral'}>{t('history.points', { n: String(points) })}</HistoryResult>}
    </>;
  }}>{(round) => <HistoryActions>{round.actions.map((action, index) => {
    const card = action.cards[0];
    return <HistoryAction key={index} label name={t(`history.${action.kind}`)}
      marks={action.points ? <SignedValue value={action.points} text={`+${action.points}`} /> : null}>
      {card && <CardChip card={card} />}
      {action.pending ? <HistoryNote>{t('history.pending')}</HistoryNote>
        : action.captured ? <><HistoryNote>{t('redpoints.historyCaptures')}</HistoryNote><CardChip card={action.captured} /></>
          : <HistoryNote muted>{t('history.stay')}</HistoryNote>}
    </HistoryAction>;
  })}</HistoryActions>}</HistoryRounds>;
}
