import type { BotDifficulty, GameSeat, PlayerInfo, Seat } from './player';
import type {
  BlackjackOptions, NapoleonOptions, RoomCode, RoomInfo, RoomSeatTarget, GameType, NinetyNineOptions, SevensOptions, TimeControl,
} from './room';
import type {
  Card, BidAction, BlackjackAction, BlackjackDealerAction, ChinesePokerArrangement, HoldemAction, NapoleonAction,
  PlayerVisibleGameState,
} from './game';
import type { ChatMessage } from './chat';
import type { MatchSummary } from './game';
import type { MatchReplay } from './replay';
import type { PublicAccount } from './social';
import type { AccountProfile } from './account';
import type { ShopStickerId } from '../constants/shop';
import type { VoiceIncomingSignal, VoiceJoinResult, VoiceRoomState, VoiceSettings, VoiceSignal } from './voice';

export interface PlayerSnapshot {
  success: boolean;
  error?: string;
  player?: PlayerInfo;
  /** Own balance on authenticated resume; never included in room identities. */
  coins?: number;
  coinRevision?: number;
  room?: RoomInfo;
  gameState?: PlayerVisibleGameState;
  /**
   * Complete room history, sent on resume and when the room changes; it replaces local
   * history. Broadcasts omit it while the room is unchanged and send `chat:message` instead.
   */
  chatHistory?: ChatMessage[];
  /** Server clock when sent, present while the room has a replay session to derive its position. */
  serverNow?: number;
}

/** Playback the host requests; the server anchors it at its own clock. */
export interface RoomReplayPlayback {
  /** Step to show now, from 0 to the session's `lastStep`. */
  step: number;
  playing: boolean;
  speed: number;
}

