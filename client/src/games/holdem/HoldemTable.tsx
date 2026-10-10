// ─── HoldemTable: board and pots, every seat's stake, hole cards, betting controls, info rail, result ───

import { useState } from 'react';
import type { ReactNode } from 'react';
import { HE_HANDS, heReplay } from '@shared/rules/holdem';
import type { HoldemAction, HoldemLogEntry, HoldemMatchResult, HoldemVisibleState, Seat } from '@shared/types';
import { tablePosition } from '../../game-view';
import type { TablePosition } from '../../game-view';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { ChipIcon } from '../ChipIcon';
import { GameShell } from '../GameShell';
import { ResultDialog, resultStyles } from '../ResultDialog';
import { RoundHistory } from '../RoundHistory';
import { infoStyles, RulesBox, TurnBox } from '../TableInfo';
import { joinNames, useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useGamePresentation } from '../use-game-presentation';
import { BetStack, Board, ChipAmount, HeCards, SeatMarkers, cardName } from './HoldemCards';
import { usePotLabel } from './HoldemFrame';
import {
  HE_SEATS, QUICK_SIZES, chipsAdded, clampRaise, holdemBlindSeats, holdemCategory, holdemControls, holdemView,
  potLines, potTotal, quickRaise, raiseKind, rankHoldem, recentHoldemMoves, seatState, shownAward, shownHoleCards,
  signedChips, streetActions,
} from './holdem-view';
import type { HoldemBlindSeats, HoldemControls, HoldemTableView, RaiseControl, SeatAction } from './holdem-view';
import styles from './HoldemTable.module.css';

const RECENT_MOVES = 12;

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

const toneClass = (value: number): string | undefined => value > 0 ? styles.gain : value < 0 ? styles.loss : undefined;

/** One seat's corner of the felt: hole cards (opponents), last action, street stake, and winnings. */
function SeatSpot({ seat, view, position, isMe, action, blinds }: {
  seat: Seat; view: HoldemTableView; position: TablePosition; isMe: boolean; action: SeatAction | undefined;
  blinds: HoldemBlindSeats | null;
}): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const state = seatState(view, seat);
  // Busted seats are marked on their plate and have nothing on the felt.
  if (state === 'waiting' || state === 'out') return null;
  const revealed = view.revealed[seat];
  const category = holdemCategory(revealed, view.board);
  const won = view.award?.payouts[seat] ?? 0;
  const bet = view.streetBets[seat];
  const classes = [styles.spot, styles[position], state === 'folded' && styles.folded, won > 0 && styles.winner];
  return <section className={classes.filter(Boolean).join(' ')} aria-label={seatName(seat)}>
    <header className={styles.spotHeader}>
      <SeatMarkers seat={seat} blinds={blinds} />
      {!isMe && <span className={styles.spotName}>{seatName(seat)}</span>}
      {state === 'folded' ? <span className={styles.tag}>{t('holdem.folded')}</span>
        : state === 'allIn' ? <span className={`${styles.tag} ${styles.allInTag}`}>{t('holdem.allIn')}</span>
          : action && <span className={styles.tag}>{t(`holdem.tag.${action}`)}</span>}
    </header>
    {!isMe && (revealed.length > 0
      ? <HeCards cards={revealed} size="sm" overlap label={seatName(seat)} />
      : <HeCards cards={[]} backs={2} size="xs" overlap />)}
    {category && <span className={styles.category}>{t(`holdem.category.${category}`)}</span>}
    {won > 0 && <strong className={styles.won}>🏆 {t('holdem.wonAmount', { n: String(won) })}</strong>}
    {bet > 0 && <BetStack amount={bet} title={t('holdem.betTitle', { n: String(bet) })} />}
  </section>;
}

