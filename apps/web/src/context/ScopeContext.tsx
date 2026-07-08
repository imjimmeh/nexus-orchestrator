// apps/web/src/context/ScopeContext.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";

const STORAGE_KEY = "nexus_active_scope_node_id";
const SCOPE_PARAM = "scope";

interface ScopeContextValue {
  activeScopeNodeId: string;
  activeScopePath: string[]; // e.g. ['Platform', 'Acme Corp', 'Engineering']
  setActiveScopeNodeId: (id: string) => void;
  setScopePath: (path: string[]) => void;
  isScopePanelOpen: boolean;
  toggleScopePanel: () => void;
}

const ScopeContext = createContext<ScopeContextValue | null>(null);

export function ScopeProvider({ children }: { children: React.ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeScopePath, setActiveScopePath] = useState<string[]>([
    "Platform",
  ]);
  const [isScopePanelOpen, setIsScopePanelOpen] = useState(false);

  // Source of truth is the `?scope=` URL param; localStorage is only a
  // back-compat fallback/mirror for bookmarks created before this param
  // existed, and for other tabs that haven't navigated yet.
  const activeScopeNodeId =
    searchParams.get(SCOPE_PARAM) ??
    localStorage.getItem(STORAGE_KEY) ??
    GLOBAL_SCOPE_NODE_ID;

  const setActiveScopeNodeId = useCallback(
    (id: string) => {
      localStorage.setItem(STORAGE_KEY, id);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id === GLOBAL_SCOPE_NODE_ID) {
            next.delete(SCOPE_PARAM);
          } else {
            next.set(SCOPE_PARAM, id);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setScopePath = useCallback((path: string[]) => {
    setActiveScopePath(path);
  }, []);

  const toggleScopePanel = useCallback(() => {
    setIsScopePanelOpen((prev) => !prev);
  }, []);

  const value = useMemo<ScopeContextValue>(
    () => ({
      activeScopeNodeId,
      activeScopePath,
      setActiveScopeNodeId,
      setScopePath,
      isScopePanelOpen,
      toggleScopePanel,
    }),
    [
      activeScopeNodeId,
      activeScopePath,
      setActiveScopeNodeId,
      setScopePath,
      isScopePanelOpen,
      toggleScopePanel,
    ],
  );

  return (
    <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
  );
}

export function useScopeContext(): ScopeContextValue {
  const ctx = useContext(ScopeContext);
  if (!ctx)
    throw new Error("useScopeContext must be used within ScopeProvider");
  return ctx;
}
