// ─── BlackjackHistory: each hand's deal, draws, dealer play, and settlement ───

import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { useI18nStore } from '../../stores/i18n-store';
import {
  CardBacks, CardChips, ChipAmount, HistoryAction, HistoryActions, HistoryDivider, HistoryNote, HistoryOngoing,
  HistoryResult, HistoryRounds, HistoryTag, SignedValue,
} from '../HistoryRounds';
import type { HistoryAction as Action, HistoryRound } from '../round-history';
import { useSeatName } from '../seat-names';
import { signedChips, summarizeBlackjackRound } from './blackjack-view';

const OUTCOME_TONE = { blackjack: 'success', win: 'success', push: 'neutral', lose: 'danger', bust: 'danger' } as const;

export function BlackjackRounds({ rounds, mySeat }: {
  rounds: readonly HistoryRound[]; mySeat: GameSeat | null;
}): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();

  const total = (action: Action): ReactNode => {
    if (action.handTotal === undefined) return null;
    const n = String(action.handTotal);
    if (action.handTotal > 21) return <HistoryTag tone="danger">{t('blackjack.bustTotal', { n })}</HistoryTag>;
    if (action.kind === 'deal' && action.seat && action.handTotal === 21 && action.cards.length === 2) {
      return <HistoryTag tone="success">{t('blackjack.natural')}</HistoryTag>;
    }
    return <HistoryTag>{t('blackjack.totalShort', { n })}</HistoryTag>;
  };

  const row = (action: Action, index: number): ReactNode => {
    const who = action.seat ? name(action.seat) : t('blackjack.dealer');
    const common = { name: who, nameTitle: who, mine: action.seat !== null && action.seat === mySeat };
    if (action.kind === 'deal') {
      return <HistoryAction key={index} {...common} marks={total(action)}>
        <CardChips cards={action.cards} />
        {action.seat ? action.bet !== undefined && <HistoryNote muted>
          {t('blackjack.bet', { n: String(action.bet) })}{action.auto && ` (${t('blackjack.auto')})`}</HistoryNote>
          : <CardBacks count={1} label={t('blackjack.holeCard')} />}
      </HistoryAction>;
    }
    if (action.kind === 'settle') {
      return <HistoryAction key={index} {...common}
        marks={action.net !== undefined && <SignedValue value={action.net} text={signedChips(action.net)} />}>
        {action.dealer && <HistoryTag tone="primary">{t('blackjack.dealerTag')}</HistoryTag>}
        {action.outcomes?.map((outcome, outcomeIndex) => <HistoryTag key={outcomeIndex} tone={OUTCOME_TONE[outcome]}>
          {t(`blackjack.outcome.${outcome}`)}</HistoryTag>)}
      </HistoryAction>;
    }
    return <HistoryAction key={index} {...common} marks={total(action)}
      state={action.kind === 'stand' || action.kind === 'dealerStand' ? 'muted' : undefined}>
      {action.handIndex !== undefined && <HistoryTag>{t('blackjack.handIndex', { n: String(action.handIndex + 1) })}</HistoryTag>}
      <HistoryNote>{t(`history.${action.kind}`)}</HistoryNote>
      {action.cards.length > 0 && <CardChips cards={action.cards} />}
    </HistoryAction>;
  };

  return <HistoryRounds rounds={rounds} summary={(round) => {
    const { dealerTotal, myNet } = summarizeBlackjackRound(round, mySeat);
    return <>
      {dealerTotal !== null && <HistoryTag tone={dealerTotal > 21 ? 'danger' : 'neutral'}>
        {t(dealerTotal > 21 ? 'blackjack.historyDealerBust' : 'blackjack.historyDealer', { n: String(dealerTotal) })}
      </HistoryTag>}
      {!round.complete ? <HistoryOngoing /> : myNet !== null
        && <HistoryResult tone={myNet > 0 ? 'success' : myNet < 0 ? 'danger' : 'neutral'}>
          <ChipAmount amount={signedChips(myNet)} /></HistoryResult>}
    </>;
  }}>{(round) => {
    const firstSettle = round.actions.findIndex((action) => action.kind === 'settle');
    return <HistoryActions>{round.actions.map((action, index) => index === firstSettle
      ? [<HistoryDivider key="settle">{t('history.settle')}</HistoryDivider>, row(action, index)]
      : row(action, index))}</HistoryActions>;
  }}</HistoryRounds>;
}
