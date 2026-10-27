// ─── ReplayViewer: a recorded match on the live game table, with a playback transport ───

import { Suspense, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameSeat, MatchReplay, MatchSummary, PublicAccount } from '@shared/types';
import { gameUi } from '../games/ui-registry';
import { ReplayModeContext } from '../games/replay-mode';
import type { ReplayMode } from '../games/replay-mode';
import { seatLabel } from '../games/seat-names';
import { createTableStores, TableStoreScope } from '../games/TableStoreScope';
import {
  createReplayTimeline, presentedReplaySnapshot, replayParticipants, replayRoom, replaySeatOf,
} from '../match-replay';
import { clampReplayStep, isReplaySpeed, REPLAY_SPEEDS } from '../replay-playback';
import type { ReplayControl, ReplaySpeed } from '../replay-playback';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from './AppIcon';
import type { AppIconName } from './AppIcon';
import styles from './ReplayViewer.module.css';

export interface ReplayViewerProps {
  readonly replay: MatchReplay;
  readonly match: MatchSummary;
  /** Recorded participants' public profiles, keyed by account ID. */
  readonly players: Readonly<Record<string, PublicAccount>>;
  /** Starts at the bottom of the table; viewers may rotate to any seat. */
  readonly viewedAccountId?: string;
  readonly step: number;
  readonly playing: boolean;
  readonly speed: ReplaySpeed;
  /** Transport commands, plus `advance` whenever a playing step's hold time elapses. */
  readonly onControl: (control: ReplayControl) => void;
  /** False for members watching a host-controlled shared replay. */
  readonly controlsEnabled: boolean;
  /** Shared playback keeps the live room's chat beside the table. */
  readonly chat?: boolean;
  /** Omitted when the viewer cannot leave playback from here. */
  readonly onClose?: () => void;
  /** Extra transport buttons, such as ending or leaving a shared replay. */
  readonly actions?: ReactNode;
}

/**
 * Renders the step snapshot in scoped stores as an unseated spectator with every hand visible.
 * Moving forward by exactly one step plays that step's presentation; any other move shows the
 * settled snapshot at once.
 */
export function ReplayViewer({
  replay, match, players, viewedAccountId, step, playing, speed, onControl, controlsEnabled, chat = false, onClose, actions,
}: ReplayViewerProps): ReactNode {
  const { t } = useI18nStore();
  const timeline = useMemo(() => createReplayTimeline(replay), [replay]);
  const total = timeline.total;
  const current = clampReplayStep(step, total);
  const [shown, setShown] = useState(() => ({ step: current, animate: current === 0 && playing }));
  if (shown.step !== current) setShown({ step: current, animate: current === shown.step + 1 });
  const snapshot = useMemo(() => presentedReplaySnapshot(
    shown.step > 0 ? timeline.snapshot(shown.step - 1) : null, timeline.snapshot(shown.step), shown.animate,
  ), [timeline, shown]);
  const room = useMemo(() => replayRoom(replay, match, replayParticipants(match, players, (seat: GameSeat, bot: boolean) => {
    const label = seatLabel(t, replay.gameType, seat);
    return bot ? t('player.botSeat', { seat: label }) : label;
  })), [replay, match, players, t]);
  // Filled before the first render so the table never reads an empty store.
  const [stores] = useState(() => {
    const created = createTableStores();
    created.room.getState().setRoom(room.code, room);
    created.game.getState().restore(snapshot);
    // The table updates god view after each change; a settled first step shows its hands at once.
    if (!shown.animate) created.godView.getState().update(snapshot, false);
    const seat = replaySeatOf(match, viewedAccountId);
    if (seat) created.perspective.getState().selectSeat(seat);
    return created;
  });
  useLayoutEffect(() => { stores.room.getState().setRoom(room.code, room); }, [stores, room]);
  useLayoutEffect(() => { stores.game.getState().restore(snapshot); }, [stores, snapshot]);

  const control = useRef(onControl);
  useLayoutEffect(() => { control.current = onControl; });
  useEffect(() => {
    if (!playing || current >= total) return;
    const timer = window.setTimeout(() => control.current({ type: 'advance' }), timeline.holdMs(current) / speed);
    return () => window.clearTimeout(timer);
  }, [playing, current, total, speed, timeline]);

  const mode = useMemo((): ReplayMode => ({
    chat, before: shown.animate && shown.step > 0 ? timeline.snapshot(shown.step - 1) : null,
  }), [chat, shown, timeline]);
  const Table = gameUi(replay.gameType).table;
  return <div className={styles.viewer} data-replay-viewer={replay.gameType}>
    <TableStoreScope stores={stores}>
      <ReplayModeContext value={mode}>
        <Suspense fallback={<p className={styles.loading} role="status">{t('replay.loading')}</p>}>
          <Table />
        </Suspense>
      </ReplayModeContext>
    </TableStoreScope>
    <ReplayTransport title={t('replay.title', { game: t(`gameType.${replay.gameType}`) })} step={current} total={total}
      playing={playing && current < total} speed={speed} enabled={controlsEnabled} onControl={onControl} onClose={onClose} actions={actions} />
  </div>;
}

