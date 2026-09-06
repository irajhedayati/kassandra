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

/**
 * Datacenters visible to the currently active client. Returns a sorted,
 * de-duplicated list. The server responds 409 (ApiError) when no
 * connection is active; callers should handle that case gracefully.
 */
export function listDatacenters(): Promise<{ datacenters: string[] }> {
  return apiGet<{ datacenters: string[] }>('/api/profiles/datacenters');
}

export function listFavoriteKeyspaces(profileName: string): Promise<string[]> {
  return apiGet<string[]>(`/api/profiles/${encodeURIComponent(profileName)}/favorites`);
}

export function addFavoriteKeyspace(
  profileName: string,
  keyspace: string,
): Promise<string[]> {
  return apiSend<string[]>(
    'POST',
    `/api/profiles/${encodeURIComponent(profileName)}/favorites`,
    { keyspace },
  );
}

export function removeFavoriteKeyspace(
  profileName: string,
  keyspace: string,
): Promise<string[]> {
  return apiSend<string[]>(
    'DELETE',
    `/api/profiles/${encodeURIComponent(profileName)}/favorites/${encodeURIComponent(keyspace)}`,
  );
}
