import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ReplaySessionPosition, ReplayStepDuration } from '@shared/replay-session';
import type { RoomReplayArchive, RoomReplaySession } from '@shared/types';
import { socket } from '../socket';
import { ReplayViewer } from '../components/ReplayViewer';
import { createReplayTimeline } from '../match-replay';
import { isReplaySpeed } from '../replay-playback';
import type { ReplayControl } from '../replay-playback';
import { useGameStore } from '../stores/game-store';
import { useI18nStore } from '../stores/i18n-store';
import { usePlayerStore } from '../stores/player-store';
import { useRoomStore } from '../stores/room-store';
import {
  fallbackRoomReplayStepDuration, replayStarterName, roomReplayErrorKey, roomReplayPlayback, roomReplayPosition,
} from '../room-replay';
import type { RoomReplayControl } from '../room-replay';
import styles from './RoomReplayPage.module.css';

type ArchiveLoad =
  | { readonly key: string; readonly archive: RoomReplayArchive }
  | { readonly key: string; readonly error: ReturnType<typeof roomReplayErrorKey> | 'auth.connectionError' };

/** Re-renders when the shared position reaches its next step; between steps nothing changes. */
function useRoomReplayPosition(
  session: RoomReplaySession | null, clockOffset: number, stepDuration: ReplayStepDuration,
): ReplaySessionPosition | null {
  const [now, setNow] = useState(() => Date.now());
  // A stale `now` predates any newer anchor, which still yields the anchor step and its schedule.
  const position = session ? roomReplayPosition(session, clockOffset, now, stepDuration) : null;
  const nextStepAt = position?.nextStepAt ?? null;
  useEffect(() => {
    if (nextStepAt === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextStepAt - clockOffset - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [nextStepAt, clockOffset]);
  return position;
}

/** Viewer transport commands as host intents; `advance` is a local timing signal the shared clock replaces. */
function sharedControl(control: ReplayControl, step: number, lastStep: number): RoomReplayControl | null {
  switch (control.type) {
    case 'play': case 'pause': return { type: control.type };
    case 'previous': return { type: 'seek', step: step - 1 };
    case 'next': return { type: 'seek', step: step + 1 };
    case 'start': return { type: 'seek', step: 0 };
    case 'end': return { type: 'seek', step: lastStep };
    case 'seek': return { type: 'seek', step: control.step };
    case 'speed': return { type: 'speed', speed: control.speed };
    case 'advance': return null;
  }
}

/** Room-wide replay at `/room/:roomCode/replay`; members arrive here whenever the room is replaying. */
export function RoomReplayPage(): ReactNode {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const roomInfo = useRoomStore((state) => state.roomInfo);
  const clockOffset = useRoomStore((state) => state.replayClockOffset);
  const playerId = usePlayerStore((state) => state.playerId);
  const phase = useGameStore((state) => state.phase);
  const { t } = useI18nStore();
  const [load, setLoad] = useState<ArchiveLoad | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReturnType<typeof roomReplayErrorKey> | 'auth.connectionError' | null>(null);
  const hadRoom = useRef(false);
  const leaving = useRef(false);
  const session = roomInfo?.status === 'replaying' ? roomInfo.replay ?? null : null;
  const sessionKey = session ? `${session.subjectId}/${session.matchId}` : null;
  const isHost = Boolean(playerId) && roomInfo?.hostId === playerId;
  const current = load?.key === sessionKey ? load : null;
  const archive = current && 'archive' in current ? current.archive : null;
  const timeline = useMemo(() => archive ? createReplayTimeline(archive.replay) : null, [archive]);
  // Every member derives the step from the same presentation-based durations, so tables stay in step.
  const stepDuration = useMemo<ReplayStepDuration>(
    () => timeline ? (step) => timeline.holdMs(step) : fallbackRoomReplayStepDuration, [timeline]);
  const position = useRoomReplayPosition(session, clockOffset, stepDuration);

  useEffect(() => {
    if (leaving.current) return;
    if (!roomCode) { navigate('/', { replace: true }); return; }
    if (!roomInfo) {
      // A direct visit joins through the waiting room; losing the room afterwards returns to the lobby.
      navigate(hadRoom.current ? '/' : `/room/${roomCode}`, { replace: true });
      return;
    }
    hadRoom.current = true;
    if (phase) navigate(`/game/${roomInfo.code}`, { replace: true });
    else if (roomInfo.status !== 'replaying' || roomInfo.code !== roomCode) navigate(`/room/${roomInfo.code}`, { replace: true });
  }, [roomCode, roomInfo, phase, navigate]);

  useEffect(() => {
    if (!sessionKey) return;
    let active = true;
    socket.timeout(20000).emit('room:replay:load', (timeout, result) => {
      if (!active) return;
      if (timeout) setLoad({ key: sessionKey, error: 'auth.connectionError' });
      else if (result.success && result.archive) setLoad({ key: sessionKey, archive: result.archive });
      else setLoad({ key: sessionKey, error: roomReplayErrorKey(result.error) });
    });
    return () => { active = false; };
  }, [sessionKey, attempt]);

  const done = (timeout: Error | null, result?: { success: boolean; error?: string }): void => {
    setBusy(false);
    if (timeout) setError('auth.connectionError');
    else if (!result?.success) setError(roomReplayErrorKey(result?.error));
  };
  const control = (request: RoomReplayControl): void => {
    if (!session || !isHost || busy) return;
    setBusy(true);
    setError(null);
    // Read the clock now: the rendered position may be up to one step behind.
    const current = roomReplayPosition(session, clockOffset, Date.now(), stepDuration);
    socket.timeout(10000).emit('room:replay:control', roomReplayPlayback(session, current, request), done);
  };
  const end = (): void => {
    if (!session || !isHost || busy) return;
    setBusy(true);
    setError(null);
    socket.timeout(10000).emit('room:replay:end', done);
  };

  const leave = (): void => {
    leaving.current = true;
    setBusy(true);
    socket.timeout(10000).emit('room:leave', (timeout, result) => {
      setBusy(false);
      if (!timeout && result.success) {
        useRoomStore.getState().leaveRoom();
        navigate('/');
      } else {
        leaving.current = false;
        setError(timeout ? 'auth.connectionError' : roomReplayErrorKey(result.error));
      }
    });
  };

  if (!roomInfo || !session || !position) return <main className={styles.page}>
    <p role="status">{t('common.loading')}</p>
  </main>;

  if (archive) {
    const starter = replayStarterName(roomInfo, session, archive.players);
    return <Dialog open fullScreen
      slotProps={{ paper: { className: styles.dialog,
        'aria-label': t('replay.sharedTitle', { game: t(`gameType.${session.gameType}`) }) } }}>
      <ReplayViewer key={sessionKey} replay={archive.replay} match={archive.match} players={archive.players}
        viewedAccountId={playerId ?? undefined} step={position.step} playing={session.playing && !position.finished}
        speed={isReplaySpeed(session.speed) ? session.speed : 1} controlsEnabled={isHost && !busy} chat
        onControl={(request) => {
          const next = sharedControl(request, position.step, session.lastStep);
          if (next) control(next);
        }}
        actions={<>
          {error ? <span role="alert" className={styles.error}>{t(error)}</span>
            : starter && <span className={styles.meta}>{t('replay.sharedStartedBy', { name: starter })}</span>}
          {isHost && <button type="button" className="btn btn-danger" disabled={busy} onClick={end}>{t('replay.sharedEnd')}</button>}
          <button type="button" className="btn btn-outline" disabled={busy} onClick={leave}>{t('room.leave')}</button>
        </>} />
    </Dialog>;
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <span className={styles.code}>{roomInfo.code}</span>
      <div className={styles.actions}>
        {isHost && <button type="button" className="btn btn-danger" disabled={busy}
          onClick={end}>{t('replay.sharedEnd')}</button>}
        <button type="button" className="btn btn-outline" disabled={busy} onClick={leave}>{t('room.leave')}</button>
      </div>
    </header>
    {error && <p role="alert" className={styles.error}>{t(error)}</p>}
    <div className={styles.body}>
      {!current && <p role="status" className={styles.stage}>{t('replay.loading')}</p>}
      {current && 'error' in current && <div role="alert" className={styles.stage}>
        <p>{t(current.error)}</p>
        <button type="button" className="btn btn-outline" onClick={() => setAttempt((value) => value + 1)}>
          {t('common.retry')}</button>
        <Link to="/">{t('nav.lobby')}</Link>
      </div>}
    </div>
  </main>;
}