function PotList({ view }: { view: HoldemTableView }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const potLabel = usePotLabel();
  const lines = potLines(view);
  const total = view.award ? lines.reduce((sum, line) => sum + line.amount, 0) : potTotal(view);
  return <div className={styles.pots}>
    <strong className={styles.potTotal}>{t('holdem.pot')} <ChipAmount amount={total} /></strong>
    {(lines.length > 1 || view.award) && <ul className={styles.potLines}>{lines.map((line, index) => <li key={index}>
      {potLabel(line, index, lines.length)} <ChipAmount amount={line.amount} />
      {line.winners.length > 0 && !line.returned && <> → {line.winners.map(seatName).join(' · ')}</>}
    </li>)}</ul>}
  </div>;
}

function Centre({ game, view }: { game: HoldemVisibleState; view: HoldemTableView }): ReactNode {
  const { t } = useI18nStore();
  const blinds = holdemBlindSeats(view);
  const actions = streetActions(game.log, view.logEnd);
  return <div className={styles.centre}>
    {HE_SEATS.map((seat) => <SeatSpot key={seat} seat={seat} view={view} position={tablePosition(seat, game.mySeat)}
      isMe={seat === game.mySeat} action={actions[seat]} blinds={blinds} />)}
    <div className={styles.middle}>
      {view.hand > 0 && <p className={styles.handLine}>
        {t('holdem.handOf', { n: String(view.hand), total: String(HE_HANDS) })} ·
        {' '}{t('holdem.blinds', { sb: String(view.smallBlind), bb: String(view.bigBlind) })} ·
        {' '}{t(`holdem.street.${view.street}`)}
      </p>}
      <Board cards={view.board} size="md" />
      {view.hand > 0 && <PotList view={view} />}
    </div>
  </div>;
}

function MoveLine({ log, index }: { log: readonly HoldemLogEntry[]; index: number }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const entry = log[index];
  if (entry.type === 'hand') {
    return <div className={styles.moveBlock}>
      <span className={styles.handTitle}>{t('holdem.logHand', { n: String(entry.hand) })}</span>
      <span className={styles.moveDetail}>
        <span>{t('holdem.logButton', { name: seatName(entry.button) })}</span>
        <span>{t('holdem.blinds', { sb: String(entry.smallBlind), bb: String(entry.bigBlind) })}</span>
      </span>
    </div>;
  }
  if (entry.type === 'action') {
    const kind = entry.allIn ? 'allIn' : entry.action;
    const amount = kind === 'call' ? chipsAdded(log, index) : entry.to;
    return <>
      <span className={infoStyles.name}>{seatName(entry.seat)}</span>
      <span className={kind === 'allIn' ? styles.allInText : undefined}>{t(`holdem.log.${kind}`, { n: String(amount) })}</span>
    </>;
  }
  if (entry.type === 'street') {
    return <>
      <span className={styles.handTitle}>{t(`holdem.street.${entry.street}`)}</span>
      <span className={styles.cardText}>{entry.cards.map(cardName).join(' ')}</span>
    </>;
  }
  if (entry.type === 'showdown') {
    const { board } = heReplay(log, index);
    return <div className={styles.moveBlock}>
      <span className={styles.handTitle}>{t('holdem.log.showdown')}</span>
      <span className={styles.moveDetail}>{HE_SEATS.filter((seat) => entry.cards[seat].length > 0).map((seat) => {
        const category = holdemCategory(entry.cards[seat], board);
        return <span key={seat}>
          {seatName(seat)} <span className={styles.cardText}>{entry.cards[seat].map(cardName).join(' ')}</span>
          {category && <> · {t(`holdem.category.${category}`)}</>}
        </span>;
      })}</span>
    </div>;
  }
  const award = shownAward(log, index + 1);
  return <div className={styles.moveBlock}>
    {award && HE_SEATS.filter((seat) => award.payouts[seat] > 0).map((seat) => <span key={seat}>
      <span className={infoStyles.name}>{seatName(seat)}</span> {t('holdem.log.wins', { n: String(award.payouts[seat]) })}
    </span>)}
    {entry.eliminated.map((seat) => <span key={seat} className={styles.loss}>
      {seatName(seat)} {t('holdem.log.eliminated')}
    </span>)}
  </div>;
}

