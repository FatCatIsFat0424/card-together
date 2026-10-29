// ─── BattleshipTable: fleet placement on the own sea, then shots at the enemy sea beside it ───

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { BattleshipVisibleState, GameSeat } from '@shared/types';
import { battleshipBoard } from '@shared/rules/board/boards';
import type { NodeId } from '@shared/rules/board/board-model';
import { battleshipDefinition } from '@shared/games/battleship/definition';
import { BS_SHIPS, BS_SHIP_LENGTH, bsCell, bsCellLabel, bsNode, bsRandomFleet } from '@shared/rules/battleship';
import type { BsPlacement, BsPlacementProblem } from '@shared/rules/battleship';
import { Button } from '../../components/Button';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import type { TranslationKey } from '../../i18n';
import { GameShell } from '../GameShell';
import { isSpectator } from '../observer-view';
import { useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useTablePerspective, useViewedGame } from '../use-table-perspective';
import { BoardResultDialog } from '../board/BoardResultDialog';
import { BoardView } from '../board/BoardView';
import type { BoardPieceItem } from '../board/BoardView';
import { boardControls } from '../board/BoardControls';
import { BoardInfo, boardMoveEntries } from '../board/BoardMoves';
import { BoardTable } from '../board/BoardTable';
import { useBoardInput } from '../board/use-board-input';
import { useDeadlinePassed } from '../board/use-deadline-passed';
import { boardAspect } from '../board/board-view';
import { HitMarker, LastShotMarker, MissMarker, ShipPiece } from './BattleshipPieces';
import {
  EMPTY_DRAFT, battleshipOpponent, draftFleet, draftGrid, fireTargets, nextUnplaced, placeDraftShip, seaView,
  shipsAfloat, shotText,
} from './battleship-view';
import type { DraftFleet } from './battleship-view';
import styles from './BattleshipTable.module.css';

const BOARD = battleshipBoard();
const FILES = Array.from({ length: 10 }, (_, index) => String.fromCharCode(65 + index));
const RANKS = Array.from({ length: 10 }, (_, index) => String(index + 1));
/** One labelled sea is square. */
const SEA_ASPECT = boardAspect(BOARD, 0, true);
/** Width of the side column (fleet dock or small sea) as a share of the main sea's height. */
const SIDE = 0.42;
/** Gap between two full seas, as a share of a sea's height. */
const GAP = 0.04;
const COMPACT_ASPECT = SEA_ASPECT + SIDE;
const WIDE_ASPECT = 2 * SEA_ASPECT + GAP;
const LANDSCAPE_QUERY = '(max-height: 500px) and (min-width: 600px)';

const PROBLEM: Record<BsPlacementProblem, TranslationKey> = {
  outside: 'battleship.outside', overlap: 'battleship.overlap', touching: 'battleship.touching',
};

type BattleshipWireAction =
  | { type: 'place-fleet'; fleet: BsPlacement[] }
  | { type: 'fire'; to: string }
  | { type: 'resign' }
  | { type: 'offer-draw' }
  | { type: 'answer-draw'; accept: boolean };

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

interface Draft {
  readonly fleet: DraftFleet;
  /** Ship being placed or moved, by index in `BS_SHIPS` */
  readonly selected: number | null;
  /** Orientation the next placement uses */
  readonly vertical: boolean;
}

const START_DRAFT: Draft = { fleet: EMPTY_DRAFT, selected: 0, vertical: false };

