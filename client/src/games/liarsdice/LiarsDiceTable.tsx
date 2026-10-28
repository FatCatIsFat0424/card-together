// ─── LiarsDiceTable: Liar's Dice table (standing bid, own cup, bid controls, info rail, settlement) ───

import { useState } from 'react';
import type { ReactNode } from 'react';
import { LDI_ALL_FACES, ldiIsLegalBid } from '@shared/rules/liarsdice';
import type { DiceFace, LiarsDiceBid, LiarsDiceLogEntry, LiarsDiceMatchResult, LiarsDiceVisibleState } from '@shared/types';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { AppIcon } from '../../components/AppIcon';
import { GameShell } from '../GameShell';
import { HandActions } from '../HandActions';
import { useViewedGame } from '../use-table-perspective';
import { ResultDialog, resultStyles } from '../ResultDialog';
import { useResultRoundHistory } from '../RoundHistory';
import { infoStyles, TurnBox } from '../TableInfo';
import { useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useGamePresentation } from '../use-game-presentation';
import { isOwnTurn, isSpectator } from '../observer-view';
import { Die, HiddenDie } from './Dice';
import { diceThemeVars, useDiceTheme } from './dice-theme';
import {
  defaultBid, dieMatches, liarsDiceMode, liarsDiceView, recentLiarsDiceMoves, sortDice, totalDice,
} from './liarsdice-view';
import type { LiarsDiceTableView } from './liarsdice-view';
import styles from './LiarsDiceTable.module.css';

const RECENT_MOVES = 8;

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

function Centre({ view }: { view: LiarsDiceTableView }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const theme = useDiceTheme();
  const bid = view.bid;
  return <div className={styles.centre} style={diceThemeVars(theme)}>
    <span className={styles.round}>{t('liarsdice.round', { n: String(view.round) })}</span>
    {bid ? <div className={styles.board}>
      <span className={styles.bidder}>{t('liarsdice.bidBy', { name: seatName(bid.seat) })}</span>
      <span className={styles.bid} aria-label={t('liarsdice.bidLabel', { n: String(bid.quantity), face: String(bid.face) })}>
        <strong className={styles.quantity}>{bid.quantity}</strong>
        <span aria-hidden="true">×</span>
        <Die value={bid.face} />
      </span>
    </div> : <p className={styles.noBid}>{t('liarsdice.noBid')}</p>}
    <div className={styles.facts}>
      <span className={`${styles.pill} ${view.onesWild ? '' : styles.pillOff}`}>
        {t(view.onesWild ? 'liarsdice.onesWild' : 'liarsdice.onesNotWild')}
      </span>
      <span className={styles.pill}>{t('liarsdice.inPlay', { n: String(totalDice(view.counts)) })}</span>
    </div>
  </div>;
}

function MoveLine({ entry }: { entry: LiarsDiceLogEntry }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  if (entry.type === 'round') {
    return <span className={styles.roundLine}>
      {t('liarsdice.logRound', { n: String(entry.round), name: seatName(entry.starter) })}
    </span>;
  }
  return <>
    <span className={infoStyles.name}>{seatName(entry.seat)}</span>
    {entry.type === 'bid' && <span>{t('liarsdice.logBid', { n: String(entry.quantity), face: String(entry.face) })}</span>}
    {entry.type === 'challenge' && <>
      <span>{t('liarsdice.logCall', { name: seatName(entry.target) })}</span>
      <span className={`${styles.tag} ${entry.bidTrue ? styles.tagGood : styles.tagBad}`}>
        {t('liarsdice.logFound', { count: String(entry.count), n: String(entry.quantity) })}
        {entry.eliminated ? ` · ${t('liarsdice.out')}` : ''}
      </span>
    </>}
  </>;
}

