// ─── Constants barrel ───

export {
  SUIT_DISPLAY_ORDER,
  RANK_ORDER_DESC,
  SUIT_SYMBOLS,
  RANK_DISPLAY,
  HIGH_CARD_POINTS,
} from './cards';

export {
  GAME_TYPES,
  ABORT_VOTE_THRESHOLD,
  ABORT_VOTE_DURATION_MS,
  ABORT_VOTE_COOLDOWN_MS,
  HAND_SIZE,
  TOTAL_TRICKS,
  CONTRACT_BASE_TRICKS,
  SEAT_ORDER_CLOCKWISE,
  TEAM_SEATS,
  BID_SUIT_ORDER,
  REDEAL_MAX_POINTS,
  RECONNECT_TIMEOUT_MS,
  ROOM_CODE_LENGTH,
  NICKNAME_MAX_LENGTH,
} from './game-rules';

export { IMAGE_OPACITY_MAX, IMAGE_OPACITY_MIN, isImageOpacity, isMediaId } from './media';
export {
  EMOJI_MAX_BYTES,
  EMOJI_NAME_MAX_LENGTH,
  MAX_EMOJIS_PER_ACCOUNT,
  MAX_MESSAGE_EMOJIS,
  isEmojiName,
  isProvidedEmojiFile,
  parseProvidedEmojiCatalog,
  extractEmojiNames,
  splitEmojiText,
} from './emoji';
export type { EmojiSegment } from './emoji';
