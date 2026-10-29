// ─── DouDizhuHistory: each deal's auction, landlord, plays, and settlement ───

import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { useI18nStore } from '../../stores/i18n-store';
import {
  CardChips, HistoryAction, HistoryActions, HistoryDivider, HistoryNote, HistoryOngoing, HistoryResult, HistoryRounds,
  HistoryTag, SignedValue,
} from '../HistoryRounds';
import type { HistoryAction as Action, HistoryRound } from '../round-history';
import { useSeatName } from '../seat-names';
import { signed } from './doudizhu-view';

function myNet(round: HistoryRound, mySeat: GameSeat | null): number | null {
  const settle = round.actions.find((action) => action.kind === 'settle' && action.seat === mySeat);
  return settle?.net ?? null;
}

export function DouDizhuRounds({ rounds, mySeat }: {
  rounds: readonly HistoryRound[]; mySeat: GameSeat | null;
}): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();

  const bidText = (action: Action): string => {
    const bid = action.ddzBid;
    if (!bid) return '';
    if (bid.kind === 'score') return bid.value === 0 ? t('doudizhu.bidPass') : t('doudizhu.bidScore', { n: String(bid.value) });
    return t(bid.value === 1 ? 'doudizhu.claimCall' : 'doudizhu.claimPass');
  };

  const row = (action: Action, index: number): ReactNode => {
    if (action.kind === 'redeal') {
      return <HistoryAction key={index} name="" nameTitle="" mine={false}>
        <HistoryNote muted>{t('history.redeal')}</HistoryNote></HistoryAction>;
    }
    const who = action.seat ? name(action.seat) : '';
    const common = { name: who, nameTitle: who, mine: action.seat !== null && action.seat === mySeat };
    switch (action.kind) {
      case 'deal':
        return <HistoryAction key={index} {...common}><HistoryNote muted>{t('doudizhu.openingBid', { name: who })}</HistoryNote></HistoryAction>;
      case 'bid':
        return <HistoryAction key={index} {...common} state={action.ddzBid?.value === 0 ? 'muted' : undefined}>
          <HistoryNote>{bidText(action)}</HistoryNote></HistoryAction>;
      case 'call':
        return <HistoryAction key={index} {...common}
          marks={<HistoryTag tone="primary">{t('doudizhu.historyLandlord', { n: String(action.amount ?? 1) })}</HistoryTag>}>
          <CardChips cards={action.cards} /></HistoryAction>;
      case 'play':
        return <HistoryAction key={index} {...common}
          marks={action.ddzCombo === 'bomb' || action.ddzCombo === 'rocket'
            ? <HistoryTag tone="warning">{t(`doudizhu.combo.${action.ddzCombo}`)}</HistoryTag>
            : action.ddzCombo && <HistoryTag>{t(`doudizhu.combo.${action.ddzCombo}`)}</HistoryTag>}>
          <CardChips cards={action.cards} /></HistoryAction>;
      case 'pass':
        return <HistoryAction key={index} {...common} state="muted"><HistoryNote>{t('history.pass')}</HistoryNote></HistoryAction>;
      default:
        return <HistoryAction key={index} {...common}
          marks={action.net !== undefined && <SignedValue value={action.net} text={signed(action.net)} />}>
          {action.ddzDeal && <>
            <HistoryTag tone="primary">{t('doudizhu.landlord')}</HistoryTag>
            <HistoryTag tone={action.ddzDeal.landlordWins ? 'success' : 'danger'}>
              {t(action.ddzDeal.landlordWins ? 'doudizhu.landlordWins' : 'doudizhu.farmersWin')}</HistoryTag>
            <HistoryTag>{t('doudizhu.multiplier', { n: String(action.ddzDeal.multiplier) })}</HistoryTag>
            {action.ddzDeal.spring && <HistoryTag tone="warning">{t('doudizhu.spring')}</HistoryTag>}
            {action.ddzDeal.antiSpring && <HistoryTag tone="warning">{t('doudizhu.antiSpring')}</HistoryTag>}
          </>}
        </HistoryAction>;
    }
  };

  return <HistoryRounds rounds={rounds} summary={(round) => {
    const net = myNet(round, mySeat);
    return !round.complete ? <HistoryOngoing /> : net !== null
      && <HistoryResult tone={net > 0 ? 'success' : net < 0 ? 'danger' : 'neutral'}>{signed(net)}</HistoryResult>;
  }}>{(round) => {
    const firstPlay = round.actions.findIndex((action) => action.kind === 'play');
    const firstSettle = round.actions.findIndex((action) => action.kind === 'settle');
    return <HistoryActions>{round.actions.map((action, index) => index === firstPlay || index === firstSettle
      ? [<HistoryDivider key={`divider-${index}`}>{t(index === firstSettle ? 'history.settle' : 'doudizhu.historyPlay')}</HistoryDivider>,
        row(action, index)]
      : row(action, index))}</HistoryActions>;
  }}</HistoryRounds>;
}
