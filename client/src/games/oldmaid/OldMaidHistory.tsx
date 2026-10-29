// ─── OldMaidHistory: each deal's opening discards, draws, and who was left with the joker ───

import type { ReactNode } from 'react';
import { GAME_SEAT_ORDER } from '@shared/constants';
import type { GameSeat } from '@shared/types';
import { useI18nStore } from '../../stores/i18n-store';
import {
  CardChips, HistoryAction, HistoryActions, HistoryDivider, HistoryNote, HistoryOngoing, HistoryResult, HistoryRounds,
  HistoryTag,
} from '../HistoryRounds';
import type { HistoryRound } from '../round-history';
import { useSeatName } from '../seat-names';

export function OldMaidRounds({ rounds, mySeat }: {
  rounds: readonly HistoryRound[]; mySeat: GameSeat | null;
}): ReactNode {
  const { t, locale } = useI18nStore();
  const name = useSeatName();
  const separator = locale === 'zh-TW' ? '、' : ', ';

  return <HistoryRounds rounds={rounds} summary={(round) => {
    const settle = round.actions.find((action) => action.kind === 'settle');
    const loser = settle?.seat;
    return <>
      <HistoryTag>{t('oldmaid.historyDeal', { n: String(round.number) })}</HistoryTag>
      {loser ? <HistoryResult tone={loser === mySeat ? 'danger' : 'neutral'} title={t('oldmaid.historyLoser', { name: name(loser) })}>
        {t('oldmaid.historyLoser', { name: name(loser) })}</HistoryResult> : !round.complete && <HistoryOngoing />}
    </>;
  }}>{(round) => {
    const firstDraw = round.actions.findIndex((action) => action.kind === 'draw');
    return <HistoryActions>{round.actions.map((action, index) => {
      if (!action.seat) return null;
      const who = name(action.seat);
      const common = { name: who, nameTitle: who, mine: action.seat === mySeat };
      const row = action.kind === 'settle'
        ? <HistoryAction key={index} {...common} marks={<HistoryTag tone="danger">{t('oldmaid.joker')}</HistoryTag>}>
          <HistoryNote>{t('oldmaid.historyOrder', { names: (action.order ?? []).map(name).join(separator) })}</HistoryNote>
        </HistoryAction>
        : action.kind === 'deal'
          ? (action.cards.length > 0 || GAME_SEAT_ORDER.includes(action.seat)) && <HistoryAction key={index} {...common}>
            {action.cards.length > 0 ? <CardChips cards={action.cards} />
              : <HistoryNote muted>{t('oldmaid.nothingDiscarded')}</HistoryNote>}
          </HistoryAction>
          : <HistoryAction key={index} {...common}>
            <HistoryNote>{t('oldmaid.logDraw', { n: String((action.index ?? 0) + 1), name: action.target ? name(action.target) : '' })}</HistoryNote>
            {action.cards.length > 0 && <CardChips cards={action.cards} />}
          </HistoryAction>;
      return index === firstDraw ? [<HistoryDivider key={`divider-${index}`}>{t('history.draw')}</HistoryDivider>, row] : row;
    })}</HistoryActions>;
  }}</HistoryRounds>;
}
