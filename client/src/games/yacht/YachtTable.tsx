// ─── YachtTable: scorecard in the centre, the dice and roll controls in the hand zone ───

import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { YACHT_DICE, YACHT_LOWER_BOXES, YACHT_UPPER_BOXES, isYachtJoker, yachtPotentials } from '@shared/rules/yacht';
import type { YachtBox } from '@shared/rules/yacht';
import type { GameSeat } from '@shared/types';
import type { YachtGameAction } from '@shared/games/yacht/actions';
import type { YachtLogEntry, YachtMatchResult, YachtTurn, YachtVisibleState } from '@shared/games/yacht/types';
import { playDiceRollSound } from '../../audio/card-sound';
import { AppIcon } from '../../components/AppIcon';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { GameShell } from '../GameShell';
import { HandActions } from '../HandActions';
import { ResultDialog, resultStyles } from '../ResultDialog';
import { infoStyles, TurnBox } from '../TableInfo';
import { Die, HiddenDie, useDiceFx } from '../liarsdice/Dice';
import { diceThemeVars, useDiceTheme } from '../liarsdice/dice-theme';
import { isSpectator } from '../observer-view';
import { joinNames, useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useViewedGame } from '../use-table-perspective';
import {
  YACHT_ROUNDS_TOTAL, boxLabel, boxShortLabel, diceSeat, ownTurn, recentScores, rerolled, rollsLeft, rowState,
  seatCells, seatTotals,
} from './yacht-view';
import styles from './YachtTable.module.css';

const RECENT_SCORES = 8;

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

interface RollMotion {
  readonly id: string;
  readonly rolls: number;
  /** The roll number that last rolled each die, so a die tumbles again only when it is rolled again */
  readonly stamps: readonly number[];
  readonly fresh: readonly boolean[];
}

/** Which dice were just rolled; dice already on the table when it opens (joining, reloading) do not tumble. */
function useRollMotion(seat: GameSeat, round: number, turn: YachtTurn | undefined): RollMotion | null {
  const [motion, setMotion] = useState<RollMotion | null>(null);
  const id = `${seat}:${round}`;
  let current = motion;
  if (turn && (motion?.id !== id || motion.rolls !== turn.rolls)) {
    const same = motion?.id === id;
    const rolled = rerolled(turn);
    current = {
      id,
      rolls: turn.rolls,
      stamps: turn.dice.map((_die, index) => (rolled[index] ? turn.rolls : same ? motion.stamps[index] ?? 0 : 0)),
      fresh: turn.dice.map((_die, index) => same && rolled[index]),
    };
    setMotion(current);
  }
  useEffect(() => {
    if (current?.fresh.some(Boolean)) playDiceRollSound();
  }, [current]);
  return current;
}

function DiceRow({ game, seat, turn, holdMask, canHold, onToggle }: {
  game: YachtVisibleState; seat: GameSeat; turn: YachtTurn | undefined; holdMask: readonly boolean[];
  canHold: boolean; onToggle: (index: number) => void;
}): ReactNode {
  const { t } = useI18nStore();
  const diceFx = useDiceFx();
  const motion = useRollMotion(seat, game.round, turn);
  if (!turn || turn.rolls === 0) {
    return <div className={styles.dice} role="group" aria-label={t('yacht.dice')}>
      {Array.from({ length: YACHT_DICE }, (_, index) => <HiddenDie key={index} className={styles.unrolled} />)}
    </div>;
  }
  return <div className={styles.dice} role="group" aria-label={t('yacht.dice')}>
    {turn.dice.map((value, index) => {
      const held = holdMask[index] ?? false;
      const tumbling = motion?.fresh[index] ?? false;
      const delay = index * 60;
      return <button key={`${motion?.id}:${index}:${motion?.stamps[index] ?? 0}`} type="button"
        className={`${styles.dieButton} ${held ? styles.held : ''}`} aria-pressed={canHold ? held : undefined}
        disabled={!canHold} onClick={() => onToggle(index)}
        aria-label={t(held ? 'yacht.dieLabelHeld' : 'yacht.dieLabel', { n: String(index + 1), face: String(value) })}>
        <Die value={value} state={held ? 'match' : 'plain'}
          className={tumbling && !diceFx ? styles.tumble : undefined}
          style={tumbling ? { '--d': `${delay}ms` } as CSSProperties : undefined}
          fx={tumbling && diceFx ? { kind: 'land', delay } : null} />
        <span className={styles.heldTag} aria-hidden="true">{held ? t('yacht.heldTag') : ''}</span>
      </button>;
    })}
  </div>;
}

