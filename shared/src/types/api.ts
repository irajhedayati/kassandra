/**
 * Generic API envelope for non-query endpoints.
 * Routes that return a typed payload should use these helpers.
 */

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiErr {
  ok: false;
  message: string;
  /** Optional error code for the client to switch on. */
  code?: string;
}

export type ApiResponse<T> = ApiOk<T> | ApiErr;

/** Payload of GET /api/about. */
export interface AboutInfo {
  /** Version of the running server (semver, e.g. "1.6.0"). */
  version: string;
}

/** Relational databases that can hold the configuration. The `mysql` dialect also covers MariaDB. */
export type SqlDialect = 'postgres' | 'mysql';

export const SQL_DEFAULT_PORTS: Record<SqlDialect, number> = { postgres: 5432, mysql: 3306 };

/** PostgreSQL schema used unless another is given; MySQL has none (the database is the namespace). */
export const DEFAULT_SQL_SCHEMA = 'public';

/** How Kassandra reaches a relational database, without the password. */
export interface SqlConnectionInfo {
  dialect: SqlDialect;
  host: string;
  port: number;
  database: string;
  username: string;
  /** Verify and encrypt the connection with TLS. */
  ssl: boolean;
  /** PostgreSQL schema holding the tables; ignored for MySQL. */
  schema: string;
  /** A password is saved. It is never sent to the browser. */
  hasPassword: boolean;
}

/** The connection settings in a PUT /api/setup/storage request. */
export interface SqlConnectionRequest {
  host: string;
  port: number;
  database: string;
  username: string;
  /** Omit to keep the saved password. */
  password?: string;
  ssl: boolean;
  schema?: string;
}

/** Collection used unless another is given. */
export const DEFAULT_FIRESTORE_COLLECTION = 'kassandra';

/** How Kassandra reaches Firestore, without the service-account key. */
export interface FirestoreConnectionInfo {
  projectId: string;
  collection: string;
  /** A service-account key is saved (else Application Default Credentials are used). It is never sent to the browser. */
  hasCredentials: boolean;
  /** The service account's e-mail, when a key is saved. */
  clientEmail?: string;
}

/** The Firestore settings in a PUT /api/setup/storage request. */
export interface FirestoreConnectionRequest {
  /** Omit to use the project of the service-account key. */
  projectId?: string;
  collection?: string;
  /** Content of the service-account key file. Omit to keep the saved key. */
  credentials?: string;
}

/** Payload of GET /api/setup. */
export interface SetupInfo {
  /** Nothing has been configured yet; the UI shows the Configuration page first. */
  firstRun: boolean;
  /** Directory the configuration currently lives in. */
  location: string;
  defaultLocation: string;
  /** KASSANDRA_HOME fixes the location; it cannot be changed from the UI. */
  locked: boolean;
  /** Storage backend in use: `file`, `sqlite`, `postgres`, `mysql` or `firestore` (or a registered connector). */
  backend: string;
  /** KASSANDRA_STORAGE fixes the backend; it cannot be changed from the UI. */
  backendLocked: boolean;
  /** SQLite database file in use (or that would be used if `sqlite` were chosen). */
  sqlitePath: string;
  defaultSqlitePath: string;
  /** KASSANDRA_SQLITE_PATH fixes the database file. */
  sqlitePathLocked: boolean;
  /**
   * Connection settings of the relational database: the one in use if the backend is `postgres` or
   * `mysql`, else the last one saved, else defaults.
   */
  sql: SqlConnectionInfo;
  /** KASSANDRA_DB_URL fixes the whole connection; it cannot be changed from the UI. */
  sqlLocked: boolean;
  /** KASSANDRA_DB_SCHEMA fixes the PostgreSQL schema. */
  sqlSchemaLocked: boolean;
  /** Firestore settings: the ones in use if the backend is `firestore`, else the last saved, else defaults. */
  firestore: FirestoreConnectionInfo;
  /** KASSANDRA_FIRESTORE_PROJECT / _CREDENTIALS / _COLLECTION fix the connection. */
  firestoreLocked: boolean;
  /** FIRESTORE_EMULATOR_HOST is set: Firestore requests go to that emulator. */
  firestoreEmulator: string | null;
}

/** Payload of PUT /api/setup/location and PUT /api/setup/storage. */
export interface ChangeLocationResult extends SetupInfo {
  /** Documents copied from the previous location or storage. */
  copied: number;
  /** The new location or storage already held a configuration, which is used as is. */
  existing: boolean;
}

/** Body of PUT /api/setup/storage. */
export interface ChangeStorageRequest {
  backend: 'file' | 'sqlite' | SqlDialect | 'firestore';
  /** Database file for `sqlite`; the default in the config directory when omitted. */
  sqlitePath?: string;
  /** Connection for `postgres` and `mysql`. Required unless KASSANDRA_DB_URL provides it. */
  sql?: SqlConnectionRequest;
  /** Connection for `firestore`. Required unless KASSANDRA_FIRESTORE_* provides it. */
  firestore?: FirestoreConnectionRequest;
  /** Copy the current configuration into an empty target. Default true. */
  migrate?: boolean;
}
