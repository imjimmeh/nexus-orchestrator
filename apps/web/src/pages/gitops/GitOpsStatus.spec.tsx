import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScopeProvider, useScopeContext } from "@/context/ScopeContext";
import { GitOpsStatus } from "./GitOpsStatus";

const apiMock = vi.hoisted(() => ({
  getGitOpsStatus: vi.fn(),
  getGitOpsBindings: vi.fn(),
  createGitOpsBinding: vi.fn(),
  planGitOpsBinding: vi.fn(),
  applyGitOpsBinding: vi.fn(),
  syncGitOpsBindingOutbound: vi.fn(),
  runReconcile: vi.fn(),
  getSecrets: vi.fn(),
  updateGitOpsBinding: vi.fn(),
}));
vi.mock("@/lib/api/client", () => ({ api: apiMock }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

const statusFixture = {
  bindings: [
    {
      bindingId: "binding-1",
      name: "platform-config",
      scopeNodeId: "00000000-0000-0000-0000-000000000000",
      syncMode: "two_way",
      enabled: true,
      lastAppliedRevision: "rev-1",
      latestRun: null,
      pendingChangeCount: 2,
      driftCount: 1,
    },
  ],
  lastReconcile: {
    id: "rec-1",
    finishedAt: "2026-06-08T00:00:00.000Z",
    result: "success",
    summary: { create: 0, update: 2, prune: 0, drift: 1 },
    dryRun: false,
    auditEventId: "aud-1",
  },
  drift: [
    {
      kind: "workflow",
      name: "pr-review",
      scopeNodeId: "org-1",
      managedBy: "gitops",
      driftedFields: ["description"],
      auditEventId: "aud-2",
      category: "conflict",
    },
  ],
  managedByCounts: { gitops: 12, manual: 3, seed: 5 },
};

function wrapper(initialEntries: string[] = ["/"]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <ScopeProvider>{children}</ScopeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("GitOpsStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // ScopeContext falls back to a localStorage-persisted active scope when
    // no ?scope= URL param is present; clear it so tests that don't pass a
    // scope genuinely start from the global root, independent of scope
    // switches made by earlier tests in this file.
    localStorage.clear();
    apiMock.getGitOpsStatus.mockResolvedValue(statusFixture);
    apiMock.getGitOpsBindings.mockResolvedValue([
      {
        id: "binding-1",
        scopeNodeId: "00000000-0000-0000-0000-000000000000",
        name: "platform-config",
        repoUrl: "https://github.com/acme/platform-config.git",
        defaultRef: "main",
        rootPath: ".",
        syncMode: "two_way",
        credentialsSecretId: null,
        enabled: true,
        includedObjectTypes: ["workflow", "agent_profile", "skill"],
        conflictPolicy: "fail",
        lastAppliedRevision: "rev-1",
        createdByUserId: null,
        createdAt: "",
        updatedAt: "",
      },
    ]);
    apiMock.updateGitOpsBinding.mockResolvedValue({ id: "binding-1" });
    apiMock.createGitOpsBinding.mockResolvedValue({ id: "binding-2" });
    apiMock.planGitOpsBinding.mockResolvedValue({ changes: [] });
    apiMock.applyGitOpsBinding.mockResolvedValue({ applied: 1 });
    apiMock.syncGitOpsBindingOutbound.mockResolvedValue({
      bindingId: "binding-1",
      branchName: "gitops/binding-1/1",
      pendingChangeCount: 2,
    });
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

  it("renders last reconcile result and summary counts", async () => {
    render(<GitOpsStatus />, { wrapper: wrapper() });
    await waitFor(() => expect(screen.getByText(/success/i)).toBeTruthy());
    expect(screen.getByText(/2 updated/i)).toBeTruthy();
    expect(screen.getByText(/1 drifted/i)).toBeTruthy();
  });

  it("renders a drift row with a managed-by badge and audit link", async () => {
    render(<GitOpsStatus />, { wrapper: wrapper() });
    await waitFor(() => expect(screen.getByText("pr-review")).toBeTruthy());
    expect(screen.getAllByText(/gitops/i).length).toBeGreaterThan(0);
    const auditLink = screen.getByRole("link", { name: /audit/i });
    expect(auditLink.getAttribute("href")).toContain("aud-2");
  });

  it("shows an empty state when nothing has reconciled", async () => {
    apiMock.getGitOpsStatus.mockResolvedValue({
      bindings: [],
      lastReconcile: null,
      drift: [],
      managedByCounts: { gitops: 0, manual: 0, seed: 0 },
    });
    render(<GitOpsStatus />, { wrapper: wrapper() });
    await waitFor(() =>
      expect(screen.getByText(/add a repository binding/i)).toBeTruthy(),
    );
  });

  it("renders a binding form with scope, repository, ref, root, mode, and object type fields", async () => {
    render(<GitOpsStatus />, { wrapper: wrapper() });
    await waitFor(() =>
      expect(screen.getByLabelText(/scope node id/i)).toBeTruthy(),
    );

    expect(screen.getByLabelText(/repository url/i)).toBeTruthy();
    expect(screen.getByLabelText(/default ref/i)).toBeTruthy();
    expect(screen.getByLabelText(/root path/i)).toBeTruthy();
    expect(screen.getByLabelText(/sync mode/i)).toBeTruthy();
    expect(screen.getByLabelText(/sync workflows/i)).toBeTruthy();
    expect(screen.getAllByText(/git-to-app/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/two-way/i).length).toBeGreaterThan(0);
  });

  it("separates inbound drift, outbound pending changes, and conflicts", async () => {
    render(<GitOpsStatus />, { wrapper: wrapper() });
    await waitFor(() =>
      expect(screen.getAllByText(/inbound drift/i).length).toBeGreaterThan(0),
    );

    expect(screen.getAllByText(/1 inbound drift/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2 outbound pending/i).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(/1 conflict/i)).toBeTruthy();
  });

  it("runs plan, apply, and outbound sync for a binding", async () => {
    const user = userEvent.setup();
    render(<GitOpsStatus />, { wrapper: wrapper() });

    await user.click(await screen.findByRole("button", { name: /plan/i }));
    await user.click(screen.getByRole("button", { name: /apply/i }));
    await user.click(screen.getByRole("button", { name: /sync to git/i }));

    expect(apiMock.planGitOpsBinding).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000000",
      "binding-1",
    );
    expect(apiMock.applyGitOpsBinding).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000000",
      "binding-1",
    );
    expect(apiMock.syncGitOpsBindingOutbound).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000000",
      "binding-1",
    );
  });

  it("renders the git auth secret field on the binding form", async () => {
    render(<GitOpsStatus />, { wrapper: wrapper() });
    await waitFor(() =>
      expect(screen.getByText(/Git Auth Secret/i)).toBeTruthy(),
    );
    expect(
      screen.getByRole("button", { name: /manage secrets/i }),
    ).toBeTruthy();
  });

  it("includes credentialsSecretId in the create payload when a secret is selected", async () => {
    const user = userEvent.setup();
    render(<GitOpsStatus />, { wrapper: wrapper() });
    await waitFor(() =>
      expect(screen.getByLabelText(/repository url/i)).toBeTruthy(),
    );

    await user.type(
      screen.getByLabelText(/repository url/i),
      "https://github.com/acme/platform-config.git",
    );
    await user.click(screen.getByLabelText(/git auth secret/i));
    await user.click(screen.getByRole("option", { name: "GH PAT" }));
    await user.click(screen.getByRole("button", { name: /add binding/i }));

    await waitFor(() =>
      expect(apiMock.createGitOpsBinding).toHaveBeenCalledWith(
        expect.objectContaining({
          repoUrl: "https://github.com/acme/platform-config.git",
          credentialsSecretId: "secret-1",
        }),
      ),
    );
  });

  describe("scope awareness", () => {
    it("shows platform-scoped bindings and drift at the global scope", async () => {
      render(<GitOpsStatus />, { wrapper: wrapper() });

      await waitFor(() =>
        expect(screen.getAllByText("platform-config").length).toBeGreaterThan(
          0,
        ),
      );
      expect(screen.getByText("pr-review")).toBeTruthy();
    });

    it("filters bindings and drift to the active (non-global) scope", async () => {
      render(<GitOpsStatus />, {
        wrapper: wrapper(["/?scope=org-1"]),
      });

      await waitFor(() =>
        expect(
          screen.getByText(/reconciliation is platform-wide/i),
        ).toBeTruthy(),
      );

      // binding-1 belongs to the global root scope, not "org-1", so it drops
      // out of the bindings panel (and its empty state renders instead).
      expect(screen.queryAllByText("platform-config").length).toBe(0);
      expect(
        screen.getByText(/add a repository binding to start syncing/i),
      ).toBeTruthy();

      // The drift row is scoped to "org-1", so it remains visible.
      expect(screen.getByText("pr-review")).toBeTruthy();
    });

    it("re-filters bindings and drift when the active scope changes", async () => {
      const user = userEvent.setup();
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });

      function Harness() {
        const { setActiveScopeNodeId } = useScopeContext();
        return (
          <>
            <button type="button" onClick={() => setActiveScopeNodeId("org-1")}>
              switch-scope
            </button>
            <GitOpsStatus />
          </>
        );
      }

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <ScopeProvider>
              <Harness />
            </ScopeProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );

      await waitFor(() =>
        expect(screen.getAllByText("platform-config").length).toBeGreaterThan(
          0,
        ),
      );

      await user.click(screen.getByText("switch-scope"));

      await waitFor(() => {
        expect(screen.queryAllByText("platform-config").length).toBe(0);
      });
    });
  });

  it("opens the edit dialog from a binding row and saves changes", async () => {
    const user = userEvent.setup();
    render(<GitOpsStatus />, { wrapper: wrapper() });

    await user.click(await screen.findByRole("button", { name: /^edit$/i }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByText(/Edit repository binding/i)).toBeTruthy(),
    );
    await user.clear(within(dialog).getByLabelText(/^name$/i));
    await user.type(within(dialog).getByLabelText(/^name$/i), "renamed-config");
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(apiMock.updateGitOpsBinding).toHaveBeenCalledWith(
        "00000000-0000-0000-0000-000000000000",
        "binding-1",
        expect.objectContaining({ name: "renamed-config" }),
      ),
    );
  });
});
