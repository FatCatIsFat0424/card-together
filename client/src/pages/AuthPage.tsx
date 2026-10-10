import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_PATTERN,
} from '@shared/constants';
import type { AccountProfile } from '@shared/types';
import { apiRequest } from '../api';
import { AppCheckbox } from '../components/AppCheckbox';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import styles from './AccountPages.module.css';

interface AuthPageProps { mode: 'login' | 'register'; }

export function AuthPage({ mode }: AuthPageProps): ReactNode {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18nStore();
  const account = useAccountStore((state) => state.account);
  const setAccount = useAccountStore((state) => state.setAccount);
  const [username, setUsername] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const passwordType = showPassword ? 'text' : 'password';
  const register = mode === 'register';
  const locationState = location.state as { from?: string; passwordChanged?: boolean } | null;
  const from = locationState?.from;
  const destination = from?.startsWith('/') && !from.startsWith('//') ? from : '/';

  if (account) return <Navigate to={destination} replace />;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError('');
    if (register && password !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setBusy(true);
    const result = await apiRequest<{ account: AccountProfile }>(`/api/auth/${mode}`, 'POST', {
      username: username.trim(), password,
      ...(register && nickname.trim() ? { nickname: nickname.trim() } : {}),
    });
    setBusy(false);
    if (result.success) {
      setPassword('');
      setConfirmPassword('');
      setAccount(result.account);
      navigate(destination, { replace: true });
    } else setError(result.error);
  };

  return (
    <main className={styles.authPage}>
      <div className={styles.authCard}>
        <Link to="/" className={styles.username}>♠ Card Together</Link>
        <h1 className={styles.title}>{t('auth.welcome')}</h1>
        <p className={styles.subtitle}>{t('auth.description')}</p>
        <h2 className={styles.title}>{t(register ? 'auth.register' : 'auth.login')}</h2>
        {locationState?.passwordChanged && (
          <p className={styles.success} role="status">{t('auth.passwordChanged')}</p>
        )}
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <div className={styles.field}>
            <label htmlFor="username">{t('auth.username')}</label>
            <input id="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
              value={username} onChange={(event) => setUsername(event.target.value)}
              required minLength={USERNAME_MIN_LENGTH} maxLength={USERNAME_MAX_LENGTH} pattern={USERNAME_PATTERN}
              aria-describedby={register ? 'username-help' : undefined} />
            {register && <p id="username-help" className={styles.hint}>{t('auth.usernameHelp')}</p>}
          </div>
          {register && (
            <div className={styles.field}>
              <label htmlFor="nickname">{t('lobby.nickname')}</label>
              <input id="nickname" autoComplete="nickname" value={nickname}
                onChange={(event) => setNickname(event.target.value)} maxLength={20}
                placeholder={username || t('lobby.nicknamePlaceholder')} />
            </div>
          )}
          <div className={styles.field}>
            <label htmlFor="password">{t('auth.password')}</label>
            <input id="password" type={passwordType} autoComplete={register ? 'new-password' : 'current-password'}
              value={password} onChange={(event) => setPassword(event.target.value)}
              required minLength={register ? PASSWORD_MIN_LENGTH : undefined} maxLength={PASSWORD_MAX_LENGTH}
              aria-describedby={register ? 'password-help' : undefined} />
            {register && <p id="password-help" className={styles.hint}>{t('auth.passwordHelp')}</p>}
          </div>
          {register && (
            <div className={styles.field}>
              <label htmlFor="confirm-password">{t('auth.confirmPassword')}</label>
              <input id="confirm-password" type={passwordType} autoComplete="new-password"
                value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)}
                required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} />
            </div>
          )}
          <label className={styles.showPassword}>
            <AppCheckbox checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
            {t('auth.showPassword')}
          </label>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? t('common.loading') : t(register ? 'auth.register' : 'auth.login')}
          </button>
        </form>
        <p className={styles.switch}>
          {t(register ? 'auth.hasAccount' : 'auth.noAccount')}{' '}
          <Link to={register ? '/login' : '/register'} state={{ from: destination }}>
            {t(register ? 'auth.login' : 'auth.register')}
          </Link>
        </p>
      </div>
    </main>
  );
}
