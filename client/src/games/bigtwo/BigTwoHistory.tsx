// ─── BigTwoHistory: Big Two rounds, newest first, as aligned name / cards rows ───

import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { useI18nStore } from '../../stores/i18n-store';
import {
  CardChips, HistoryAction, HistoryActions, HistoryNote, HistoryOngoing, HistoryResult, HistoryRounds, HistoryTag,
  HistoryTrophy,
} from '../HistoryRounds';
import type { HistoryRound } from '../round-history';
import { useSeatName } from '../seat-names';
import { comboLabelKey, summarizeBigTwoRound } from './bigtwo-view';

export function BigTwoRounds({ rounds, mySeat }: {
  rounds: readonly HistoryRound[]; mySeat: GameSeat | null;
}): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();
  return <HistoryRounds rounds={rounds} summary={(round) => {
    const { leadCombo, winnerSeat } = summarizeBigTwoRound(round);
    return <>
      {leadCombo && <HistoryTag>{t(comboLabelKey(leadCombo))}</HistoryTag>}
      {winnerSeat ? <HistoryResult trophy title={t('bigtwo.historyLeader', { name: name(winnerSeat) })}>
        {name(winnerSeat)}</HistoryResult> : !round.complete && <HistoryOngoing />}
    </>;
  }}>{(round) => {
    const { leadCombo, winningIndex } = summarizeBigTwoRound(round);
    return <HistoryActions>{round.actions.map((action, index) => {
      if (action.kind === 'round_end' || !action.seat) return null;
      const won = index === winningIndex;
      const bomb = action.comboType && action.comboType !== leadCombo ? action.comboType : null;
      return <HistoryAction key={index} name={name(action.seat)} nameTitle={name(action.seat)}
        mine={action.seat === mySeat} state={won ? 'won' : action.kind === 'pass' ? 'muted' : undefined}
        marks={<>
          {bomb && <HistoryTag tone="warning">{t(comboLabelKey(bomb))}</HistoryTag>}
          {won && <HistoryTrophy title={t('bigtwo.historyLeader', { name: name(action.seat) })} />}
        </>}>
        {action.kind === 'play' ? <CardChips cards={action.cards} /> : <HistoryNote>{t(`history.${action.kind}`)}</HistoryNote>}
      </HistoryAction>;
    })}</HistoryActions>;
  }}</HistoryRounds>;
}
