// ─── DominoesHistory: each round's lead, tiles, draws and passes, and the pips left in hand ───

import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { useI18nStore } from '../../stores/i18n-store';
import {
  HistoryAction, HistoryActions, HistoryNote, HistoryOngoing, HistoryResult, HistoryRounds, TextChip,
} from '../HistoryRounds';
import type { HistoryRound } from '../round-history';
import { useSeatName } from '../seat-names';

export function DominoesRounds({ rounds, mySeat }: {
  rounds: readonly HistoryRound[]; mySeat: GameSeat | null;
}): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();
  return <HistoryRounds rounds={rounds} summary={(round) => {
    const winner = round.actions.find((action) => action.kind === 'settle' && action.total !== undefined);
    return winner?.seat
      ? <HistoryResult trophy>{name(winner.seat)} {t('dominoes.roundGain', { n: String(winner.total ?? 0) })}</HistoryResult>
      : round.complete ? <HistoryNote muted>{t('dominoes.roundTie')}</HistoryNote> : !round.complete && <HistoryOngoing />;
  }}>{(round) => <HistoryActions>{round.actions.map((action, index) => {
    if (!action.seat) return null;
    const common = { name: name(action.seat), nameTitle: name(action.seat), mine: action.seat === mySeat };
    switch (action.kind) {
      case 'deal':
        return <HistoryAction key={index} {...common}><HistoryNote muted>{t('dominoes.historyLead')}</HistoryNote></HistoryAction>;
      case 'play':
        return <HistoryAction key={index} {...common}>
          {action.tile && <TextChip>{action.tile[0]}|{action.tile[1]}</TextChip>}
        </HistoryAction>;
      case 'hit':
        return <HistoryAction key={index} {...common} state="muted"><HistoryNote>{t('dominoes.logDrew')}</HistoryNote></HistoryAction>;
      case 'pass':
        return <HistoryAction key={index} {...common} state="muted"><HistoryNote>{t('dominoes.logPassed')}</HistoryNote></HistoryAction>;
      default:
        return <HistoryAction key={index} {...common} state={action.total !== undefined ? 'won' : undefined}>
          <HistoryNote>{t('dominoes.historyRoundEnd', { n: String(action.points ?? 0) })}</HistoryNote>
        </HistoryAction>;
    }
  })}</HistoryActions>}</HistoryRounds>;
}