function Info({ game, view, locked }: { game: HoldemVisibleState; view: HoldemTableView; locked: boolean }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const me = game.mySeat;
  const blinds = holdemBlindSeats(view);
  const recentEnd = view.logEnd;
  const recent = recentHoldemMoves(game.log, recentEnd, RECENT_MOVES);
  const text = game.phase === 'scoring' ? t('game.scoring')
    : locked ? t('game.playing')
      : game.currentTurnSeat === me ? t('holdem.yourTurn')
        : t('holdem.turnOf', { name: seatName(game.currentTurnSeat) });
  return <aside className={infoStyles.rail}>
    <TurnBox text={text}>
      {view.hand > 0 && <p className={infoStyles.note}>
        {t('holdem.handOf', { n: String(view.hand), total: String(HE_HANDS) })} ·
        {' '}{t('holdem.blinds', { sb: String(view.smallBlind), bb: String(view.bigBlind) })}
      </p>}
      <p className={infoStyles.note}>
        {t('holdem.pot')} <ChipAmount amount={potTotal(view)} /> · {t('holdem.myChips', { n: String(view.chips[me]) })}
      </p>
    </TurnBox>

    <section className={infoStyles.box}>
      <h2 className={infoStyles.caption}>{t('holdem.players')}</h2>
      <ul className={infoStyles.list}>{HE_SEATS.map((seat) => {
        const state = seatState(view, seat);
        return <li key={seat} className={`${infoStyles.row} ${state === 'out' || state === 'folded' ? styles.dimRow : ''}`}>
          <span className={`${infoStyles.name} ${styles.infoName}`} title={state === 'folded' ? t('holdem.folded') : undefined}>
            {seatName(seat)}
          </span>
          <span className={styles.markers}><SeatMarkers seat={seat} blinds={blinds} /></span>
          {/* Folded rows are dimmed instead of labelled so the chip count keeps its room. */}
          {(state === 'out' || state === 'allIn') && <span className={`${infoStyles.note} ${styles.stateNote}`}>
            {t(state === 'out' ? 'holdem.out' : 'holdem.allIn')}
          </span>}
          <strong className={styles.infoChips}><ChipIcon />{view.chips[seat]}</strong>
        </li>;
      })}</ul>
    </section>

    <section className={`${infoStyles.box} ${infoStyles.grow}`}>
      <h2 className={infoStyles.caption}>{t('holdem.recent')}</h2>
      {recent.length === 0 ? <p className={infoStyles.note}>{t('holdem.noMoves')}</p>
        : <ol className={infoStyles.list}>{recent.map((entry, offset) => {
          const index = recentEnd - 1 - offset;
          return <li key={`${entry.timestamp}-${index}`} className={infoStyles.row}>
            <MoveLine log={game.log} index={index} />
          </li>;
        })}</ol>}
    </section>

    <RulesBox title={t('holdem.rules')} lines={[t('holdem.rulesChips'), t('holdem.rulesDeal'),
      t('holdem.rulesAction'), t('holdem.rulesShowdown')]} />
  </aside>;
}

function ResultOverlay({ result, pending, error, disabled, onBack }: {
  result: HoldemMatchResult; pending: boolean; error: string; disabled: boolean; onBack: () => void;
}): ReactNode {
  const { t, locale } = useI18nStore();
  const historyGame = useGameStore((state) => state.visible);
  const seatName = useSeatName();
  return <ResultDialog title={t('holdem.winner', { names: joinNames(result.winners.map(seatName), locale) })}
    pending={pending} error={error} disabled={disabled} onBack={onBack}>
    <table className={`${resultStyles.table} ${styles.rankTable}`}>
      <thead><tr>
        <th>{t('holdem.rank')}</th><th>{t('holdem.player')}</th>
        <th>{t('holdem.chipsColumn')}</th><th>{t('holdem.net')}</th>
      </tr></thead>
      <tbody>{rankHoldem(result).map((row) => (
        <tr key={row.seat} className={row.winner ? resultStyles.winnerRow : ''}>
          <td>{t('holdem.place', { n: String(row.place) })}</td>
          <td>{row.winner && '🏆 '}{seatName(row.seat)}</td>
          <td>{row.eliminated ? t('holdem.out') : row.chips}</td>
          <td className={toneClass(row.net)}>{signedChips(row.net)}</td>
        </tr>
      ))}</tbody>
    </table>
    <p className={resultStyles.note}>{t('holdem.handsPlayed', { n: String(result.hands) })}</p>
    {historyGame && <RoundHistory game={historyGame} />}
  </ResultDialog>;
}