function ReplayTransport({ title, step, total, playing, speed, enabled, onControl, onClose, actions }: {
  readonly title: string;
  readonly step: number;
  readonly total: number;
  readonly playing: boolean;
  readonly speed: ReplaySpeed;
  readonly enabled: boolean;
  readonly onControl: (control: ReplayControl) => void;
  readonly onClose?: () => void;
  readonly actions?: ReactNode;
}): ReactNode {
  const { t } = useI18nStore();
  const timelineId = useId();
  const speedId = useId();
  const atStart = !enabled || step === 0;
  const atEnd = !enabled || step === total;
  const button = (label: string, icon: AppIconName, disabled: boolean, command: ReplayControl): ReactNode =>
    <button type="button" className="btn btn-outline" title={label} aria-label={label} disabled={disabled}
      onClick={() => onControl(command)}><AppIcon name={icon} /></button>;
  return <div className={styles.transport} role="toolbar" aria-label={t('replay.controls')}>
    <span className={styles.title} title={t('replay.fullHandNotice')}>{title}</span>
    <div className={styles.buttons}>
      {button(t('replay.start'), 'previous', atStart, { type: 'start' })}
      {button(t('replay.previous'), 'previousPage', atStart, { type: 'previous' })}
      <button type="button" className={`btn btn-primary ${styles.play}`} disabled={!enabled || total === 0}
        title={t(playing ? 'replay.pause' : 'replay.play')} aria-label={t(playing ? 'replay.pause' : 'replay.play')}
        onClick={() => onControl({ type: playing ? 'pause' : 'play' })}>
        <AppIcon name={playing ? 'pause' : 'play'} />
      </button>
      {button(t('replay.next'), 'nextPage', atEnd, { type: 'next' })}
      {button(t('replay.end'), 'next', atEnd, { type: 'end' })}
    </div>
    <div className={styles.timeline}>
      <label htmlFor={timelineId} className={styles.srOnly}>{t('replay.timeline')}</label>
      <input id={timelineId} type="range" min={0} max={total} step={1} value={step} disabled={!enabled || total === 0}
        onChange={(event) => onControl({ type: 'seek', step: Number(event.target.value) })} />
      <output htmlFor={timelineId}>{t('replay.steps', { current: String(step), total: String(total) })}</output>
    </div>
    <label htmlFor={speedId} className={styles.srOnly}>{t('replay.speed')}</label>
    <select id={speedId} className={styles.speed} value={speed} disabled={!enabled} title={t('replay.speed')}
      onChange={(event) => {
        const value = Number(event.target.value);
        if (isReplaySpeed(value)) onControl({ type: 'speed', speed: value });
      }}>
      {REPLAY_SPEEDS.map((value) => <option key={value} value={value}>{value}×</option>)}
    </select>
    {!enabled && <span className={styles.note}>{t('replay.hostControls')}</span>}
    {actions && <div className={styles.actions}>{actions}</div>}
    {onClose && <button type="button" className={`btn btn-outline ${styles.close}`} onClick={onClose}
      title={t('table.close')} aria-label={t('table.close')}><AppIcon name="close" /></button>}
  </div>;
}
