const english = {
  'reversi.dark': 'Black',
  'reversi.light': 'White',
  'reversi.sideDark': 'Plays black, moves first',
  'reversi.sideLight': 'Plays white',
  'reversi.discs': '{n} discs',
  'reversi.passed': '{name} has no legal move; skipped',
  'reversi.board': 'Reversi board',
  'reversi.rulesFlip': 'Place a disc so it traps a line of the opponent’s discs against one of yours; the trapped discs flip.',
  'reversi.rulesPass': 'A player with no legal move is skipped automatically.',
  'reversi.rulesEnd': 'When neither side can move, more discs wins; equal counts draw.',
};

export type ReversiTranslationKey = keyof typeof english;

export const reversiTranslations: Record<'en' | 'zh-TW', Record<ReversiTranslationKey, string>> = {
  en: english,
  'zh-TW': {
    'reversi.dark': '黑',
    'reversi.light': '白',
    'reversi.sideDark': '執黑，先手',
    'reversi.sideLight': '執白',
    'reversi.discs': '{n} 子',
    'reversi.passed': '{name}無子可下，跳過',
    'reversi.board': '黑白棋棋盤',
    'reversi.rulesFlip': '落子後，夾住的對手棋子會翻成自己的顏色。',
    'reversi.rulesPass': '沒有合法位置時自動跳過。',
    'reversi.rulesEnd': '雙方都無子可下時，棋子較多者獲勝；數量相同為和局。',
  },
};
