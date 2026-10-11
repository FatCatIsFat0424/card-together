import type { SevensOptions, SevensSlayEffect } from './types/room';

export const DEFAULT_SEVENS_OPTIONS: SevensOptions = { closeOnEnd: false };

export const SEVENS_SLAY_EFFECTS: readonly SevensSlayEffect[] = ['dragon', 'fire'];

/** Length of the presentation after a Dragon Slaying close; the client scene uses the same values. */
export const SEVENS_SLAY_FRAME_MS: Readonly<Record<SevensSlayEffect, number>> = { dragon: 2900, fire: 1700 };

/** Missing on rooms and games saved before the choice existed; they keep the dragon. */
export function sevensSlayEffect(options: SevensOptions | undefined): SevensSlayEffect {
  return options?.slayEffect ?? 'dragon';
}

export function isSevensOptions(value: unknown): value is SevensOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).every((key) => key === 'closeOnEnd' || key === 'slayEffect')
    && typeof candidate.closeOnEnd === 'boolean'
    && (candidate.slayEffect === undefined || SEVENS_SLAY_EFFECTS.includes(candidate.slayEffect as SevensSlayEffect));
}
