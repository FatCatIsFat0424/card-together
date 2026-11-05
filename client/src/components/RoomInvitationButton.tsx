import { lazy, Suspense, useState } from 'react';
import type { ReactNode } from 'react';
import { normalizeRoomCode } from '../room-invitation';
import { useI18nStore } from '../stores/i18n-store';
import { ActionButton } from './ActionButton';

const RoomInvitationDialog = lazy(() => import('./RoomInvitationDialog').then((module) => ({
  default: module.RoomInvitationDialog,
})));

export function RoomInvitationButton({ code, collapsible = false, className }: {
  readonly code: string; readonly collapsible?: boolean; readonly className?: string;
}): ReactNode {
  const { t } = useI18nStore();
  const [open, setOpen] = useState(false);
  return <>
    <ActionButton icon="link" text={t('room.invitation.open')} collapsible={collapsible} className={className}
      aria-haspopup="dialog" disabled={!normalizeRoomCode(code)} onClick={() => setOpen(true)} />
    {open && <Suspense fallback={null}><RoomInvitationDialog key={code} code={code}
      onClose={() => setOpen(false)} /></Suspense>}
  </>;
}
