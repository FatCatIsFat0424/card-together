import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Card, Seat } from '@shared/types';
import type { HeartsAction, HeartsVisibleState } from '@shared/games/hearts/types';
import { HEARTS_SEATS, heartsPenalty } from '@shared/rules/hearts';
import { cardKey, hasCard } from '@shared/rules/cards';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { DeadlineClock } from '../../components/TurnClock';
import { CardHand } from '../../components/CardHand';
import { useCardFaceUrl } from '../../cosmetics/card-faces/use-card-face';
import { GameShell } from '../GameShell';
import { ResultDialog, resultStyles } from '../ResultDialog';
import { infoStyles, TurnBox } from '../TableInfo';
import { useSeatName, joinNames } from '../seat-names';
import { useViewedGame } from '../use-table-perspective';
import { useConnectionReady } from '../use-connection-ready';
import { useGamePresentation } from '../use-game-presentation';
import styles from './HeartsTable.module.css';
const cardText = (card: Card): string => `${RANK_DISPLAY[card.rank]}${SUIT_SYMBOLS[card.suit]}`;

function Scores({ game }: { game: HeartsVisibleState }): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();
  const rows = game.log.filter((entry) => entry.type === 'hand_end');
  return <table className={resultStyles.table}>
    <thead><tr><th>{t('hearts.hand')}</th>{HEARTS_SEATS.map((seat) => <th key={seat}>{name(seat)}</th>)}</tr></thead>
    <tbody>{rows.map((entry) => <tr key={entry.hand}><td>{entry.hand}</td>
      {HEARTS_SEATS.map((seat) => <td key={seat}>+{entry.score.added[seat]}{entry.score.moon === seat ? ' ☾' : ''}</td>)}
    </tr>)}<tr><th>{t('hearts.total')}</th>{HEARTS_SEATS.map((seat) => <td key={seat}><strong>{game.scores[seat]}</strong></td>)}</tr></tbody>
  </table>;
}
function Info({ game, prompt }: { game: HeartsVisibleState; prompt: string }): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();
  const penalty = (seat: Seat): number => game.tricks.filter((trick) => trick.winner === seat)
    .reduce((sum, trick) => sum + trick.plays.reduce((points, play) => points + heartsPenalty(play.card), 0), 0);
  return <aside className={infoStyles.rail}>
    <TurnBox text={prompt}><p className={infoStyles.note}>{t('hearts.handNumber', { n: String(game.hand) })}</p></TurnBox>
    <section className={infoStyles.box}><h2 className={infoStyles.caption}>{t('hearts.score')}</h2>
      <table className={styles.scores}><thead><tr><th>{t('hearts.player')}</th><th>{t('hearts.hand')}</th><th>{t('hearts.total')}</th></tr></thead>
        <tbody>{HEARTS_SEATS.map((seat) => <tr key={seat}><th>{name(seat)}</th><td>{penalty(seat)}</td><td>{game.scores[seat]}</td></tr>)}</tbody>
      </table>
      <p className={infoStyles.note}>{t(game.heartsBroken ? 'hearts.broken' : 'hearts.unbroken')}</p>
    </section>
    <section className={`${infoStyles.box} ${infoStyles.grow}`}><h2 className={infoStyles.caption}>{t('hearts.history')}</h2>
      <details><summary>{t('hearts.handScores')}</summary><Scores game={game} /></details>
      <ol className={styles.history}>{game.log.flatMap((entry, index) => entry.type === 'trick_end'
        ? [<li key={index}>{entry.trick.plays.map((play) => `${name(play.seat)} ${cardText(play.card)}`).join(' · ')}
          <strong>{t('hearts.trickWinner', { name: name(entry.trick.winner) })}</strong></li>] : [])}</ol>
    </section>
  </aside>;
}
export function HeartsTable(): ReactNode {
  const game = useViewedGame(useGameStore((state) => state.hearts));
  const { t, locale } = useI18nStore();
  const name = useSeatName();
  const cardFace = useCardFaceUrl();
  const connectionReady = useConnectionReady();
  const { locked } = useGamePresentation();
  const [selection, setSelection] = useState<{ hand: number; cards: Card[] }>({ hand: 0, cards: [] });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  if (!game) return null;
  const observer = game.observer === 'spectator';
  const passing = game.phase === 'passing';
  const owes = passing && !game.passedSeats.includes(game.mySeat) && !observer;
  const ownTurn = game.currentTurnSeat === game.mySeat && !observer && game.phase === 'playing';
  const canAct = !locked && !pending && connectionReady;
  const selected = selection.hand === game.hand ? selection.cards : [];
  const prompt = passing ? t(owes ? 'hearts.choosePass' : 'hearts.waitPass', { direction: t(`hearts.pass.${game.passDirection}`),
    n: String(selected.length) }) : game.currentTurnSeat ? t(ownTurn ? 'hearts.yourTurn' : 'hearts.turnOf', { name: name(game.currentTurnSeat) }) : t('hearts.handEnd');
  const callback = (timeout: Error | null, response?: { success: boolean; error?: string }): void => {
    setPending(false);
    if (timeout) setError(t('auth.connectionError'));
    else if (!response?.success) setError(response?.error ?? t('common.error'));
  };
  const send = (action: HeartsAction): void => {
    if (!canAct) return;
    setError(''); setPending(true);
    socket.timeout(10000).emit('game:action', { gameType: 'hearts', action }, callback);
  };
  const pick = (card: Card): void => {
    if (owes) setSelection({ hand: game.hand, cards: hasCard(selected, card)
      ? selected.filter((other) => cardKey(other) !== cardKey(card)) : selected.length < 3 ? [...selected, card] : selected });
    else send({ type: 'play', card });
  };
  const centre = passing ? <div className={styles.passStatus}>
    <h2>{t('hearts.passTitle', { direction: t(`hearts.pass.${game.passDirection}`) })}</h2>
    <p>{t('hearts.secret')}</p>
    <p>{t('hearts.ready', { n: String(game.passedSeats.length) })}</p>
    {game.passDeadline !== null && <DeadlineClock deadline={game.passDeadline} />}
  </div> : <div className={styles.trick} aria-label={t('hearts.trick')}>
    {game.trick?.plays.map((play) => <figure key={play.seat} className={styles.play}>
      <img src={cardFace(play.card)} alt={cardText(play.card)} draggable={false} />
      <figcaption>{name(play.seat)}</figcaption>
    </figure>)}
    {game.phase === 'playing' && game.trick?.plays.length === 0 && <p>{t('hearts.lead', { name: name(game.trick.leadSeat) })}</p>}
  </div>;
  const result = game.result;
  return <GameShell turnReady={(owes || ownTurn) && !locked} info={<Info game={game} prompt={prompt} />} centre={centre}
    prompt={prompt} error={game.phase !== 'scoring' ? error : undefined}
    panel={owes && <div className={styles.controls}><button type="button" className="btn btn-primary"
      disabled={!canAct || selected.length !== 3} onClick={() => send({ type: 'pass', cards: selected })}>
      {t('hearts.confirmPass', { n: String(selected.length) })}</button></div>}
    hand={<CardHand cards={game.myHand} selectedCards={passing ? game.myPass.length ? game.myPass : selected : undefined}
      playableCards={ownTurn ? game.validCards : undefined} onCardClick={pick}
      disabled={!canAct || !(owes || ownTurn)} />}
    overlay={result && <ResultDialog title={t('hearts.winners', { names: joinNames(result.winners.map(name), locale) })}
      history={{ label: t('hearts.handScores'), content: <Scores game={game} /> }}
      pending={pending} error={error} disabled={!connectionReady} onBack={() => {
        setError(''); setPending(true); socket.timeout(10000).emit('game:continue', callback);
      }}><Scores game={game} /></ResultDialog>} />;
}