function Info({ game, view, locked }: { game: LiarsDiceVisibleState; view: LiarsDiceTableView; locked: boolean }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const recent = recentLiarsDiceMoves(game.log.slice(0, view.logEnd), RECENT_MOVES);
  return <aside className={infoStyles.rail}>
    <TurnBox text={game.phase !== 'playing' || locked ? t('game.playing')
      : isOwnTurn(game) ? t('liarsdice.yourTurn')
        : t('liarsdice.turnOf', { name: seatName(game.currentTurnSeat) })}>
      <p className={infoStyles.note}>
        {t('liarsdice.round', { n: String(view.round) })} · {t('liarsdice.inPlay', { n: String(totalDice(view.counts)) })}
      </p>
    </TurnBox>

    <section className={`${infoStyles.box} ${infoStyles.grow}`}>
      <h2 className={infoStyles.caption}>{t('liarsdice.recent')}</h2>
      {recent.length === 0 ? <p className={infoStyles.note}>{t('liarsdice.noMoves')}</p>
        : <ol className={infoStyles.list}>{recent.map((entry) => (
          <li key={`${entry.timestamp}-${entry.type}-${'seat' in entry ? entry.seat : entry.round}`} className={infoStyles.row}>
            <MoveLine entry={entry} />
          </li>
        ))}</ol>}
    </section>
  </aside>;
}

