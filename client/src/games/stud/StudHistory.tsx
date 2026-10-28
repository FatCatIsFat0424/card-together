// ─── StudHistory: each hand's antes, up cards and betting by street, showdown, and winnings ───

import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { useI18nStore } from '../../stores/i18n-store';
import {
  CardChips, ChipAmount, HistoryAction, HistoryActions, HistoryDivider, HistoryNote, HistoryOngoing, HistoryResult,
  HistoryRounds, HistoryTag, HistoryTrophy,
} from '../HistoryRounds';
import type { HistoryAction as Action, HistoryRound } from '../round-history';
import { joinNames, useSeatName } from '../seat-names';
import { holdemRoundWinners } from '../holdem/holdem-view';

export function StudRounds({ rounds, mySeat }: {
  rounds: readonly HistoryRound[]; mySeat: GameSeat | null;
}): ReactNode {
  const { locale, t } = useI18nStore();
  const name = useSeatName();

  const row = (action: Action, index: number): ReactNode => {
    if (action.kind === 'street') {
      return <HistoryDivider key={index}>{action.studStreet && t(`stud.street.${action.studStreet}`)}</HistoryDivider>;
    }
    if (!action.seat) return null;
    const who = name(action.seat);
    const amount = action.amount !== undefined && <ChipAmount amount={action.amount} />;
    const common = { name: who, nameTitle: who, mine: action.seat === mySeat };
    if (action.kind === 'deal') {
      return <HistoryAction key={index} {...common}><CardChips cards={action.cards} /></HistoryAction>;
    }
    if (action.kind === 'showdown') {
      return <HistoryAction key={index} {...common}>
        <CardChips cards={action.cards} />
        {action.category && <HistoryTag>{t(`holdem.category.${action.category}`)}</HistoryTag>}
      </HistoryAction>;
    }
    if (action.kind === 'award') {
      return <HistoryAction key={index} {...common} state="won"
        marks={<HistoryTrophy title={t('holdem.wonAmount', { n: String(action.amount ?? 0) })} />}>
        <HistoryNote>{t('history.award')}</HistoryNote>{amount}
      </HistoryAction>;
    }
    return <HistoryAction key={index} {...common}
      state={action.kind === 'eliminated' ? 'lost' : action.kind === 'fold' ? 'muted' : undefined}>
      {action.kind === 'allIn' ? <HistoryTag tone="warning">{t('history.allIn')}</HistoryTag>
        : <HistoryNote>{t(`history.${action.kind}`)}</HistoryNote>}
      {amount}
    </HistoryAction>;
  };

  return <HistoryRounds rounds={rounds} summary={(round) => {
    const stakes = round.actions.find((action) => action.stakes)?.stakes;
    const winners = holdemRoundWinners(round);
    const names = joinNames(winners.map((winner) => name(winner.seat)), locale);
    return <>
      {stakes && <HistoryTag>{t('stud.stakes', { ante: String(stakes.ante), bet: String(stakes.minBet) })}</HistoryTag>}
      {winners.length > 0 ? <HistoryResult trophy title={winners.map((winner) =>
        `${name(winner.seat)} ${t('holdem.wonAmount', { n: String(winner.amount) })}`).join(' · ')}>
        {names}{winners.length === 1 && <> <ChipAmount amount={winners[0].amount} /></>}
      </HistoryResult> : !round.complete && <HistoryOngoing />}
    </>;
  }}>{(round) => <HistoryActions>{round.actions.map(row)}</HistoryActions>}</HistoryRounds>;
}
