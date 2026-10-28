// ─── HoldemTable: board and pots, every seat's stake, hole cards, betting controls, info rail, result ───

import { useState } from 'react';
import type { ReactNode } from 'react';
import { HE_HANDS } from '@shared/rules/holdem';
import type { HoldemAction, HoldemLogEntry, HoldemVisibleState, GameSeat } from '@shared/types';
import { tablePosition, usesCornerSlots } from '../../game-view';
import type { TablePosition } from '../../game-view';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { ChipIcon } from '../ChipIcon';
import { GameShell } from '../GameShell';
import { useViewedGame } from '../use-table-perspective';
import { infoStyles, TurnBox } from '../TableInfo';
import { useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useGamePresentation } from '../use-game-presentation';
import { BetStack, Board, ChipAmount, HeCards, SeatMarkers, cardName } from './HoldemCards';
import {
  HE_SEATS, chipsAdded, holdemBlindSeats, holdemCategory, holdemControls, holdemTableAt, holdemView,
  potTotal, recentHoldemMoves, seatState, shownAward, shownHoleCards, streetActions,
} from './holdem-view';
import type { HoldemBlindSeats, HoldemTableView, SeatAction } from './holdem-view';
import { BettingControls } from './HoldemControls';
import { MatchResultOverlay, PotList } from './HoldemShared';
import { AppIcon } from '../../components/AppIcon';
import styles from './HoldemTable.module.css';
import { isOwnTurn, isSpectator } from '../observer-view';
import { useGodViewStore } from '../../stores/god-view-store';

const RECENT_MOVES = 12;

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

/** One seat's corner of the felt: hole cards (opponents), last action, street stake, and winnings. */
function SeatSpot({ seat, view, position, isMe, action, blinds }: {
  seat: GameSeat; view: HoldemTableView; position: TablePosition; isMe: boolean; action: SeatAction | undefined;
  blinds: HoldemBlindSeats | null;
}): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const state = seatState(view, seat);
  const observed = useGodViewStore((store) => store.hands?.[seat]);
  // Busted seats are marked on their plate and have nothing on the felt.
  if (state === 'waiting' || state === 'out') return null;
  const revealed = view.revealed[seat];
  const category = holdemCategory(revealed, view.board);
  const won = view.award?.payouts[seat] ?? 0;
  const bet = view.streetBets[seat];
  const classes = [styles.spot, styles[position], state === 'folded' && styles.folded, won > 0 && styles.winner];
  return <section className={classes.filter(Boolean).join(' ')} aria-label={seatName(seat)}>
    <header className={styles.spotHeader}>
      <span className={styles.spotMarkers}><SeatMarkers seat={seat} blinds={blinds} /></span>
      {!isMe && <span className={styles.spotName}>{seatName(seat)}</span>}
      {/* Folded seats are dimmed instead of labelled. */}
      {state === 'allIn' ? <span className={`${styles.tag} ${styles.allInTag}`}>{t('holdem.allIn')}</span>
        : state !== 'folded' && action && <span className={styles.tag}>{t(`holdem.tag.${action}`)}</span>}
    </header>
    {!isMe && (revealed.length > 0
      ? <HeCards cards={revealed} size="sm" overlap label={seatName(seat)} />
      : observed?.length ? <HeCards cards={observed} size="xs" overlap peek label={seatName(seat)} />
        : <span className={styles.spotBacks}><HeCards cards={[]} backs={2} size="xs" overlap /></span>)}
    {category && <span className={styles.category}>{t(`holdem.category.${category}`)}</span>}
    {won > 0 && <strong className={styles.won}><AppIcon name="trophy" /> {t('holdem.wonAmount', { n: String(won) })}</strong>}
    {bet > 0 && <span className={styles.spotBet}><BetStack amount={bet} title={t('holdem.betTitle', { n: String(bet) })} /></span>}
  </section>;
}

function Centre({ game, view }: { game: HoldemVisibleState; view: HoldemTableView }): ReactNode {
  const blinds = holdemBlindSeats(view);
  const actions = streetActions(game.log, view.logEnd);
  return <div className={[styles.centre, usesCornerSlots(game.seats) && styles.expandedCentre].filter(Boolean).join(' ')}>
    {game.seats.map((seat) => <SeatSpot key={seat} seat={seat} view={view} position={tablePosition(seat, game.mySeat, game.seats)}
      isMe={seat === game.mySeat} action={actions[seat]} blinds={blinds} />)}
    <div className={styles.middle}>
      <Board cards={view.board} size="md" />
      {view.hand > 0 && <PotList view={view} />}
    </div>
  </div>;
}

