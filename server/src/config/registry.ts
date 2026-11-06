/**
 * The active ConfigRepository. Backends are registered by name; the name comes
 * from KASSANDRA_STORAGE or the Configuration page (see backend.ts).
 */
import { DEFAULT_BACKEND, getBackendName, getSqlitePath } from './backend.js';
import { DocumentRepository } from './documentRepository.js';
import { FileStorage, getConfigDir } from './fileStorage.js';
import type { ConfigRepository } from './repository.js';
import { sharedSqliteRepository } from './sqlite/repository.js';

/** Creates a backend. Called on every `getRepository()`, so a non-trivial backend should return a shared instance. */
export type RepositoryFactory = () => ConfigRepository;

const backends = new Map<string, RepositoryFactory>([
  [DEFAULT_BACKEND, () => new DocumentRepository(new FileStorage(getConfigDir()))],
  ['sqlite', () => sharedSqliteRepository(getSqlitePath())],
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
