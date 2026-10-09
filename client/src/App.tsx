// ─── Root component ───

import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { InviteToast } from './components/InviteToast';
import { AbortVoteToast } from './games/AbortVote';
import { useAccountConnection } from './hooks/use-account-connection';
import { restoreAccount, useAccountStore } from './stores/account-store';
import { useI18nStore } from './stores/i18n-store';
import { ConnectionBanner } from './components/ConnectionBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { reconnectSocket } from './socket';
import { APP_BASE_PATH } from './deployment';
import styles from './pages/AccountPages.module.css';
import appStyles from './App.module.css';

const LobbyPage = lazy(() => import('./pages/LobbyPage').then((page) => ({ default: page.LobbyPage })));
const RoomPage = lazy(() => import('./pages/RoomPage').then((page) => ({ default: page.RoomPage })));
const GamePage = lazy(() => import('./pages/GamePage').then((page) => ({ default: page.GamePage })));
const AuthPage = lazy(() => import('./pages/AuthPage').then((page) => ({ default: page.AuthPage })));
const AccountPage = lazy(() => import('./pages/AccountPage').then((page) => ({ default: page.AccountPage })));
const FriendsPage = lazy(() => import('./pages/FriendsPage').then((page) => ({ default: page.FriendsPage })));
const PlayerProfilePage = lazy(() => import('./pages/PlayerProfilePage')
  .then((page) => ({ default: page.PlayerProfilePage })));

function PageLoading(): ReactNode {
  const { t } = useI18nStore();
  return <main className={styles.status}><p role="status">{t('common.loading')}</p></main>;
}

function ProtectedRoute(): ReactNode {
  const accountId = useAccountStore((state) => state.account?.id);
  const connection = useAccountStore((state) => state.connection);
  const hasConnected = useAccountStore((state) => state.hasConnected);
  const location = useLocation();
  const { t } = useI18nStore();
  if (!accountId) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  // After the first ready snapshot, keep pages mounted so drafts and selections survive drops.
  if (hasConnected) return <>
    <ConnectionBanner />
    <Suspense fallback={<PageLoading />}><Outlet /></Suspense>
  </>;
  return <main className={styles.status}>
    <p role="status">{t(connection === 'error' ? 'auth.connectionError' : 'auth.connecting')}</p>
    {connection === 'error' && <button className="btn btn-primary"
      onClick={reconnectSocket}>{t('common.retry')}</button>}
  </main>;
}

function AppRoutes(): ReactNode {
  useAccountConnection();
  const status = useAccountStore((state) => state.status);
  const error = useAccountStore((state) => state.error);
  const { t } = useI18nStore();
  if (status === 'loading' || status === 'error') return <main className={styles.status}>
    <p role="status">{status === 'loading' ? t('common.loading') : error}</p>
    {status === 'error' && <button className="btn btn-primary" onClick={() => void restoreAccount()}>
      {t('common.retry')}</button>}
  </main>;
  return (
    <Suspense fallback={<PageLoading />}>
    <Routes>
      <Route path="/login" element={<AuthPage key="login" mode="login" />} />
      <Route path="/register" element={<AuthPage key="register" mode="register" />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<LobbyPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/friends" element={<FriendsPage />} />
        <Route path="/players/:accountId" element={<PlayerProfilePage />} />
        <Route path="/room/:roomCode" element={<RoomPage />} />
        <Route path="/game/:roomCode" element={<GamePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}

// Navigating away from a failed page clears the error while the top bar stays usable.
function RouteErrorBoundary({ children }: { readonly children: ReactNode }): ReactNode {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}

export function App(): ReactNode {
  const signedIn = useAccountStore((state) => Boolean(state.account));
  return (
    <BrowserRouter basename={APP_BASE_PATH}>
      <TopBar />
      {signedIn && <InviteToast />}
      {signedIn && <AbortVoteToast />}
      <div className={appStyles.viewport}>
        <RouteErrorBoundary><AppRoutes /></RouteErrorBoundary>
      </div>
    </BrowserRouter>
  );
}
