// ─── StudTable: pot, every seat's up cards and stake, own cards, betting controls, info rail, result ───

import { useState } from 'react';
import type { ReactNode } from 'react';
import { STUD_HANDS } from '@shared/rules/stud';
import type { GameSeat, StudAction, StudLogEntry, StudVisibleState } from '@shared/types';
import { tablePosition, usesCornerSlots } from '../../game-view';
import type { TablePosition } from '../../game-view';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useGodViewStore } from '../../stores/god-view-store';
import { useI18nStore } from '../../stores/i18n-store';
import { AppIcon } from '../../components/AppIcon';
import { ChipIcon } from '../ChipIcon';
import { GameShell } from '../GameShell';
import { infoStyles, TurnBox } from '../TableInfo';
import { isOwnTurn, isSpectator } from '../observer-view';
import { useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useGamePresentation } from '../use-game-presentation';
import { useViewedGame } from '../use-table-perspective';
import { BetStack, ChipAmount, HeCards, cardName } from '../holdem/HoldemCards';
import { BettingControls } from '../holdem/HoldemControls';
import { MatchResultOverlay, PotList } from '../holdem/HoldemShared';
import {
  HE_SEATS, holdemControls, potTotal, seatState, shownHoleCards, streetActions,
} from '../holdem/holdem-view';
import type { SeatAction } from '../holdem/holdem-view';
import holdemStyles from '../holdem/HoldemTable.module.css';
import { recentStudMoves, studCategory, studChipsAdded, studShownAward, studTableAt, studView } from './stud-view';
import type { StudShownTable } from './stud-view';
import styles from './StudTable.module.css';

const RECENT_MOVES = 12;

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

/** A seat's cards in deal order: the hole card (face down until shown) then the face-up cards. */
function StudCards({ hole, up, size, label, overlap = true }: {
  hole: { readonly cards: StudShownTable['up'][GameSeat]; readonly kind: 'back' | 'open' | 'peek' | 'none' };
  up: StudShownTable['up'][GameSeat]; size: 'xs' | 'sm' | 'lg'; label: string; overlap?: boolean;
}): ReactNode {
  const { t } = useI18nStore();
  return <span className={styles.cards} role="group" aria-label={label}>
    {hole.kind === 'back' && <HeCards cards={[]} backs={1} size={size} overlap={overlap} />}
    {(hole.kind === 'open' || hole.kind === 'peek') && hole.cards.length > 0
      && <HeCards cards={hole.cards} size={size} peek={hole.kind === 'peek'} label={t('stud.hole')} />}
    <HeCards cards={up} size={size} overlap={overlap} freshFrom={up.length > 0 ? up.length - 1 : undefined} />
  </span>;
}

/** One seat's corner of the felt: its cards (opponents), last action, street stake, and winnings. */
function SeatSpot({ seat, view, position, isMe, action }: {
  seat: GameSeat; view: StudShownTable; position: TablePosition; isMe: boolean; action: SeatAction | undefined;
}): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const state = seatState(view, seat);
  const observed = useGodViewStore((store) => store.hands?.[seat]);
  // Busted seats are marked on their plate and have nothing on the felt.
  if (state === 'waiting' || state === 'out') return null;
  const revealed = view.revealed[seat];
  const up = view.up[seat];
  const category = studCategory(revealed, up);
  const won = view.award?.payouts[seat] ?? 0;
  const bet = view.streetBets[seat];
  const classes = [holdemStyles.spot, holdemStyles[position], styles.spot, state === 'folded' && holdemStyles.folded,
    won > 0 && holdemStyles.winner];
  const hole = revealed.length > 0 ? { cards: revealed, kind: 'open' as const }
    : observed?.length ? { cards: observed, kind: 'peek' as const } : { cards: [], kind: 'back' as const };
  return <section className={classes.filter(Boolean).join(' ')} aria-label={seatName(seat)}>
    <header className={holdemStyles.spotHeader}>
      {!isMe && <span className={holdemStyles.spotName}>{seatName(seat)}</span>}
      {/* Folded seats are dimmed instead of labelled. */}
      {state === 'allIn' ? <span className={`${holdemStyles.tag} ${holdemStyles.allInTag}`}>{t('holdem.allIn')}</span>
        : state !== 'folded' && action && <span className={holdemStyles.tag}>{t(`holdem.tag.${action}`)}</span>}
    </header>
    {!isMe && <span className={styles.spotCards}>
      <StudCards hole={hole} up={up} size="sm" label={seatName(seat)} />
    </span>}
    {category && <span className={holdemStyles.category}>{t(`holdem.category.${category}`)}</span>}
    {won > 0 && <strong className={holdemStyles.won}><AppIcon name="trophy" /> {t('holdem.wonAmount', { n: String(won) })}</strong>}
    {bet > 0 && <span className={holdemStyles.spotBet}><BetStack amount={bet} title={t('holdem.betTitle', { n: String(bet) })} /></span>}
  </section>;
}

