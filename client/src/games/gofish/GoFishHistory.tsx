// ─── GoFishHistory: each hand's asks, books, and final book counts ───

import type { ReactNode } from 'react';
import { RANK_DISPLAY } from '@shared/constants';
import type { GameSeat } from '@shared/types';
import { useI18nStore } from '../../stores/i18n-store';
import {
  HistoryAction, HistoryActions, HistoryNote, HistoryOngoing, HistoryResult, HistoryRounds, HistoryTag,
} from '../HistoryRounds';
import type { HistoryAction as Action, HistoryRound } from '../round-history';
import { useSeatName } from '../seat-names';
import { askOutcome } from './gofish-view';

export function GoFishRounds({ rounds, mySeat }: {
  rounds: readonly HistoryRound[]; mySeat: GameSeat | null;
}): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();

  const outcome = (action: Action): string => askOutcome(t, {
    given: action.count ?? 0, fished: action.fished ?? null, rank: action.rank ?? 2,
  });

  return <HistoryRounds rounds={rounds} summary={(round) => {
    const books = round.actions.filter((action) => action.kind === 'settle');
    const best = Math.max(...books.map((action) => action.points ?? 0));
    const leaders = books.filter((action) => action.points === best && action.seat);
    return leaders.length === 1 && leaders[0].seat ? <HistoryResult trophy>{name(leaders[0].seat)}</HistoryResult>
      : !round.complete && <HistoryOngoing />;
  }}>{(round) => <HistoryActions>{round.actions.map((action, index) => {
    if (!action.seat) return null;
    const common = { name: name(action.seat), nameTitle: name(action.seat), mine: action.seat === mySeat };
    switch (action.kind) {
      case 'deal':
        return <HistoryAction key={index} {...common}>
          <HistoryNote muted>{t('gofish.historyStarter')}</HistoryNote>
        </HistoryAction>;
      case 'ask':
        return <HistoryAction key={index} {...common}>
          <HistoryNote>{action.target ? `→ ${name(action.target)}` : ''}</HistoryNote>
          {action.rank && <HistoryTag>{RANK_DISPLAY[action.rank]}</HistoryTag>}
          <HistoryNote muted={!action.count}>{outcome(action)}</HistoryNote>
        </HistoryAction>;
      case 'book':
        return <HistoryAction key={index} {...common} state="won">
          <HistoryNote>{t('gofish.logBook', { rank: action.rank ? RANK_DISPLAY[action.rank] : '' })}</HistoryNote>
        </HistoryAction>;
      case 'hit':
        return <HistoryAction key={index} {...common} state="muted"><HistoryNote>{t('gofish.logRefill')}</HistoryNote></HistoryAction>;
      default:
        return <HistoryAction key={index} {...common}>
          <HistoryNote>{t('gofish.historyBooks', { n: String(action.points ?? 0) })}</HistoryNote>
        </HistoryAction>;
    }
  })}</HistoryActions>}</HistoryRounds>;
}