function MoveLine({ log, seats, index }: {
  log: readonly HoldemLogEntry[]; seats: readonly GameSeat[]; index: number;
}): ReactNode {
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
    const { board } = holdemTableAt(log, seats, index);
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
  const award = shownAward(log, seats, index + 1);
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
      : isOwnTurn(game) ? t('holdem.yourTurn')
        : t('holdem.turnOf', { name: seatName(game.currentTurnSeat) });
  return <aside className={infoStyles.rail}>
    <TurnBox text={text}>
      {view.hand > 0 && <p className={infoStyles.note}>
        {t('holdem.handOf', { n: String(view.hand), total: String(HE_HANDS) })} ·
        {' '}{t('holdem.blinds', { sb: String(view.smallBlind), bb: String(view.bigBlind) })}
      </p>}
      <p className={infoStyles.note}>
        {t('holdem.pot')} <ChipAmount amount={potTotal(view)} />
        {!isSpectator(game) && <> · {t('holdem.myChips', { n: String(view.chips[me]) })}</>}
      </p>
    </TurnBox>

    <section className={infoStyles.box}>
      <h2 className={infoStyles.caption}>{t('holdem.players')}</h2>
      <ul className={infoStyles.list}>{game.seats.map((seat) => {
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
            <MoveLine log={game.log} seats={game.seats} index={index} />
          </li>;
        })}</ol>}
    </section>
  </aside>;
}

export function HoldemTable(): ReactNode {
  const { locked, frame } = useGamePresentation();
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.holdem));
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
  const hole = isSpectator(game)
    ? { cards: view.dealt.includes(me) ? game.myHand : [], hidden: false }
    : shownHoleCards(game, view, held);
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
    socket.timeout(10000).emit('game:action', { gameType: 'holdem', action }, handleActionResult);
  };

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const prompt = game.phase !== 'playing' || locked ? null
    // The shell already announces my turn; only the amount owed is added here.
    : isOwnTurn(game) ? owed > 0 ? t('holdem.toCall', { n: String(owed) }) : null
      : t('holdem.turnOf', { name: seatName(game.currentTurnSeat) });

  const stateNote = myState === 'out' ? t('holdem.youOut') : myState === 'folded' ? t('holdem.youFolded')
    : myState === 'allIn' ? t('holdem.youAllIn') : myState === 'waiting' ? t('holdem.waitingDeal') : null;

  const handZone = <div className={styles.handArea}>
    {(hole.cards.length > 0 || hole.hidden) && <div className={`${styles.myHand} ${myState === 'folded' ? styles.folded : ''}`}>
      <HeCards cards={hole.cards} backs={hole.hidden ? 2 : 0} size="lg" label={t('holdem.hole')} sortable={!isSpectator(game)} />
      <div className={styles.myMeta}>
        {view.streetBets[me] > 0 && <span className={styles.myBet}>
          <BetStack amount={view.streetBets[me]} title={t('holdem.betTitle', { n: String(view.streetBets[me]) })} /></span>}
        {category && <span className={styles.bestHand}>{t('holdem.bestHand', { category: t(`holdem.category.${category}`) })}</span>}
        {won > 0 && <strong className={styles.won}><AppIcon name="trophy" /> {t('holdem.wonAmount', { n: String(won) })}</strong>}
      </div>
    </div>}
    {game.phase === 'playing' && !isSpectator(game) && myState === 'active'
      && <BettingControls key={game.log.length} table={game} seat={me} options={options} enabled={myTurn} onAction={sendAction} />}
  </div>;
  const handPrompt = game.phase !== 'playing' ? null
    : isSpectator(game) || myState === 'active' ? prompt : stateNote;

  return (
    <GameShell
      info={<Info game={game} view={view} locked={locked} />}
      centre={<Centre game={game} view={view} />}
      hand={handZone}
      prompt={handPrompt}
      overlay={game.phase === 'scoring' && game.result && <MatchResultOverlay result={game.result}
        pending={actionPending} error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
      error={game.phase !== 'scoring' ? actionError : undefined}
    />
  );
}
