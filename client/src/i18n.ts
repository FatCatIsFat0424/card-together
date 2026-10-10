// ─── i18n system ───

import { accountTranslations } from './account-i18n';
import type { AccountTranslationKey } from './account-i18n';
import { playerTranslations } from './player-i18n';
import type { PlayerTranslationKey } from './player-i18n';
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
import { blackjackTranslations } from './blackjack-i18n';
import type { BlackjackTranslationKey } from './blackjack-i18n';

export type Locale = 'zh-TW' | 'en';

type TranslationKeys = Record<
  AccountTranslationKey | PlayerTranslationKey | VoiceTranslationKey | UiTranslationKey
    | EmojiTranslationKey | GameTranslationKey | SevensTranslationKey | ChinesePokerTranslationKey
    | LiarsDeckTranslationKey | BlackjackTranslationKey, string
> & {
  // Lobby
  'lobby.title': string;
  'lobby.subtitle': string;
  'lobby.nickname': string;
  'lobby.nicknamePlaceholder': string;
  'lobby.color': string;
  'lobby.createRoom': string;
  'lobby.joinRoom': string;
  'lobby.roomCodePlaceholder': string;
  'lobby.join': string;
  // Room
  'room.title': string;
  'room.code': string;
  'room.copyCode': string;
  'room.leave': string;
  'room.ready': string;
  'room.unready': string;
  'room.waiting': string;
  'room.seatEmpty': string;
  'room.seatTaken': string;
  'room.ready.status': string;
  'room.addBot': string;
  'room.removeBot': string;
  'room.fillBots': string;
  'room.botReady': string;
  'player.bot': string;
  'player.botSeat': string;
  // Game
  'game.dealing': string;
  'game.redealPending': string;
  'game.bidding': string;
  'game.playing': string;
  'game.scoring': string;
  'game.contract': string;
  'game.mySeat': string;
  'game.myTurn': string;
  'game.waitingFor': string;
  'game.pass': string;
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
    ...accountTranslations['zh-TW'],
    ...playerTranslations['zh-TW'],
    ...voiceTranslations['zh-TW'],
    ...uiTranslations['zh-TW'],
    ...emojiTranslations['zh-TW'],
    ...gameTranslations['zh-TW'],
    ...sevensTranslations['zh-TW'],
    ...chinesePokerTranslations['zh-TW'],
    ...liarsDeckTranslations['zh-TW'],
    ...blackjackTranslations['zh-TW'],
    'lobby.title': 'Card Together',
    'lobby.subtitle': '橋牌、大老二、撿紅點、99、牌七、十三支、騙子酒館、21 點，線上同桌一起玩',
    'lobby.nickname': '暱稱',
    'lobby.nicknamePlaceholder': '輸入暱稱...',
    'lobby.color': '顏色',
    'lobby.createRoom': '建立房間',
    'lobby.joinRoom': '加入房間',
    'lobby.roomCodePlaceholder': '輸入房間代碼',
    'lobby.join': '加入',
    'room.title': '房間',
    'room.code': '房間代碼',
    'room.copyCode': '複製',
    'room.leave': '離開房間',
    'room.ready': '準備',
    'room.unready': '取消準備',
    'room.waiting': '等待玩家就座並準備...',
    'room.seatEmpty': '空位',
    'room.seatTaken': '已就座',
    'room.ready.status': '已準備',
    'room.addBot': '加入 bot',
    'room.removeBot': '移除 bot',
    'room.fillBots': '用 bot 補滿空位',
    'room.botReady': 'bot 已自動準備',
    'player.bot': 'bot',
    'player.botSeat': 'bot（{seat}）',
    'game.dealing': '發牌中',
    'game.redealPending': '倒牌確認',
    'game.bidding': '叫牌',
    'game.playing': '出牌',
    'game.scoring': '結算',
    'game.contract': '合約',
    'game.mySeat': '我的座位',
    'game.myTurn': '🎯 輪到你出牌！',
    'game.waitingFor': '等待 {seat} 出牌',
    'game.pass': 'Pass',
    'redeal.title': '倒牌重洗',
    'redeal.description': '你的手牌符合倒牌重洗條件（無 A 且點數 ≤ 4），是否要求重新發牌？',
    'redeal.accept': '重洗',
    'redeal.decline': '不要',
    'score.declarerWins': '🎉 莊家方勝利！',
    'score.defenderWins': '🛡️ 防守方勝利！',
    'score.required': '所需墩數',
    'score.declarerTricks': '莊家方得墩',
    'score.defenderTricks': '防守方得墩',
    'score.backToRoom': '返回房間',
    'chat.title': '💬 聊天',
    'chat.placeholder': '輸入訊息...',
    'chat.send': '送出',
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
    ...accountTranslations.en,
    ...playerTranslations.en,
    ...voiceTranslations.en,
    ...uiTranslations.en,
    ...emojiTranslations.en,
    ...gameTranslations.en,
    ...sevensTranslations.en,
    ...chinesePokerTranslations.en,
    ...liarsDeckTranslations.en,
    ...blackjackTranslations.en,
    'lobby.title': 'Card Together',
    'lobby.subtitle': "Bridge, Big Two, Red Points, Ninety-Nine, Sevens, Chinese Poker, Liar's Deck, and Blackjack with friends online",
    'lobby.nickname': 'Nickname',
    'lobby.nicknamePlaceholder': 'Enter nickname...',
    'lobby.color': 'Color',
    'lobby.createRoom': 'Create Room',
    'lobby.joinRoom': 'Join Room',
    'lobby.roomCodePlaceholder': 'Enter room code',
    'lobby.join': 'Join',
    'room.title': 'Room',
    'room.code': 'Room Code',
    'room.copyCode': 'Copy',
    'room.leave': 'Leave Room',
    'room.ready': 'Ready',
    'room.unready': 'Unready',
    'room.waiting': 'Waiting for players...',
    'room.seatEmpty': 'Empty',
    'room.seatTaken': 'Seated',
    'room.ready.status': 'Ready',
    'room.addBot': 'Add bot',
    'room.removeBot': 'Remove bot',
    'room.fillBots': 'Fill empty seats with bots',
    'room.botReady': 'Bot is automatically ready',
    'player.bot': 'Bot',
    'player.botSeat': 'Bot ({seat})',
    'game.dealing': 'Dealing',
    'game.redealPending': 'Redeal Check',
    'game.bidding': 'Bidding',
    'game.playing': 'Playing',
    'game.scoring': 'Scoring',
    'game.contract': 'Contract',
    'game.mySeat': 'My Seat',
    'game.myTurn': '🎯 Your turn!',
    'game.waitingFor': 'Waiting for {seat}',
    'game.pass': 'Pass',
    'redeal.title': 'Redeal',
    'redeal.description': 'Your hand qualifies for a redeal (no Aces, HCP ≤ 4). Request a redeal?',
    'redeal.accept': 'Redeal',
    'redeal.decline': 'Keep',
    'score.declarerWins': '🎉 Declarer Wins!',
    'score.defenderWins': '🛡️ Defenders Win!',
    'score.required': 'Required Tricks',
    'score.declarerTricks': 'Declarer Tricks',
    'score.defenderTricks': 'Defender Tricks',
    'score.backToRoom': 'Back to Room',
    'chat.title': '💬 Chat',
    'chat.placeholder': 'Type a message...',
    'chat.send': 'Send',
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
      text = text.replace(`{${k}}`, v);
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
