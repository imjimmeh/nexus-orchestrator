import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitOpsBindingEditDialog } from "./GitOpsBindingEditDialog";

const apiMock = vi.hoisted(() => ({
  getGitOpsBindings: vi.fn(),
  updateGitOpsBinding: vi.fn(),
  getSecrets: vi.fn(),
}));
vi.mock("@/lib/api/client", () => ({ api: apiMock }));

const bindingFixture = {
  id: "binding-1",
  scopeNodeId: "scope-1",
  name: "platform-config",
  repoUrl: "https://github.com/acme/platform-config.git",
  defaultRef: "main",
  rootPath: ".",
  syncMode: "two_way" as const,
  credentialsSecretId: null,
  enabled: true,
  includedObjectTypes: ["workflow"],
  conflictPolicy: "fail",
  lastAppliedRevision: null,
  createdByUserId: null,
  createdAt: "",
  updatedAt: "",
};

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("GitOpsBindingEditDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getGitOpsBindings.mockResolvedValue([bindingFixture]);
    apiMock.updateGitOpsBinding.mockResolvedValue(bindingFixture);
    apiMock.getSecrets.mockResolvedValue([
      {
        id: "secret-1",
        name: "GH PAT",
        metadata: {},
        created_at: "",
        updated_at: "",
      },
    ]);
  });

  it("loads the binding, edits fields, and saves via updateGitOpsBinding", async () => {
    const onOpenChange = vi.fn();
    render(
      <GitOpsBindingEditDialog
        scopeNodeId="scope-1"
        bindingId="binding-1"
        open
        onOpenChange={onOpenChange}
      />,
      { wrapper: wrapper() },
    );

    await waitFor(() =>
      expect(screen.getByDisplayValue("platform-config")).toBeTruthy(),
    );

    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "renamed-config" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(apiMock.updateGitOpsBinding).toHaveBeenCalledWith(
        "scope-1",
        "binding-1",
        expect.objectContaining({ name: "renamed-config" }),
      ),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the git auth secret field seeded from the binding", async () => {
    render(
      <GitOpsBindingEditDialog
        scopeNodeId="scope-1"
        bindingId="binding-1"
        open
        onOpenChange={vi.fn()}
      />,
      { wrapper: wrapper() },
    );
    await waitFor(() =>
      expect(screen.getByText(/Git Auth Secret/i)).toBeTruthy(),
    );
  });

  it("includes credentialsSecretId in the update payload when secret is cleared", async () => {
    apiMock.getGitOpsBindings.mockResolvedValue([
      { ...bindingFixture, credentialsSecretId: "secret-1" },
    ]);
    const onOpenChange = vi.fn();
    render(
      <GitOpsBindingEditDialog
        scopeNodeId="scope-1"
        bindingId="binding-1"
        open
        onOpenChange={onOpenChange}
      />,
      { wrapper: wrapper() },
    );

    await waitFor(() =>
      expect(screen.getByDisplayValue("platform-config")).toBeTruthy(),
    );

    fireEvent.click(screen.getByLabelText(/git auth secret/i));
    fireEvent.click(screen.getByRole("option", { name: "No secret selected" }));

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(apiMock.updateGitOpsBinding).toHaveBeenCalledWith(
        "scope-1",
        "binding-1",
        expect.objectContaining({ credentialsSecretId: null }),
      ),
    );
  });
});