function ScoreCell({ cell, seat, interactive, picked, onPick, name }: {
  cell: ReturnType<typeof seatCells>[number]; seat: GameSeat; interactive: boolean; picked: boolean;
  onPick: (box: YachtBox) => void; name: string;
}): ReactNode {
  const { t } = useI18nStore();
  const filled = cell.score !== null;
  const hasPotential = !filled && cell.potential !== null;
  const state = filled ? t('yacht.cellScored', { n: String(cell.score) })
    : hasPotential ? t('yacht.cellPotential', { n: String(cell.potential) }) : t('yacht.cellEmpty');
  const label = t('yacht.boxCell', { name, box: t(boxLabel(cell.box)), state });
  const classes = [styles.cell, filled ? styles.filled : '', hasPotential ? styles.potential : '',
    picked ? styles.picked : ''].filter(Boolean).join(' ');
  if (interactive && hasPotential) {
    return <button type="button" role="cell" className={`${classes} ${styles.pickable}`} aria-pressed={picked}
      aria-label={label} data-seat={seat} onClick={() => onPick(cell.box)}>{cell.potential}</button>;
  }
  return <span role="cell" className={classes} aria-label={label}>
    {filled ? cell.score : hasPotential ? cell.potential : ''}
  </span>;
}

function Scorecard({ game, picked, onPick, canPick }: {
  game: YachtVisibleState; picked: YachtBox | null; onPick: (box: YachtBox) => void; canPick: boolean;
}): ReactNode {
  const { t, locale } = useI18nStore();
  // Two-character Chinese labels stand upright in one column's width.
  const headClass = `${styles.boxHead} ${locale === 'zh-TW' ? styles.stacked : ''}`;
  const seatName = useSeatName();
  const columns = [...YACHT_UPPER_BOXES, ...YACHT_LOWER_BOXES] as readonly YachtBox[];
  return <div className={`${styles.scorecard} ${locale === 'zh-TW' ? styles.upright : ''}`} role="table" aria-label={t('yacht.scorecard')}
    style={{ '--rows': String(game.seats.length) } as CSSProperties}>
    <div className={`${styles.row} ${styles.head}`} role="row">
      <span role="columnheader" className={styles.nameHead}
        aria-label={t('yacht.round', { n: String(game.round), total: String(YACHT_ROUNDS_TOTAL) })}>
        {game.round}/{YACHT_ROUNDS_TOTAL}</span>
      {YACHT_UPPER_BOXES.map((box) => <span key={box} role="columnheader" className={styles.boxHead}
        title={t(boxLabel(box))} aria-label={t(boxLabel(box))}>{t(boxShortLabel(box))}</span>)}
      <span role="columnheader" className={`${styles.boxHead} ${styles.sumHead}`} title={t('yacht.upperBonus')}
        aria-label={t('yacht.upperBonus')}>{t('yacht.upperShort')}</span>
      {YACHT_LOWER_BOXES.map((box) => <span key={box} role="columnheader" className={headClass}
        title={t(boxLabel(box))} aria-label={t(boxLabel(box))}>{t(boxShortLabel(box))}</span>)}
      <span role="columnheader" className={`${styles.boxHead} ${styles.sumHead}`}>{t('yacht.totalShort')}</span>
    </div>
    {game.seats.map((seat) => {
      const name = seatName(seat);
      const state = rowState(game, seat);
      const cells = seatCells(game, seat, columns);
      const totals = seatTotals(game, seat);
      const mine = seat === game.mySeat && !isSpectator(game);
      const extra = game.cards[seat]?.extraYachts ?? 0;
      return <div key={seat} role="row" className={`${styles.row} ${styles.body} ${state === 'active' ? styles.activeRow : ''} ${mine ? styles.mineRow : ''}`}
        data-state={state}>
        <span role="rowheader" className={styles.name} title={name}>
          <span className={styles.nameText}>{name}</span>
          {state === 'scored' && game.options.mode === 'simultaneous' && <AppIcon name="check" />}
          {state === 'rolling' && <span className={styles.pips} aria-label={t('yacht.rowRolling')}>
            {Array.from({ length: game.turns[seat]?.rolls ?? 0 }, (_, index) => <i key={index} />)}</span>}
        </span>
        {cells.slice(0, 6).map((cell) => <ScoreCell key={cell.box} cell={cell} seat={seat} name={name}
          interactive={canPick && mine} picked={picked === cell.box && mine} onPick={onPick} />)}
        <span role="cell" className={`${styles.sum} ${totals.upperBonus > 0 ? styles.bonus : ''}`}
          title={totals.upperBonus > 0 ? t('yacht.upperBonus') : t('yacht.upperProgress', { n: String(totals.upper) })}
          aria-label={t('yacht.upperProgress', { n: String(totals.upper) })}>
          {totals.upper}
        </span>
        {cells.slice(6).map((cell) => <span key={cell.box} className={styles.lowerSlot} role="presentation">
          <ScoreCell cell={cell} seat={seat} name={name} interactive={canPick && mine}
            picked={picked === cell.box && mine} onPick={onPick} />
          {cell.box === 'yacht' && extra > 0 && <i className={styles.extra} title={t('yacht.extraYachts', { n: String(extra) })} />}
        </span>)}
        <span role="cell" className={`${styles.sum} ${styles.total}`}>{totals.total}</span>
      </div>;
    })}
  </div>;
}

