import { create } from 'zustand';

interface CqlDraftState {
  /** Set by Insert/Update forms; consumed once by CqlEditor then cleared. */
  pending: { text: string; nonce: number } | null;
  pushQuery: (text: string) => void;
  clearPending: () => void;
}

let nextNonce = 1;

export const useCqlDraft = create<CqlDraftState>((set) => ({
  pending: null,
  pushQuery: (text) => set({ pending: { text, nonce: nextNonce++ } }),
  clearPending: () => set({ pending: null }),
}));
