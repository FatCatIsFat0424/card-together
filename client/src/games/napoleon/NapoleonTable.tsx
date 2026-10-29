// ─── NapoleonTable: auction, exchange, discard review, secretary call, tricks, and settlement ───

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { SUIT_DISPLAY_ORDER, SUIT_SYMBOLS } from '@shared/constants';
import { NAPOLEON_BID_LEVELS } from '@shared/rules/napoleon';
import type {
  GameSeat, NapoleonAction, NapoleonBidLevel, NapoleonCard, NapoleonMatchResult, NapoleonSummon, NapoleonVisibleState, Suit,
} from '@shared/types';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useRoomStore } from '../../stores/room-store';
import { useI18nStore } from '../../stores/i18n-store';
import { AuctionPanel, BiddingWaiting } from '../../components/BiddingPanel';
import type { AuctionAction } from '../../components/bidding-choice';
import { CardHand } from '../../components/CardHand';
import { DeadlineClock } from '../../components/TurnClock';
import { readPreference, writePreference } from '../../utils/preference-storage';
import { GameShell } from '../GameShell';
import { ResultDialog, resultStyles } from '../ResultDialog';
import { useConnectionReady } from '../use-connection-ready';
import { useGamePresentation } from '../use-game-presentation';
import { useTablePerspective, useViewedGame } from '../use-table-perspective';
import { joinNames, useSeatName } from '../seat-names';
import { useNapoleonCardImageUrl } from './napoleon-card-art';
import { NapoleonInfoRail } from './NapoleonInfoRail';
import { NapoleonTrickArea } from './NapoleonTrickArea';
import { SecretaryPicker } from './SecretaryPicker';
import {
  napoleonAckKey, napoleonActiveSummon, napoleonCardText, napoleonExchange, napoleonForcedPlay, napoleonLeadSummons,
  napoleonListKey, napoleonNeedsAck, napoleonNeedsLeadSuit, napoleonOwnTurn, napoleonPlayableCards,
  napoleonReviewState, toggleNapoleonDiscard,
} from './napoleon-view';
import styles from './NapoleonTable.module.css';

/** The latest acknowledged secretary notice; one value is enough because only the current deal matters. */
const ACK_PREFERENCE = 'napoleon-secretary-ack';

type Translate = ReturnType<typeof useI18nStore.getState>['t'];

function CardStrip({ cards, label }: { cards: readonly NapoleonCard[]; label: string }): ReactNode {
  const napoleonCardImageUrl = useNapoleonCardImageUrl();
  const { t } = useI18nStore();
  const jokerName = (joker: 'big' | 'small'): string => t(`cards.joker.${joker}`);
  return <ul className={styles.cardRow} aria-label={label}>
    {cards.map((card, index) => <li key={napoleonListKey(card, index)}>
      <img src={napoleonCardImageUrl(card)} alt={napoleonCardText(card, jokerName)} draggable={false} />
    </li>)}
  </ul>;
}

function NapoleonResult({ result, name, t }: {
  result: NapoleonMatchResult; name: (seat: GameSeat) => string; t: Translate;
}): ReactNode {
  const { contract, secretarySeat } = result;
  const side = (seat: GameSeat): string => seat === contract.napoleon ? t('napoleon.napoleon')
    : seat === secretarySeat ? t('napoleon.secretary') : t('napoleon.defender');
  return <>
    <table className={resultStyles.table}>
      <thead><tr>
        <th scope="col">{t('napoleon.player')}</th>
        <th scope="col">{t('napoleon.side')}</th>
        <th scope="col">{t('napoleon.seatPoints')}</th>
      </tr></thead>
      <tbody>{result.seats.map((seat) => <tr key={seat}
        className={result.winners.includes(seat) ? resultStyles.winnerRow : undefined}>
        <td>{name(seat)}</td>
        <td>{side(seat)}</td>
        <td>{result.points[seat] ?? 0}</td>
      </tr>)}</tbody>
    </table>
    <section className={styles.resultDiscards}>
      <h3>{t('napoleon.discards')}</h3>
      <CardStrip cards={result.discards} label={t('napoleon.discards')} />
      <p className={resultStyles.note}>{t('napoleon.discardPoints', { n: String(result.discardPoints) })}</p>
    </section>
  </>;
}

