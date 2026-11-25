import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiState {
  sidebarCollapsed: boolean;
  activeOrgId: string | null;
  toggleSidebar: () => void;
  setActiveOrgId: (orgId: string | null) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      activeOrgId: null,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setActiveOrgId: (activeOrgId) => set({ activeOrgId }),
    }),
    {
      name: "worksphere-ui",
      partialize: (s) => ({ activeOrgId: s.activeOrgId }),
    },
  ),
);
