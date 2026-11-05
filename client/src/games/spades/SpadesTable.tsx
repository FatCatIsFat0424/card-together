import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Seat } from '@shared/types';
import type { SpadesAction, SpadesHandResult, SpadesVisibleState } from '@shared/games/spades/types';
import { SPADES_SEATS, SPADES_TEAMS, spadesNext } from '@shared/rules/spades';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { CardHand } from '../../components/CardHand';
import { TrickArea } from '../../components/TrickArea';
import { GameShell } from '../GameShell';
import { ResultDialog, resultStyles } from '../ResultDialog';
import { infoStyles, TurnBox } from '../TableInfo';
import { useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useGamePresentation } from '../use-game-presentation';
import { useTablePerspective, useViewedGame } from '../use-table-perspective';
import { isOwnTurn } from '../observer-view';
import styles from './SpadesTable.module.css';

function HandScores({ hands }: { hands: readonly SpadesHandResult[] }): ReactNode {
  const { t } = useI18nStore();
  return <div className={styles.scoreScroll}>
    <table className={resultStyles.table}>
      <thead><tr><th>{t('spades.handScores')}</th><th>{t('spades.team')}</th><th>{t('spades.contract')}</th>
        <th>{t('spades.nilPoints')}</th><th>{t('spades.addedBags')}</th><th>{t('spades.penalty')}</th><th>{t('spades.points')}</th>
      </tr></thead>
      <tbody>{hands.flatMap((hand, index) => SPADES_TEAMS.map((team) => {
        const score = hand.teams[team];
        return <tr key={`${index}-${team}`}><td>{index + 1}</td><td>{t(team === 'NS' ? 'table.teamNS' : 'table.teamEW')}</td>
          <td>{score.tricks}/{score.contract} ({score.contractPoints})</td><td>{score.nilPoints}</td>
          <td>{score.bagsAdded}</td><td>{-score.bagPenalty}</td><td>{score.points}</td></tr>;
      }))}</tbody>
    </table>
  </div>;
}
function Info({ game }: { game: SpadesVisibleState }): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();
  const current = game.currentTurnSeat;
  return <aside className={infoStyles.rail}>
    <TurnBox text={current ? t('spades.turn', { name: name(current) }) : t('game.scoring')}>
      <p className={infoStyles.note}>{t('spades.hand', { n: String(game.handResults.length + (game.result ? 0 : 1)) })} · {t('spades.target')}</p>
      <p className={infoStyles.note}>{t(game.position.broken ? 'spades.broken' : 'spades.unbroken')}</p>
    </TurnBox>
    <section className={infoStyles.box}>
      <h2 className={infoStyles.caption}>{t('spades.score')} · {t('spades.bags')}</h2>
      {SPADES_TEAMS.map((team) => <div key={team} className={infoStyles.row}>
        <span>{t(team === 'NS' ? 'table.teamNS' : 'table.teamEW')}</span><strong>{game.scores[team]} · {game.bags[team]}</strong>
      </div>)}
    </section>
    <section className={infoStyles.box}>
      <h2 className={infoStyles.caption}>{t('spades.bids')}</h2>
      {SPADES_SEATS.map((seat) => <div key={seat} className={infoStyles.row}>
        <span className={infoStyles.name}>{name(seat)}</span>
        <span>{game.position.bids[seat] === 0 ? t('spades.nil') : game.position.bids[seat] ?? '–'} / {game.position.taken[seat]}</span>
      </div>)}
    </section>
    <section className={`${infoStyles.box} ${infoStyles.grow}`}>
      <h2 className={infoStyles.caption}>{t('spades.handScores')}</h2>
      {!game.handResults.length ? <p className={infoStyles.note}>{t('spades.noHands')}</p>
        : <HandScores hands={game.handResults} />}
    </section>
  </aside>;
}
export function SpadesTable(): ReactNode {
  const game = useViewedGame(useGameStore((state) => state.spades));
  const bottom = useTablePerspective() as Seat;
  const { t } = useI18nStore();
  const { locked } = useGamePresentation();
  const connected = useConnectionReady();
  const [bid, setBid] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  if (!game) return null;
  const own = isOwnTurn(game);
  const canAct = own && !locked && connected && !pending && game.phase !== 'scoring';
  const reply = (timeout: Error | null, response?: { success: boolean; error?: string }): void => {
    setPending(false);
    if (timeout) setError(t('auth.connectionError'));
    else if (!response?.success) setError(response?.error ?? t('common.error'));
  };
  const send = (action: SpadesAction): void => {
    if (!canAct) return;
    setError(''); setPending(true);
    socket.timeout(10000).emit('game:action', { gameType: 'spades', action }, reply);
    setBid(null);
  };
  const position = game.position;
  const bidding = game.phase === 'bidding';
  const biddingPanel = bidding && <section className={styles.bidding} aria-labelledby="bidding-panel-title">
    <h2 id="bidding-panel-title">{t('spades.chooseBid')}</h2>
    <div className={styles.bidGrid}>{Array.from({ length: 14 }, (_, value) => <button type="button" key={value}
      className={`btn ${bid === value ? 'btn-primary' : 'btn-outline'}`} aria-pressed={bid === value} disabled={!canAct}
      onClick={() => setBid(value)}>{value === 0 ? t('spades.nil') : value}</button>)}</div>
    <button type="button" className="btn btn-primary" disabled={!canAct || bid === null}
      onClick={() => { if (bid !== null) send({ type: 'bid', bid }); }}>{t('spades.confirmBid')}</button>
  </section>;
  const centre = !bidding && <TrickArea currentTrick={Object.fromEntries(position.trick.map((play) => [play.seat, play.card]))}
    leadSeat={position.trick[0]?.seat ?? position.currentTurnSeat ?? spadesNext(position.dealerSeat)}
    bottomSeat={bottom} myTurn={canAct} />;
  return <GameShell info={<Info game={game} />} centre={centre} panel={biddingPanel}
    prompt={canAct ? t(bidding ? 'spades.chooseBid' : 'spades.play') : null}
    hand={<CardHand cards={game.myHand} playableCards={game.validCards} disabled={!canAct || bidding}
      onCardClick={(card) => send({ type: 'play', card })} />}
    error={game.phase !== 'scoring' ? error : undefined}
    overlay={game.result && <ResultDialog title={t('spades.winner', { team: t(game.result.winners.includes('N') ? 'table.teamNS' : 'table.teamEW') })}
      pending={pending} error={error} disabled={!connected} onBack={() => {
        setError(''); setPending(true); socket.timeout(10000).emit('game:continue', reply);
      }}>
      <p>{t('table.teamNS')} {game.result.scores.NS} · {t('table.teamEW')} {game.result.scores.EW}</p>
      <HandScores hands={game.result.hands} />
    </ResultDialog>} />;
}
