import type { PlayerInfo, Seat } from './player';
import type { RoomCode, RoomInfo, GameType, TimeControl } from './room';
import type { Card, BidAction, ChinesePokerArrangement, PlayerVisibleGameState } from './game';
import type { ChatMessage } from './chat';
import type { PublicAccount } from './social';
import type { VoiceIncomingSignal, VoiceJoinResult, VoiceRoomState, VoiceSettings, VoiceSignal } from './voice';

export interface PlayerSnapshot {
  success: boolean;
  error?: string;
  player?: PlayerInfo;
  room?: RoomInfo;
  gameState?: PlayerVisibleGameState;
  /**
   * Complete room history, sent on resume and when the room changes; it replaces local
   * history. Broadcasts omit it while the room is unchanged and send `chat:message` instead.
   */
  chatHistory?: ChatMessage[];
}

/** One new message appended to the recipient's current room history. */
export interface ChatMessageEvent {
  roomCode: RoomCode;
  message: ChatMessage;
}

export interface ActionResult {
  success: boolean;
  error?: string;
}

export interface ClientToServerEvents {
  'voice:join': (payload: VoiceSettings, callback: (response: VoiceJoinResult) => void) => void;
  'voice:leave': (callback: (response: ActionResult) => void) => void;
  'voice:settings': (payload: VoiceSettings, callback: (response: ActionResult) => void) => void;
  'voice:signal': (payload: VoiceSignal, callback: (response: ActionResult) => void) => void;
  'player:resume': (callback: (response: PlayerSnapshot) => void) => void;
  'room:create': (
    payload: { gameType: GameType },
    callback: (response: ActionResult & { roomCode?: RoomCode }) => void,
  ) => void;
  'room:join': (
    payload: { roomCode: RoomCode },
    callback: (response: ActionResult & { room?: RoomInfo }) => void,
  ) => void;
  'room:invite': (
    payload: { accountId: string }, callback: (response: ActionResult) => void,
  ) => void;
  'room:leave': (callback: (response: ActionResult) => void) => void;
  'room:changeSeat': (
    payload: { seat: Seat }, callback: (response: ActionResult) => void,
  ) => void;
  'room:setGameType': (
    payload: { gameType: GameType }, callback: (response: ActionResult) => void,
  ) => void;
  'room:setTimeControl': (
    payload: TimeControl, callback: (response: ActionResult) => void,
  ) => void;
  'room:ready': (callback: (response: ActionResult) => void) => void;
  'room:addBot': (
    payload: { seat: Seat }, callback: (response: ActionResult) => void,
  ) => void;
  'room:removeBot': (
    payload: { seat: Seat }, callback: (response: ActionResult) => void,
  ) => void;
  'room:fillBots': (callback: (response: ActionResult) => void) => void;
  'room:unready': (callback: (response: ActionResult) => void) => void;
  'game:redealResponse': (
    payload: { accept: boolean }, callback: (response: ActionResult) => void,
  ) => void;
  'game:bid': (
    payload: { bid: BidAction }, callback: (response: ActionResult) => void,
  ) => void;
  'game:playCard': (
    payload: { card: Card }, callback: (response: ActionResult) => void,
  ) => void;
  'game:bigtwo:play': (
    payload: { cards: Card[] }, callback: (response: ActionResult) => void,
  ) => void;
  'game:bigtwo:pass': (callback: (response: ActionResult) => void) => void;
  'game:redpoints:play': (
    payload: { card: Card; capture?: Card }, callback: (response: ActionResult) => void,
  ) => void;
  'game:redpoints:chooseFlip': (
    payload: { capture: Card }, callback: (response: ActionResult) => void,
  ) => void;
  'game:ninetynine:play': (
    payload: { card: Card; choice?: 'plus' | 'minus'; target?: Seat }, callback: (response: ActionResult) => void,
  ) => void;
  'game:sevens:play': (
    payload: { card: Card }, callback: (response: ActionResult) => void,
  ) => void;
  'game:sevens:cover': (
    payload: { card: Card }, callback: (response: ActionResult) => void,
  ) => void;
  'game:chinesepoker:arrange': (
    payload: { arrangement: ChinesePokerArrangement }, callback: (response: ActionResult) => void,
  ) => void;
  'game:liarsdeck:play': (
    payload: { cardIds: number[] }, callback: (response: ActionResult) => void,
  ) => void;
  'game:liarsdeck:challenge': (callback: (response: ActionResult) => void) => void;
  'game:continue':(callback: (response: ActionResult) => void) => void;
  'game:abortVote:start': (callback: (response: ActionResult) => void) => void;
  'game:abortVote:cast': (
    payload: { agree: boolean }, callback: (response: ActionResult) => void,
  ) => void;
  'chat:send': (
    payload:
      | { message: string; stickerId?: never; providedSticker?: never }
      | { stickerId: string; message?: never; providedSticker?: never }
      /** Name of a site-provided emoji sent as a sticker. */
      | { providedSticker: string; message?: never; stickerId?: never },
    callback: (response: ActionResult) => void,
  ) => void;
}

export interface ServerToClientEvents {
  'voice:state': (payload: VoiceRoomState) => void;
  'voice:signal': (payload: VoiceIncomingSignal) => void;
  'voice:left': (payload: { reason: string }) => void;
  'player:state': (payload: PlayerSnapshot) => void;
  'chat:message': (payload: ChatMessageEvent) => void;
  'room:invited': (payload: RoomInvite) => void;
}

/** Ephemeral friend invite; never persisted. */
export interface RoomInvite {
  roomCode: RoomCode;
  gameType: GameType;
  from: PublicAccount;
  seatsFree: number;
}