function LogLine({ entry }: { entry: YachtLogEntry }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  return <>
    <span className={infoStyles.name}>{seatName(entry.seat)}</span>
    <span>{t('yacht.logScore', { box: t(boxLabel(entry.box)), n: String(entry.score) })}</span>
    {entry.bonus && <span className={styles.tag}>{t('yacht.logBonus')}</span>}
  </>;
}

function Info({ game }: { game: YachtVisibleState }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const recent = recentScores(game, RECENT_SCORES);
  const simultaneous = game.options.mode === 'simultaneous';
  const turnText = game.phase !== 'playing' ? t('game.playing')
    : simultaneous ? t('yacht.promptSimultaneous')
      : game.currentTurnSeat === game.mySeat && !isSpectator(game) ? t('yacht.yourTurn')
        : t('yacht.turnOf', { name: seatName(game.currentTurnSeat ?? game.mySeat) });
  return <aside className={infoStyles.rail}>
    <TurnBox text={turnText}>
      <p className={infoStyles.note}>{t('yacht.round', { n: String(game.round), total: String(YACHT_ROUNDS_TOTAL) })}</p>
    </TurnBox>
    <section className={`${infoStyles.box} ${infoStyles.grow}`}>
      <h2 className={infoStyles.caption}>{t('yacht.recent')}</h2>
      {recent.length === 0 ? <p className={infoStyles.note}>{t('yacht.noScores')}</p>
        : <ol className={infoStyles.list}>{recent.map((entry) => (
          <li key={`${entry.round}-${entry.seat}`} className={infoStyles.row}><LogLine entry={entry} /></li>
        ))}</ol>}
    </section>
  </aside>;
}

function ResultOverlay({ game, result, pending, error, disabled, onBack }: {
  game: YachtVisibleState; result: YachtMatchResult; pending: boolean; error: string; disabled: boolean; onBack: () => void;
}): ReactNode {
  const { t, locale } = useI18nStore();
  const seatName = useSeatName();
  const ranked = [...result.seats].sort((a, b) => (result.totals[b] ?? 0) - (result.totals[a] ?? 0));
  const title = result.winners.length === 1 ? t('yacht.winner', { name: seatName(result.winners[0]) })
    : t('yacht.winners', { names: joinNames(result.winners.map(seatName), locale) });
  return <ResultDialog title={title} pending={pending} error={error} disabled={disabled} onBack={onBack}>
    <table className={`${resultStyles.table} ${styles.rankTable}`}>
      <thead><tr>
        <th>{t('yacht.rank')}</th><th>{t('yacht.player')}</th><th>{t('yacht.upperBonus')}</th>
        <th>{t('yacht.yachts')}</th><th>{t('yacht.total')}</th>
      </tr></thead>
      <tbody>{ranked.map((seat) => {
        const best = result.winners.includes(seat);
        const rank = 1 + ranked.filter((other) => (result.totals[other] ?? 0) > (result.totals[seat] ?? 0)).length;
        return <tr key={seat} className={best ? resultStyles.winnerRow : ''}>
          <td>{t('yacht.place', { n: String(rank) })}</td>
          <td>{best ? <><AppIcon name="trophy" /> </> : ''}{seatName(seat)}</td>
          <td>{result.upperBonus[seat] ? '+35' : '–'}</td>
          <td>{result.yachts[seat] ?? 0}</td>
          <td>{result.totals[seat] ?? 0}</td>
        </tr>;
      })}</tbody>
    </table>
    <p className={resultStyles.note}>{t('yacht.roundsDone')}{game.options.mode === 'simultaneous' ? ` · ${t('yacht.modeSimultaneous')}` : ''}</p>
  </ResultDialog>;
}

