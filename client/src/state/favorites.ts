/**
 * Favorite keyspaces, scoped per connection profile and persisted server-side
 * in the user's config.json (see server/src/config/store.ts).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addFavoriteKeyspace,
  listFavoriteKeyspaces,
  removeFavoriteKeyspace,
} from '../api/connection.js';

export function useFavoriteKeyspaces(profileName: string | null | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['favorites', profileName];

  const query = useQuery<string[]>({
    queryKey,
    queryFn: () => listFavoriteKeyspaces(profileName as string),
    enabled: !!profileName,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const addMutation = useMutation({
    mutationFn: (keyspace: string) => addFavoriteKeyspace(profileName as string, keyspace),
    onSuccess: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: (keyspace: string) =>
      removeFavoriteKeyspace(profileName as string, keyspace),
    onSuccess: invalidate,
  });

  const favorites = query.data ?? [];

  return {
    favorites,
    isFavorite: (keyspace: string) => favorites.includes(keyspace),
    toggleFavorite: (keyspace: string) => {
      if (!profileName) return;
      if (favorites.includes(keyspace)) {
        removeMutation.mutate(keyspace);
      } else {
        addMutation.mutate(keyspace);
      }
    },
  };
}