/** The secretary's private notice; it blocks only their own actions until confirmed. */
function SecretaryNotice({ card, onConfirm }: { card: NapoleonCard; onConfirm: () => void }): ReactNode {
  const napoleonCardImageUrl = useNapoleonCardImageUrl();
  const { t } = useI18nStore();
  const jokerName = (joker: 'big' | 'small'): string => t(`cards.joker.${joker}`);
  return <section className={styles.panel} role="alertdialog" aria-labelledby="napoleon-ack-title"
    aria-describedby="napoleon-ack-text">
    <div className={styles.panelHeader}>
      <span className={`${styles.roleBadge} ${styles.secretaryBadge}`} id="napoleon-ack-title">{t('napoleon.ackTitle')}</span>
    </div>
    <div className={styles.noticeBody}>
      <img src={napoleonCardImageUrl(card)} alt="" draggable={false} />
      <div>
        <p id="napoleon-ack-text" className={styles.noticeText}>
          {t('napoleon.notice.secretarySelf', { card: napoleonCardText(card, jokerName) })}
        </p>
        <p className={styles.panelHint}>{t('napoleon.ackHint')}</p>
      </div>
    </div>
    <button type="button" className={styles.confirmBtn} onClick={onConfirm}>{t('napoleon.ackConfirm')}</button>
  </section>;
}

