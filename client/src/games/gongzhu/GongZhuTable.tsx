import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Card, Seat } from '@shared/types';
import type { GongZhuVisibleState } from '@shared/games/gongzhu/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { gongZhuScore, gongZhuScoringCard } from '@shared/rules/gongzhu';
import { socket } from '../../socket';
import { CardHand } from '../../components/CardHand';
import { TrickArea } from '../../components/TrickArea';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { CardChips } from '../HistoryRounds';
import { GameShell } from '../GameShell';
import { ResultDialog, resultStyles } from '../ResultDialog';
import { useResultRoundHistory } from '../RoundHistory';
import { infoStyles, TurnBox } from '../TableInfo';
import { joinNames, useSeatName } from '../seat-names';
import { useViewedGame } from '../use-table-perspective';
import { useGamePresentation } from '../use-game-presentation';
import { useConnectionReady } from '../use-connection-ready';
import { isOwnTurn } from '../observer-view';
import styles from './GongZhuTable.module.css';

function Info({ game }: { game: GongZhuVisibleState }): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();
  return <aside className={infoStyles.rail}>
    <TurnBox text={game.phase === 'scoring' ? t('game.scoring') : isOwnTurn(game) ? t('gongzhu.yourTurn')
      : t('gongzhu.turnOf', { name: name(game.currentTurnSeat) })}>
      <p className={infoStyles.note}>{t('gongzhu.hand', { n: String(game.hand) })} · {t('gongzhu.tricks', { n: String(game.tricks.length) })}</p>
    </TurnBox>
    <section className={infoStyles.box}>
      <h2 className={infoStyles.caption}>{t('gongzhu.captures')}</h2>
      <ol className={infoStyles.list}>{SEAT_ORDER_CLOCKWISE.map((seat) => <li key={seat} className={styles.captureRow}>
        <div className={infoStyles.row}><strong className={infoStyles.name}>{name(seat)}</strong>
          <span>{t('gongzhu.total')} {game.scores[seat]}</span></div>
        <span className={infoStyles.note}>{t('gongzhu.currentScore', { n: String(gongZhuScore(game.captures[seat])) })}</span>
        {game.captures[seat].some(gongZhuScoringCard) ? <CardChips cards={game.captures[seat].filter(gongZhuScoringCard)} />
          : <span className={infoStyles.note}>{t('gongzhu.noCaptures')}</span>}
      </li>)}</ol>
    </section>
    {game.handResults.length > 0 && <section className={infoStyles.box}>
      <h2 className={infoStyles.caption}>{t('gongzhu.total')}</h2>
      <ScoreTable game={game} />
    </section>}
    <section className={infoStyles.box}><p className={infoStyles.note}>{t('gongzhu.rulesScore')}</p>
      <p className={infoStyles.note}>{t('gongzhu.rulesSpecial')}</p></section>
  </aside>;
}
function ScoreTable({ game }: { game: GongZhuVisibleState }): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();
  const ranked = [...SEAT_ORDER_CLOCKWISE].sort((a, b) => game.scores[b] - game.scores[a]);
  return <div className={styles.scoreScroll}><table className={resultStyles.table}>
    <thead><tr><th>{t('gongzhu.player')}</th>
      {game.handResults.map((hand) => <th key={hand.hand}>{t('gongzhu.handShort', { n: String(hand.hand) })}</th>)}
      <th>{t('gongzhu.total')}</th></tr></thead>
    <tbody>{ranked.map((seat) => <tr key={seat} className={game.result?.winners.includes(seat) ? resultStyles.winnerRow : undefined}>
      <td>{name(seat)}</td>{game.handResults.map((hand) => <td key={hand.hand}>{hand.scores[seat]}</td>)}
      <td><strong>{game.scores[seat]}</strong></td></tr>)}</tbody>
  </table></div>;
}
export function GongZhuTable(): ReactNode {
  const game = useViewedGame(useGameStore((state) => state.gongzhu));
  const { t, locale } = useI18nStore();
  const name = useSeatName();
  const { locked } = useGamePresentation();
  const connectionReady = useConnectionReady();
  const history = useResultRoundHistory(useGameStore((state) => state.visible));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  if (!game) return null;
  const canPlay = game.phase === 'playing' && isOwnTurn(game) && !locked && !pending && connectionReady;
  const callback = (timeout: Error | null, response?: { success: boolean; error?: string }): void => {
    setPending(false);
    if (timeout) setError(t('auth.connectionError'));
    else if (!response?.success) setError(response?.error ?? t('common.error'));
  };
  const play = (card: Card): void => {
    if (!canPlay) return;
    setError(''); setPending(true);
    socket.timeout(10000).emit('game:action', { gameType: 'gongzhu', action: { type: 'play', card } }, callback);
  };
  const back = (): void => {
    setError(''); setPending(true);
    socket.timeout(10000).emit('game:continue', callback);
  };
  const cards = Object.fromEntries(game.trick.map((play) => [play.seat, play.card])) as Partial<Record<Seat, Card>>;
  return <GameShell info={<Info game={game} />}
    centre={<TrickArea currentTrick={cards} leadSeat={game.trick[0]?.seat ?? game.currentTurnSeat}
      bottomSeat={game.mySeat} myTurn={canPlay} />}
    hand={<CardHand cards={game.myHand} playableCards={game.validCards} disabled={!canPlay} onCardClick={play} />}
    prompt={game.phase === 'playing' ? canPlay ? game.tricks.length === 0 && game.trick.length === 0
      ? t('gongzhu.opening') : t('gongzhu.yourTurn') : t('gongzhu.turnOf', { name: name(game.currentTurnSeat) }) : null}
    overlay={game.phase === 'scoring' && game.result && <ResultDialog
      title={t('gongzhu.winners', { names: joinNames(game.result.winners.map(name), locale) })}
      history={history} pending={pending} error={error} disabled={!connectionReady} onBack={back}>
      <ScoreTable game={game} />
    </ResultDialog>}
    error={game.phase !== 'scoring' ? error : undefined} />;
}