function Centre({ game, view }: { game: StudVisibleState; view: StudShownTable }): ReactNode {
  const actions = streetActions(game.log, view.logEnd);
  return <div className={[holdemStyles.centre, usesCornerSlots(game.seats) && holdemStyles.expandedCentre].filter(Boolean).join(' ')}>
    {game.seats.map((seat) => <SeatSpot key={seat} seat={seat} view={view} position={tablePosition(seat, game.mySeat, game.seats)}
      isMe={seat === game.mySeat} action={actions[seat]} />)}
    <div className={holdemStyles.middle}>
      {view.hand > 0 && <PotList view={view} />}
    </div>
  </div>;
}

function MoveLine({ log, seats, index }: {
  log: readonly StudLogEntry[]; seats: readonly GameSeat[]; index: number;
}): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const entry = log[index];
  if (entry.type === 'hand') {
    return <div className={holdemStyles.moveBlock}>
      <span className={holdemStyles.handTitle}>{t('holdem.logHand', { n: String(entry.hand) })}</span>
      <span className={holdemStyles.moveDetail}>
        <span>{t('stud.stakes', { ante: String(entry.ante), bet: String(entry.minBet) })}</span>
      </span>
    </div>;
  }
  if (entry.type === 'action') {
    const kind = entry.allIn ? 'allIn' : entry.action;
    const amount = kind === 'call' ? studChipsAdded(log, index) : entry.to;
    return <>
      <span className={infoStyles.name}>{seatName(entry.seat)}</span>
      <span className={kind === 'allIn' ? holdemStyles.allInText : undefined}>{t(`holdem.log.${kind}`, { n: String(amount) })}</span>
    </>;
  }
  if (entry.type === 'street') {
    return <div className={holdemStyles.moveBlock}>
      <span className={holdemStyles.handTitle}>{t(`stud.street.${entry.street}`)}</span>
      <span className={holdemStyles.moveDetail}>{HE_SEATS.filter((seat) => entry.cards[seat].length > 0).map((seat) => <span key={seat}>
        {seatName(seat)} <span className={holdemStyles.cardText}>{entry.cards[seat].map(cardName).join(' ')}</span>
      </span>)}</span>
    </div>;
  }
  if (entry.type === 'showdown') {
    const { up } = studTableAt(log, seats, index);
    return <div className={holdemStyles.moveBlock}>
      <span className={holdemStyles.handTitle}>{t('holdem.log.showdown')}</span>
      <span className={holdemStyles.moveDetail}>{HE_SEATS.filter((seat) => entry.cards[seat].length > 0).map((seat) => {
        const category = studCategory(entry.cards[seat], up[seat]);
        return <span key={seat}>
          {seatName(seat)} <span className={holdemStyles.cardText}>{entry.cards[seat].map(cardName).join(' ')}</span>
          {category && <> · {t(`holdem.category.${category}`)}</>}
        </span>;
      })}</span>
    </div>;
  }
  const award = studShownAward(log, seats, index + 1);
  return <div className={holdemStyles.moveBlock}>
    {award && HE_SEATS.filter((seat) => award.payouts[seat] > 0).map((seat) => <span key={seat}>
      <span className={infoStyles.name}>{seatName(seat)}</span> {t('holdem.log.wins', { n: String(award.payouts[seat]) })}
    </span>)}
    {entry.eliminated.map((seat) => <span key={seat} className={holdemStyles.loss}>
      {seatName(seat)} {t('holdem.log.eliminated')}
    </span>)}
  </div>;
}

