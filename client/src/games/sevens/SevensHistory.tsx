// ─── SevensHistory: each rotation's plays, with covered turns dimmed ───

import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { useI18nStore } from '../../stores/i18n-store';
import {
  CardChip, HistoryAction, HistoryActions, HistoryNote, HistoryOngoing, HistoryRounds, HistoryTag,
} from '../HistoryRounds';
import type { HistoryRound } from '../round-history';
import { useSeatName } from '../seat-names';

export function SevensRounds({ rounds, mySeat }: {
  rounds: readonly HistoryRound[]; mySeat: GameSeat | null;
}): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();
  return <HistoryRounds rounds={rounds} summary={(round) => {
    const covers = round.actions.filter((action) => action.kind === 'cover').length;
    return <>
      {covers > 0 && <HistoryTag>{t('sevens.historyCovers', { n: String(covers) })}</HistoryTag>}
      {!round.complete && <HistoryOngoing />}
    </>;
  }}>{(round) => <HistoryActions>{round.actions.map((action, index) => {
    if (!action.seat) return null;
    const card = action.cards[0];
    return <HistoryAction key={index} name={name(action.seat)} nameTitle={name(action.seat)}
      mine={action.seat === mySeat} state={action.kind === 'cover' ? 'muted' : undefined}>
      {card ? <CardChip card={card} /> : <HistoryNote>{t('history.cover')}</HistoryNote>}
    </HistoryAction>;
  })}</HistoryActions>}</HistoryRounds>;
}
