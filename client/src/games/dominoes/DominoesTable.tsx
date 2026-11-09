// ─── DominoesTable: the snaking line with both open ends, boneyard, tile hand, info rail, settlement ───

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import type { GameSeat } from '@shared/types';
import type { DominoesAction } from '@shared/games/dominoes/actions';
import type {
  DominoesMatchResult, DominoesVisibleState, DominoPlacement, DominoSide, DominoTile as Tile,
} from '@shared/games/dominoes/types';
import { dmEnds, dmSameTile, dmSortHand, dmTurnOptions } from '@shared/rules/dominoes';
import { playBoardSound } from '../../audio/card-sound';
import { AppIcon } from '../../components/AppIcon';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { GameShell } from '../GameShell';
import { HandActions } from '../HandActions';
import { useViewedGame } from '../use-table-perspective';
import { ResultDialog, resultStyles } from '../ResultDialog';
import { useResultRoundHistory } from '../RoundHistory';
import { infoStyles, TurnBox } from '../TableInfo';
import { joinNames, useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useGamePresentation } from '../use-game-presentation';
import { isOwnTurn } from '../observer-view';
import { DominoTile } from './DominoTile';
import { fitHand } from './dominoes-hand';
import { fitLine, lineGap, lineSlots, reversedRow } from './dominoes-line';
import type { LineSlot } from './dominoes-line';
import styles from './DominoesTable.module.css';

const RECENT_MOVES = 8;
const MAX_ROUND_COLUMNS = 8;

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

/** The tile laid last in the round in play, which the line marks. */
function latestTile(log: DominoesVisibleState['log']): Tile | undefined {
  for (let index = log.length - 1; index >= 0; index--) {
    const entry = log[index];
    if (entry.type === 'play') return entry.tile;
    if (entry.type === 'round') return undefined;
  }
  return undefined;
}