/** Slider, amount field, and shortcuts for a bet or raise, clamped to the legal street totals. */
function RaiseInput({ game, control, disabled, onRaise }: {
  game: HoldemVisibleState; control: RaiseControl; disabled: boolean; onRaise: (to: number) => void;
}): ReactNode {
  const { t } = useI18nStore();
  const [draft, setDraft] = useState<string | null>(null);
  const [chosen, setChosen] = useState(control.min);
  const value = clampRaise(draft === null ? chosen : Number(draft), control);
  const choose = (to: number): void => {
    setDraft(null);
    setChosen(clampRaise(to, control));
  };
  const kind = raiseKind(value, control);
  const confirm = <button type="button" className={`btn btn-primary ${styles.ctrl} ${kind === 'allIn' ? styles.allInButton : ''}`}
    disabled={disabled} onClick={() => onRaise(value)}>
    {t(`holdem.confirm.${kind}`, { n: String(value) })}
  </button>;
  if (control.min === control.max) {
    return <div className={styles.raise}>
      <span className={styles.limits}>{t('holdem.raiseAllInOnly')}</span>
      {confirm}
    </div>;
  }
  return <div className={styles.raise}>
    <div className={styles.quickRow} role="group" aria-label={t('holdem.raiseAmount')}>
      {QUICK_SIZES.map((size) => {
        const to = quickRaise(size, game, game.mySeat, control);
        return <button key={size} type="button" className={`btn btn-outline ${styles.quick} ${to === value ? styles.quickActive : ''}`}
          aria-pressed={to === value} disabled={disabled} onClick={() => choose(to)} title={String(to)}>
          {t(`holdem.quick.${size}`)}
        </button>;
      })}
    </div>
    <div className={styles.sliderRow}>
      <input type="range" className={styles.slider} min={control.min} max={control.max} step={1} value={value}
        aria-label={t('holdem.raiseAmount')} disabled={disabled}
        onChange={(event) => choose(Number(event.target.value))} />
      <input type="number" className={styles.amountInput} min={control.min} max={control.max} step={1}
        inputMode="numeric" aria-label={t('holdem.raiseAmount')} disabled={disabled}
        value={draft ?? String(value)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => choose(value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !disabled) {
            choose(value);
            onRaise(value);
          }
        }} />
      {confirm}
    </div>
    <span className={styles.limits}>{t('holdem.raiseRange', { min: String(control.min), max: String(control.max) })}</span>
  </div>;
}

function Controls({ game, options, enabled, onAction }: {
  game: HoldemVisibleState; options: HoldemControls | null; enabled: boolean; onAction: (action: HoldemAction) => void;
}): ReactNode {
  const { t } = useI18nStore();
  const disabled = !enabled || !options;
  const callLabel = !options || options.check ? t('holdem.action.check')
    : t(options.callAllIn ? 'holdem.action.callAllIn' : 'holdem.action.call', { n: String(options.call) });
  return <div className={styles.controls}>
    <div className={styles.mainButtons}>
      <button type="button" className={`btn btn-outline ${styles.ctrl} ${styles.foldButton}`} disabled={disabled}
        onClick={() => onAction({ type: 'fold' })}>{t('holdem.action.fold')}</button>
      <button type="button" className={`btn btn-primary ${styles.ctrl}`} disabled={disabled}
        onClick={() => onAction(options?.check ? { type: 'check' } : { type: 'call' })}>{callLabel}</button>
    </div>
    {options?.raise && <RaiseInput key={`${options.raise.min}-${options.raise.max}`} game={game} control={options.raise}
      disabled={disabled} onRaise={(to) => onAction({ type: 'raise', to })} />}
  </div>;
}

