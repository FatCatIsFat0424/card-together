import type { ReactNode } from 'react';
import { frameLogIndex } from '@shared/game-presentation';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import type { FrameProps, RoundsViewProps } from '../game-ui';
import { CardChips, HistoryAction, HistoryActions, HistoryNote, HistoryOngoing, HistoryResult, HistoryRounds } from '../HistoryRounds';
import { useSeatName } from '../seat-names';
import styles from './GongZhuTable.module.css';

export function GongZhuFrame({ frame, name }: FrameProps): ReactNode {
  const game = useGameStore((state) => state.gongzhu);
  const { t } = useI18nStore();
  const index = frameLogIndex(frame);
  const entry = game && index !== null ? game.log[index] : null;
  if (entry?.type !== 'settle') return null;
  return <div className={styles.settle}>
    <strong>{t('gongzhu.hand', { n: String(entry.hand) })}</strong>
    {SEAT_ORDER_CLOCKWISE.map((seat) => <span key={seat}>{name(seat)} {entry.scores[seat]}</span>)}
  </div>;
}

export function GongZhuRounds({ rounds, mySeat }: RoundsViewProps): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();
  return <HistoryRounds rounds={rounds} summary={(round) => {
    const scored = round.actions.filter((action) => action.kind === 'settle');
    return scored.length ? <HistoryResult>{scored.map((action) => `${action.seat ? name(action.seat) : ''} ${action.points ?? 0}`).join(' · ')}</HistoryResult>
      : <HistoryOngoing />;
  }}>{(round) => <HistoryActions>{round.actions.map((action, index) => <HistoryAction key={index}
    name={action.seat ? name(action.seat) : ''} mine={action.seat === mySeat}>
    {action.kind === 'settle' ? <HistoryNote>{t('gongzhu.handScore', { n: String(action.points ?? 0) })}</HistoryNote>
      : action.kind === 'deal' ? <HistoryNote>{t('gongzhu.opening')}</HistoryNote>
        : <><HistoryNote>{t(action.kind === 'award' ? 'presentation.trick' : 'history.play')}</HistoryNote>
          <CardChips cards={action.cards} /></>}
  </HistoryAction>)}</HistoryActions>}</HistoryRounds>;
}
