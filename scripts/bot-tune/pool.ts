// Child-process pool for offline bot tuning: a tuning script forks itself with `--worker` and the pool hands
// each child one job at a time, so self-play games run on several cores.
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

interface Request<J> {
  readonly id: number;
  readonly job: J;
}

interface Response<R> {
  readonly id: number;
  readonly result?: R;
  readonly error?: string;
}

/** In a `--worker` child: answers every job with `handler(job)`. */
export function serveJobs<J, R>(handler: (job: J) => R): void {
  process.on('message', (request: Request<J>) => {
    try {
      process.send?.({ id: request.id, result: handler(request.job) } satisfies Response<R>);
    } catch (error) {
      process.send?.({ id: request.id, error: error instanceof Error ? error.stack ?? error.message : String(error) } satisfies Response<R>);
    }
  });
}

export interface Pool<J, R> {
  /** Runs every job, at most `size` at a time, and returns the results in job order. */
  readonly map: (jobs: readonly J[]) => Promise<R[]>;
  readonly close: () => void;
}

/** Forks `size` children of the script at `entry`, which must call `serveJobs` when run with `--worker`. */
export function forkPool<J, R>(entry: string, size: number): Pool<J, R> {
  const children: ChildProcess[] = Array.from({ length: size }, () =>
    fork(entry, ['--worker'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }));
  const map = (jobs: readonly J[]): Promise<R[]> => new Promise<R[]>((resolve, reject) => {
    const results = new Array<R>(jobs.length);
    let next = 0;
    let done = 0;
    if (jobs.length === 0) {
      resolve(results);
      return;
    }
    const feed = (child: ChildProcess): void => {
      if (next >= jobs.length) return;
      const id = next++;
      child.send({ id, job: jobs[id] } satisfies Request<J>);
    };
    for (const child of children) {
      const onMessage = (response: Response<R>): void => {
        if (response.error !== undefined) {
          child.off('message', onMessage);
          reject(new Error(response.error));
          return;
        }
        results[response.id] = response.result as R;
        if (++done === jobs.length) {
          for (const other of children) other.removeAllListeners('message');
          resolve(results);
        } else feed(child);
      };
      child.on('message', onMessage);
      feed(child);
    }
  });
  return { map, close: () => { for (const child of children) child.kill(); } };
}
