/**
 * The active ConfigRepository. Backends are registered by name; the name comes
 * from KASSANDRA_STORAGE or the Configuration page (see backend.ts).
 */
import type { SqlDialect } from '@kassandra/shared';
import { DEFAULT_BACKEND, getBackendName, getFirestoreConnection, getSqlConnection, getSqlitePath } from './backend.js';
import { DocumentRepository } from './documentRepository.js';
import { FileStorage, getConfigDir } from './fileStorage.js';
import { sharedFirestoreStorage } from './firestore/storage.js';
import type { ConfigRepository } from './repository.js';
import { sharedSqlRepository } from './sql/repository.js';
import { sharedSqliteRepository } from './sqlite/repository.js';

const SQL_DIALECTS: SqlDialect[] = ['postgres', 'mysql'];

/** Creates a backend. Called on every `getRepository()`, so a non-trivial backend should return a shared instance. */
export type RepositoryFactory = () => ConfigRepository;

const backends = new Map<string, RepositoryFactory>([
  [DEFAULT_BACKEND, () => new DocumentRepository(new FileStorage(getConfigDir()))],
  ['sqlite', () => sharedSqliteRepository(getSqlitePath())],
  [
    'firestore',
    () => {
      const connection = getFirestoreConnection();
      if (!connection) {
        throw new Error(
          'The "firestore" storage backend needs KASSANDRA_FIRESTORE_PROJECT (and KASSANDRA_FIRESTORE_CREDENTIALS), or a connection saved on the Configuration page',
        );
      }
      return new DocumentRepository(sharedFirestoreStorage(connection));
    },
  ],
  ...SQL_DIALECTS.map((dialect): [string, RepositoryFactory] => [
    dialect,
    () => {
      const connection = getSqlConnection(dialect);
      if (!connection) {
        throw new Error(
          `The "${dialect}" storage backend needs KASSANDRA_DB_URL, or a connection saved on the Configuration page`,
        );
      }
      return sharedSqlRepository(connection);
    },
  ]),
]);

/** Make a backend selectable with `KASSANDRA_STORAGE=<name>`. Replaces a backend of the same name. */
export function registerStorageBackend(name: string, factory: RepositoryFactory): void {
  backends.set(name, factory);
}

let override: ConfigRepository | null = null;

/** The active backend: the one chosen with `KASSANDRA_STORAGE` or on the Configuration page (see backend.ts), files by default. */
export function getRepository(): ConfigRepository {
  if (override) return override;
  const name = getBackendName();
  const factory = backends.get(name);
  if (!factory) {
    throw new Error(`Unknown storage backend "${name}". Available: ${[...backends.keys()].sort().join(', ')}`);
  }
  return factory();
}

/** Use `repository` instead of the configured backend; pass null to go back to it. */
export function setRepository(repository: ConfigRepository | null): void {
  override = repository;
}
