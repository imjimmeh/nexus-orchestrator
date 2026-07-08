// apps/web/src/context/ScopeContext.spec.tsx
import {
  renderHook,
  act,
  render,
  screen,
  fireEvent,
} from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { ScopeProvider, useScopeContext } from "./ScopeContext";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";

function urlWrapper(initialEntries: string[]) {
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={initialEntries}>
      <ScopeProvider>{children}</ScopeProvider>
    </MemoryRouter>
  );
}

describe("ScopeContext", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to GLOBAL_SCOPE_NODE_ID", () => {
    const { result } = renderHook(() => useScopeContext(), {
      wrapper: urlWrapper(["/workflows"]),
    });
    expect(result.current.activeScopeNodeId).toBe(GLOBAL_SCOPE_NODE_ID);
  });

  it("persists active scope to localStorage", () => {
    const { result } = renderHook(() => useScopeContext(), {
      wrapper: urlWrapper(["/workflows"]),
    });
    act(() => {
      result.current.setActiveScopeNodeId("node-123");
    });
    expect(localStorage.getItem("nexus_active_scope_node_id")).toBe("node-123");
  });

  it("restores active scope from localStorage on mount", () => {
    localStorage.setItem("nexus_active_scope_node_id", "node-456");
    const { result } = renderHook(() => useScopeContext(), {
      wrapper: urlWrapper(["/workflows"]),
    });
    expect(result.current.activeScopeNodeId).toBe("node-456");
  });

  it("toggles scope panel open/closed", () => {
    const { result } = renderHook(() => useScopeContext(), {
      wrapper: urlWrapper(["/workflows"]),
    });
    expect(result.current.isScopePanelOpen).toBe(false);
    act(() => {
      result.current.toggleScopePanel();
    });
    expect(result.current.isScopePanelOpen).toBe(true);
    act(() => {
      result.current.toggleScopePanel();
    });
    expect(result.current.isScopePanelOpen).toBe(false);
  });

  it("reads active scope from the ?scope= URL param when present", () => {
    const { result } = renderHook(() => useScopeContext(), {
      wrapper: urlWrapper(["/workflows?scope=node-url-1"]),
    });
    expect(result.current.activeScopeNodeId).toBe("node-url-1");
  });

  it("falls back to localStorage when no ?scope= param is present (back-compat)", () => {
    localStorage.setItem("nexus_active_scope_node_id", "node-ls-2");
    const { result } = renderHook(() => useScopeContext(), {
      wrapper: urlWrapper(["/workflows"]),
    });
    expect(result.current.activeScopeNodeId).toBe("node-ls-2");
  });

  it("prefers the URL param over localStorage", () => {
    localStorage.setItem("nexus_active_scope_node_id", "node-ls-2");
    const { result } = renderHook(() => useScopeContext(), {
      wrapper: urlWrapper(["/workflows?scope=node-url-1"]),
    });
    expect(result.current.activeScopeNodeId).toBe("node-url-1");
  });

  it("writes the ?scope= param and mirrors to localStorage on change", () => {
    function Probe() {
      const { setActiveScopeNodeId } = useScopeContext();
      const [params] = useSearchParams();
      return (
        <div>
          <button onClick={() => setActiveScopeNodeId("node-set-3")}>
            set
          </button>
          <span data-testid="param">{params.get("scope") ?? ""}</span>
        </div>
      );
    }
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <ScopeProvider>
          <Probe />
        </ScopeProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("set"));
    expect(screen.getByTestId("param")).toHaveTextContent("node-set-3");
    expect(localStorage.getItem("nexus_active_scope_node_id")).toBe(
      "node-set-3",
    );
  });

  it("removes the ?scope= param when returning to the global root", () => {
    function Probe() {
      const { setActiveScopeNodeId } = useScopeContext();
      const [params] = useSearchParams();
      return (
        <div>
          <button onClick={() => setActiveScopeNodeId(GLOBAL_SCOPE_NODE_ID)}>
            reset
          </button>
          <span data-testid="param">{params.get("scope") ?? "none"}</span>
        </div>
      );
    }
    render(
      <MemoryRouter initialEntries={["/workflows?scope=node-url-1"]}>
        <ScopeProvider>
          <Probe />
        </ScopeProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("reset"));
    expect(screen.getByTestId("param")).toHaveTextContent("none");
  });
});
