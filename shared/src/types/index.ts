// ─── Types barrel ───

export type {
  PlayerId,
  Seat,
  PlayerColor,
  PlayerInfo,
  ConnectionStatus,
} from './player';

export type {
  TimeControl,
  RoomCode,
  GameType,
  RoomStatus,
  SeatInfo,
  SeatMap,
  RoomInfo,
  AbortVoteInfo,
} from './room';

export type {
  GameClock,
  Suit,
  BidSuit,
  Rank,
  Card,
  BidLevel,
  BidAction,
  Contract,
  GamePhase,
  TrickRecord,
  GameLogEntry,
  GameResult,
  Team,
  PlayingState,
  BiddingState,
  BridgeGameState,
  BridgeVisibleState,
  BigTwoPlay,
  BigTwoLogEntry,
  BigTwoMatchResult,
  BigTwoPhase,
  BigTwoGameState,
  BigTwoVisibleState,
  RedPointsLogEntry,
  RedPointsMatchResult,
  RedPointsPhase,
  RedPointsStep,
  RedPointsGameState,
  RedPointsVisibleState,
  NinetyNineDirection,
  NinetyNineLogEntry,
  NinetyNineMatchResult,
  NinetyNinePhase,
  NinetyNineGameState,
  NinetyNineVisibleState,
  SevensPhase,
  SevensTable,
  SevensLogEntry,
  SevensMatchResult,
  SevensGameState,
  SevensVisibleState,
  ChinesePokerRow,
  ChinesePokerArrangement,
  ChinesePokerCategory,
  ChinesePokerMatchup,
  ChinesePokerMatchResult,
  ChinesePokerPhase,
  ChinesePokerLogEntry,
  ChinesePokerGameState,
  ChinesePokerVisibleState,
  LiarTableFace,
  LiarFace,
  LiarCard,
  LiarsDeckLogEntry,
  LiarsDeckMatchResult,
  LiarsDeckPhase,
  LiarsDeckLastPlay,
  LiarsDeckGameState,
  LiarsDeckVisibleState,
  AnyGameState,
  PlayerVisibleGameState,
  MatchResult,
} from './game';

export type { ChatMessage } from './chat';
export type { EmojiRecord, ProvidedEmoji } from './emoji';
export type { AccountProfile, AvatarPreset, AvatarId, MediaId } from './account';

export type {
  ClientToServerEvents,
  ServerToClientEvents,
  PlayerSnapshot,
  ChatMessageEvent,
  RoomInvite,
} from './socket-events';

export type { MatchSummary } from './game';
export type {
  PublicAccount, FriendEntry, FriendRequest, FriendsData, FriendsResponse, CreateFriendRequestResponse,
  MatchHistory,
} from './social';

export type {
  VoiceSettings, VoiceParticipant, VoiceRoomState, VoiceJoinResult,
  VoiceDescription, VoiceCandidate, VoiceSignal, VoiceIncomingSignal,
} from './voice';
