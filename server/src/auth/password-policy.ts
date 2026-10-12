import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@shared/constants';
import { isCommonPassword } from './common-passwords';

export function validateNewPassword(input: unknown): string {
  let message: string | undefined;
  if (typeof input !== 'string' || input.length < PASSWORD_MIN_LENGTH || input.length > PASSWORD_MAX_LENGTH) {
    message = `Password must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters.`;
  } else if (input.trim() !== input) {
    message = 'Password cannot start or end with a space.';
  } else if (isCommonPassword(input)) {
    message = 'Password is too common. Choose another one.';
  } else {
    return input;
  }
  throw Object.assign(new Error(message), { status: 400, code: 'INVALID_PASSWORD' });
}
