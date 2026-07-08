import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface NavSidebarStore {
  isNavExpanded: boolean;
  toggleNav: () => void;
  setNavExpanded: (value: boolean) => void;
}

export const useNavSidebar = create<NavSidebarStore>()(
  persist(
    (set) => ({
      isNavExpanded: true,
      toggleNav: () =>
        set((state) => ({ isNavExpanded: !state.isNavExpanded })),
      setNavExpanded: (value) => set({ isNavExpanded: value }),
    }),
    {
      name: "nexus-nav-sidebar",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