export function BattleshipTable(): ReactNode {
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.battleship));
  const bottomSeat = useTablePerspective();
  const { t, locale } = useI18nStore();
  const seatName = useSeatName();
  const compact = useMediaQuery(LANDSCAPE_QUERY);
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const [draft, setDraft] = useState<Draft>(START_DRAFT);
  // Phones show one sea large and the other small; this puts the viewer's own sea in the large spot.
  const [ownLarge, setOwnLarge] = useState(false);

  const handleActionResult: ActionCallback = useCallback((timeout, response) => {
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  }, [t]);

  const send = useCallback((action: BattleshipWireAction): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:action', { gameType: 'battleship', action }, handleActionResult);
  }, [handleActionResult]);

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const mySeat: GameSeat | null = game && !isSpectator(game) && game.seats.includes(game.mySeat) ? game.mySeat : null;
  const placing = game?.phase === 'placing';
  const deadlinePassed = useDeadlinePassed(placing ? game.placeDeadline : null);
  const owesFleet = Boolean(placing && mySeat !== null && !game.placed.includes(mySeat));
  const canPlace = owesFleet && !deadlinePassed && connectionReady && !actionPending;
  const targets = useMemo(() => (game ? fireTargets(game, mySeat) : []), [game, mySeat]);
  const canFire = targets.length > 0 && connectionReady && !actionPending;
  const input = useBoardInput({ movable: [], targets: (from) => (from === null ? targets : []) }, canFire,
    (choice) => send({ type: 'fire', to: choice.to }));

  if (!game) return null;

  const playing = game.phase === 'playing';
  const viewer = mySeat ?? bottomSeat;
  const enemy = battleshipOpponent(game, viewer) ?? game.seats[1];
  const shipName = (index: number): string => t(`battleship.ship.${BS_SHIPS[index]}`);
  const cellName = (node: NodeId): string => bsCellLabel(bsCell(node) ?? 0);
  const seaLabel = (owner: GameSeat): string => (mySeat === null ? t('battleship.seaOf', { name: seatName(owner) })
    : t(owner === mySeat ? 'battleship.ownSea' : 'battleship.targetSea'));

  const seaPieces = (owner: GameSeat): BoardPieceItem[] => {
    const sea = seaView(game, owner);
    return [
      ...sea.ships.map((ship) => ({
        node: bsNode(ship.placement.cell), key: `ship-${ship.ship}`,
        piece: <ShipPiece ship={ship.ship} vertical={ship.placement.vertical} sunk={ship.sunk} />,
        label: t(`battleship.ship.${ship.ship}`),
      })),
      ...sea.shots.map((shot) => ({
        node: bsNode(shot.cell), key: `shot-${shot.cell}`,
        piece: shot.result === 'miss' ? <MissMarker /> : <HitMarker />,
        label: t(shot.result === 'miss' ? 'battleship.cellMiss' : 'battleship.cellHit'),
      })),
      ...sea.last === null ? [] : [{ node: bsNode(sea.last), key: 'last-shot', piece: <LastShotMarker /> }],
    ];
  };

  const draftPieces: BoardPieceItem[] = draft.fleet.flatMap((placement, index) => (placement ? [{
    node: bsNode(placement.cell), key: `ship-${BS_SHIPS[index]}`,
    piece: <ShipPiece ship={BS_SHIPS[index]} vertical={placement.vertical} selected={draft.selected === index} />,
    label: shipName(index),
  }] : []));

  const placeShip = (index: number, placement: BsPlacement): void => {
    const next = placeDraftShip(draft.fleet, index, placement, game.options);
    if (typeof next === 'string') {
      setActionError(t(PROBLEM[next]));
      return;
    }
    setActionError('');
    setDraft({ fleet: next, selected: nextUnplaced(next, index), vertical: placement.vertical });
  };

  // A tap on a ship picks it up (a second tap turns it); a tap on open water puts the chosen ship's bow there.
  const tapDraft = (node: NodeId | null): void => {
    const cell = node === null ? null : bsCell(node);
    if (!canPlace || cell === null) return;
    const at = draftGrid(draft.fleet)[cell];
    if (at >= 0 && at === draft.selected) {
      const placement = draft.fleet[at]!;
      placeShip(at, { cell: placement.cell, vertical: !placement.vertical });
    } else if (at >= 0) {
      setActionError('');
      setDraft({ ...draft, selected: at, vertical: draft.fleet[at]!.vertical });
    } else if (draft.selected !== null) {
      placeShip(draft.selected, { cell, vertical: draft.vertical });
    }
  };

  const rotate = (): void => {
    const placed = draft.selected === null ? null : draft.fleet[draft.selected];
    if (draft.selected !== null && placed) placeShip(draft.selected, { cell: placed.cell, vertical: !placed.vertical });
    else setDraft({ ...draft, vertical: !draft.vertical });
  };

  const seaBoard = (owner: GameSeat, options: { readonly aim?: boolean; readonly mini?: boolean } = {}): ReactNode => {
    const aim = Boolean(options.aim);
    const pending = aim ? input.pending : null;
    return <BoardView board={BOARD} surface="wood" label={seaLabel(owner)} pieces={seaPieces(owner)} moveEffects={false}
      fileLabels={options.mini ? undefined : FILES} rankLabels={options.mini ? undefined : RANKS} nodeName={cellName}
      selectable={aim && canFire ? targets : []} pending={pending ? { to: pending.to } : null}
      onNodeClick={aim && canFire ? input.tap : undefined} />;
  };

  const caption = (owner: GameSeat): ReactNode => <span className={styles.caption}>
    {seaLabel(owner)}<span className={styles.afloat}>{t('battleship.shipsLeft', { n: String(shipsAfloat(game, owner)) })}</span>
  </span>;

  const myShot = playing && game.currentTurnSeat === mySeat;
  let seas: ReactNode;
  if (owesFleet) {
    const placedAll = draftFleet(draft.fleet, game.options) !== null;
    seas = <div className={styles.compact}>
      <div className={styles.main}>
        <BoardView board={BOARD} surface="wood" label={t('battleship.placeTitle')} pieces={draftPieces}
          fileLabels={FILES} rankLabels={RANKS} nodeName={cellName}
          selectable={canPlace ? BOARD.nodes.map((entry) => entry.id) : []} onNodeClick={canPlace ? tapDraft : undefined} />
      </div>
      <div className={styles.side} role="group" aria-label={t('battleship.fleet')}>
        {BS_SHIPS.map((ship, index) => <button key={ship} type="button" disabled={!canPlace}
          className={`${styles.dockShip} ${draft.selected === index ? styles.dockSelected : ''} ${draft.fleet[index] ? styles.dockPlaced : ''}`}
          aria-pressed={draft.selected === index}
          onClick={() => setDraft({ ...draft, selected: index, vertical: draft.fleet[index]?.vertical ?? draft.vertical })}>
          <span className={styles.dockName}>{shipName(index)}</span>
          <span className={styles.dockCells} aria-label={t('battleship.shipCells', { n: String(BS_SHIP_LENGTH[ship]) })}>
            {Array.from({ length: BS_SHIP_LENGTH[ship] }, (_, part) => <i key={part} />)}
          </span>
        </button>)}
        {placedAll && <p className={styles.dockReady}>{t('battleship.placeReady')}</p>}
      </div>
    </div>;
  } else if (compact) {
    const large = ownLarge ? viewer : enemy;
    const small = ownLarge ? enemy : viewer;
    seas = <div className={styles.compact}>
      <div className={`${styles.main} ${myShot && large === enemy ? styles.aim : ''}`}>
        {caption(large)}
        {seaBoard(large, { aim: large === enemy })}
      </div>
      <div className={styles.side}>
        {caption(small)}
        <button type="button" className={`${styles.mini} ${myShot && small === enemy ? styles.aim : ''}`}
          aria-label={t('battleship.switchSea')} onClick={() => setOwnLarge(!ownLarge)}>
          {seaBoard(small, { mini: true })}
        </button>
      </div>
    </div>;
  } else {
    seas = <div className={styles.wide}>
      <div className={`${styles.sea} ${myShot ? styles.aim : ''}`}>{caption(enemy)}{seaBoard(enemy, { aim: true })}</div>
      <div className={styles.sea}>{caption(viewer)}{seaBoard(viewer)}</div>
    </div>;
  }

  const seatStats = (seat: GameSeat): ReactNode => <span className={styles.stats}>
    {placing ? (game.placed.includes(seat) ? t('battleship.placed') : null)
      : t('battleship.shipsLeft', { n: String(shipsAfloat(game, seat)) })}
  </span>;

  const moves = {
    entries: boardMoveEntries(game.log, (move) => shotText(move, t), locale, t),
    columns: game.seats,
    heads: game.seats.map((seat) => seatName(seat)),
  };

  // Placement has no turn, and the phone column needs the room for the placement tools.
  const controls = playing ? boardControls(
    battleshipDefinition.matchControls, game.drawOffer, mySeat,
    { seats: game.seats, turnSeat: game.currentTurnSeat }, (action) => send(action),
  ) : null;

  const fleet = draftFleet(draft.fleet, game.options);
  const tools = owesFleet ? <div className={styles.tools} role="group" aria-label={t('battleship.placeTitle')}>
    <div className={styles.toolRow}>
      <Button className={styles.tool} disabled={!canPlace} onClick={rotate}>{t('battleship.rotate')}</Button>
      <Button className={styles.tool} disabled={!canPlace} onClick={() => {
        setActionError('');
        setDraft({ fleet: bsRandomFleet(Math.random, game.options), selected: null, vertical: draft.vertical });
      }}>{t('battleship.random')}</Button>
      <Button className={styles.tool} disabled={!canPlace} onClick={() => {
        setActionError('');
        setDraft(START_DRAFT);
      }}>{t('battleship.clear')}</Button>
    </div>
    <Button variant="primary" className={styles.submit} disabled={!canPlace || fleet === null}
      onClick={() => fleet && send({ type: 'place-fleet', fleet: fleet.map((ship) => ({ ...ship })) })}>
      {t('battleship.confirmFleet')}</Button>
  </div> : null;

  const status = placing ? placingStatus(game, mySeat, owesFleet, t) : playing ? lastShotStatus(game, mySeat, t, seatName) : undefined;
  const pendingCell = input.pending ? cellName(input.pending.to) : null;

  return (
    <GameShell
      info={<BoardInfo data={moves} />}
      centre={null}
      hand={null}
      turnReady={owesFleet ? canPlace : undefined}
      board={<BoardTable
        seats={game.seats} bottomSeat={bottomSeat} board={seas}
        aspect={owesFleet || compact ? COMPACT_ASPECT : WIDE_ASPECT} moves={moves} seatStats={seatStats}
        controls={controls}
        pending={pendingCell ? { text: pendingCell, confirm: input.confirm, cancel: input.cancel } : null}
        tools={tools}
        status={status}
        error={game.phase !== 'scoring' ? actionError : undefined}
        busy={actionPending || !connectionReady}
        ownTurn={owesFleet ? canPlace : undefined} />}
      overlay={game.phase === 'scoring' && game.result && <BoardResultDialog
        outcome={game.result} viewer={mySeat} moves={game.log.length} pending={actionPending}
        error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
    />
  );
}