function Info({ game, view, locked }: { game: StudVisibleState; view: StudShownTable; locked: boolean }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const me = game.mySeat;
  const recentEnd = view.logEnd;
  const recent = recentStudMoves(game.log, recentEnd, RECENT_MOVES);
  const text = game.phase === 'scoring' ? t('game.scoring')
    : locked ? t('game.playing')
      : isOwnTurn(game) ? t('holdem.yourTurn')
        : t('holdem.turnOf', { name: seatName(game.currentTurnSeat) });
  return <aside className={infoStyles.rail}>
    <TurnBox text={text}>
      {view.hand > 0 && <p className={infoStyles.note}>
        {t('holdem.handOf', { n: String(view.hand), total: String(STUD_HANDS) })} ·
        {' '}{t('stud.stakes', { ante: String(view.ante), bet: String(view.minBet) })}
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
        return <li key={seat} className={`${infoStyles.row} ${state === 'out' || state === 'folded' ? holdemStyles.dimRow : ''}`}>
          <span className={`${infoStyles.name} ${holdemStyles.infoName}`} title={state === 'folded' ? t('holdem.folded') : undefined}>
            {seatName(seat)}
          </span>
          {/* Folded rows are dimmed instead of labelled so the chip count keeps its room. */}
          {(state === 'out' || state === 'allIn') && <span className={`${infoStyles.note} ${holdemStyles.stateNote}`}>
            {t(state === 'out' ? 'holdem.out' : 'holdem.allIn')}
          </span>}
          <strong className={holdemStyles.infoChips}><ChipIcon />{view.chips[seat]}</strong>
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

export function StudTable(): ReactNode {
  const { locked, frame } = useGamePresentation();
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.stud));
  const held = useGameStore((state) => state.studHeld);
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  // An acknowledgement can arrive before the updated state; stay locked until the log grows.
  const [sentAt, setSentAt] = useState<number | null>(null);

  if (!game) return null;

  const view = studView(game, frame);
  const me = game.mySeat;
  const awaiting = sentAt !== null && sentAt === game.log.length;
  const ready = !locked && connectionReady && !actionPending && !awaiting;
  const options = holdemControls(game, true);
  const myTurn = options !== null && ready;
  const myState = seatState(view, me);
  const hole = isSpectator(game)
    ? { cards: view.dealt.includes(me) ? game.myHand : [], hidden: false }
    : shownHoleCards(game, view, held);
  const up = view.up[me];
  const category = studCategory(hole.cards, up);
  const won = view.award?.payouts[me] ?? 0;
  const owed = Math.max(0, view.currentBet - view.streetBets[me]);

  const handleActionResult: ActionCallback = (timeout, response) => {
    setActionPending(false);
    if (timeout || !response?.success) setSentAt(null);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  };

  const sendAction = (action: StudAction): void => {
    if (!myTurn || !options) return;
    if (action.type === 'check' && !options.check) return;
    if (action.type === 'raise' && (!options.raise || action.to < options.raise.min || action.to > options.raise.max)) return;
    setActionError('');
    setActionPending(true);
    setSentAt(game.log.length);
    socket.timeout(10000).emit('game:action', { gameType: 'stud', action }, handleActionResult);
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

  const hasCards = hole.cards.length > 0 || hole.hidden || up.length > 0;
  const handZone = <div className={holdemStyles.handArea}>
    {hasCards && <div className={`${holdemStyles.myHand} ${myState === 'folded' ? holdemStyles.folded : ''}`}>
      <span className={`${styles.cards} ${styles.myCards}`}>
        {(hole.cards.length > 0 || hole.hidden) && <HeCards cards={hole.cards} backs={hole.hidden ? 1 : 0} size="lg" peek
          label={t('stud.hole')} />}
        {up.length > 0 && <HeCards cards={up} size="lg" label={t('stud.up')} freshFrom={up.length - 1} />}
      </span>
      <div className={holdemStyles.myMeta}>
        {view.streetBets[me] > 0 && <span className={holdemStyles.myBet}>
          <BetStack amount={view.streetBets[me]} title={t('holdem.betTitle', { n: String(view.streetBets[me]) })} /></span>}
        {category && <span className={holdemStyles.bestHand}>{t('holdem.bestHand', { category: t(`holdem.category.${category}`) })}</span>}
        {won > 0 && <strong className={holdemStyles.won}><AppIcon name="trophy" /> {t('holdem.wonAmount', { n: String(won) })}</strong>}
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
