// Five-Card Stud strings. Betting, pot, and hand-category wording is shared with Hold'em (holdem-i18n.ts).
const english = {
  'stud.stakes': 'Ante {ante} · min bet {bet}',
  'stud.antesIn': 'Antes {n} each',
  'stud.street.2': '2nd card',
  'stud.street.3': '3rd card',
  'stud.street.4': '4th card',
  'stud.street.5': '5th card',
  'stud.hole': 'Hole card',
  'stud.up': 'Up cards',
  'stud.rulesChips': 'No-limit Five-Card Stud. Everyone starts with 1000 chips; every hand costs an ante of 10, rising every 4 hands to 15, 25, 40, and 60.',
  'stud.rulesDeal': 'Each seat gets one face-down hole card and one face-up card, then one more face-up card per round. Betting follows each of the four deals.',
  'stud.rulesAction': 'The best showing cards act first in every round (a pair beats high cards; equal ranks break by suit: spades, hearts, diamonds, clubs), then play goes clockwise. Check, bet, call, raise up to all your chips (all-in). On timeout you check, or fold if you owe chips.',
  'stud.rulesShowdown': 'After the fifth card, remaining seats turn over their hole cards and the best five-card hand wins each main and side pot. The match ends when one seat has every chip or after 20 hands; most chips wins.',
  'stud.presentationDeal': 'Antes in, first cards dealt',
  'stud.presentationStreet': 'Up cards dealt',
  'history.ante': 'Ante',
} as const;

export type StudTranslationKey = keyof typeof english;

export const studTranslations: Record<'en' | 'zh-TW', Record<StudTranslationKey, string>> = {
  en: english,
  'zh-TW': {
    'stud.stakes': '前注 {ante} · 最小下注 {bet}',
    'stud.antesIn': '每人前注 {n}',
    'stud.street.2': '第 2 張',
    'stud.street.3': '第 3 張',
    'stud.street.4': '第 4 張',
    'stud.street.5': '第 5 張',
    'stud.hole': '底牌',
    'stud.up': '明牌',
    'stud.rulesChips': '無限注梭哈。每人起始 1000 籌碼；每手先付前注 10，每 4 手提高到 15、25、40、60。',
    'stud.rulesDeal': '每人先拿 1 張蓋著的底牌和 1 張明牌，之後每輪再發 1 張明牌。四次發牌後各有一輪下注。',
    'stud.rulesAction': '每輪都由明牌最大的人先行動（一對大於單張；點數相同時依花色 ♠ > ♥ > ♦ > ♣），之後順時針進行。可過牌、下注、跟注、加注，最多全部籌碼（梭哈）。逾時自動過牌，欠下注時棄牌。',
    'stud.rulesShowdown': '第五張發完後，剩下的人亮出底牌，五張牌最好者贏得各個主池和邊池。有人贏走所有籌碼或打完 20 手後結束，籌碼最多者獲勝。',
    'stud.presentationDeal': '付前注，發出第一批牌',
    'stud.presentationStreet': '發明牌',
    'history.ante': '前注',
  },
};
