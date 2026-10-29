// ─── i18n system ───

import { socialTranslations } from './social-i18n';
import { replayTranslations } from './replay-i18n';
import type { ReplayTranslationKey } from './replay-i18n';
import { roomErrorTranslations } from './room-error-i18n';
import type { RoomErrorTranslationKey } from './room-error-i18n';
import type { SocialTranslationKey } from './social-i18n';
import { accountTranslations } from './account-i18n';
import type { AccountTranslationKey } from './account-i18n';
import { playerTranslations } from './player-i18n';
import type { PlayerTranslationKey } from './player-i18n';
import { audioTranslations } from './audio-i18n';
import type { AudioTranslationKey } from './audio-i18n';
import { voiceTranslations } from './voice-i18n';
import type { VoiceTranslationKey } from './voice-i18n';
import { uiTranslations } from './ui-i18n';
import type { UiTranslationKey } from './ui-i18n';
import { emojiTranslations } from './emoji-i18n';
import type { EmojiTranslationKey } from './emoji-i18n';
import { gameTranslations } from './game-i18n';
import type { GameTranslationKey } from './game-i18n';
import { sevensTranslations } from './sevens-i18n';
import type { SevensTranslationKey } from './sevens-i18n';
import { chinesePokerTranslations } from './chinesepoker-i18n';
import type { ChinesePokerTranslationKey } from './chinesepoker-i18n';
import { liarsDeckTranslations } from './liarsdeck-i18n';
import type { LiarsDeckTranslationKey } from './liarsdeck-i18n';
import { liarsDiceTranslations } from './liarsdice-i18n';
import type { LiarsDiceTranslationKey } from './liarsdice-i18n';
import { oldMaidTranslations } from './oldmaid-i18n';
import type { OldMaidTranslationKey } from './oldmaid-i18n';
import { blackjackTranslations } from './blackjack-i18n';
import type { BlackjackTranslationKey } from './blackjack-i18n';
import { holdemTranslations } from './holdem-i18n';
import type { HoldemTranslationKey } from './holdem-i18n';
import { napoleonTranslations } from './napoleon-i18n';
import { crazyEightsTranslations } from './crazyeights-i18n';
import type { CrazyEightsTranslationKey } from './crazyeights-i18n';
import { studTranslations } from './stud-i18n';
import { reversiTranslations } from './reversi-i18n';
import type { ReversiTranslationKey } from './reversi-i18n';
import { jungleTranslations } from './jungle-i18n';
import type { JungleTranslationKey } from './jungle-i18n';
import type { StudTranslationKey } from './stud-i18n';
import { goFishTranslations } from './gofish-i18n';
import type { GoFishTranslationKey } from './gofish-i18n';
import type { NapoleonTranslationKey } from './napoleon-i18n';
import { tenHalfTranslations } from './tenhalf-i18n';
import { douDizhuTranslations } from './doudizhu-i18n';
import type { DouDizhuTranslationKey } from './doudizhu-i18n';
import type { TenHalfTranslationKey } from './tenhalf-i18n';
import { shopTranslations } from './shop-i18n';
import type { ShopTranslationKey } from './shop-i18n';
import { dailyRewardsTranslations } from './daily-rewards-i18n';
import type { DailyRewardsTranslationKey } from './daily-rewards-i18n';
import { achievementsTranslations } from './achievements-i18n';
import type { AchievementsTranslationKey } from './achievements-i18n';
import { statsTranslations } from './stats-i18n';
import type { StatsTranslationKey } from './stats-i18n';
import { boardTranslations } from './board-i18n';
import type { BoardTranslationKey } from './board-i18n';

export type Locale = 'zh-TW' | 'en';

