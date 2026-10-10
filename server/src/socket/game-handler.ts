import type { BidAction, BlackjackAction, Card, ChinesePokerArrangement, HoldemAction, Seat } from '@shared/types';
import { LD_DECK, LD_MAX_PLAY } from '@shared/rules/liarsdeck';
import { BJ_ACTIONS, BJ_MAX_BET, BJ_MIN_BET } from '@shared/rules/blackjack';
import type { SocketContext, TypedSocket } from './context';
import { actionError, requireRoom, requireSuccess, runAction } from './context';
import * as roomManager from '../managers/room-manager';
import * as gameManager from '../managers/game-manager';
import * as chatManager from '../managers/chat-manager';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];

function playerSeat(socket: TypedSocket, code: string): Seat {
  const seat = roomManager.getPlayerSeat(code, socket.data.accountId);
  if (!seat) throw actionError('Select a seat first.');
  return seat;
}

function isCard(value: unknown): value is Card {
  if (typeof value !== 'object' || value === null) return false;
  const { suit, rank } = value as { suit?: unknown; rank?: unknown };
  return typeof rank === 'number' && Number.isInteger(rank) && rank >= 2 && rank <= 14
    && typeof suit === 'string' && ['clubs', 'diamonds', 'hearts', 'spades'].includes(suit);
}

/** Rebuilds a Hold'em action so client-supplied extra keys never reach saved state. */
function parseHoldemAction(value: unknown): HoldemAction | null {
  if (typeof value !== 'object' || value === null) return null;
  const { type, to } = value as { type?: unknown; to?: unknown };
  if (type === 'fold' || type === 'check' || type === 'call') return { type };
  return type === 'raise' && typeof to === 'number' && Number.isSafeInteger(to) && to > 0 ? { type, to } : null;
}

/** Rebuilds a 3/5/5 arrangement so client-supplied extra keys never reach saved state. */
function parseArrangement(value: unknown): ChinesePokerArrangement | null {
  if (typeof value !== 'object' || value === null) return null;
  const { front, middle, back } = value as { front?: unknown; middle?: unknown; back?: unknown };
  const row = (cards: unknown, size: number): Card[] | null => Array.isArray(cards) && cards.length === size
    && cards.every(isCard) ? cards.map(({ suit, rank }: Card): Card => ({ suit, rank })) : null;
  const arrangement = { front: row(front, 3), middle: row(middle, 5), back: row(back, 5) };
  if (!arrangement.front || !arrangement.middle || !arrangement.back) return null;
  const all = [...arrangement.front, ...arrangement.middle, ...arrangement.back];
  if (new Set(all.map((card) => `${card.suit}-${card.rank}`)).size !== all.length) return null;
  return { front: arrangement.front, middle: arrangement.middle, back: arrangement.back };
}

/** Adds an abort-vote chat line about `accountId`, read from the room seats. */
export function systemLine(code: string, accountId: string, key: string): void {
  const seat = roomManager.getPlayerSeat(code, accountId);
  const subject = seat ? roomManager.getRoomInfo(code)?.seats[seat].player : null;
  if (subject) chatManager.addSystemMessage(code, subject, key);
}