/** The shared session's archive with the participants needed to render it. */
export interface RoomReplayArchive {
  match: MatchSummary;
  replay: MatchReplay;
  /** Public profiles of the match's accounts that still exist. */
  players: Record<string, PublicAccount>;
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
  'game:autoPlay': (payload: { enabled: boolean }, callback: (response: ActionResult) => void) => void;
  'game:leaveEarly': (callback: (response: ActionResult) => void) => void;
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
  /** Join an accepted friend's hosted room, checking the listed room is still current. */
  'room:joinFriend': (
    payload: { accountId: string; roomCode: RoomCode },
    callback: (response: ActionResult & { room?: RoomInfo }) => void,
  ) => void;
  'room:leave': (callback: (response: ActionResult) => void) => void;
  'room:kick': (
    payload: { accountId: string }, callback: (response: ActionResult) => void,
  ) => void;
  'room:changeSeat': (
    payload: { seat: Seat }, callback: (response: ActionResult) => void,
  ) => void;
  /** Host only; swaps occupied destinations and resets human readiness. */
  'room:movePlayer': (
    payload: { accountId: string; target: RoomSeatTarget }, callback: (response: ActionResult) => void,
  ) => void;
  'room:addSeat': (callback: (response: ActionResult) => void) => void;
  /** Removes the last additional seat, which must be empty. */
  'room:removeSeat': (callback: (response: ActionResult) => void) => void;
  'room:changeAdditionalSeat': (
    payload: { index: number }, callback: (response: ActionResult) => void,
  ) => void;
  /** Leaves the seat to spectate; waiting rooms only. */
  'room:standUp': (callback: (response: ActionResult) => void) => void;
  'room:setGameType': (
    payload: { gameType: GameType }, callback: (response: ActionResult) => void,
  ) => void;
  'room:setTimeControl': (
    payload: TimeControl, callback: (response: ActionResult) => void,
  ) => void;
  'room:setSevensOptions': (
    payload: SevensOptions, callback: (response: ActionResult) => void,
  ) => void;
  'room:setNinetyNineOptions': (
    payload: NinetyNineOptions, callback: (response: ActionResult) => void,
  ) => void;
  'room:setBlackjackOptions': (
    payload: BlackjackOptions, callback: (response: ActionResult) => void,
  ) => void;
  'room:setNapoleonOptions': (
    payload: NapoleonOptions, callback: (response: ActionResult) => void,
  ) => void;
  'room:ready': (callback: (response: ActionResult) => void) => void;
  'room:start': (callback: (response: ActionResult) => void) => void;
  'room:setShuffleSeats': (payload: { enabled: boolean }, callback: (response: ActionResult) => void) => void;
  'room:addBot': (
    payload: { seat: GameSeat; difficulty?: BotDifficulty }, callback: (response: ActionResult) => void,
  ) => void;
  'room:setBotDifficulty': (
    payload: { seat: GameSeat; difficulty: BotDifficulty }, callback: (response: ActionResult) => void,
  ) => void;
  'room:removeBot': (
    payload: { seat: GameSeat }, callback: (response: ActionResult) => void,
  ) => void;
  'room:fillBots': (callback: (response: ActionResult) => void) => void;
  'room:unready': (callback: (response: ActionResult) => void) => void;
  /** Host only, from the waiting room: a match the host may view in the subject's history. */
  'room:replay:start': (
    payload: { subjectId: string; matchId: string }, callback: (response: ActionResult) => void,
  ) => void;
  /** Host only: play, pause, seek, or change speed by replacing the playback anchor. */
  'room:replay:control': (
    payload: RoomReplayPlayback, callback: (response: ActionResult) => void,
  ) => void;
  /** Host only: returns every member to the waiting room. */
  'room:replay:end': (callback: (response: ActionResult) => void) => void;
  /** Current room members only, while the room's replay session is active. */
  'room:replay:load': (
    callback: (response: ActionResult & { archive?: RoomReplayArchive }) => void,
  ) => void;
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
    payload: { card: Card; choice?: 'plus' | 'minus'; target?: GameSeat }, callback: (response: ActionResult) => void,
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
  'game:blackjack:bet': (
    payload: { amount: number }, callback: (response: ActionResult) => void,
  ) => void;
  'game:blackjack:action': (
    payload: { action: BlackjackAction }, callback: (response: ActionResult) => void,
  ) => void;
  /** The player dealer's own hand, after every player hand is finished */
  'game:blackjack:dealerAction': (
    payload: { action: BlackjackDealerAction }, callback: (response: ActionResult) => void,
  ) => void;
  'game:holdem:action': (
    payload: { action: HoldemAction }, callback: (response: ActionResult) => void,
  ) => void;
  'game:napoleon:action': (
    payload: { action: NapoleonAction }, callback: (response: ActionResult) => void,
  ) => void;
  'game:continue':(callback: (response: ActionResult) => void) => void;
  'game:abortVote:start': (callback: (response: ActionResult) => void) => void;
  'game:abortVote:cast': (
    payload: { agree: boolean }, callback: (response: ActionResult) => void,
  ) => void;
  'chat:send': (
    payload:
      | { message: string; stickerId?: never; providedSticker?: never; shopSticker?: never }
      | { stickerId: string; message?: never; providedSticker?: never; shopSticker?: never }
      /** Name of a site-provided emoji sent as a sticker. */
      | { providedSticker: string; message?: never; stickerId?: never; shopSticker?: never }
      | { shopSticker: ShopStickerId; message?: never; stickerId?: never; providedSticker?: never },
    callback: (response: ActionResult) => void,
  ) => void;
}

export interface ServerToClientEvents {
  /** Private balance refresh after a durable completed-game reward. */
  'account:coins': (payload: { coins: number; coinRevision?: number }) => void;
  'account:updated': (account: AccountProfile) => void;
  'social:changed': () => void;
  'voice:state': (payload: VoiceRoomState) => void;
  'voice:signal': (payload: VoiceIncomingSignal) => void;
  'voice:left': (payload: { reason: string }) => void;
  'player:state': (payload: PlayerSnapshot) => void;
  'chat:message': (payload: ChatMessageEvent) => void;
  'room:invited': (payload: RoomInvite) => void;
  /** Sent to a member the host removed, after their state no longer includes the room. */
  'room:kicked': (payload: { roomCode: RoomCode }) => void;
}

/** Ephemeral friend invite; never persisted. */
export interface RoomInvite {
  roomCode: RoomCode;
  gameType: GameType;
  from: PublicAccount;
  seatsFree: number;
}