type TranslationKeys = Record<
  ReplayTranslationKey | RoomErrorTranslationKey | SocialTranslationKey | AccountTranslationKey | PlayerTranslationKey | AudioTranslationKey | VoiceTranslationKey | UiTranslationKey
    | EmojiTranslationKey | GameTranslationKey | SevensTranslationKey | ChinesePokerTranslationKey
    | LiarsDeckTranslationKey | LiarsDiceTranslationKey | BlackjackTranslationKey | HoldemTranslationKey | NapoleonTranslationKey | TenHalfTranslationKey | DouDizhuTranslationKey | CrazyEightsTranslationKey | ShopTranslationKey | DailyRewardsTranslationKey | AchievementsTranslationKey
    | LiarsDeckTranslationKey | LiarsDiceTranslationKey | BlackjackTranslationKey | HoldemTranslationKey | NapoleonTranslationKey | StudTranslationKey | TenHalfTranslationKey | OldMaidTranslationKey | GoFishTranslationKey | ReversiTranslationKey | JungleTranslationKey | ShopTranslationKey | DailyRewardsTranslationKey | AchievementsTranslationKey
    | StatsTranslationKey | BoardTranslationKey, string
> & {
  // Lobby
  'lobby.nickname': string;
  'lobby.nicknamePlaceholder': string;
  'lobby.color': string;
  'lobby.createRoom': string;
  'lobby.joinRoom': string;
  'lobby.roomCodePlaceholder': string;
  'lobby.join': string;
  'lobby.androidAppTitle': string;
  'lobby.androidAppDescription': string;
  'lobby.androidAppDownload': string;
  'lobby.androidAppDismiss': string;
  // Room
  'room.title': string;
  'room.code': string;
  'room.copyCode': string;
  'room.leave': string;
  'room.ready': string;
  'room.unready': string;
  'room.seatEmpty': string;
  'room.notReady': string;
  'room.ready.status': string;
  'room.addBot': string;
  'room.removeBot': string;
  'room.fillBots': string;
  'room.botDifficulty': string;
  'room.botDifficultyFor': string;
  'room.botControlsFor': string;
  'room.botDifficulty.easy': string;
  'room.botDifficulty.hard': string;
  'player.bot': string;
  'player.botSeat': string;
  // Game
  'game.redealPending': string;
  'game.playing': string;
  'game.scoring': string;
  'game.contract': string;
  'game.pass': string;
  'game.passShort': string;
  // Redeal
  'redeal.title': string;
  'redeal.description': string;
  'redeal.accept': string;
  'redeal.decline': string;
  // Score
  'score.declarerWins': string;
  'score.defenderWins': string;
  'score.required': string;
  'score.declarerTricks': string;
  'score.defenderTricks': string;
  'score.backToRoom': string;
  // Chat
  'chat.title': string;
  'chat.placeholder': string;
  'chat.send': string;
  'chat.playerJoined': string;
  'chat.playerLeft': string;
  // Seats
  'seat.N': string;
  'seat.E': string;
  'seat.S': string;
  'seat.W': string;
  // Common
  'common.me': string;
  'common.error': string;
  'common.loading': string;
  // Connection and recovery
  'connection.reconnecting': string;
  'connection.interrupted': string;
  'app.crashed': string;
  'app.reload': string;
};

