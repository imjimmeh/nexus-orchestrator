// apps/web/src/components/layout/Header.spec.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ScopeProvider } from "@/context/ScopeContext";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";
import {
  KeyboardShortcutsProvider,
  useKeyboardShortcuts,
} from "./KeyboardShortcutsProvider";
import { MobileNavProvider } from "./MobileNavContext";
import { Header } from "./Header";

function TestHarness({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <MobileNavProvider>
        <KeyboardShortcutsProvider>
          <ScopeProvider>{children}</ScopeProvider>
        </KeyboardShortcutsProvider>
      </MobileNavProvider>
    </MemoryRouter>
  );
}

describe("Header", () => {
  it("renders the short title", () => {
    render(
      <TestHarness>
        <Header />
      </TestHarness>,
    );
    expect(screen.getByText("Nexus")).toBeInTheDocument();
    expect(screen.queryByText("Nexus Orchestrator")).not.toBeInTheDocument();
  });

  it("always shows the scope switcher, labeled 'Platform (global)' at the global root", () => {
    localStorage.setItem("nexus_active_scope_node_id", GLOBAL_SCOPE_NODE_ID);
    render(
      <TestHarness>
        <Header />
      </TestHarness>,
    );

    expect(
      screen.getByRole("button", { name: /platform \(global\)/i }),
    ).toBeInTheDocument();
  });

  it("opens command palette when search is clicked", () => {
    function CommandSpy() {
      const { isCommandPaletteOpen } = useKeyboardShortcuts();
      return (
        <span data-testid="spy">
          {isCommandPaletteOpen ? "open" : "closed"}
        </span>
      );
    }

    render(
      <TestHarness>
        <Header />
        <CommandSpy />
      </TestHarness>,
    );

    const searchButton = screen.getByRole("button", { name: /search/i });
    fireEvent.click(searchButton);
    expect(screen.getByTestId("spy")).toHaveTextContent("open");
  });
});
