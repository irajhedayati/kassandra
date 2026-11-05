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

/** Payload of GET /api/setup. */
export interface SetupInfo {
  /** Nothing has been configured yet; the UI shows the Configuration page first. */
  firstRun: boolean;
  /** Directory the configuration currently lives in. */
  location: string;
  defaultLocation: string;
  /** KASSANDRA_HOME fixes the location; it cannot be changed from the UI. */
  locked: boolean;
}

/** Payload of PUT /api/setup/location. */
export interface ChangeLocationResult extends SetupInfo {
  /** Documents copied from the previous location. */
  copied: number;
  /** The new location already held a configuration, which is used as is. */
  existing: boolean;
}