const translations: Record<Locale, TranslationKeys> = {
  'zh-TW': {
    ...socialTranslations['zh-TW'],
    ...accountTranslations['zh-TW'],
    ...replayTranslations['zh-TW'],
    ...playerTranslations['zh-TW'],
    ...audioTranslations['zh-TW'],
    ...voiceTranslations['zh-TW'],
    ...uiTranslations['zh-TW'],
    ...emojiTranslations['zh-TW'],
    ...gameTranslations['zh-TW'],
    ...roomErrorTranslations['zh-TW'],
    ...sevensTranslations['zh-TW'],
    ...chinesePokerTranslations['zh-TW'],
    ...liarsDeckTranslations['zh-TW'],
    ...liarsDiceTranslations['zh-TW'],
    ...blackjackTranslations['zh-TW'],
    ...holdemTranslations['zh-TW'],
    ...napoleonTranslations['zh-TW'],
    ...tenHalfTranslations['zh-TW'],
    ...crazyEightsTranslations['zh-TW'],
    ...studTranslations['zh-TW'],
    ...reversiTranslations['zh-TW'],
    ...oldMaidTranslations['zh-TW'],
    ...goFishTranslations['zh-TW'],
    ...douDizhuTranslations['zh-TW'],
    ...jungleTranslations['zh-TW'],
    ...shopTranslations['zh-TW'],
    ...dailyRewardsTranslations['zh-TW'],
    ...achievementsTranslations['zh-TW'],
    ...statsTranslations['zh-TW'],
    ...boardTranslations['zh-TW'],
    'lobby.nickname': '暱稱',
    'lobby.nicknamePlaceholder': '輸入暱稱...',
    'lobby.color': '顏色',
    'lobby.createRoom': '建立房間',
    'lobby.joinRoom': '加入房間',
    'lobby.roomCodePlaceholder': '輸入房間代碼',
    'lobby.join': '加入',
    'lobby.androidAppTitle': 'Android App',
    'lobby.androidAppDescription': '安裝後可從主畫面全螢幕開啟。安裝時若出現「未知來源」提示，請允許後繼續。',
    'lobby.androidAppDownload': '下載 APK',
    'lobby.androidAppDismiss': '不再顯示 Android App 提示',
    'room.title': '房間',
    'room.code': '房間代碼',
    'room.copyCode': '複製',
    'room.leave': '離開房間',
    'room.ready': '準備',
    'room.unready': '取消準備',
    'room.seatEmpty': '空位',
    'room.notReady': '未準備',
    'room.ready.status': '已準備',
    'room.addBot': '加入 bot',
    'room.removeBot': '移除 bot',
    'room.fillBots': '用 bot 補滿空位',
    'room.botDifficulty': '難度',
    'room.botDifficultyFor': '{nickname} 的難度',
    'room.botControlsFor': '管理 {nickname}',
    'room.botDifficulty.easy': '簡單',
    'room.botDifficulty.hard': '困難',
    'player.bot': 'bot',
    'player.botSeat': 'bot（{seat}）',
    'game.redealPending': '倒牌確認',
    'game.playing': '出牌',
    'game.scoring': '結算',
    'game.contract': '合約',
    'game.pass': 'Pass',
    'game.passShort': 'P',
    'redeal.title': '倒牌重洗',
    'redeal.description': '你的手牌符合倒牌重洗條件（點數 ≤ 4，包含只有一張 A 的手牌），是否要求重新發牌？',
    'redeal.accept': '重洗',
    'redeal.decline': '不要',
    'score.declarerWins': '🎉 莊家方勝利！',
    'score.defenderWins': '🛡️ 防守方勝利！',
    'score.required': '所需墩數',
    'score.declarerTricks': '莊家方得墩',
    'score.defenderTricks': '防守方得墩',
    'score.backToRoom': '返回房間',
    'chat.title': '聊天',
    'chat.placeholder': '輸入訊息...',
    'chat.send': '送出',
    'chat.playerJoined': '{name} 加入了房間',
    'chat.playerLeft': '{name} 離開了房間',
    'seat.N': '北',
    'seat.E': '東',
    'seat.S': '南',
    'seat.W': '西',
    'common.me': '（我）',
    'common.error': '發生錯誤',
    'common.loading': '載入中...',
    'connection.reconnecting': '重新連線中…',
    'connection.interrupted': '連線中斷，正在自動重試。',
    'app.crashed': '頁面發生錯誤或版本已更新，請重新整理。',
    'app.reload': '重新整理',
  },
  en: {
    ...socialTranslations.en,
    ...accountTranslations.en,
    ...replayTranslations.en,
    ...playerTranslations.en,
    ...audioTranslations.en,
    ...voiceTranslations.en,
    ...uiTranslations.en,
    ...emojiTranslations.en,
    ...gameTranslations.en,
    ...roomErrorTranslations.en,
    ...sevensTranslations.en,
    ...chinesePokerTranslations.en,
    ...liarsDeckTranslations.en,
    ...liarsDiceTranslations.en,
    ...blackjackTranslations.en,
    ...holdemTranslations.en,
    ...napoleonTranslations.en,
    ...tenHalfTranslations.en,
    ...crazyEightsTranslations.en,
    ...studTranslations.en,
    ...reversiTranslations.en,
    ...oldMaidTranslations.en,
    ...goFishTranslations.en,
    ...douDizhuTranslations.en,
    ...jungleTranslations.en,
    ...shopTranslations.en,
    ...dailyRewardsTranslations.en,
    ...achievementsTranslations.en,
    ...statsTranslations.en,
    ...boardTranslations.en,
    'lobby.nickname': 'Nickname',
    'lobby.nicknamePlaceholder': 'Enter nickname...',
    'lobby.color': 'Color',
    'lobby.createRoom': 'Create Room',
    'lobby.joinRoom': 'Join Room',
    'lobby.roomCodePlaceholder': 'Enter room code',
    'lobby.join': 'Join',
    'lobby.androidAppTitle': 'Android app',
    'lobby.androidAppDescription': 'Open the game full screen from your home screen. If Android warns about unknown apps, allow it to continue.',
    'lobby.androidAppDownload': 'Download APK',
    'lobby.androidAppDismiss': 'Hide the Android app notice',
    'room.title': 'Room',
    'room.code': 'Room Code',
    'room.copyCode': 'Copy',
    'room.leave': 'Leave Room',
    'room.ready': 'Ready',
    'room.unready': 'Unready',
    'room.seatEmpty': 'Empty',
    'room.notReady': 'Not ready',
    'room.ready.status': 'Ready',
    'room.addBot': 'Add bot',
    'room.removeBot': 'Remove bot',
    'room.fillBots': 'Fill empty seats with bots',
    'room.botDifficulty': 'Difficulty',
    'room.botDifficultyFor': 'Difficulty for {nickname}',
    'room.botControlsFor': 'Manage {nickname}',
    'room.botDifficulty.easy': 'Easy',
    'room.botDifficulty.hard': 'Hard',
    'player.bot': 'Bot',
    'player.botSeat': 'Bot ({seat})',
    'game.redealPending': 'Redeal Check',
    'game.playing': 'Playing',
    'game.scoring': 'Scoring',
    'game.contract': 'Contract',
    'game.pass': 'Pass',
    'game.passShort': 'P',
    'redeal.title': 'Redeal',
    'redeal.description': 'Your hand qualifies for a redeal (HCP ≤ 4, including a lone Ace). Request a redeal?',
    'redeal.accept': 'Redeal',
    'redeal.decline': 'Keep',
    'score.declarerWins': '🎉 Declarer Wins!',
    'score.defenderWins': '🛡️ Defenders Win!',
    'score.required': 'Required Tricks',
    'score.declarerTricks': 'Declarer Tricks',
    'score.defenderTricks': 'Defender Tricks',
    'score.backToRoom': 'Back to Room',
    'chat.title': 'Chat',
    'chat.placeholder': 'Type a message...',
    'chat.send': 'Send',
    'chat.playerJoined': '{name} joined the room',
    'chat.playerLeft': '{name} left the room',
    'seat.N': 'North',
    'seat.E': 'East',
    'seat.S': 'South',
    'seat.W': 'West',
    'common.me': '(me)',
    'common.error': 'An error occurred',
    'common.loading': 'Loading...',
    'connection.reconnecting': 'Reconnecting…',
    'connection.interrupted': 'Connection lost. Retrying automatically.',
    'app.crashed': 'Something went wrong or a new version is available. Reload to continue.',
    'app.reload': 'Reload',
  },
};

export type TranslationKey = keyof TranslationKeys;

/**
 * Get translated text
 */
export function t(key: TranslationKey, locale: Locale, params?: Record<string, string>): string {
  let text = translations[locale][key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, v);
    }
  }

  return text;
}

/**
 * Get all available locales
 */
export function getAvailableLocales(): Locale[] {
  return ['zh-TW', 'en'];
}
