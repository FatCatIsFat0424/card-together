export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 24;
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * ASCII letters, digits, and `_`, with single `.` or `-` separators between them. A strict
 * superset of the earlier `[a-zA-Z0-9_]{3,24}` rule, so stored usernames stay valid. Written
 * without the `^`/`$` anchors so HTML `pattern` attributes can reuse it.
 */
export const USERNAME_PATTERN = '[A-Za-z0-9_]+(?:[.\\-][A-Za-z0-9_]+)*';

const USERNAME_EXPRESSION = new RegExp(`^${USERNAME_PATTERN}$`);

export function isUsername(value: string): boolean {
  return (
    value.length >= USERNAME_MIN_LENGTH &&
    value.length <= USERNAME_MAX_LENGTH &&
    USERNAME_EXPRESSION.test(value)
  );
}
