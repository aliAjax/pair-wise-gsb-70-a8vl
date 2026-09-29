import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ReviewState } from '../models/contract';

interface ReviewSelection {
  contractId: string;
  changeId: string;
}

/** 一个编辑窗口：每个窗口从同一条基线开始，提交时携带基线标识。 */
export interface EditWindow {
  id: string;
  contractId: string;
  label: string;
  author: string;
  createdAt: string;
}

interface ReviewStore {
  selectedContractId: string;
  activeTab: string;
  reviewStateFilter: ReviewState | 'all';
  selection: ReviewSelection[];
  /** 每个契约当前激活的窗口 id。 */
  activeWindowByContract: Record<string, string>;
  windows: EditWindow[];
  setSelectedContract: (contractId: string) => void;
  setActiveTab: (tab: string) => void;
  setReviewStateFilter: (filter: ReviewState | 'all') => void;
  toggleSelection: (selection: ReviewSelection) => void;
  clearSelection: () => void;
  selectMany: (selections: ReviewSelection[]) => void;
  ensureWindow: (contractId: string) => EditWindow;
  setActiveWindow: (contractId: string, windowId: string) => void;
  addWindow: (contractId: string, label: string, author: string) => EditWindow;
  removeWindow: (contractId: string, windowId: string) => void;
  setWindowAuthor: (contractId: string, windowId: string, author: string) => void;
}

let windowSeq = 1;

export const useReviewStore = create<ReviewStore>()(
  persist(
    (set, get) => ({
      selectedContractId: '',
      activeTab: 'overview',
      reviewStateFilter: 'all',
      selection: [],
      activeWindowByContract: {},
      windows: [],
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
      ensureWindow: (contractId) => {
        const state = get();
        const existing = state.windows.find((window) => window.contractId === contractId);
        if (existing) {
          if (state.activeWindowByContract[contractId] !== existing.id) {
            set({
              activeWindowByContract: {
                ...state.activeWindowByContract,
                [contractId]: existing.id,
              },
            });
          }
          return existing;
        }
        const created: EditWindow = {
          id: `win-${Date.now()}-${windowSeq++}`,
          contractId,
          label: `窗口 ${state.windows.filter((w) => w.contractId === contractId).length + 1}`,
          author: '当前评审人',
          createdAt: new Date().toISOString(),
        };
        set({
          windows: [...state.windows, created],
          activeWindowByContract: {
            ...state.activeWindowByContract,
            [contractId]: created.id,
          },
        });
        return created;
      },
      setActiveWindow: (contractId, windowId) =>
        set((state) => ({
          activeWindowByContract: { ...state.activeWindowByContract, [contractId]: windowId },
        })),
      addWindow: (contractId, label, author) => {
        const created: EditWindow = {
          id: `win-${Date.now()}-${windowSeq++}`,
          contractId,
          label: label.trim() || `窗口 ${get().windows.filter((w) => w.contractId === contractId).length + 1}`,
          author: author.trim() || '未署名',
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          windows: [...state.windows, created],
          activeWindowByContract: {
            ...state.activeWindowByContract,
            [contractId]: created.id,
          },
        }));
        return created;
      },
      removeWindow: (contractId, windowId) =>
        set((state) => {
          const remaining = state.windows.filter(
            (window) => !(window.contractId === contractId && window.id === windowId),
          );
          const active = state.activeWindowByContract[contractId];
          const nextActive =
            active === windowId
              ? (remaining.find((window) => window.contractId === contractId)?.id ?? '')
              : active;
          return {
            windows: remaining,
            activeWindowByContract: { ...state.activeWindowByContract, [contractId]: nextActive },
          };
        }),
      setWindowAuthor: (contractId, windowId, author) =>
        set((state) => ({
          windows: state.windows.map((window) =>
            window.contractId === contractId && window.id === windowId
              ? { ...window, author }
              : window,
          ),
        })),
    }),
    {
      name: 'pair-wise-gsb-70-review-ui',
      partialize: (state) => ({
        selectedContractId: state.selectedContractId,
        activeTab: state.activeTab,
        reviewStateFilter: state.reviewStateFilter,
        selection: state.selection,
        activeWindowByContract: state.activeWindowByContract,
        windows: state.windows,
      }),
    },
  ),
);
