/**
 * Subtitle of one scene: a single cue, or two cues shown in turn. Each cue holds one or two short
 * lines separated by `\n`.
 */
export type DemoText = string | readonly [string, string];

export interface DemoScene<TextKey extends string = string> {
  readonly text: TextKey;
  readonly seconds: number;
  readonly step: number;
  readonly until?: number;
  /** Seconds into the scene when a two-cue subtitle switches cues; defaults to half the scene. */
  readonly split?: number;
  /** Chinese poker: arranges one row with the real controls during the scene. */
  readonly interaction?: 'front' | 'middle' | 'back';
}
