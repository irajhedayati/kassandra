import { create } from 'zustand';

interface CqlDraftState {
  /** Set by Insert/Update forms and saved queries; consumed once by CqlEditor then cleared. */
  pending: { text: string; paramTypes?: Record<string, string>; nonce: number } | null;
  pushQuery: (text: string, paramTypes?: Record<string, string>) => void;
  clearPending: () => void;
}

let nextNonce = 1;

export const useCqlDraft = create<CqlDraftState>((set) => ({
  pending: null,
  pushQuery: (text, paramTypes) => set({ pending: { text, paramTypes, nonce: nextNonce++ } }),
  clearPending: () => set({ pending: null }),
}));
