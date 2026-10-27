import type { HistoryInputOf, RoundBuilder } from '../round-builder';

export function deriveLiarsDeckRounds(game: HistoryInputOf<'liarsdeck'>, builder: RoundBuilder): void {
  for (const entry of game.log) {
    if (entry.type === 'round') {
      const open = builder.current();
      if (open) open.complete = true;
      builder.start().tableFace = entry.tableFace;
      continue;
    }
    const round = builder.open();
    if (entry.type === 'play') {
      round.actions.push({ kind: 'play', seat: entry.seat, cards: [], count: entry.count });
    } else if (entry.type === 'challenge') {
      round.actions.push({ kind: 'challenge', seat: entry.seat, cards: [], target: entry.target,
        faces: entry.revealed, lied: entry.lied });
    } else {
      round.actions.push({ kind: 'shot', seat: entry.seat, cards: [], shot: entry.shot, survived: entry.survived });
      round.complete = true;
    }
  }
}
