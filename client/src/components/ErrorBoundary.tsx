import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useI18nStore } from '../stores/i18n-store';
import styles from './ErrorBoundary.module.css';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** Changing this value (for example the route path) clears a previous failure. */
  readonly resetKey?: string;
}

interface ErrorBoundaryState {
  readonly failed: boolean;
}

function ErrorFallback(): ReactNode {
  const { t } = useI18nStore();
  return (
    <main className={styles.fallback} role="alert">
      <p>{t('app.crashed')}</p>
      <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
        {t('app.reload')}</button>
    </main>
  );
}

/** React exposes render-error recovery only through class components. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error', error, info.componentStack);
  }

  componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render(): ReactNode {
    return this.state.failed ? <ErrorFallback /> : this.props.children;
  }
}
