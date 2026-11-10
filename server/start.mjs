// Production entry point: the release ships TypeScript sources, so tsx is registered in-process before the
// server loads. Works from any working directory; it never reads process.cwd().
import { register } from 'tsx/esm/api';
import { URL, fileURLToPath } from 'node:url';

// Without an explicit tsconfig tsx would use the one of the working directory and miss the `@shared/*` paths.
register({ tsconfig: fileURLToPath(new URL('./tsconfig.json', import.meta.url)) });
await import('./src/index.ts');
