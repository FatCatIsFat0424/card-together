import type { SevensOptions, SevensSlayEffect } from './types/room';

/** New Sevens rooms start with Dragon Slaying on. */
export const DEFAULT_SEVENS_OPTIONS: SevensOptions = { closeOnEnd: true };
/** Rooms and games saved before the options existed played standard rules, so a missing value means off. */
export const LEGACY_SEVENS_OPTIONS: SevensOptions = { closeOnEnd: false };

export const SEVENS_SLAY_EFFECTS: readonly SevensSlayEffect[] = ['dragon', 'fire'];

/** Length of the presentation after a Dragon Slaying close; the client scene uses the same values. */
export const SEVENS_SLAY_FRAME_MS: Readonly<Record<SevensSlayEffect, number>> = { dragon: 2200, fire: 1700 };

/** When Dragon Slaying closes the last suit, the table collapses, then holds broken before the result. */
export const SEVENS_COLLAPSE_MS = 1800;
export const SEVENS_COLLAPSE_SETTLE_MS = 2000;

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
