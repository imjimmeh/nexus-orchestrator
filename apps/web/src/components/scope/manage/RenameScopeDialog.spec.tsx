// apps/web/src/components/scope/manage/RenameScopeDialog.spec.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenameScopeDialog } from "./RenameScopeDialog";
import { useUpdateScopeNode } from "@/hooks/useScope";
import type { ScopeNode } from "@/lib/api/client.scope.types";

vi.mock("@/hooks/useScope", () => ({
  useUpdateScopeNode: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const mockMutateAsync = vi.fn();

const node: ScopeNode = {
  id: "node-1",
  parentId: "parent-1",
  type: "team",
  name: "Backend",
  slug: "backend",
  metadata: {},
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

function renderDialog(onOpenChange = vi.fn()) {
  render(<RenameScopeDialog node={node} open onOpenChange={onOpenChange} />);
  return { onOpenChange };
}

describe("RenameScopeDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue(node);
    vi.mocked(useUpdateScopeNode).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateScopeNode>);
  });

  it("pre-fills the name input with the current node name", () => {
    renderDialog();

    expect(screen.getByLabelText(/^name$/i)).toHaveValue("Backend");
  });

  it("submits the new name and closes the dialog on success", async () => {
    const { onOpenChange } = renderDialog();

    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Platform" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^rename$/i }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({ name: "Platform" });
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("shows an error and keeps the dialog open when the rename is rejected", async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error("conflict"));
    const { onOpenChange } = renderDialog();

    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Duplicate" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^rename$/i }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({ name: "Duplicate" });
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("disables the submit button when the name is blank", () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "" },
    });

    expect(screen.getByRole("button", { name: /^rename$/i })).toBeDisabled();
  });
});
