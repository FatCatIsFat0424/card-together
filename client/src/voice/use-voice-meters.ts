import { useEffect, useRef, useState } from 'react';
import { currentVoiceGain } from '../stores/audio-settings-store';
import { monitorStream, watchLevel } from './voice-levels';

/** Calls `onLevel` with the stream's loudness every frame; the callback writes to the DOM, so nothing re-renders. */
export function useStreamLevel(stream: MediaStream | null, onLevel: (level: number) => void): void {
  const latest = useRef(onLevel);
  useEffect(() => { latest.current = onLevel; });
  useEffect(() => stream ? watchLevel(stream, (level) => latest.current(level)) : undefined, [stream]);
}

export interface MicTest {
  /** Stream the meter reads: the call's microphone while joined, a temporary one while testing before joining. */
  readonly stream: MediaStream | null;
  readonly testing: boolean;
  /** The microphone could not be opened for the test. */
  readonly failed: boolean;
  toggle(): void;
}

/**
 * Self-monitoring microphone test. While joined the call's own stream is metered and testing only adds playback;
 * before joining, testing opens the chosen microphone temporarily and releases it when testing ends.
 */
export function useMicTest(joinedStream: MediaStream | null, inputDeviceId: string | null): MicTest {
  const [testing, setTesting] = useState(false);
  const [temporary, setTemporary] = useState<MediaStream | null>(null);
  const [failed, setFailed] = useState(false);
  const stream = joinedStream ?? temporary;

  useEffect(() => {
    if (!testing || joinedStream) return;
    let cancelled = false;
    let acquired: MediaStream | null = null;
    navigator.mediaDevices?.getUserMedia({
      audio: inputDeviceId ? { deviceId: { exact: inputDeviceId } } : true, video: false,
    }).then((opened) => {
      if (cancelled) opened.getTracks().forEach((track) => track.stop());
      else { acquired = opened; setTemporary(opened); }
    }, () => {
      if (cancelled) return;
      setFailed(true);
      setTesting(false);
    });
    if (!navigator.mediaDevices?.getUserMedia) {
      queueMicrotask(() => { setFailed(true); setTesting(false); });
    }
    return () => {
      cancelled = true;
      acquired?.getTracks().forEach((track) => track.stop());
      setTemporary(null);
    };
  }, [testing, joinedStream, inputDeviceId]);

  useEffect(() => testing && stream ? monitorStream(stream, currentVoiceGain()) : undefined, [testing, stream]);

  return {
    stream, testing, failed,
    toggle: () => { setFailed(false); setTesting((current) => !current); },
  };
}
