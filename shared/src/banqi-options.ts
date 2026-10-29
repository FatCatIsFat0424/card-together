import type { BanqiMatchOptions, BanqiOptions } from './games/banqi/types';
import type { BqRules } from './rules/banqi';

/** New rooms play the common Taiwanese house rule: chain captures, attacks on face-down pieces included. */
export const DEFAULT_BANQI_OPTIONS: BanqiOptions = { chain: true, rookDash: false };
/** Rooms saved before the options existed played every variant off. */
export const LEGACY_BANQI_OPTIONS: BanqiOptions = { chain: false, rookDash: false };

/** The fixed rules of a match started now: 連吃 brings attacks on face-down pieces with it. */
export const banqiMatchOptions = (options: BanqiOptions): BanqiMatchOptions => ({
  chain: options.chain, rookDash: options.rookDash, blindCapture: options.chain,
});

/** The rules a match plays; matches started before attacks on face-down pieces existed keep them off. */
export const banqiRules = (options: BanqiMatchOptions): BqRules => ({
  chain: options.chain, rookDash: options.rookDash, blindCapture: options.blindCapture === true,
});

export function isBanqiOptions(value: unknown): value is BanqiOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 2 && typeof candidate.chain === 'boolean'
    && typeof candidate.rookDash === 'boolean';
}

/** A match's rules: room options plus, since attacks on face-down pieces exist, whether it plays them. */
export function isBanqiMatchOptions(value: unknown): value is BanqiMatchOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { blindCapture, ...room } = value as Record<string, unknown>;
  // Attacks on face-down pieces come only with chain captures.
  return isBanqiOptions(room) && (blindCapture === undefined || blindCapture === room.chain);
}
