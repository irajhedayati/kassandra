import { create } from 'zustand';

interface SelectionState {
  keyspace: string | null;
  table: string | null;
  setKeyspace: (ks: string | null) => void;
  setTable: (t: string | null) => void;
}

export const useSelection = create<SelectionState>((set) => ({
  keyspace: null,
  table: null,
  setKeyspace: (ks) => set({ keyspace: ks, table: null }),
  setTable: (t) => set({ table: t }),
}));
