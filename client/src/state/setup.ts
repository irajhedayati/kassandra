import { useQuery } from '@tanstack/react-query';
import type { SetupInfo } from '@kassandra/shared';
import { getSetup } from '../api/setup.js';

/** First-run state and configuration location. */
export function useSetup() {
  return useQuery<SetupInfo>({
    queryKey: ['setup'],
    queryFn: getSetup,
    retry: false,
  });
}
