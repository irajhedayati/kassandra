import type { AboutInfo } from '@kassandra/shared';
import { apiGet } from './client.js';

/** Typed wrapper for GET /api/about. */
export function getAbout(): Promise<AboutInfo> {
  return apiGet<AboutInfo>('/api/about');
}
