import type { ReactNode } from 'react';
import Checkbox from '@mui/material/Checkbox';
import type { CheckboxProps } from '@mui/material/Checkbox';
import styles from './AppCheckbox.module.css';

/** MUI checkbox colors follow the app's CSS-variable themes. */
export function AppCheckbox({ className, size = 'small', ...props }: CheckboxProps): ReactNode {
  return <Checkbox {...props} size={size} className={`${styles.checkbox} ${className ?? ''}`} />;
}
