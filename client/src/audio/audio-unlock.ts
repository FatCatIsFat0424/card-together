/**
 * Trusted user gestures that may start audio. iOS Safari accepts click/touchend
 * but not pointerdown, so listeners register all of them.
 */
export const AUDIO_UNLOCK_EVENTS = ['pointerdown', 'keydown', 'click', 'touchend'] as const;
