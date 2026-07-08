// apps/web/src/components/scope/manage/OrgHierarchyManager.spec.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrgHierarchyManager } from "./OrgHierarchyManager";
import {
  useScopeTree,
  useArchiveScopeNode,
  useAllowedChildTypes,
  useUpdateScopeNode,
} from "@/hooks/useScope";
import { useMyPermissions } from "@/hooks/useMyPermissions";
import type { ScopeNode } from "@/lib/api/client.scope.types";

vi.mock("@/hooks/useScope", () => ({
  useScopeTree: vi.fn(),
  useArchiveScopeNode: vi.fn(),
  useAllowedChildTypes: vi.fn(),
  useCreateScopeNode: vi.fn(),
  useUpdateScopeNode: vi.fn(),
  useMoveScopeNode: vi.fn(),
}));

vi.mock("@/hooks/useMyPermissions", () => ({
  useMyPermissions: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

const ORG_ID = "org-1";
const TEAM_ID = "team-1";
const PROJECT_ID = "project-1";

function makeTree(): ScopeNode {
  return {
    id: ORG_ID,
    parentId: "platform-root",
    type: "org",
    name: "Acme Corp",
    slug: "acme",
    metadata: {},
    isTenantRoot: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    children: [
      {
        id: TEAM_ID,
        parentId: ORG_ID,
        type: "team",
        name: "Backend Team",
        slug: "backend-team",
        metadata: {},
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        children: [
          {
            id: PROJECT_ID,
            parentId: TEAM_ID,
            type: "project",
            name: "Checkout Service",
            slug: "checkout-service",
            metadata: {},
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
            children: [],
          },
        ],
      },
    ],
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function mockAllGranted() {
  vi.mocked(useMyPermissions).mockReturnValue({
    permissions: ["scopes:create", "scopes:update", "scopes:manage"],
    can: () => true,
    isLoading: false,
  });
  vi.mocked(useAllowedChildTypes).mockImplementation(
    (id: string) =>
      ({
        data: id === PROJECT_ID ? [] : ["team"],
        isLoading: false,
      }) as unknown as ReturnType<typeof useAllowedChildTypes>,
  );
  vi.mocked(useArchiveScopeNode).mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  } as unknown as ReturnType<typeof useArchiveScopeNode>);
  vi.mocked(useUpdateScopeNode).mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateScopeNode>);
}

describe("OrgHierarchyManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useScopeTree).mockReturnValue({
      data: makeTree(),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useScopeTree>);
  });

  it("renders the subtree rooted at rootScopeNodeId with a Tenant badge and node-scoped actions", () => {
    mockAllGranted();

    render(<OrgHierarchyManager rootScopeNodeId={ORG_ID} />, { wrapper });

    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Backend Team")).toBeInTheDocument();
    expect(screen.getByText("Checkout Service")).toBeInTheDocument();

    // Tenant badge on the org (tenant-root) node only.
    expect(screen.getByText("Tenant")).toBeInTheDocument();

    // Create child requires allowed child types: org/team have them, project does not.
    const createChildButtons = screen.getAllByRole("button", {
      name: /create child/i,
    });
    expect(createChildButtons).toHaveLength(2);

    // Archive only appears on the project node.
    const archiveButtons = screen.getAllByRole("button", { name: /archive/i });
    expect(archiveButtons).toHaveLength(1);
  });

  it("hides every management control when the user lacks all scope permissions (read-only)", () => {
    vi.mocked(useMyPermissions).mockReturnValue({
      permissions: [],
      can: () => false,
      isLoading: false,
    });
    vi.mocked(useAllowedChildTypes).mockReturnValue({
      data: ["team"],
      isLoading: false,
    } as unknown as ReturnType<typeof useAllowedChildTypes>);
    vi.mocked(useArchiveScopeNode).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useArchiveScopeNode>);

    render(<OrgHierarchyManager rootScopeNodeId={ORG_ID} />, { wrapper });

    expect(
      screen.queryByRole("button", { name: /create child/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /rename/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /move/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /archive/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();

    // Tenant badge is informational, not gated by permission.
    expect(screen.getByText("Tenant")).toBeInTheDocument();
  });

  it("shows an access message when the root scope node is not found in the tree", () => {
    mockAllGranted();

    render(<OrgHierarchyManager rootScopeNodeId="missing-node" />, { wrapper });

    expect(screen.getByText(/not found|no access/i)).toBeInTheDocument();
  });

  it("shows a confirmation dialog on Archive and does not call the archive mutation until confirmed", async () => {
    mockAllGranted();
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useArchiveScopeNode).mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useArchiveScopeNode>);

    render(<OrgHierarchyManager rootScopeNodeId={ORG_ID} />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: /^archive$/i }));

    // Clicking Archive opens a confirmation dialog naming the node — the
    // mutation must not fire until the user confirms.
    expect(mutateAsync).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog", {
      name: /archive checkout service/i,
    });
    expect(dialog).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("calls the archive mutation only after confirming in the dialog", async () => {
    mockAllGranted();
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useArchiveScopeNode).mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useArchiveScopeNode>);

    render(<OrgHierarchyManager rootScopeNodeId={ORG_ID} />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: /^archive$/i }));

    const dialog = screen.getByRole("alertdialog", {
      name: /archive checkout service/i,
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^archive$/i }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(PROJECT_ID);
    });
  });
});
