import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ReviewState } from '../models/contract';
import type { MergeableField } from '../models/candidate';

interface ReviewSelection {
  contractId: string;
  changeId: string;
}

export interface ReviewWindow {
  id: string;
  label: string;
  author: string;
}

export interface FieldDraftKey {
  contractId: string;
  windowId: string;
  changeId: string;
  field: MergeableField | 'openapi';
}

interface ReviewStore {
  selectedContractId: string;
  activeTab: string;
  reviewStateFilter: ReviewState | 'all';
  selection: ReviewSelection[];
  windows: ReviewWindow[];
  activeWindowId: string;
  /** 每个窗口当前正在编辑的候选 id（按契约维度） */
  windowCandidates: Record<string, Record<string, string>>;
  drafts: Record<string, string>;
  setSelectedContract: (contractId: string) => void;
  setActiveTab: (tab: string) => void;
  setReviewStateFilter: (filter: ReviewState | 'all') => void;
  toggleSelection: (selection: ReviewSelection) => void;
  clearSelection: () => void;
  selectMany: (selections: ReviewSelection[]) => void;
  setActiveWindow: (windowId: string) => void;
  updateWindow: (windowId: string, patch: Partial<ReviewWindow>) => void;
  setWindowCandidate: (contractId: string, windowId: string, candidateId: string | undefined) => void;
  setDraft: (key: FieldDraftKey, value: string) => void;
  getDraft: (key: FieldDraftKey) => string | undefined;
  clearDrafts: (contractId: string, windowId: string) => void;
}

export function draftKey(key: FieldDraftKey): string {
  return `${key.contractId}:${key.windowId}:${key.changeId}:${key.field}`;
}

const defaultWindows: ReviewWindow[] = [
  { id: 'window-a', label: '窗口 A', author: '评审人 A' },
  { id: 'window-b', label: '窗口 B', author: '评审人 B' },
];

export const useReviewStore = create<ReviewStore>()(
  persist(
    (set, get) => ({
      selectedContractId: '',
      activeTab: 'overview',
      reviewStateFilter: 'all',
      selection: [],
      windows: defaultWindows,
      activeWindowId: 'window-a',
      windowCandidates: {},
      drafts: {},
      setSelectedContract: (selectedContractId) => set({ selectedContractId }),
      setActiveTab: (activeTab) => set({ activeTab }),
      setReviewStateFilter: (reviewStateFilter) => set({ reviewStateFilter }),
      toggleSelection: (candidate) =>
        set((state) => {
          const exists = state.selection.some(
            (item) =>
              item.contractId === candidate.contractId &&
              item.changeId === candidate.changeId,
          );
          return {
            selection: exists
              ? state.selection.filter(
                  (item) =>
                    item.contractId !== candidate.contractId ||
                    item.changeId !== candidate.changeId,
                )
              : [...state.selection, candidate],
          };
        }),
      clearSelection: () => set({ selection: [] }),
      selectMany: (selection) => set({ selection }),
      setActiveWindow: (activeWindowId) => set({ activeWindowId }),
      updateWindow: (windowId, patch) =>
        set((state) => ({
          windows: state.windows.map((window) =>
            window.id === windowId ? { ...window, ...patch } : window,
          ),
        })),
      setWindowCandidate: (contractId, windowId, candidateId) =>
        set((state) => {
          const byWindow = { ...(state.windowCandidates[contractId] ?? {}) };
          if (candidateId) {
            byWindow[windowId] = candidateId;
          } else {
            delete byWindow[windowId];
          }
          return {
            windowCandidates: { ...state.windowCandidates, [contractId]: byWindow },
          };
        }),
      setDraft: (key, value) =>
        set((state) => ({ drafts: { ...state.drafts, [draftKey(key)]: value } })),
      getDraft: (key) => get().drafts[draftKey(key)],
      clearDrafts: (contractId, windowId) =>
        set((state) => {
          const prefix = `${contractId}:${windowId}:`;
          const drafts = Object.fromEntries(
            Object.entries(state.drafts).filter(([key]) => !key.startsWith(prefix)),
          );
          return { drafts };
        }),
    }),
    {
      name: 'pair-wise-gsb-70-review-ui',
      partialize: (state) => ({
        selectedContractId: state.selectedContractId,
        activeTab: state.activeTab,
        reviewStateFilter: state.reviewStateFilter,
        selection: state.selection,
        windows: state.windows,
        activeWindowId: state.activeWindowId,
        windowCandidates: state.windowCandidates,
        drafts: state.drafts,
      }),
    },
  ),
);