type Translate = ReturnType<typeof useI18nStore.getState>['t'];

function placingStatus(game: BattleshipVisibleState, mySeat: GameSeat | null, owesFleet: boolean, t: Translate): string | undefined {
  if (mySeat === null) return undefined;
  if (!owesFleet) return t('battleship.waitingPlace');
  const opponent = battleshipOpponent(game, mySeat);
  return `${t('battleship.placeHint')} ${t(opponent && game.placed.includes(opponent)
    ? 'battleship.opponentReady' : 'battleship.opponentPlacing')}`;
}

/** The newest shot read out, and a reminder when a hit earns the viewer another shot. */
function lastShotStatus(
  game: BattleshipVisibleState, mySeat: GameSeat | null, t: Translate, seatName: (seat: GameSeat) => string,
): string | undefined {
  const last = game.log.at(-1);
  if (!last) return mySeat !== null && game.autoPlaced.includes(mySeat) ? t('battleship.autoPlaced') : undefined;
  const cell = bsCellLabel(bsCell(last.to) ?? 0);
  const line = last.ship ? t('battleship.lastSunk', { cell, ship: t(`battleship.ship.${last.ship}`) })
    : t(last.result === 'hit' ? 'battleship.lastHit' : 'battleship.lastMiss', { cell });
  const again = last.result !== 'miss' && game.currentTurnSeat === last.seat;
  if (last.seat !== mySeat) return t('battleship.byShooter', { name: seatName(last.seat), line });
  return again ? `${line} ${t('battleship.again')}` : line;
}
