import type { ChangeLocationResult, SetupInfo } from '@kassandra/shared';
import { apiGet, apiSend } from './client.js';

/** Typed wrappers for the /api/setup routes. */

export function getSetup(): Promise<SetupInfo> {
  return apiGet<SetupInfo>('/api/setup');
}

export function setConfigLocation(location: string): Promise<ChangeLocationResult> {
  return apiSend<ChangeLocationResult>('PUT', '/api/setup/location', { location });
}
