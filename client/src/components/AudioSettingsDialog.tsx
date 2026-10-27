import type { ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import { useAudioSettingsDialogStore } from '../stores/audio-settings-dialog-store';
import { AudioSettings } from './AudioSettings';
import { dialogPaperClass } from '../styles/dialog';
import styles from './AudioSettingsDialog.module.css';

/** The one audio settings dialog; mount it once near the app root. */
export function AudioSettingsDialog(): ReactNode {
  const open = useAudioSettingsDialogStore((state) => state.open);
  const closeDialog = useAudioSettingsDialogStore((state) => state.closeDialog);
  return <Dialog open={open} onClose={closeDialog}
    slotProps={{ paper: { className: dialogPaperClass('medium', styles.dialog) } }}>
    <AudioSettings onClose={closeDialog} />
  </Dialog>;
}