function ReviewDialog({ game, disabled, onConfirm }: {
  game: NapoleonVisibleState; disabled: boolean; onConfirm: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  return <section className={styles.panel} aria-labelledby="napoleon-review-title">
    <div className={styles.panelHeader}>
      <span className={styles.panelTitle} id="napoleon-review-title">{t('napoleon.reviewTitle')}</span>
      {game.reviewDeadline !== null && <DeadlineClock deadline={game.reviewDeadline} />}
    </div>
    <CardStrip cards={game.discards ?? []} label={t('napoleon.discards')} />
    <p className={styles.panelHint}>{t('napoleon.reviewHint')}</p>
    <button type="button" className={styles.confirmBtn} disabled={disabled} onClick={onConfirm}>
      {t('napoleon.reviewConfirm')}
    </button>
  </section>;
}

export function NapoleonTable(): ReactNode {
  const game = useGameStore((state) => state.napoleon);
  const viewed = useViewedGame(game);
  const roomCode = useRoomStore((state) => state.roomInfo?.code ?? '');
  const { t, locale } = useI18nStore();
  const name = useSeatName();
  const connectionReady = useConnectionReady();
  const { locked } = useGamePresentation();
  const bottomSeat = useTablePerspective();
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const [acknowledged, setAcknowledged] = useState(() => readPreference(ACK_PREFERENCE));
  // Choices belong to one exchange or one lead; a changed log or trick discards them.
  const [discards, setDiscards] = useState<{ key: number; cards: NapoleonCard[] }>({ key: -1, cards: [] });
  const [summonPick, setSummonPick] = useState<{ trick: number; summon: NapoleonSummon | null }>({ trick: -1, summon: null });
  const [leadPick, setLeadPick] = useState<{ trick: number; card: NapoleonCard } | null>(null);

  const handleResult = useCallback((timeout: Error | null, response?: { success: boolean; error?: string }): void => {
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  }, [t]);

  const send = useCallback((action: NapoleonAction): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:action', { gameType: 'napoleon', action }, handleResult);
  }, [handleResult]);

  const submitBid = useCallback((action: AuctionAction<NapoleonBidLevel>, done: (error: string | null) => void): void => {
    socket.timeout(10000).emit('game:action', {
      gameType: 'napoleon',
      action: { type: 'bid', action },
    }, (timeout, response) => {
      if (timeout) done(t('auth.connectionError'));
      else if (!response.success) done(response.error ?? t('common.error'));
      else done(null);
    });
  }, [t]);

  if (!game || !viewed) return null;

  const jokerName = (joker: 'big' | 'small'): string => t(`cards.joker.${joker}`);
  const ownTurn = napoleonOwnTurn(game);
  const acting = ownTurn && !locked;
  const blocked = actionPending || !connectionReady;
  const ackKey = napoleonAckKey(roomCode, game);
  const needsAck = napoleonNeedsAck(game, ackKey, acknowledged);
  const trickIndex = game.tricks.length;
  const summon = napoleonActiveSummon(game, summonPick.trick === trickIndex ? summonPick.summon : null);
  const pendingLead = leadPick?.trick === trickIndex && acting && game.phase === 'playing' ? leadPick.card : null;
  const exchange = napoleonExchange(game);
  const exchangeKey = game.log.length;
  const selected = discards.key === exchangeKey ? discards.cards : [];
  const reviewState = napoleonReviewState(game);
  const napoleonName = game.contract ? name(game.contract.napoleon) : '';

  const acknowledge = (): void => {
    if (!ackKey) return;
    writePreference(ACK_PREFERENCE, ackKey);
    setAcknowledged(ackKey);
  };

  const play = (card: NapoleonCard, leadSuit?: Suit): void => {
    setLeadPick(null);
    send({ type: 'play', card, ...(leadSuit ? { leadSuit } : {}), ...(summon ? { summon } : {}) });
  };

  const handleCard = (card: NapoleonCard): void => {
    if (exchange) {
      setDiscards({ key: exchangeKey, cards: toggleNapoleonDiscard(selected, card, exchange.discardCount) });
      return;
    }
    if (napoleonNeedsLeadSuit(game, card)) setLeadPick({ trick: trickIndex, card });
    else play(card);
  };

  let centre: ReactNode = null;
  let panel: ReactNode;
  if (game.phase === 'bidding') {
    const bids = game.bidding?.bids ?? [];
    const bidder = game.bidding?.currentBidderSeat ?? null;
    if (acting) {
      panel = <AuctionPanel levels={NAPOLEON_BID_LEVELS} bids={bids} highestBid={game.bidding?.highestBid ?? null}
        disabled={!connectionReady} onSubmit={submitBid} />;
    } else centre = <BiddingWaiting seat={bidder} bids={bids} />;
  } else if (game.phase === 'exchanging') {
    // The exchange controls sit in the unscaled action panel so they stay touch-sized on phones.
    if (exchange) {
      panel = <section className={styles.panel} aria-labelledby="napoleon-exchange-title">
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle} id="napoleon-exchange-title">{t('napoleon.exchangeTitle')}</span>
          <span className={styles.panelHint}>{t('napoleon.exchangeCount', {
            n: String(selected.length), total: String(exchange.discardCount) })}</span>
        </div>
        <p className={styles.panelHint}>{t('napoleon.exchangeHint', { n: String(exchange.discardCount) })}</p>
        <button type="button" className={styles.confirmBtn}
          disabled={blocked || selected.length !== exchange.discardCount}
          onClick={() => send({ type: 'discard', cards: selected })}>
          {t('napoleon.discardConfirm')}
        </button>
      </section>;
    } else centre = <p className={styles.centreText} role="status">{t('napoleon.waitExchange', { name: napoleonName })}</p>;
  } else if (game.phase === 'reviewing') {
    if (reviewState === 'review') {
      panel = <ReviewDialog game={game} disabled={blocked} onConfirm={() => send({ type: 'review' })} />;
    }
    centre = <div className={styles.centreBox}>
      <h2 className={styles.centreTitle}>{t('napoleon.reviewTitle')}</h2>
      <CardStrip cards={game.discards ?? []} label={t('napoleon.discards')} />
      <p className={styles.centreText} role="status">{t('napoleon.reviewWaiting')}</p>
    </div>;
  } else if (game.phase === 'calling') {
    if (acting) panel = <SecretaryPicker game={game} disabled={blocked} onConfirm={(card) => send({ type: 'call', card })} />;
    else centre = <p className={styles.centreText} role="status">{t('napoleon.waitCall', { name: napoleonName })}</p>;
  } else if (game.phase === 'playing') {
    const summons = acting && !needsAck ? napoleonLeadSummons(game) : [];
    const forced = acting ? napoleonForcedPlay(game) : null;
    centre = <div className={styles.playCentre}>
      <NapoleonTrickArea trick={game.trick} seats={game.seats} bottomSeat={bottomSeat} myTurn={acting && !needsAck} />
      {forced && !needsAck && <p className={styles.forced} role="status">
        {t('napoleon.forced', { card: napoleonCardText(forced, jokerName) })}</p>}
    </div>;
    if (pendingLead) {
      panel = <section className={styles.panel} aria-labelledby="napoleon-lead-title">
        <span className={styles.panelTitle} id="napoleon-lead-title">{t('napoleon.leadSuitTitle')}</span>
        <p className={styles.panelHint}>{t('napoleon.leadSuitHint', { card: napoleonCardText(pendingLead, jokerName) })}</p>
        <div className={styles.suitChoices}>
          {SUIT_DISPLAY_ORDER.map((suit) => <button key={suit} type="button" disabled={blocked}
            className={`${styles.choiceBtn} ${suit === 'hearts' || suit === 'diamonds' ? styles.redSuit : ''}`}
            aria-label={t('napoleon.leadSuit', { suit: SUIT_SYMBOLS[suit] })}
            onClick={() => play(pendingLead, suit)}>{SUIT_SYMBOLS[suit]}</button>)}
          <button type="button" className={styles.cancelBtn} onClick={() => setLeadPick(null)}>{t('napoleon.cancel')}</button>
        </div>
      </section>;
    } else if (summons.length > 0) {
      panel = <fieldset className={`${styles.panel} ${styles.summons}`}>
        <legend className={styles.panelTitle}>{t('napoleon.summonTitle')}</legend>
        {summons.map((option) => {
          const label = t(`napoleon.summonToggle.${option.summon}`, {
            card: option.cards.map((card) => napoleonCardText(card, jokerName)).join(' / ') });
          // Joker summons follow from the led card, so they are stated rather than offered.
          return option.automatic ? <p key={option.summon} className={styles.summonOption}>{label}</p>
            : <label key={option.summon} className={styles.summonOption}>
              <input type="checkbox" checked={summon === option.summon} disabled={blocked}
                onChange={(event) => setSummonPick({ trick: trickIndex, summon: event.target.checked ? option.summon : null })} />
              {label}
            </label>;
        })}
        <p className={styles.panelHint}>{t('napoleon.summonHint')}</p>
      </fieldset>;
    }
    if (needsAck && game.secretaryCard) panel = <SecretaryNotice card={game.secretaryCard} onConfirm={acknowledge} />;
  }

  const result = game.phase === 'scoring' ? game.result : null;
  const overlay = result && <ResultDialog tone={result.napoleonWins ? 'win' : 'lose'}
    title={t(result.napoleonWins ? 'napoleon.napoleonWins' : 'napoleon.defendersWin')}
    eyebrow={joinNames(result.winners.map(name), locale)}
    pending={actionPending} error={actionError} disabled={!connectionReady} onBack={() => {
      setActionError('');
      setActionPending(true);
      socket.timeout(10000).emit('game:continue', handleResult);
    }}>
    <NapoleonResult result={result} name={name} t={t} />
  </ResultDialog>;

  const playable = acting && !needsAck && !pendingLead ? napoleonPlayableCards(game, summon) : [];
  const handCards = exchange ? exchange.cards : viewed.myHand;
  return (
    <GameShell
      turnReady={acting || reviewState === 'review'}
      info={<NapoleonInfoRail game={game} />}
      centre={centre}
      panel={panel}
      overlay={overlay}
      hand={exchange
        ? <CardHand cards={handCards} selectedCards={selected} highlightedCards={exchange.pickedUp}
          highlightedLabel={t('napoleon.pickedUp')} onCardClick={handleCard} disabled={blocked || locked} />
        : <CardHand cards={handCards} playableCards={playable} onCardClick={handleCard}
          highlightedCards={game.secretaryCard ? [game.secretaryCard] : undefined}
          highlightedLabel={t('napoleon.secretaryCard')}
          disabled={blocked || !acting || needsAck || game.phase !== 'playing' || pendingLead !== null} />}
      error={game.phase !== 'scoring' ? actionError : undefined}
    />
  );
}
