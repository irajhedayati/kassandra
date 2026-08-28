import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConnectionStatus } from '@kassandra/shared';
import { apiGet } from '../api/client.js';
import { resetCqlCompletionCache } from '../components/CqlEditor/cqlCompletion.js';

export function useConnectionStatus() {
  const query = useQuery({
    queryKey: ['connection', 'status'],
    queryFn: () => apiGet<ConnectionStatus>('/api/profiles/status'),
    refetchInterval: false,
  });

  const lastProfileRef = useRef<string | null>(null);
  useEffect(() => {
    const profileName = query.data?.profileName ?? null;
    if (profileName !== lastProfileRef.current) {
      lastProfileRef.current = profileName;
      resetCqlCompletionCache();
    }
  }, [query.data?.profileName]);

  return query;
}
