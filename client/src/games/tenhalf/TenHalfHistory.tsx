// ─── TenHalfHistory: each hand's deal, draws, showdown, and settlement ───

import type { ReactNode } from 'react';
import { thPoints } from '@shared/rules/tenhalf';
import type { GameSeat } from '@shared/types';
import { useI18nStore } from '../../stores/i18n-store';
import {
  CardChips, ChipAmount, HistoryAction, HistoryActions, HistoryDivider, HistoryNote, HistoryOngoing,
  HistoryResult, HistoryRounds, HistoryTag, SignedValue,
} from '../HistoryRounds';
import type { HistoryAction as Action, HistoryRound } from '../round-history';
import { useSeatName } from '../seat-names';
import { signedChips } from '../blackjack/blackjack-view';

const OUTCOME_TONE = { win: 'success', lose: 'danger', bust: 'danger', blackjack: 'success', push: 'neutral' } as const;

function myNet(round: HistoryRound, mySeat: GameSeat | null): number | null {
  const settle = round.actions.find((action) => action.kind === 'settle' && action.seat === mySeat);
  return settle?.net ?? null;
}

export function TenHalfRounds({ rounds, mySeat }: {
  rounds: readonly HistoryRound[]; mySeat: GameSeat | null;
}): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();

  const row = (action: Action, index: number): ReactNode => {
    const who = action.seat ? name(action.seat) : '';
    const common = { name: who, nameTitle: who, mine: action.seat !== null && action.seat === mySeat };
    if (action.kind === 'deal') {
      return <HistoryAction key={index} {...common}>
        {action.dealer ? <HistoryTag tone="primary">{t('tenhalf.bankerTag')}</HistoryTag>
          : action.bet !== undefined && <HistoryNote muted>
            {t('tenhalf.bet', { n: String(action.bet) })}{action.auto && ` (${t('tenhalf.auto')})`}</HistoryNote>}
      </HistoryAction>;
    }
    if (action.kind === 'showdown') {
      const n = String(thPoints(action.handTotal ?? 0));
      const special = action.handKind && action.handKind !== 'points' && action.handKind !== 'bust';
      return <HistoryAction key={index} {...common}
        marks={action.handKind === 'bust' ? <HistoryTag tone="danger">{t('tenhalf.bustTotal', { n })}</HistoryTag>
          : special ? <HistoryTag tone="success">{t(`tenhalf.kind.${action.handKind as 'tenhalf'}`)}</HistoryTag>
            : <HistoryTag>{t('tenhalf.total', { n })}</HistoryTag>}>
        <HistoryNote>{t('history.showdown')}</HistoryNote>
        <CardChips cards={action.cards} />
      </HistoryAction>;
    }
    if (action.kind === 'settle') {
      return <HistoryAction key={index} {...common}
        marks={action.net !== undefined && <SignedValue value={action.net} text={signedChips(action.net)} />}>
        {action.dealer && <HistoryTag tone="primary">{t('tenhalf.bankerTag')}</HistoryTag>}
        {action.outcomes?.map((outcome, outcomeIndex) => <HistoryTag key={outcomeIndex} tone={OUTCOME_TONE[outcome]}>
          {t(`tenhalf.outcome.${outcome as 'win'}`)}</HistoryTag>)}
      </HistoryAction>;
    }
    return <HistoryAction key={index} {...common} state={action.kind === 'stand' ? 'muted' : undefined}>
      <HistoryNote>{t(`history.${action.kind as 'hit'}`)}</HistoryNote>
      {action.cards.length > 0 && <CardChips cards={action.cards} />}
    </HistoryAction>;
  };

  return <HistoryRounds rounds={rounds} summary={(round) => {
    const net = myNet(round, mySeat);
    return !round.complete ? <HistoryOngoing /> : net !== null
      && <HistoryResult tone={net > 0 ? 'success' : net < 0 ? 'danger' : 'neutral'}>
        <ChipAmount amount={signedChips(net)} /></HistoryResult>;
  }}>{(round) => {
    const firstShowdown = round.actions.findIndex((action) => action.kind === 'showdown');
    const firstSettle = round.actions.findIndex((action) => action.kind === 'settle');
    return <HistoryActions>{round.actions.map((action, index) => index === firstShowdown || index === firstSettle
      ? [<HistoryDivider key={`divider-${index}`}>{t(index === firstSettle ? 'history.settle' : 'history.showdown')}</HistoryDivider>,
        row(action, index)]
      : row(action, index))}</HistoryActions>;
  }}</HistoryRounds>;
}
