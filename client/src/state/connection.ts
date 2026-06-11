import { useQuery } from '@tanstack/react-query';
import type { ConnectionStatus } from '@kassandra/shared';
import { apiGet } from '../api/client.js';

export function useConnectionStatus() {
  return useQuery({
    queryKey: ['connection', 'status'],
    queryFn: () => apiGet<ConnectionStatus>('/api/profiles/status'),
    refetchInterval: false,
  });
}
