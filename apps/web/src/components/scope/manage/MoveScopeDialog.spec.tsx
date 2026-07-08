// apps/web/src/components/scope/manage/MoveScopeDialog.spec.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MoveScopeDialog } from "./MoveScopeDialog";
import { useMoveScopeNode, useScopeTree } from "@/hooks/useScope";
import type { ScopeNode } from "@/lib/api/client.scope.types";

vi.mock("@/hooks/useScope", () => ({
  useScopeTree: vi.fn(),
  useMoveScopeNode: vi.fn(),
}));

const toastError = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: toastError }),
}));

const mockMutateAsync = vi.fn();

const now = "2026-07-01T00:00:00.000Z";

function makeNode(overrides: Partial<ScopeNode>): ScopeNode {
  return {
    id: "id",
    parentId: null,
    type: "team",
    name: "name",
    slug: "slug",
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// platform(root) -> org(EMEA) -> team(Backend, the node under test) -> project(Alpha)
const projectAlpha = makeNode({
  id: "project-alpha",
  parentId: "team-backend",
  type: "project",
  name: "Alpha",
});
const teamBackend = makeNode({
  id: "team-backend",
  parentId: "org-emea",
  type: "team",
  name: "Backend",
  children: [projectAlpha],
});
const orgEmea = makeNode({
  id: "org-emea",
  parentId: "root",
  type: "org",
  name: "EMEA",
  children: [teamBackend],
});
const root = makeNode({
  id: "root",
  parentId: null,
  type: "platform",
  name: "Global",
  children: [orgEmea],
});

function renderDialog(onOpenChange = vi.fn()) {
  render(
    <MoveScopeDialog node={teamBackend} open onOpenChange={onOpenChange} />,
  );
  return { onOpenChange };
}

describe("MoveScopeDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue(undefined);
    vi.mocked(useScopeTree).mockReturnValue({
      data: root,
      isLoading: false,
    } as unknown as ReturnType<typeof useScopeTree>);
    vi.mocked(useMoveScopeNode).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useMoveScopeNode>);
  });

  it("excludes the node itself and its descendants from the target-parent options", () => {
    renderDialog();

    fireEvent.click(screen.getByRole("combobox"));

    expect(screen.getByText("Global")).toBeTruthy();
    expect(screen.getByText("EMEA")).toBeTruthy();
    expect(screen.queryByText("Backend")).toBeNull();
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("submits {id, newParentId} for the selected target parent", async () => {
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("EMEA"));
    fireEvent.click(screen.getByRole("button", { name: /^move$/i }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        id: "team-backend",
        newParentId: "org-emea",
      });
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("shows an error toast and keeps the dialog open when the move is rejected", async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error("cycle detected"));
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("EMEA"));
    fireEvent.click(screen.getByRole("button", { name: /^move$/i }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("disables the submit button until a target parent is chosen", () => {
    renderDialog();

    expect(screen.getByRole("button", { name: /^move$/i })).toBeDisabled();
  });
});
