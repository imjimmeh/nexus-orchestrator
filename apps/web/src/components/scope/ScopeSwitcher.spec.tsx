// apps/web/src/components/scope/ScopeSwitcher.spec.tsx
import { useEffect } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ScopeSwitcher } from "./ScopeSwitcher";
import { ScopeProvider, useScopeContext } from "@/context/ScopeContext";

function Harness({
  entries,
  children,
}: {
  entries: string[];
  children: React.ReactNode;
}) {
  return (
    <MemoryRouter initialEntries={entries}>
      <ScopeProvider>{children}</ScopeProvider>
    </MemoryRouter>
  );
}

describe("ScopeSwitcher", () => {
  beforeEach(() => localStorage.clear());

  it("renders 'Platform (global)' at the global root", () => {
    render(
      <Harness entries={["/"]}>
        <ScopeSwitcher />
      </Harness>,
    );
    expect(
      screen.getByRole("button", { name: /platform \(global\)/i }),
    ).toBeInTheDocument();
  });

  it("renders the active scope path breadcrumb in a workspace", () => {
    function Probe() {
      const { setScopePath } = useScopeContext();
      useEffect(() => {
        setScopePath(["Platform", "Acme", "Engineering", "Checkout"]);
      }, [setScopePath]);
      return null;
    }
    render(
      <Harness entries={["/?scope=n1"]}>
        <Probe />
        <ScopeSwitcher />
      </Harness>,
    );
    expect(screen.getByRole("button")).toHaveTextContent(/checkout|n1/i);
  });

  it("opens the scope panel when clicked", () => {
    function PanelSpy() {
      const { isScopePanelOpen } = useScopeContext();
      return (
        <span data-testid="panel">{isScopePanelOpen ? "open" : "closed"}</span>
      );
    }
    render(
      <Harness entries={["/"]}>
        <ScopeSwitcher />
        <PanelSpy />
      </Harness>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("panel")).toHaveTextContent("open");
  });
});
