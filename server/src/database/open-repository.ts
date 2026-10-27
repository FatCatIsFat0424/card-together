import type { DatabaseConfig } from '../config';
import { createJsonRepository } from './json-repository';
import type { Repository, RepositoryOptions } from './repository';
import { createSqliteRepository } from './sqlite-repository';

/** Opens the configured storage engine; both implement the same Repository contract. */
export function openRepository(config: DatabaseConfig, options: RepositoryOptions = {}): Promise<Repository> {
  return config.engine === 'sqlite'
    ? createSqliteRepository(config.path, options)
    : createJsonRepository(config.path, options);
}
