/**
 * Frequently leaked passwords that satisfy the length rule. Kept short on purpose: online
 * guessing is rate limited, so this only blocks the guesses an attacker would try first.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '000000', '111111', '112233', '121212', '123123', '123321', '1234567', '12345678',
  '123456789', '1234567890', '123654', '123abc', '147258', '159753', '654321', '666666',
  '696969', '777777', '87654321', '888888', '987654321', '999999', 'aa123456', 'abc123',
  'abcdef', 'abcd1234', 'admin123', 'asdfgh', 'azerty', 'baseball', 'dragon', 'football',
  'iloveyou', 'letmein', 'master', 'monkey', 'passw0rd', 'password', 'password1',
  'password123', 'princess', 'qazwsx', 'qwerty', 'qwerty123', 'qwertyuiop', 'shadow',
  'sunshine', 'superman', 'trustno1', 'welcome', 'zxcvbn', 'zxcvbnm',
]);

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}
