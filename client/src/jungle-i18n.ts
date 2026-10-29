const english = {
  'jungle.red': 'Red',
  'jungle.blue': 'Blue',
  'jungle.sideRed': 'Plays red, moves first',
  'jungle.sideBlue': 'Plays blue',
  'jungle.pieces': '{n} pieces',
  'jungle.board': 'Jungle board',
  'jungle.animal.rat': 'Rat',
  'jungle.animal.cat': 'Cat',
  'jungle.animal.dog': 'Dog',
  'jungle.animal.wolf': 'Wolf',
  'jungle.animal.leopard': 'Leopard',
  'jungle.animal.tiger': 'Tiger',
  'jungle.animal.lion': 'Lion',
  'jungle.animal.elephant': 'Elephant',
  'jungle.rulesRanks': 'Elephant > lion > tiger > leopard > wolf > dog > cat > rat. A piece captures an equal or lower rank; the rat captures the elephant, but not the other way round.',
  'jungle.rulesRiver': 'Only the rat swims. Lions and tigers jump across the river in a straight line unless a rat is in the way.',
  'jungle.rulesWin': 'Enter the opponent’s den, capture every opposing piece, or leave them with no legal move. A piece in the opponent’s trap counts as rank 0.',
};

export type JungleTranslationKey = keyof typeof english;

export const jungleTranslations: Record<'en' | 'zh-TW', Record<JungleTranslationKey, string>> = {
  en: english,
  'zh-TW': {
    'jungle.red': '紅',
    'jungle.blue': '藍',
    'jungle.sideRed': '執紅，先手',
    'jungle.sideBlue': '執藍',
    'jungle.pieces': '{n} 子',
    'jungle.board': '鬥獸棋棋盤',
    'jungle.animal.rat': '鼠',
    'jungle.animal.cat': '貓',
    'jungle.animal.dog': '狗',
    'jungle.animal.wolf': '狼',
    'jungle.animal.leopard': '豹',
    'jungle.animal.tiger': '虎',
    'jungle.animal.lion': '獅',
    'jungle.animal.elephant': '象',
    'jungle.rulesRanks': '象＞獅＞虎＞豹＞狼＞狗＞貓＞鼠；大吃小，同級可互吃，鼠可以吃象，象不能吃鼠。',
    'jungle.rulesRiver': '只有鼠可以下河；獅、虎可以直線跳過河，河中有鼠擋住時不行。',
    'jungle.rulesWin': '進入對方獸穴、吃光對方，或讓對方無子可動者勝；進入對方陷阱的棋子等級視為 0。',
  },
};
