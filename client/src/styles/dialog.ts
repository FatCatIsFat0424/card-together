import classes from './dialog.module.css';

export type DialogSize = 'narrow' | 'medium' | 'wide';

/** Class names for the parts of a dialog that follow the shared inset and scrolling rules. */
export const dialogParts = { header: classes.header, body: classes.body, footer: classes.footer } as const;

/** Paper class for a centered dialog capped at the size; extra classes add the dialog's own look. */
export function dialogPaperClass(size: DialogSize, ...extra: readonly (string | false | undefined)[]): string {
  return [classes.paper, classes[size], ...extra].filter(Boolean).join(' ');
}
