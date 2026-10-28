// Worker bootstrap. Plain JavaScript, because it must register the TypeScript loader before any .ts import:
// vitest and `tsx watch` do not hand their loaders to a worker, and production's `--import tsx` is not
// inherited once the pool starts workers with an empty execArgv.
import { URL, fileURLToPath } from 'node:url';
import { register } from 'tsx/esm/api';

register({ tsconfig: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)) });
await import('./search-worker.ts');
