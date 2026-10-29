import type {
  AchievementNameplateId, AvatarBorderId, BoardStyleId, CardBackStyleId, CardFaceStyleId, ChatFrameId, ChipStyleId,
  DiceStyleId, NameplateId, PieceStyleId, SeatBackgroundStyleId, SeatFrameId, ShopItemId, SoundPackId, TableBackgroundStyleId, VictoryEffectId,
} from '../constants/shop';
/**
 * Retired preset avatars: accounts keep the stored value but every client shows the single
 * default image or the uploaded picture. `bot` marks seats filled by the server.
 */
export type AvatarPreset = 'cat' | 'fox' | 'owl' | 'bear' | 'rabbit' | 'panda' | 'bot';
export type AvatarId = AvatarPreset;
/** Uploaded image: 64 lowercase hex sha256 + `.png|.jpg|.gif|.webp`. */
export type MediaId = string;

/** Public account data. Passwords and session tokens never cross this boundary. */
export interface AccountProfile {
  readonly id: string;
  readonly username: string;
  /** Server-owned balance. Older accounts without this field start at zero. */
  readonly coins?: number;
  /** Increases on every balance change, including purchases. Missing means zero. */
  readonly coinRevision?: number;
  /** Private inventory; older accounts own no borders. */
  readonly ownedAvatarBorders?: readonly AvatarBorderId[];
  readonly avatarBorder?: AvatarBorderId | null;
  /** Private permanent inventory for products other than legacy avatar borders. */
  readonly ownedShopItems?: readonly ShopItemId[];
  /** Earned through achievements only; never purchasable. */
  readonly ownedAchievementNameplates?: readonly AchievementNameplateId[];
  /** Official styles take precedence over uploaded images; null restores the uploaded image/theme. */
  readonly cardBackStyle?: CardBackStyleId | null;
  readonly tableBackgroundStyle?: TableBackgroundStyleId | null;
  readonly seatBackgroundStyle?: SeatBackgroundStyleId | null;
  readonly nameplate?: NameplateId | null;
  /** Private equipment: null or missing keeps the classic deck, tones, and chips. */
  readonly cardFaceStyle?: CardFaceStyleId | null;
  readonly soundPack?: SoundPackId | null;
  readonly chipStyle?: ChipStyleId | null;
  /** Private board-game equipment: null or missing keeps the built-in pieces, boards, and dice. */
  readonly pieceStyle?: PieceStyleId | null;
  readonly boardStyle?: BoardStyleId | null;
  readonly diceStyle?: DiceStyleId | null;
  /** Public equipment shared with tables and chat; null or missing keeps the theme design. */
  readonly seatFrame?: SeatFrameId | null;
  readonly victoryEffect?: VictoryEffectId | null;
  readonly chatFrame?: ChatFrameId | null;
  readonly nickname: string;
  readonly color: string;
  readonly avatar: AvatarPreset;
  readonly avatarImage: MediaId | null;
  /** Optional for older accounts; shared as the owner's waiting-room seat artwork. */
  readonly seatBackground?: MediaId | null;
  readonly tableBackground: MediaId | null;
  /** Integer percent applied to the table background image layer only. */
  readonly tableBackgroundOpacity: number;
  /** Replaces every face-down card the owner sees; never shown to other players. */
  readonly cardBack: MediaId | null;
  /** Integer percent applied to the custom card back image over the theme card base. */
  readonly cardBackOpacity: number;
  readonly matchesPublic: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}
