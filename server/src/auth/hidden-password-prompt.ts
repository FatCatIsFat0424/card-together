import { createInterface } from 'node:readline';
import type { ReadStream, WriteStream } from 'node:tty';
import { Writable } from 'node:stream';

export function readHiddenPassword(
  prompt: string,
  input: ReadStream = process.stdin,
  output: WriteStream = process.stderr,
): Promise<string> {
  if (!input.isTTY || !output.isTTY) return Promise.reject(new Error('Password input requires an interactive terminal.'));
  const silentOutput = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const reader = createInterface({ input, output: silentOutput, terminal: true, historySize: 0 });
  return new Promise<string>((resolve, reject) => {
    let finished = false;
    const finish = (error: Error | null, value = ''): void => {
      if (finished) return;
      finished = true;
      input.off('error', onError);
      reader.close();
      silentOutput.end();
      output.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onError = (error: Error): void => finish(error);
    input.once('error', onError);
    reader.once('SIGINT', () => finish(new Error('Password reset cancelled.')));
    reader.once('close', () => finish(new Error('Password input ended; no reset was applied.')));
    reader.question('', (answer) => finish(null, answer));
    output.write(prompt);
  });
}
