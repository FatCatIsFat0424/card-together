import { useEffect, useReducer, useState } from 'react';
import type { ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import type { MatchReplay, MatchSummary, PublicAccount } from '@shared/types';
import { apiRequest } from '../api';
import { isPlayableReplay } from '../match-replay';
import { initialReplayPlayback, replayPlaybackReducer } from '../replay-playback';
import type { ReplayControl, ReplayPlayback } from '../replay-playback';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from './AppIcon';
import { ReplayViewer } from './ReplayViewer';
import styles from './MatchReplayDialog.module.css';

type ReplayError = 'replay.failed' | 'replay.private' | 'replay.unavailable';

/** Personal playback: the viewer owns its transport state and opens playing from the start. */
export function PersonalReplay({ replay, match, players, accountId, onClose }: {
  readonly replay: MatchReplay;
  readonly match: MatchSummary;
  readonly players: Readonly<Record<string, PublicAccount>>;
  readonly accountId: string;
  readonly onClose: () => void;
}): ReactNode {
  const total = replay.steps.length;
  const [playback, dispatch] = useReducer(
    (state: ReplayPlayback, control: ReplayControl) => replayPlaybackReducer(state, control, total),
    total, initialReplayPlayback,
  );
  return <ReplayViewer replay={replay} match={match} players={players} viewedAccountId={accountId}
    step={playback.step} playing={playback.playing} speed={playback.speed} onControl={dispatch}
    controlsEnabled onClose={onClose} />;
}

export function MatchReplayDialog({ match, players, accountId, onClose }: {
  readonly match: MatchSummary;
  readonly players: Readonly<Record<string, PublicAccount>>;
  readonly accountId: string;
  readonly onClose: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  const [replay, setReplay] = useState<MatchReplay | null>(null);
  const [error, setError] = useState<ReplayError | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void apiRequest<{ replay: MatchReplay }>(`/api/players/${encodeURIComponent(accountId)}/history/${encodeURIComponent(match.id)}/replay`)
      .then((response) => {
        if (!active) return;
        if (response.success && isPlayableReplay(response.replay, match)) setReplay(response.replay);
        else setError(response.success ? 'replay.failed' : response.status === 403 ? 'replay.private'
          : response.status === 404 ? 'replay.unavailable' : 'replay.failed');
      });
    return () => { active = false; };
  }, [accountId, match, attempt]);

  return <Dialog open fullScreen onClose={onClose}
    slotProps={{ paper: { className: styles.dialog, 'aria-label': t('replay.title', { game: t(`gameType.${match.result.gameType}`) }) } }}>
    {replay ? <PersonalReplay replay={replay} match={match} players={players} accountId={accountId} onClose={onClose} />
      : <div className={styles.feedback}>
        {error ? <div role="alert"><p>{t(error)}</p>
          {error === 'replay.failed' && <button type="button" className="btn btn-outline"
            onClick={() => { setError(null); setAttempt((value) => value + 1); }}>{t('common.retry')}</button>}</div>
          : <p role="status">{t('replay.loading')}</p>}
        <button type="button" className={`btn btn-outline ${styles.close}`} onClick={onClose}
          aria-label={t('table.close')} title={t('table.close')}><AppIcon name="close" /></button>
      </div>}
  </Dialog>;
}
