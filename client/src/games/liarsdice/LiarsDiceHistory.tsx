// ─── LiarsDiceHistory: each round's bids, the challenge, and the die it cost ───

import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { useI18nStore } from '../../stores/i18n-store';
import { HistoryAction, HistoryActions, HistoryNote, HistoryOngoing, HistoryResult, HistoryRounds, HistoryTag } from '../HistoryRounds';
import type { HistoryRound } from '../round-history';
import { useSeatName } from '../seat-names';

export function LiarsDiceRounds({ rounds, mySeat }: {
  rounds: readonly HistoryRound[]; mySeat: GameSeat | null;
}): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();
  return <HistoryRounds rounds={rounds} summary={(round) => {
    const call = round.actions.find((action) => action.kind === 'challenge');
    const outcome = call?.loser
      ? t(call.eliminated ? 'liarsdice.historyOut' : 'liarsdice.historyLost', { name: name(call.loser) }) : '';
    return <>
      {round.diceInPlay !== undefined && <HistoryTag>{t('liarsdice.inPlay', { n: String(round.diceInPlay) })}</HistoryTag>}
      {outcome ? <HistoryResult tone={call?.eliminated ? 'danger' : 'neutral'} title={outcome}>{outcome}</HistoryResult>
        : !round.complete && <HistoryOngoing />}
    </>;
  }}>{(round) => <HistoryActions>{round.actions.map((action, index) => {
    if (!action.seat || !action.bid) return null;
    const row = { name: name(action.seat), nameTitle: name(action.seat), mine: action.seat === mySeat };
    const bid = t('liarsdice.logBid', { n: String(action.bid.quantity), face: String(action.bid.face) });
    if (action.kind === 'challenge') {
      return <HistoryAction key={index} {...row} marks={<HistoryTag tone={action.bidTrue ? 'success' : 'danger'}>
        {t('liarsdice.logFound', { count: String(action.found ?? 0), n: String(action.bid.quantity) })}</HistoryTag>}>
        <HistoryNote>{t('liarsdice.historyCall', { name: action.target ? name(action.target) : '',
          bid: `${action.bid.quantity} × ${action.bid.face}` })}</HistoryNote>
      </HistoryAction>;
    }
    return <HistoryAction key={index} {...row}><HistoryNote>{bid}</HistoryNote></HistoryAction>;
  })}</HistoryActions>}</HistoryRounds>;
}
