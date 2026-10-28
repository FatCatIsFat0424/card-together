import { createContext, lazy, Suspense, useContext, useLayoutEffect, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Popover from '@mui/material/Popover';
import { useLocation } from 'react-router-dom';
import { useAccountStore } from '../stores/account-store';
import { useRoomStore } from '../stores/room-store';
import { useVoiceStore } from '../stores/voice-store';
import { useI18nStore } from '../stores/i18n-store';
import { ActionButton } from './ActionButton';
import { IconButton } from './IconButton';
import styles from './VoiceControls.module.css';

const VoicePanel = lazy(() => import('./VoicePanel').then((module) => ({ default: module.VoicePanel })));
const VoiceControlsContext = createContext<{
  readonly anchor: HTMLButtonElement | null;
  readonly toggle: (button: HTMLButtonElement) => void;
  readonly setDockSlot: (slot: HTMLElement | null) => void;
} | null>(null);

/** Detached holder of the call panel; absent where there is no DOM, such as server-side rendering. */
function createPanelHost(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const host = document.createElement('div');
  host.style.display = 'contents';
  return host;
}

/** Keep the media owner mounted while room and game routes exchange their buttons. */
export function VoiceControls({ children }: { readonly children: ReactNode }): ReactNode {
  const { pathname } = useLocation();
  const accountId = useAccountStore((state) => state.account?.id);
  const roomCode = useRoomStore((state) => state.currentRoomCode);
  const { t } = useI18nStore();
  const [target, setTarget] = useState<{ button: HTMLButtonElement; path: string } | null>(null);
  // The panel owns the call, so its DOM node moves between the popover and a docked tab instead of remounting.
  const [panelHost] = useState(createPanelHost);
  const [popoverSlot, setPopoverSlot] = useState<HTMLElement | null>(null);
  const [dockSlot, setDockSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (panelHost) (dockSlot ?? popoverSlot)?.append(panelHost);
  }, [dockSlot, popoverSlot, panelHost]);
  const available = Boolean(accountId && roomCode);
  const anchor = available && target?.path === pathname && target.button.isConnected ? target.button : null;
  const close = (): void => setTarget(null);
  return <VoiceControlsContext.Provider value={{ anchor, setDockSlot, toggle: (button) => {
    setTarget(anchor === button ? null : { button, path: pathname });
  } }}>
    {children}
    {available && <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={close} keepMounted
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ paper: { className: styles.panel, id: 'table-voice-controls', role: 'dialog',
        'aria-label': t('voice.title') } }}>
      <div inert={!anchor} ref={setPopoverSlot} />
    </Popover>}
    {available && panelHost && createPortal(<Suspense fallback={null}><VoicePanel /></Suspense>, panelHost)}
  </VoiceControlsContext.Provider>;
}

/** The call panel as the body of a dock tab; while it is mounted the voice popover has nothing to show. */
export function VoiceDockPanel({ className }: { readonly className?: string }): ReactNode {
  const controls = useContext(VoiceControlsContext);
  return <div className={className} ref={controls?.setDockSlot} />;
}

export function VoiceButton({ className = '', labelled = false }: {
  readonly className?: string;
  /** A labelled page action whose text collapses in a narrow container, instead of a bare icon. */
  readonly labelled?: boolean;
}): ReactNode {
  const controls = useContext(VoiceControlsContext);
  const { t } = useI18nStore();
  const status = useVoiceStore((state) => state.status);
  const accountId = useAccountStore((state) => state.account?.id);
  const roomCode = useRoomStore((state) => state.currentRoomCode);
  if (!controls || !accountId || !roomCode) return null;
  const onClick = (event: MouseEvent<HTMLButtonElement>): void => controls.toggle(event.currentTarget);
  if (labelled) return <ActionButton className={className} icon="microphone" text={t('room.action.voice')}
    label={t('topbar.voice')} collapsible data-voice-control badge={status === 'joined' ? 'dot' : undefined}
    badgeTone="success" aria-haspopup="dialog" aria-expanded={Boolean(controls.anchor)}
    aria-controls="table-voice-controls" onClick={onClick} />;
  return <IconButton className={className} icon="microphone" label={t('topbar.voice')} data-voice-control
    badge={status === 'joined' ? 'dot' : undefined} badgeTone="success"
    aria-haspopup="dialog" aria-expanded={Boolean(controls.anchor)} aria-controls="table-voice-controls"
    onClick={onClick} />;
}