export function HoldemTable(): ReactNode {
  const { locked, frame } = useGamePresentation();
  const connectionReady = useConnectionReady();
  const game = useGameStore((state) => state.holdem);
  const held = useGameStore((state) => state.holdemHeld);
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  // An acknowledgement can arrive before the updated state; stay locked until the log grows.
  const [sentAt, setSentAt] = useState<number | null>(null);

  if (!game) return null;

  const view = holdemView(game, frame);
  const me = game.mySeat;
  const awaiting = sentAt !== null && sentAt === game.log.length;
  const ready = !locked && connectionReady && !actionPending && !awaiting;
  const options = holdemControls(game, true);
  const myTurn = options !== null && ready;
  const myState = seatState(view, me);
  const hole = shownHoleCards(game, view, held);
  const category = holdemCategory(hole.cards, view.board);
  const won = view.award?.payouts[me] ?? 0;
  const owed = Math.max(0, view.currentBet - view.streetBets[me]);

  const handleActionResult: ActionCallback = (timeout, response) => {
    setActionPending(false);
    if (timeout || !response?.success) setSentAt(null);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  };

  const sendAction = (action: HoldemAction): void => {
    if (!myTurn || !options) return;
    if (action.type === 'check' && !options.check) return;
    if (action.type === 'raise' && (!options.raise || action.to < options.raise.min || action.to > options.raise.max)) return;
    setActionError('');
    setActionPending(true);
    setSentAt(game.log.length);
    socket.timeout(10000).emit('game:holdem:action', { action }, handleActionResult);
  };

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const prompt = game.phase !== 'playing' || locked ? null
    // The shell already announces my turn; only the amount owed is added here.
    : game.currentTurnSeat === me ? owed > 0 ? t('holdem.toCall', { n: String(owed) }) : null
      : t('holdem.turnOf', { name: seatName(game.currentTurnSeat) });

  const stateNote = myState === 'out' ? t('holdem.youOut') : myState === 'folded' ? t('holdem.youFolded')
    : myState === 'allIn' ? t('holdem.youAllIn') : myState === 'waiting' ? t('holdem.waitingDeal') : null;

  const handZone = <div className={styles.handArea}>
    {(hole.cards.length > 0 || hole.hidden) && <div className={`${styles.myHand} ${myState === 'folded' ? styles.folded : ''}`}>
      <HeCards cards={hole.cards} backs={hole.hidden ? 2 : 0} size="lg" label={t('holdem.hole')} />
      <div className={styles.myMeta}>
        {category && <span className={styles.bestHand}>{t('holdem.bestHand', { category: t(`holdem.category.${category}`) })}</span>}
        {won > 0 && <strong className={styles.won}>🏆 {t('holdem.wonAmount', { n: String(won) })}</strong>}
      </div>
    </div>}
    {game.phase === 'playing' && (myState === 'active'
      ? <>
        {prompt && <p className={`${styles.prompt} ${game.currentTurnSeat === me && !locked ? styles.promptActive : ''}`}>{prompt}</p>}
        <Controls key={game.log.length} game={game} options={options} enabled={myTurn} onAction={sendAction} />
      </>
      : stateNote && <p className={styles.prompt} role="status">{stateNote}</p>)}
  </div>;

  return (
    <GameShell
      info={<Info game={game} view={view} locked={locked} />}
      centre={<Centre game={game} view={view} />}
      hand={handZone}
      overlay={game.phase === 'scoring' && game.result && <ResultOverlay result={game.result}
        pending={actionPending} error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
      error={game.phase !== 'scoring' ? actionError : undefined}
    />
  );
}
