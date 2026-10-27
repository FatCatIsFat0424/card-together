import { createContext, lazy, Suspense, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import Popover from '@mui/material/Popover';
import { useLocation } from 'react-router-dom';
import { useAccountStore } from '../stores/account-store';
import { useRoomStore } from '../stores/room-store';
import { useVoiceStore } from '../stores/voice-store';
import { useI18nStore } from '../stores/i18n-store';
import { IconButton } from './IconButton';
import styles from './VoiceControls.module.css';

const VoicePanel = lazy(() => import('./VoicePanel').then((module) => ({ default: module.VoicePanel })));
const VoiceControlsContext = createContext<{
  readonly anchor: HTMLButtonElement | null;
  readonly toggle: (button: HTMLButtonElement) => void;
} | null>(null);

/** Keep the media owner mounted while room and game routes exchange their buttons. */
export function VoiceControls({ children }: { readonly children: ReactNode }): ReactNode {
  const { pathname } = useLocation();
  const accountId = useAccountStore((state) => state.account?.id);
  const roomCode = useRoomStore((state) => state.currentRoomCode);
  const { t } = useI18nStore();
  const [target, setTarget] = useState<{ button: HTMLButtonElement; path: string } | null>(null);
  const available = Boolean(accountId && roomCode);
  const anchor = available && target?.path === pathname && target.button.isConnected ? target.button : null;
  const close = (): void => setTarget(null);
  return <VoiceControlsContext.Provider value={{ anchor, toggle: (button) => {
    setTarget(anchor === button ? null : { button, path: pathname });
  } }}>
    {children}
    {available && <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={close} keepMounted
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ paper: { className: styles.panel, id: 'table-voice-controls', role: 'dialog',
        'aria-label': t('voice.title') } }}>
      <div inert={!anchor}><Suspense fallback={null}><VoicePanel /></Suspense></div>
    </Popover>}
  </VoiceControlsContext.Provider>;
}

export function VoiceButton({ className = '' }: { readonly className?: string }): ReactNode {
  const controls = useContext(VoiceControlsContext);
  const { t } = useI18nStore();
  const status = useVoiceStore((state) => state.status);
  const accountId = useAccountStore((state) => state.account?.id);
  const roomCode = useRoomStore((state) => state.currentRoomCode);
  if (!controls || !accountId || !roomCode) return null;
  return <IconButton className={className} icon="microphone" label={t('topbar.voice')} data-voice-control
    badge={status === 'joined' ? 'dot' : undefined} badgeTone="success"
    aria-haspopup="dialog" aria-expanded={Boolean(controls.anchor)} aria-controls="table-voice-controls"
    onClick={(event) => controls.toggle(event.currentTarget)} />;
}
