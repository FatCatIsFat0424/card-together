// ─── NinetyNineHistory: one numbered row per play, newest first, with the running total ───

import { Fragment } from 'react';
import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { useI18nStore } from '../../stores/i18n-store';
import { CardChip, HistoryAction, HistoryActions, HistoryNote, HistoryPanel, HistoryTag } from '../HistoryRounds';
import type { HistoryRound } from '../round-history';
import { useSeatName } from '../seat-names';

export function NinetyNineRounds({ rounds, mySeat }: {
  rounds: readonly HistoryRound[]; mySeat: GameSeat | null;
}): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();
  return <HistoryPanel><HistoryActions numbered>{[...rounds].reverse().map((round) => <Fragment key={round.number}>
    {round.actions.map((action, index) => {
      if (!action.seat) return null;
      const card = action.cards[0];
      const step = card && 'rank' in card && card.rank === 12 ? 20 : 10;
      return <HistoryAction key={index} index={index === 0 ? round.number : null} name={name(action.seat)}
        nameTitle={name(action.seat)} mine={action.seat === mySeat} state={action.kind === 'eliminated' ? 'lost' : undefined}
        marks={action.total !== undefined
          && <HistoryTag tone={action.total === 99 ? 'warning' : 'neutral'}>{action.previousTotal} → {action.total}</HistoryTag>}>
        {action.kind === 'eliminated' ? <HistoryNote>{t('history.eliminated')}</HistoryNote> : <>
          {card && <CardChip card={card} />}
          {action.choice && <HistoryNote>{t(action.choice === 'plus' ? 'ninetynine.plus' : 'ninetynine.minus', { n: String(step) })}</HistoryNote>}
          {action.target && <HistoryNote>{t('history.target', { name: name(action.target) })}</HistoryNote>}
        </>}
      </HistoryAction>;
    })}
  </Fragment>)}</HistoryActions></HistoryPanel>;
}
