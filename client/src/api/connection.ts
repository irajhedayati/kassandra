import type { ConnectionProfile, ConnectionStatus } from '@kassandra/shared';
import { apiGet, apiSend } from './client.js';

export function listProfiles(): Promise<ConnectionProfile[]> {
  return apiGet<ConnectionProfile[]>('/api/profiles');
}

export function createProfile(profile: ConnectionProfile): Promise<ConnectionProfile> {
  return apiSend<ConnectionProfile>('POST', '/api/profiles', profile);
}

export function updateProfile(
  originalName: string,
  profile: ConnectionProfile,
): Promise<ConnectionProfile> {
  return apiSend<ConnectionProfile>(
    'PUT',
    `/api/profiles/${encodeURIComponent(originalName)}`,
    profile,
  );
}

export function upsertProfile(
  profile: ConnectionProfile,
  originalName?: string,
): Promise<ConnectionProfile> {
  if (originalName && originalName.length > 0) {
    return updateProfile(originalName, profile);
  }
  return createProfile(profile);
}

export function deleteProfile(name: string): Promise<{ deleted: string }> {
  return apiSend<{ deleted: string }>(
    'DELETE',
    `/api/profiles/${encodeURIComponent(name)}`,
  );
}

export function connect(name: string): Promise<ConnectionStatus> {
  return apiSend<ConnectionStatus>('POST', '/api/profiles/connect', { name });
}

export function disconnect(): Promise<ConnectionStatus> {
  return apiSend<ConnectionStatus>('POST', '/api/profiles/disconnect');
}

export function getStatus(): Promise<ConnectionStatus> {
  return apiGet<ConnectionStatus>('/api/profiles/status');
}
