import { setGain } from './audio-bus';

/**
 * Web Audio path for background music: element, music gain, master gain, speakers. iOS Safari treats
 * `HTMLMediaElement.volume` as read-only, so only gain nodes make the sliders work there.
 */
export interface MusicRoute {
  /** Sets the master and music channel gains (0-1 each). */
  setLevels: (master: number, music: number) => void;
  dispose: () => void;
}

export type MusicRouteFactory = (element: HTMLAudioElement) => MusicRoute | null;

let context: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  if (context && context.state !== 'closed') return context;
  context = null;
  if (typeof AudioContext === 'undefined') return null;
  try {
    context = new AudioContext();
  } catch {
    // Web Audio is optional; music then plays with plain element volume.
  }
  return context;
}

/**
 * Creates or resumes the music context; call from a trusted gesture. A context started outside a gesture stays
 * suspended, and a suspended context would silence any element routed through it, so routing waits until it runs.
 */
export function resumeMusicRoute(): void {
  const audio = ensureContext();
  if (audio && audio.state !== 'running') void audio.resume().catch(() => undefined);
}

/**
 * Routes an element through the shared music context, or returns null when Web Audio is unavailable or not yet
 * running so the caller keeps controlling volume on the element. An element can be routed only once.
 */
export const createMusicRoute: MusicRouteFactory = (element) => {
  const audio = ensureContext();
  if (!audio) return null;
  if (audio.state !== 'running') {
    resumeMusicRoute();
    return null;
  }
  try {
    const source = audio.createMediaElementSource(element);
    const music = audio.createGain();
    const master = audio.createGain();
    source.connect(music);
    music.connect(master);
    master.connect(audio.destination);
    return {
      setLevels: (masterLevel, musicLevel) => {
        setGain(audio, master, masterLevel);
        setGain(audio, music, musicLevel);
      },
      dispose: () => {
        for (const node of [source, music, master]) {
          try { node.disconnect(); } catch { /* Already disconnected. */ }
        }
      },
    };
  } catch {
    // Routing failed before the element was captured; plain element playback still works.
    return null;
  }
};