function ResultOverlay({ result, pending, error, disabled, onBack }: {
  result: LiarsDiceMatchResult; pending: boolean; error: string; disabled: boolean; onBack: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  const history = useResultRoundHistory(useGameStore((state) => state.visible));
  const seatName = useSeatName();
  // The last player eliminated ranks 2nd, and so on
  const ranking = [result.winnerSeat, ...[...result.eliminationOrder].reverse()];
  return <ResultDialog history={history} title={t('liarsdice.winner', { name: seatName(result.winnerSeat) })}
    pending={pending} error={error} disabled={disabled} onBack={onBack}>
    <table className={`${resultStyles.table} ${styles.rankTable}`}>
      <thead><tr>
        <th>{t('liarsdice.rank')}</th><th>{t('liarsdice.player')}</th><th>{t('liarsdice.diceLeft')}</th>
      </tr></thead>
      <tbody>{ranking.map((seat, index) => (
        <tr key={seat} className={index === 0 ? resultStyles.winnerRow : ''}>
          <td>{t('liarsdice.place', { n: String(index + 1) })}</td>
          <td>{index === 0 ? <><AppIcon name="trophy" /> </> : ''}{seatName(seat)}</td>
          <td>{result.dice[seat]}</td>
        </tr>
      ))}</tbody>
    </table>
    <p className={resultStyles.note}>{t('liarsdice.rounds', { n: String(result.rounds) })}</p>
  </ResultDialog>;
}

/** Quantity stepper and face buttons that build the next bid. */
function BidPicker({ bid, total, disabled, onChange }: {
  bid: LiarsDiceBid; total: number; disabled: boolean; onChange: (bid: LiarsDiceBid) => void;
}): ReactNode {
  const { t } = useI18nStore();
  return <div className={styles.picker} role="group" aria-label={t('liarsdice.pickBid')}>
    <div className={styles.stepper}>
      <button type="button" className={styles.step} disabled={disabled || bid.quantity <= 1}
        aria-label={t('liarsdice.fewer')} onClick={() => onChange({ ...bid, quantity: bid.quantity - 1 })}>−</button>
      <output className={styles.pickQuantity} aria-live="polite">{bid.quantity}</output>
      <button type="button" className={styles.step} disabled={disabled || bid.quantity >= total}
        aria-label={t('liarsdice.more')} onClick={() => onChange({ ...bid, quantity: bid.quantity + 1 })}>+</button>
    </div>
    <div className={styles.faces} role="radiogroup" aria-label={t('liarsdice.pickFace')}>
      {LDI_ALL_FACES.map((face) => <button key={face} type="button" role="radio" aria-checked={bid.face === face}
        className={`${styles.faceButton} ${bid.face === face ? styles.faceSelected : ''}`} disabled={disabled}
        aria-label={t('liarsdice.faceLabel', { face: String(face) })} onClick={() => onChange({ ...bid, face })}>
        <Die value={face} />
      </button>)}
    </div>
  </div>;
}

export function LiarsDiceTable(): ReactNode {
  const { locked, frame } = useGamePresentation();
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.liarsDice));
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const theme = useDiceTheme();
  const [draft, setDraft] = useState<{ key: string; bid: LiarsDiceBid } | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);

  if (!game) return null;

  const view = liarsDiceView(game, frame);
  const playing = game.phase === 'playing';
  const watching = isSpectator(game);
  const out = !watching && view.eliminated.includes(game.mySeat);
  const mode = liarsDiceMode(game, view.bid, playing && !locked && isOwnTurn(game));
  const canAct = mode !== 'wait' && connectionReady && !actionPending;
  const total = totalDice(view.counts);
  // A new standing bid replaces the draft, so a stale pick never carries into the next turn.
  const draftKey = `${view.round}:${view.bid?.seat ?? ''}:${view.bid?.quantity ?? 0}:${view.bid?.face ?? 0}`;
  const pick = draft?.key === draftKey ? draft.bid : defaultBid(view.bid, total);
  const legal = ldiIsLegalBid(view.bid, pick, total);

  const handleActionResult: ActionCallback = (timeout, response) => {
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  };

  const send = (action: { type: 'bid'; quantity: number; face: DiceFace } | { type: 'challenge' }): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:action', { gameType: 'liarsdice', action }, handleActionResult);
  };

  const sendBid = (): void => {
    if (canAct && legal) send({ type: 'bid', quantity: pick.quantity, face: pick.face });
  };

  const sendCall = (): void => {
    if (canAct && mode === 'bidOrCall') send({ type: 'challenge' });
  };

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  // While the next roll is still on its way the presentation says what is happening.
  const prompt = !playing || view.handHidden ? null
    : watching ? t('liarsdice.turnOf', { name: seatName(game.currentTurnSeat) })
        : out ? t('liarsdice.youAreOut')
          : mode === 'wait' ? t('liarsdice.turnOf', { name: seatName(game.currentTurnSeat) })
            : view.bid ? t('liarsdice.promptRaise') : t('liarsdice.promptOpen');
  const showDice = playing && !out;
  const faceUp = showDice && !view.handHidden;
  const myCount = view.counts[game.mySeat] ?? 0;

  const handZone = <div className={styles.handArea} style={diceThemeVars(theme)}>
    {showDice && <div className={styles.dice} role="group" aria-label={t('liarsdice.hand')}>
      {faceUp
        ? sortDice(game.myDice).map((value, index) => <Die key={index} value={value}
          state={view.bid && dieMatches(value, view.bid.face, view.onesWild) ? 'match' : 'plain'}
          label={t('liarsdice.faceLabel', { face: String(value) })} />)
        : Array.from({ length: myCount }, (_, index) => <HiddenDie key={index} />)}
    </div>}
    {showDice && !watching && <div className={styles.pickerSlot} data-idle={mode === 'wait' ? '' : undefined}
      inert={mode === 'wait'}>
      <BidPicker bid={pick} total={total} disabled={!canAct}
        onChange={(bid) => setDraft({ key: draftKey, bid })} />
    </div>}
    {playing && !watching && !out && <HandActions className={styles.controls} layout="wide">
      <button type="button" className={`btn btn-primary ${styles.ctrl}`} disabled={!canAct || !legal} onClick={sendBid}
        title={legal ? undefined : t('liarsdice.illegalBid')}>
        {t('liarsdice.bidButton', { n: String(pick.quantity), face: String(pick.face) })}
      </button>
      {view.bid && <button type="button" className={`btn btn-danger ${styles.ctrl} ${styles.call}`}
        disabled={!canAct || mode !== 'bidOrCall'} onClick={sendCall}
        title={t('liarsdice.callOn', { name: seatName(view.bid.seat) })}>
        {t('liarsdice.call')}
      </button>}
    </HandActions>}
  </div>;

  return (
    <GameShell
      info={<Info game={game} view={view} locked={locked} />}
      centre={<Centre view={view} />}
      hand={handZone}
      prompt={prompt}
      overlay={game.phase === 'scoring' && game.result && <ResultOverlay result={game.result}
        pending={actionPending} error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
      error={game.phase !== 'scoring' ? actionError : undefined}
    />
  );
}
