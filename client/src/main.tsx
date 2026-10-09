// ─── React entry point ───

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installPreloadRecovery } from './preload-recovery';
import { applyTheme, useThemeStore } from './stores/theme-store';
import './styles/global.css';

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

installPreloadRecovery({
  target: window,
  storage: sessionStorageOrNull(),
  reload: () => window.location.reload(),
});
applyTheme(useThemeStore.getState().theme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