/** Size of a box that fills its container, tracked as the table is resized. */
function useBoxSize(): { ref: RefObject<HTMLDivElement | null>; width: number; height: number } {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const measure = (): void => setSize((previous) => (previous.width === box.clientWidth && previous.height === box.clientHeight
      ? previous : { width: box.clientWidth, height: box.clientHeight }));
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    measure();
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

/** One open end of the line: a stub showing the number, lit when the selected tile fits it. */
function EndMarker({ side, value, fits, onPick, edge }: {
  side: DominoSide; value: number; fits: boolean; onPick: () => void; edge: number;
}): ReactNode {
  const { t } = useI18nStore();
  const label = t(side === 'left' ? 'dominoes.endLeft' : 'dominoes.endRight', { n: String(value) });
  const style = { '--tile-s': `${edge}px` } as CSSProperties;
  if (!fits) return <span className={styles.end} style={style} role="img" aria-label={label} title={label}>
    <span aria-hidden="true">{value}</span></span>;
  const action = t(side === 'left' ? 'dominoes.playLeft' : 'dominoes.playRight', { n: String(value) });
  return <button type="button" className={`${styles.end} ${styles.target}`} style={style}
    aria-label={action} title={action} onClick={onPick}>
    <span aria-hidden="true">{value}</span>
  </button>;
}

function Line({ game, selected, onPick }: {
  game: DominoesVisibleState; selected: readonly DominoSide[]; onPick: (side: DominoSide) => void;
}): ReactNode {
  const { t } = useI18nStore();
  const { ref, width, height } = useBoxSize();
  const slots = useMemo(() => lineSlots(game.line), [game.line]);
  const ready = width > 0 && height > 0;
  const fit = useMemo(() => fitLine(slots, Math.max(0, width - 8), Math.max(0, height - 4)), [slots, width, height]);
  const ends = dmEnds(game.line);
  const latest = latestTile(game.log);

  const render = (slot: LineSlot, reverse: boolean): ReactNode => {
    if (slot.kind === 'marker') {
      const value = slot.side === 'left' ? ends?.left : ends?.right;
      if (value === undefined || !slot.side) return null;
      const side = slot.side;
      return <EndMarker key={`end-${side}`} side={side} value={value} edge={fit.edge}
        fits={selected.includes(side)} onPick={() => onPick(side)} />;
    }
    const placed: DominoPlacement = game.line[slot.index ?? 0];
    const [left, right] = reverse ? [placed.right, placed.left] : [placed.left, placed.right];
    return <DominoTile key={`${placed.tile[0]}-${placed.tile[1]}`} left={left} right={right} vertical={slot.double}
      className={latest && dmSameTile(latest, placed.tile) ? styles.latest : undefined}
      style={{ '--tile-s': `${fit.edge}px` } as CSSProperties} />;
  };

  return <div className={styles.lineBox} ref={ref} role="group" aria-label={t('dominoes.line')}>
    {game.line.length === 0
      ? <span className={styles.first}>{t('dominoes.firstTile')}</span>
      : ready && <div className={styles.snake} style={{ '--gap': `${lineGap(fit.edge)}px`,
        '--row-gap': `${Math.max(2, Math.round(fit.edge * 0.2))}px` } as CSSProperties}>
        {fit.rows.map((row, rowIndex) => {
          const reverse = reversedRow(rowIndex);
          return <div key={rowIndex} className={`${styles.row} ${reverse ? styles.reverse : ''} ${fit.rows.length === 1 ? styles.single : ''}`}>
            {row.map((index) => render(slots[index], reverse))}
          </div>;
        })}
      </div>}
  </div>;
}

function Centre({ game, canDraw, onDraw, selected, onPick }: {
  game: DominoesVisibleState; canDraw: boolean; onDraw: () => void;
  selected: readonly DominoSide[]; onPick: (side: DominoSide) => void;
}): ReactNode {
  const { t } = useI18nStore();
  const label = game.boneyardCount > 0 ? t('dominoes.boneyard', { n: String(game.boneyardCount) }) : t('dominoes.boneyardEmpty');
  return <div className={styles.centre}>
    <div className={styles.status}>
      <span className={styles.pill}>{t('dominoes.roundOf', { n: String(game.round) })}</span>
      <span className={styles.pill}>{t('dominoes.target', { n: String(game.options.targetScore) })}</span>
      {canDraw
        ? <button type="button" className={`${styles.pill} ${styles.drawPile}`} onClick={onDraw}
          aria-label={t('dominoes.drawPile')} title={t('dominoes.drawPile')}>{label}</button>
        : <span className={styles.pill}>{label}</span>}
    </div>
    <Line game={game} selected={selected} onPick={onPick} />
  </div>;
}

/** The player's tiles: one row while each keeps a full tap area, otherwise balanced rows. */
function Hand({ tiles, playable, chosen, opening, isMyTurn, canAct, onPick, children }: {
  tiles: readonly Tile[]; playable: readonly Tile[]; chosen: Tile | null; opening: Tile | null;
  isMyTurn: boolean; canAct: boolean; onPick: (tile: Tile) => void; children: ReactNode;
}): ReactNode {
  const { t } = useI18nStore();
  const { ref, width } = useBoxSize();
  const fit = fitHand(tiles.length, width);
  return <div className={styles.handArea} ref={ref}>
    <div className={`${styles.hand} ${fit.rows > 1 ? styles.wrapped : ''}`}
      style={{ '--per-row': fit.perRow, '--hit-w': `${fit.hit}px` } as CSSProperties}
      role="group" aria-label={t('dominoes.hand')}>
      {tiles.map((tile) => {
        const fits = playable.some((other) => dmSameTile(other, tile));
        const selectedTile = chosen !== null && dmSameTile(chosen, tile);
        const label = t('dominoes.tileLabel', { a: String(tile[0]), b: String(tile[1]) });
        const opens = opening !== null && dmSameTile(opening, tile);
        return <button key={`${tile[0]}-${tile[1]}`} type="button" className={styles.handTile}
          disabled={!canAct || !fits} aria-label={label} aria-pressed={selectedTile}
          title={isMyTurn && !fits ? t('dominoes.unplayable') : label} onClick={() => onPick(tile)}>
          <DominoTile left={tile[0]} right={tile[1]} vertical
            state={selectedTile ? 'selected' : opens ? 'opening' : isMyTurn && !fits ? 'dim' : fits && isMyTurn ? 'playable' : 'plain'} />
        </button>;
      })}
    </div>
    {children}
  </div>;
}

function Info({ game }: { game: DominoesVisibleState }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const recent = game.log.filter((entry) => entry.type === 'play' || entry.type === 'draw' || entry.type === 'pass')
    .slice(-RECENT_MOVES).reverse();
  return <aside className={infoStyles.rail}>
    <TurnBox text={game.phase !== 'playing' ? t('game.scoring')
      : isOwnTurn(game) ? t('dominoes.yourTurn') : t('dominoes.turnOf', { name: seatName(game.currentTurnSeat) })}>
      <p className={infoStyles.note}>
        {t('dominoes.roundOf', { n: String(game.round) })} · {t('dominoes.target', { n: String(game.options.targetScore) })}
      </p>
    </TurnBox>

    <section className={infoStyles.box}>
      <h2 className={infoStyles.caption}>{t('dominoes.scores')}</h2>
      <ol className={infoStyles.list}>{game.seats.map((seat) => (
        <li key={seat} className={infoStyles.row}>
          <span className={infoStyles.name}>{seatName(seat)}</span>
          <span className={styles.count}>{t('dominoes.tilesChip', { n: String(game.handCounts[seat]) })}</span>
          <span className={styles.total}>{game.scores[seat]}</span>
        </li>
      ))}</ol>
    </section>

    <section className={`${infoStyles.box} ${infoStyles.grow}`}>
      <h2 className={infoStyles.caption}>{t('dominoes.recent')}</h2>
      {recent.length === 0 ? <p className={infoStyles.note}>{t('dominoes.noMoves')}</p>
        : <ol className={infoStyles.list}>{recent.map((entry) => (
          <li key={`${entry.timestamp}-${entry.type}-${entry.type === 'play' ? entry.tile.join('') : entry.type}-${entry.seat}`}
            className={infoStyles.row}>
            <span className={infoStyles.name}>{seatName(entry.seat)}</span>
            {entry.type === 'play'
              ? <DominoTile left={entry.tile[0]} right={entry.tile[1]} className={styles.mini} />
              : <span className={styles.muted}>{t(entry.type === 'draw' ? 'dominoes.logDrew' : 'dominoes.logPassed')}</span>}
          </li>
        ))}</ol>}
    </section>
  </aside>;
}

function ResultOverlay({ result, pending, error, disabled, onBack }: {
  result: DominoesMatchResult; pending: boolean; error: string; disabled: boolean; onBack: () => void;
}): ReactNode {
  const { locale, t } = useI18nStore();
  const log = useGameStore((state) => state.dominoes?.log);
  const history = useResultRoundHistory(useGameStore((state) => state.visible));
  const seatName = useSeatName();
  const seats = result.seats;
  const played = (log ?? []).flatMap((entry) => (entry.type === 'roundEnd' ? [entry] : []));
  // A long match would make the table wider than the dialog; the round history below lists every round.
  const rounds = played.length <= MAX_ROUND_COLUMNS ? played : [];
  const ranked = [...seats].sort((a, b) => result.scores[b] - result.scores[a] || seats.indexOf(a) - seats.indexOf(b));
  const rankOf = (seat: GameSeat): number => 1 + seats.filter((other) => result.scores[other] > result.scores[seat]).length;
  return <ResultDialog history={history}
    title={result.winners.length === 1 ? t('dominoes.winner', { name: seatName(result.winners[0]) })
      : t('dominoes.tiedWinners', { names: joinNames(result.winners.map(seatName), locale) })}
    pending={pending} error={error} disabled={disabled} onBack={onBack}>
    <table className={`${resultStyles.table} ${styles.rankTable}`}>
      <thead><tr>
        <th>{t('dominoes.rank')}</th><th>{t('dominoes.player')}</th>
        {rounds.map((entry) => <th key={entry.round}>{t('dominoes.roundShort', { n: String(entry.round) })}</th>)}
        <th>{t('dominoes.total')}</th>
      </tr></thead>
      <tbody>{ranked.map((seat) => {
        const won = result.winners.includes(seat);
        return <tr key={seat} className={won ? resultStyles.winnerRow : ''}>
          <td>{t('dominoes.place', { n: String(rankOf(seat)) })}</td>
          <td>{won && <AppIcon name="trophy" />} {seatName(seat)}</td>
          {rounds.map((entry) => <td key={entry.round}>{entry.winner === seat ? entry.points : 0}</td>)}
          <td><strong>{result.scores[seat]}</strong></td>
        </tr>;
      })}</tbody>
    </table>
  </ResultDialog>;
}

/** Plays the placement sound for each tile that joins the line. */
function useTileSound(game: DominoesVisibleState | null): void {
  const plays = game?.log.filter((entry) => entry.type === 'play').length ?? 0;
  const previous = useRef<number | null>(null);
  useEffect(() => {
    if (previous.current !== null && plays > previous.current) playBoardSound('place');
    previous.current = plays;
  }, [plays]);
}

export function DominoesTable(): ReactNode {
  const { locked } = useGamePresentation();
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.dominoes));
  const { t } = useI18nStore();
  const seatName = useSeatName();
  /** A tile that fits both ends, waiting for its end */
  const [pendingTile, setPendingTile] = useState<Tile | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  useTileSound(game);

  if (!game) return null;

  const playing = game.phase === 'playing';
  const isMyTurn = playing && !locked && isOwnTurn(game);
  const canAct = isMyTurn && connectionReady && !actionPending;
  const options = dmTurnOptions(game.myHand, game.line, game.boneyardCount, game.openingTile);
  const playable = options.plays.map((play) => play.tile);
  const chosen = canAct && pendingTile && game.myHand.some((tile) => dmSameTile(tile, pendingTile)) ? pendingTile : null;
  const chosenSides = chosen ? options.plays.filter((play) => dmSameTile(play.tile, chosen)).flatMap((play) => play.side ?? []) : [];
  const canDraw = canAct && options.canDraw;
  const canPass = canAct && options.canPass;

  const handleActionResult: ActionCallback = (timeout, response) => {
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  };

  const send = (action: DominoesAction): void => {
    if (!canAct) return;
    setActionError('');
    setActionPending(true);
    setPendingTile(null);
    socket.timeout(10000).emit('game:action', { gameType: 'dominoes', action }, handleActionResult);
  };

  const onTileClick = (tile: Tile): void => {
    const plays = options.plays.filter((play) => dmSameTile(play.tile, tile));
    if (plays.length === 0) return;
    if (plays.length === 1) send({ type: 'play', tile, ...(plays[0].side ? { side: plays[0].side } : {}) });
    else setPendingTile(chosen && dmSameTile(chosen, tile) ? null : tile);
  };

  const onEndPick = (side: DominoSide): void => {
    if (chosen) send({ type: 'play', tile: chosen, side });
  };

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const opening = game.line.length === 0 ? game.openingTile : null;
  const prompt = !playing ? null
    : !isMyTurn ? t('dominoes.turnOf', { name: seatName(game.currentTurnSeat) })
      : chosen ? t('dominoes.pickEnd')
        : opening ? t('dominoes.mustOpen')
          : options.canDraw ? t('dominoes.mustDraw')
            : options.canPass ? t('dominoes.mustPass') : t('dominoes.pickTile');

  const sorted = dmSortHand(game.myHand);
  const actions = isMyTurn && (options.canDraw || options.canPass || chosen) && <HandActions className={styles.controls} layout="corner">
    {chosen && <button type="button" className={`btn btn-outline ${styles.ctrl}`} onClick={() => setPendingTile(null)}>
      {t('dominoes.cancel')}</button>}
    {options.canDraw && <button type="button" className={`btn btn-primary ${styles.ctrl}`}
      disabled={!canDraw} onClick={() => send({ type: 'draw' })}>{t('dominoes.draw')}</button>}
    {options.canPass && <button type="button" className={`btn btn-primary ${styles.ctrl}`}
      disabled={!canPass} onClick={() => send({ type: 'pass' })}>{t('dominoes.pass')}</button>}
  </HandActions>;

  const handZone = <Hand tiles={sorted} playable={playable} chosen={chosen} opening={opening} isMyTurn={isMyTurn}
    canAct={canAct} onPick={onTileClick}>{actions}</Hand>;

  return (
    <GameShell
      info={<Info game={game} />}
      centre={<Centre game={game} canDraw={canDraw} onDraw={() => send({ type: 'draw' })}
        selected={chosenSides} onPick={onEndPick} />}
      hand={handZone}
      prompt={prompt}
      overlay={game.phase === 'scoring' && game.result && <ResultOverlay result={game.result}
        pending={actionPending} error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
      error={game.phase !== 'scoring' ? actionError : undefined}
    />
  );
}
