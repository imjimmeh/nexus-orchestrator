// apps/web/src/components/scope/manage/CreateChildDialog.spec.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateChildDialog } from "./CreateChildDialog";
import { useAllowedChildTypes, useCreateScopeNode } from "@/hooks/useScope";
import type { ScopeNode } from "@/lib/api/client.scope.types";

vi.mock("@/hooks/useScope", () => ({
  useAllowedChildTypes: vi.fn(),
  useCreateScopeNode: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const mockMutateAsync = vi.fn();

const parentNode: ScopeNode = {
  id: "parent-1",
  parentId: null,
  type: "region",
  name: "EMEA",
  slug: "emea",
  metadata: {},
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function renderDialog(onOpenChange = vi.fn()) {
  render(
    <CreateChildDialog
      parentNode={parentNode}
      open
      onOpenChange={onOpenChange}
    />,
    { wrapper: createWrapper() },
  );
  return { onOpenChange };
}

describe("CreateChildDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue(parentNode);
    vi.mocked(useAllowedChildTypes).mockReturnValue({
      data: ["team", "project"],
      isLoading: false,
    } as unknown as ReturnType<typeof useAllowedChildTypes>);
    vi.mocked(useCreateScopeNode).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useCreateScopeNode>);
  });

  it("offers only the allowed child types in the type select (no org)", () => {
    renderDialog();

    fireEvent.click(screen.getByRole("combobox"));

    expect(screen.getByText("team")).toBeTruthy();
    expect(screen.getByText("project")).toBeTruthy();
    expect(screen.queryByText("org")).toBeNull();
  });

  it("submits the create-scope payload for a non-org type without isTenantRoot", async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Backend" },
    });

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("team"));

    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        parentId: "parent-1",
        type: "team",
        name: "Backend",
      });
    });
  });

  it("shows the tenant-boundary checkbox only when the selected type is org, and includes isTenantRoot in the payload when checked", async () => {
    vi.mocked(useAllowedChildTypes).mockReturnValue({
      data: ["org", "team"],
      isLoading: false,
    } as unknown as ReturnType<typeof useAllowedChildTypes>);
    renderDialog();

    expect(screen.queryByText(/tenant boundary/i)).toBeNull();

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("org"));

    expect(screen.getByText(/tenant boundary/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Acme" },
    });
    fireEvent.click(screen.getByLabelText(/tenant boundary/i));
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        parentId: "parent-1",
        type: "org",
        name: "Acme",
        isTenantRoot: true,
      });
    });
  });

  it("shows a cannot-add-children state when there are no allowed child types", () => {
    vi.mocked(useAllowedChildTypes).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useAllowedChildTypes>);
    renderDialog();

    expect(screen.getByText(/cannot have child scopes/i)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /^create$/i })).toBeNull();
  });
});
