import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScopedDefaultsForm } from "./ScopedDefaultsForm";

const setMutateAsync = vi.fn();

vi.mock("@/hooks/useScopedAiDefaults", () => ({
  useScopedAiDefault: () => ({
    data: {
      scopeNodeId: "scope-1",
      harnessId: undefined,
      modelName: undefined,
      providerName: undefined,
    },
    isLoading: false,
  }),
  useSetScopedAiDefault: () => ({
    mutateAsync: setMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/hooks/useHarnesses", () => ({
  useHarnesses: () => ({
    data: [
      { harnessId: "pi", displayName: "PI" },
      { harnessId: "claude-code", displayName: "Claude Code" },
    ],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useModels", () => ({
  useModels: () => ({
    data: [{ id: "m1", name: "claude-3-5-sonnet" }],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useProviders", () => ({
  useProviders: () => ({
    data: [{ id: "p1", name: "anthropic" }],
    isLoading: false,
  }),
}));

describe("ScopedDefaultsForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the harness, model and provider selectors", () => {
    render(<ScopedDefaultsForm scopeNodeId="scope-1" />);

    expect(screen.getByText("Harness")).toBeInTheDocument();
    expect(screen.getByText(/model/i)).toBeInTheDocument();
    expect(screen.getByText(/provider/i)).toBeInTheDocument();
  });

  it("persists via setScopedDefault when Save is clicked", async () => {
    const user = userEvent.setup();
    render(<ScopedDefaultsForm scopeNodeId="scope-1" />);

    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(setMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ scopeNodeId: "scope-1" }),
      ),
    );
  });
});
