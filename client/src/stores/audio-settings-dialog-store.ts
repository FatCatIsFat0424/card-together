import { create } from 'zustand';

interface AudioSettingsDialogState {
  open: boolean;
  openDialog: () => void;
  closeDialog: () => void;
}

/** Shared by every entry point (top bar, game menu, voice panel) so they all open one dialog. */
export const useAudioSettingsDialogStore = create<AudioSettingsDialogState>((set) => ({
  open: false,
  openDialog: () => set({ open: true }),
  closeDialog: () => set({ open: false }),
}));
