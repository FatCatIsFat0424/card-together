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
  'stud.rulesChips': 'Start with 1000 chips. Win all chips, or hold the most after 20 hands. Antes start at 10 and rise every four hands.',
  'stud.rulesDeal': 'Receive one private card and one face-up card, then three more face-up cards. Each deal is followed by betting.',
  'stud.rulesAction': 'The strongest showing cards act first, then play goes clockwise. Fold, check, call, bet, or raise; you may go all-in.',
  'stud.rulesShowdown': 'After the fifth card, reveal private cards and compare five-card hands for each pot. If everyone else folds, the remaining player wins.',
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
    'stud.rulesChips': '每人 1000 籌碼；贏走所有籌碼，或 20 手後籌碼最多者獲勝。前注從 10 起，每 4 手提高。',
    'stud.rulesDeal': '先拿一張暗牌、一張明牌，再逐輪發三張明牌；每次發牌後都有一輪下注。',
    'stud.rulesAction': '每輪明牌最大者先行動，再依順時針進行。可棄牌、過牌、跟注、下注或加注，最多全下。',
    'stud.rulesShowdown': '第五張發完後攤開暗牌，用五張牌比大小，各池分別結算。其他人全棄牌時，留下者直接贏。',
    'stud.presentationDeal': '付前注，發出第一批牌',
    'stud.presentationStreet': '發明牌',
    'history.ante': '前注',
  },
};
