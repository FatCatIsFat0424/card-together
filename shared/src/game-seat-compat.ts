import { GAME_SEAT_ORDER, FLEXIBLE_SEAT_GAMES } from './constants';

/** Expand legacy four-seat value maps without changing players or caller inputs. */
export function normalizeGameSeatMaps<T>(value: T): T {
  const copy: T = structuredClone(value);
  function visit(entry: unknown): void {
    if (!entry || typeof entry !== 'object') return;
    if (Array.isArray(entry)) { entry.forEach(visit); return; }
    const record = entry as Record<string, unknown>;
    const sample = record.N;
    if (['N', 'E', 'S', 'W'].every((seat) => Object.hasOwn(record, seat))
      && Object.keys(record).every((seat) => (GAME_SEAT_ORDER as readonly string[]).includes(seat))
      && (sample === null || Array.isArray(sample) || typeof sample === 'number' || typeof sample === 'boolean')) {
      // Pending bets mix wagers and null; all-numeric deal logs still need zero defaults.
      const nullableNumber = typeof sample === 'number' && Object.values(record).some((value) => value === null);
      for (const seat of GAME_SEAT_ORDER) if (!Object.hasOwn(record, seat)) {
        record[seat] = Array.isArray(sample) ? [] : sample === null || nullableNumber ? null : typeof sample === 'boolean' ? false : 0;
      }
    }
    for (const [key, child] of Object.entries(record)) if (key !== 'clock') visit(child);
  }
  visit(copy);
  return copy;
}

export function normalizeFlexibleGame<T extends { readonly gameType: string }>(game: T): T {
  if ('players' in game && game.players && typeof game.players === 'object'
    && Object.keys(game.players).some((seat) => seat.startsWith('P'))) return game;
  return (FLEXIBLE_SEAT_GAMES as readonly string[]).includes(game.gameType) ? normalizeGameSeatMaps(game) : game;
}