export function YachtTable(): ReactNode {
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.yacht));
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const theme = useDiceTheme();
  const [draft, setDraft] = useState<{ key: string; held: boolean[] } | null>(null);
  const [pick, setPick] = useState<{ key: string; box: YachtBox } | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);

  if (!game) return null;

  const watching = isSpectator(game);
  const shownSeat = diceSeat(game);
  const shownTurn = game.turns[shownSeat];
  const acting = ownTurn(game);
  const turn = acting?.turn;
  // A new roll, a new round, or a new seat clears the picks that belonged to the previous dice.
  const stateKey = `${game.round}:${acting?.seat ?? ''}:${turn?.rolls ?? 0}`;
  const holdMask = acting && turn && turn.rolls > 0
    ? (draft?.key === stateKey ? draft.held : [...turn.held]) : shownTurn?.held ?? [];
  const potentials = acting && turn && turn.rolls > 0 ? yachtPotentials(acting.card, turn.dice) : {};
  const picked = pick?.key === stateKey && potentials[pick.box] !== undefined ? pick.box : null;
  const canAct = connectionReady && !actionPending && acting !== null;
  const canRoll = canAct && turn !== undefined && rollsLeft(turn) > 0 && !holdMask.every(Boolean);
  const canHold = canAct && turn !== undefined && turn.rolls > 0 && rollsLeft(turn) > 0;
  const canScore = canAct && turn !== undefined && turn.rolls > 0;

  const handleActionResult: ActionCallback = (timeout, response) => {
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  };

  const send = (action: YachtGameAction): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:action', { gameType: 'yacht', action }, handleActionResult);
  };

  const toggle = (index: number): void => {
    if (!canHold) return;
    const held = holdMask.map((value, position) => (position === index ? !value : value));
    setDraft({ key: stateKey, held });
    setActionError('');
    // The hold is shown to the table at once; a failure only means the next roll carries the mask itself.
    socket.timeout(10000).emit('game:action', { gameType: 'yacht', action: { type: 'hold', held } satisfies YachtGameAction },
      (timeout: Error | null, response?: { success: boolean; error?: string }) => {
        if (timeout || !response?.success) setActionError(response?.error ?? t('auth.connectionError'));
      });
  };

  const sendRoll = (): void => {
    if (!canRoll || !turn) return;
    send(turn.rolls === 0 ? { type: 'roll' } : { type: 'roll', held: holdMask });
  };

  const sendScore = (): void => {
    if (canScore && picked) send({ type: 'score', box: picked });
  };

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const prompt = game.phase !== 'playing' ? null
    : watching || !acting ? (game.options.mode === 'simultaneous'
      ? (game.turns[game.mySeat]?.done ? t('yacht.promptWaitRound') : null)
      : t('yacht.watching', { name: seatName(shownSeat) }))
      : turn && turn.rolls === 0 ? t('yacht.promptRoll')
        : turn && isYachtJoker(acting.card, turn.dice) ? t('yacht.promptJoker')
          : turn && rollsLeft(turn) === 0 ? t('yacht.promptScore') : t('yacht.promptHold');

  const dicePanel = <div className={styles.handArea} style={diceThemeVars(theme)}>
    <DiceRow game={game} seat={shownSeat} turn={shownTurn} holdMask={holdMask} canHold={canHold} onToggle={toggle} />
    {(watching || !acting) && game.options.mode === 'turns' && game.phase === 'playing' && shownSeat !== game.mySeat
      && <p className={styles.caption}>{t('yacht.diceOf', { name: seatName(shownSeat) })}</p>}
    {acting && turn && <HandActions className={styles.controls} layout="wide">
      <button type="button" className={`btn btn-primary ${styles.ctrl}`} disabled={!canRoll} onClick={sendRoll}
        title={rollsLeft(turn) === 0 ? t('yacht.rollsOut') : undefined}>
        {t(rollsLeft(turn) === 0 ? 'yacht.rollsOut' : 'yacht.rollLeft', { n: String(rollsLeft(turn)) })}
      </button>
      <button type="button" className={`btn btn-primary ${styles.ctrl}`} disabled={!canScore || !picked} onClick={sendScore}>
        {picked ? t('yacht.scoreBox', { box: t(boxLabel(picked)), n: String(potentials[picked]) }) : t('yacht.scorePick')}
      </button>
    </HandActions>}
  </div>;

  return (
    <GameShell
      info={<Info game={game} />}
      centre={<div className={styles.centre}>
        <Scorecard game={game} picked={picked} canPick={canScore}
          onPick={(box) => setPick({ key: stateKey, box })} />
      </div>}
      hand={dicePanel}
      prompt={prompt}
      overlay={game.phase === 'scoring' && game.result && <ResultOverlay game={game} result={game.result}
        pending={actionPending} error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
      error={game.phase !== 'scoring' ? actionError : undefined}
    />
  );
}
