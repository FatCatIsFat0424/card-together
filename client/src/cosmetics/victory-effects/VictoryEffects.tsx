import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { roomSeatInfo } from '@shared/rules/seats';
import type { GameSeat, PlayerVisibleGameState, RoomInfo } from '@shared/types';
import { tablePosition } from '../../game-view';
import { resultWinnerSeats } from '../../match-history';
import { useMotionStore } from '../../stores/motion-store';
import { runVictoryCanvas } from './victory-canvas';
import type { Point } from './victory-canvas';
import {
  VICTORY_DURATION_MS, VICTORY_STATIC_MS, createVictorySchedule, settlementKey, victoryPlays, visibleMatchResult,
} from './victory-schedule';
import type { VictorySchedule, VictoryStore } from './victory-schedule';
import styles from './VictoryEffects.module.css';

/** Several winners at once share a particle budget that low-end phones can keep up with. */
const SHARED_DENSITY = 2.2;
const SMALL_SCREEN = 600;

let schedule: VictorySchedule | null = null;

function sessionStore(): VictoryStore | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function centre(element: Element | null): Point | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width || rect.height ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
}

interface VictoryEffectsProps {
  readonly game: PlayerVisibleGameState;
  readonly room: RoomInfo;
  readonly bottomSeat: GameSeat;
  readonly seats: readonly GameSeat[];
}

/** Plays each winner's equipped effect once per settlement, from their seat, around the result dialog. */
export function VictoryEffects({ game, room, bottomSeat, seats }: VictoryEffectsProps): ReactNode {
  const reduced = useMotionStore((state) => state.reducedMotion);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [finishedKey, setFinishedKey] = useState<string | null>(null);
  const key = settlementKey(room.code, game);
  const result = visibleMatchResult(game);
  const plays = result ? victoryPlays(resultWinnerSeats(result), (seat) => roomSeatInfo(room, seat)?.player) : [];
  const signature = plays.map((play) => `${play.seat}:${play.effect}`).join(',');

  const currentPlays = useEffectEvent(() => plays);
  // Seat plates can move while the effect runs, e.g. when a spectator changes perspective.
  const seatOrigin = useEffectEvent((seat: GameSeat): Point | null => {
    const position = seats.includes(seat) ? tablePosition(seat, bottomSeat, seats) : null;
    return (position && centre(document.querySelector(`[data-table-seat="${position}"]`)))
      ?? centre(document.querySelector('[data-table-centre]'))
      ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !key || !signature) return;
    schedule ??= createVictorySchedule(sessionStore());
    const durationMs = reduced ? VICTORY_STATIC_MS : VICTORY_DURATION_MS;
    const startMs = schedule.claim(key, Date.now(), durationMs);
    if (startMs === null) return;
    const targets = currentPlays().map((play) => ({
      series: play.series, seed: `${key}:${play.seat}`, locate: () => seatOrigin(play.seat),
    }));
    const smallScreen = window.innerWidth < SMALL_SCREEN ? 0.75 : 1;
    return runVictoryCanvas(canvas, {
      targets, reduced, durationMs, startMs,
      density: Math.min(1, SHARED_DENSITY / targets.length) * smallScreen,
      scale: (width, height) => Math.min(1.1, Math.max(0.6, Math.min(width, height) / 760)),
      avoid: () => Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
        (dialog) => dialog.getBoundingClientRect()),
      onDone: () => setFinishedKey(key),
    });
  }, [key, signature, reduced]);

  if (!key || !signature || finishedKey === key) return null;
  return <canvas ref={canvasRef} className={styles.overlay} aria-hidden="true" />;
}
