import type { ReactNode } from 'react';
import { frameLogIndex } from '@shared/game-presentation';
import type { GameSeat } from '@shared/types';
import type { PresentationFrame } from '@shared/game-presentation';
import { dmHandPips, dmSortHand } from '@shared/rules/dominoes';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { DominoTile } from './DominoTile';
import styles from './DominoesFrame.module.css';

/** Body of a Dominoes presentation frame: the deal, or the round summary with every hand left over. */
export function DominoesFrame({ frame, name }: { frame: PresentationFrame; name: (seat: GameSeat) => string }): ReactNode {
  const { t } = useI18nStore();
  const game = useGameStore((state) => state.dominoes);
  const index = frameLogIndex(frame);
  const entry = game && index !== null ? game.log[index] : undefined;

  if (entry?.type === 'round') {
    return <div className={styles.body}>
      <strong>{t('dominoes.roundOf', { n: String(entry.round) })}</strong>
    </div>;
  }
  if (entry?.type !== 'roundEnd' || !game) return null;

  const result = entry.reason === 'domino' ? t('dominoes.roundWon', { name: entry.winner ? name(entry.winner) : '', points: String(entry.points) })
    : entry.reason === 'blocked' ? t('dominoes.roundBlocked', { name: entry.winner ? name(entry.winner) : '', points: String(entry.points) })
      : t('dominoes.roundTie');
  return <div className={styles.body}>
    <strong>{t('dominoes.roundOver', { n: String(entry.round) })}</strong>
    <span>{result}</span>
    <table className={styles.table}>
      <caption className={styles.caption}>{t('dominoes.remaining')}</caption>
      <tbody>{game.seats.map((seat) => {
        const hand = dmSortHand(entry.hands[seat]);
        return <tr key={seat} className={seat === entry.winner ? styles.winner : undefined}>
          <th scope="row" className={styles.name}>{name(seat)}</th>
          <td className={styles.tiles}>{hand.length === 0 ? <span className={styles.out}>{t('dominoes.noTiles')}</span>
            : hand.map((tile) => <DominoTile key={`${tile[0]}-${tile[1]}`} left={tile[0]} right={tile[1]} />)}</td>
          <td className={styles.pips}>{t('dominoes.pips', { n: String(dmHandPips(hand)) })}</td>
          <td className={styles.total}>{seat === entry.winner && entry.points > 0
            ? <strong>{t('dominoes.roundGain', { n: String(entry.points) })}</strong> : null} {entry.scores[seat]}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