export function registerGameHandlers(context: SocketContext, socket: TypedSocket): void {
  socket.on('game:redealResponse', (payload, callback) => runAction(context, socket, callback, () => {
    if (!payload || typeof payload.accept !== 'boolean') throw actionError('Invalid redeal response.');
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleRedealResponse(code, playerSeat(socket, code), payload.accept));
    return { success: true };
  }));

  socket.on('game:bid', (payload, callback) => runAction(context, socket, callback, () => {
    const bid = payload?.bid;
    if (!bid || (bid.type !== 'pass' && (bid.type !== 'bid' || !Number.isInteger(bid.level)
      || bid.level < 1 || bid.level > 7
      || !['clubs', 'diamonds', 'hearts', 'spades', 'nt'].includes(bid.suit)))) {
      throw actionError('Invalid bid.');
    }
    const code = requireRoom(socket);
    // Rebuild the bid so client-supplied extra keys never reach saved logs or snapshots.
    const action: BidAction = bid.type === 'pass' ? { type: 'pass' }
      : { type: 'bid', level: bid.level, suit: bid.suit };
    requireSuccess(gameManager.handleBid(code, playerSeat(socket, code), action));
    return { success: true };
  }));

  socket.on('game:playCard', (payload, callback) => runAction(context, socket, callback, () => {
    const card = payload?.card;
    if (!isCard(card)) throw actionError('Invalid card.');
    const code = requireRoom(socket);
    requireSuccess(gameManager.handlePlayCard(code, playerSeat(socket, code), { suit: card.suit, rank: card.rank }));
    return { success: true };
  }));

  socket.on('game:bigtwo:play', (payload, callback) => runAction(context, socket, callback, () => {
    const cards: unknown = payload?.cards;
    if (!Array.isArray(cards) || cards.length < 1 || cards.length > 5 || !cards.every(isCard)
      || new Set(cards.map((card: Card) => `${card.suit}-${card.rank}`)).size !== cards.length) {
      throw actionError('Invalid cards.');
    }
    const code = requireRoom(socket);
    const played = cards.map(({ suit, rank }: Card): Card => ({ suit, rank }));
    requireSuccess(gameManager.handleBigTwoPlay(code, playerSeat(socket, code), played));
    return { success: true };
  }));

  socket.on('game:bigtwo:pass', (callback) => runAction(context, socket, callback, () => {
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleBigTwoPass(code, playerSeat(socket, code)));
    return { success: true };
  }));

  socket.on('game:redpoints:play', (payload, callback) => runAction(context, socket, callback, () => {
    const card: unknown = payload?.card;
    const capture: unknown = payload?.capture;
    if (!isCard(card) || (capture !== undefined && !isCard(capture))) throw actionError('Invalid card.');
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleRedPointsPlay(code, playerSeat(socket, code), { suit: card.suit, rank: card.rank },
      capture === undefined ? undefined : { suit: capture.suit, rank: capture.rank }));
    return { success: true };
  }));

  socket.on('game:redpoints:chooseFlip', (payload, callback) => runAction(context, socket, callback, () => {
    const capture: unknown = payload?.capture;
    if (!isCard(capture)) throw actionError('Invalid card.');
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleRedPointsChooseFlip(code, playerSeat(socket, code),
      { suit: capture.suit, rank: capture.rank }));
    return { success: true };
  }));

  socket.on('game:sevens:play', (payload, callback) => runAction(context, socket, callback, () => {
    const card: unknown = payload?.card;
    if (!isCard(card)) throw actionError('Invalid card.');
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleSevensPlay(code, playerSeat(socket, code), { suit: card.suit, rank: card.rank }));
    return { success: true };
  }));

  socket.on('game:sevens:cover', (payload, callback) => runAction(context, socket, callback, () => {
    const card: unknown = payload?.card;
    if (!isCard(card)) throw actionError('Invalid card.');
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleSevensCover(code, playerSeat(socket, code), { suit: card.suit, rank: card.rank }));
    return { success: true };
  }));

  socket.on('game:chinesepoker:arrange', (payload, callback) => runAction(context, socket, callback, () => {
    const arrangement = parseArrangement(payload?.arrangement);
    if (!arrangement) throw actionError('Invalid arrangement.');
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleChinesePokerArrange(code, playerSeat(socket, code), arrangement));
    return { success: true };
  }));

  socket.on('game:ninetynine:play', (payload, callback) => runAction(context, socket, callback, () => {
    const card: unknown = payload?.card;
    const choice: unknown = payload?.choice;
    const target: unknown = payload?.target;
    if (!isCard(card)) throw actionError('Invalid card.');
    if (choice !== undefined && choice !== 'plus' && choice !== 'minus') throw actionError('Invalid choice.');
    if (target !== undefined && !SEATS.includes(target as Seat)) throw actionError('Invalid target.');
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleNinetyNinePlay(code, playerSeat(socket, code), { suit: card.suit, rank: card.rank },
      choice, target as Seat | undefined));
    return { success: true };
  }));

  socket.on('game:liarsdeck:play', (payload, callback) => runAction(context, socket, callback, () => {
    const cardIds: unknown = payload?.cardIds;
    if (!Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > LD_MAX_PLAY
      || !cardIds.every((id) => Number.isInteger(id) && id >= 0 && id < LD_DECK.length)) {
      throw actionError('Invalid cards.');
    }
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleLiarsDeckPlay(code, playerSeat(socket, code), [...cardIds] as number[]));
    return { success: true };
  }));

  socket.on('game:liarsdeck:challenge', (callback) => runAction(context, socket, callback, () => {
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleLiarsDeckChallenge(code, playerSeat(socket, code)));
    return { success: true };
  }));

  socket.on('game:blackjack:bet', (payload, callback) => runAction(context, socket, callback, () => {
    const amount: unknown = payload?.amount;
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < BJ_MIN_BET || amount > BJ_MAX_BET) {
      throw actionError('Invalid bet.');
    }
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleBlackjackBet(code, playerSeat(socket, code), amount));
    return { success: true };
  }));

  socket.on('game:blackjack:action', (payload, callback) => runAction(context, socket, callback, () => {
    const action: unknown = payload?.action;
    if (!BJ_ACTIONS.includes(action as BlackjackAction)) throw actionError('Invalid action.');
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleBlackjackAction(code, playerSeat(socket, code), action as BlackjackAction));
    return { success: true };
  }));

  socket.on('game:holdem:action', (payload, callback) => runAction(context, socket, callback, () => {
    const action = parseHoldemAction(payload?.action);
    if (!action) throw actionError('Invalid action.');
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleHoldemAction(code, playerSeat(socket, code), action));
    return { success: true };
  }));

  socket.on('game:abortVote:start', (callback) => runAction(context, socket, callback, () => {
    const code = requireRoom(socket);
    const started = roomManager.startAbortVote(code, socket.data.accountId, Date.now());
    if (!started.success) throw actionError(started.reason);
    systemLine(code, socket.data.accountId, 'abortVote.started');
    if (started.outcome === 'passed') {
      gameManager.abortGame(code);
      roomManager.setRoomStatus(code, 'waiting');
      roomManager.resetAllReady(code);
      systemLine(code, socket.data.accountId, 'abortVote.passed');
    }
    return { success: true };
  }));

  socket.on('game:abortVote:cast', (payload, callback) => runAction(context, socket, callback, () => {
    if (!payload || typeof payload.agree !== 'boolean') throw actionError('Invalid vote.');
    const code = requireRoom(socket);
    const startedBy = roomManager.getRoomInfo(code)?.abortVote?.startedBy;
    const cast = roomManager.castAbortVote(code, socket.data.accountId, payload.agree, Date.now());
    if (!cast.success) throw actionError(cast.reason);
    if (cast.outcome === 'passed') {
      gameManager.abortGame(code);
      roomManager.setRoomStatus(code, 'waiting');
      roomManager.resetAllReady(code);
    }
    if (cast.outcome !== 'pending' && startedBy) {
      systemLine(code, startedBy, cast.outcome === 'passed' ? 'abortVote.passed' : 'abortVote.failed');
    }
    return { success: true };
  }));

  socket.on('game:continue', (callback) => runAction(context, socket, callback, () => {
    const code = requireRoom(socket);
    const accountId = socket.data.accountId;
    const seat = roomManager.getPlayerSeat(code, accountId);
    const spectating = gameManager.isSpectating(code, accountId);
    if (!seat && !spectating) throw actionError('Select a seat first.');
    if (gameManager.getGameState(code)?.phase !== 'scoring') throw actionError('The game has not ended.');
    if (gameManager.isPresentationActive(code)) {
      throw actionError('Please wait for the current action to finish.');
    }
    // Each player and spectator returns on their own; the others keep viewing the result.
    if (seat && gameManager.isViewingGame(code, seat, accountId)) gameManager.returnFromResult(code, seat);
    else if (spectating) gameManager.returnViewerFromResult(code, accountId);
    return { success: true };
  }));
}
