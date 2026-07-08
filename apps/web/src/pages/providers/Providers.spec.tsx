import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScopeProvider, useScopeContext } from "@/context/ScopeContext";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";
import { ProviderOAuthStatus } from "@/lib/api/common.types";
import { Providers } from "./Providers";

const mockProviders = [
  {
    id: "prov-1",
    name: "OpenAI",
    auth_type: "api_key",
    secret_id: "sec-1",
    runtime_env: {},
    is_active: true,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    owner_type: null,
    owner_id: null,
    oauth_authorization_url: null,
    oauth_token_url: null,
    oauth_client_id: null,
    oauth_client_secret_id: null,
    oauth_scopes: null,
    oauth_redirect_uri: null,
  },
  {
    id: "prov-2",
    name: "OAuth Provider",
    auth_type: "oauth",
    secret_id: null,
    runtime_env: {},
    is_active: true,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    owner_type: null,
    owner_id: null,
    oauth_authorization_url: "https://auth.example.com",
    oauth_token_url: "https://auth.example.com/token",
    oauth_client_id: "client-123",
    oauth_client_secret_id: "sec-2",
    oauth_scopes: null,
    oauth_redirect_uri: null,
  },
];

const mockSecrets = [
  {
    id: "sec-1",
    name: "Secret 1",
    metadata: {},
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
];

const oauthStatusDisconnected: ProviderOAuthStatus = { status: "disconnected" };
const oauthStatusConnected: ProviderOAuthStatus = { status: "connected" };
const oauthStatusNotConfigured: ProviderOAuthStatus = {
  status: "not_configured",
};

const apiMock = vi.hoisted(() => ({
  getProviders: vi.fn(),
  getProvidersPage: vi.fn(),
  getProvider: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  getSecrets: vi.fn(),
  getProviderOAuthStatus: vi.fn(),
  initiateProviderOAuth: vi.fn(),
  completeProviderOAuthCallback: vi.fn(),
  getModels: vi.fn(),
  createModel: vi.fn(),
  updateModel: vi.fn(),
  deleteModel: vi.fn(),
  getModelPresets: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  api: apiMock,
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

function createWrapper(initialEntries: string[] = ["/"]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <ScopeProvider>{children}</ScopeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The scope-switch test writes the active scope to localStorage, which
    // ScopeContext falls back to when no ?scope param is present; clear it so
    // the default-scope assertions genuinely start from the global root.
    localStorage.clear();
    apiMock.getProviders.mockResolvedValue(mockProviders);
    apiMock.getModels.mockResolvedValue([]);
    apiMock.getModelPresets.mockResolvedValue([]);
    apiMock.getProvidersPage.mockResolvedValue({
      data: mockProviders,
      meta: {
        pagination: {
          total: mockProviders.length,
          page: 1,
          limit: 20,
          totalPages: 1,
        },
      },
    });
    apiMock.getSecrets.mockResolvedValue(mockSecrets);
    apiMock.getProviderOAuthStatus.mockResolvedValue(oauthStatusNotConfigured);
  });

  it("renders the providers page with table headers", async () => {
    const { container } = render(<Providers />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("OpenAI")).toBeTruthy();
    });

    expect(screen.getByText("LLM Providers & Models")).toBeTruthy();
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Auth Type")).toBeTruthy();

    const tableBody = container.querySelector("tbody");
    expect(tableBody).toBeTruthy();
    expect(
      Array.from(tableBody?.children ?? []).every(
        (child) => child.tagName === "TR",
      ),
    ).toBe(true);
  });

  describe("scope awareness", () => {
    it("sends the global root scope id at the default (global) scope", async () => {
      render(<Providers />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(apiMock.getProviders).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: GLOBAL_SCOPE_NODE_ID }),
        );
      });
    });

    it("sends the active scope node id to the providers list query", async () => {
      render(<Providers />, { wrapper: createWrapper(["/?scope=n1"]) });

      await waitFor(() => {
        expect(apiMock.getProviders).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: "n1" }),
        );
      });
    });

    it("refetches the providers list when the active scope changes", async () => {
      const user = userEvent.setup();
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });

      function Harness() {
        const { activeScopeNodeId, setActiveScopeNodeId } = useScopeContext();
        return (
          <>
            <button type="button" onClick={() => setActiveScopeNodeId("n2")}>
              switch-scope
            </button>
            <span data-testid="active-scope">{activeScopeNodeId}</span>
            <Providers />
          </>
        );
      }

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/?scope=n1"]}>
            <ScopeProvider>
              <Harness />
            </ScopeProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );

      await waitFor(() => {
        expect(apiMock.getProviders).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: "n1" }),
        );
      });

      apiMock.getProviders.mockClear();
      await user.click(screen.getByText("switch-scope"));

      await waitFor(() => {
        expect(screen.getByTestId("active-scope").textContent).toBe("n2");
        expect(apiMock.getProviders).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: "n2" }),
        );
      });
    });
  });

  describe("OAuth status badge", () => {
    it("shows an OAuth status badge for oauth providers", async () => {
      apiMock.getProviderOAuthStatus.mockResolvedValue(oauthStatusConnected);
      render(<Providers />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText("OAuth Provider")).toBeTruthy();
      });

      await waitFor(() => {
        expect(screen.getByText(/connected/i)).toBeTruthy();
      });
    });

    it("shows disconnected badge for disconnected oauth providers", async () => {
      apiMock.getProviderOAuthStatus.mockResolvedValue(oauthStatusDisconnected);
      render(<Providers />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText("OAuth Provider")).toBeTruthy();
      });

      await waitFor(() => {
        expect(screen.getByText(/disconnected/i)).toBeTruthy();
      });
    });
  });

  describe("Connect button", () => {
    it("shows Connect button for disconnected oauth providers", async () => {
      apiMock.getProviderOAuthStatus.mockResolvedValue(oauthStatusDisconnected);
      render(<Providers />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText("OAuth Provider")).toBeTruthy();
      });

      await waitFor(() => {
        const connectBtn = screen.getByRole("button", { name: /^connect$/i });
        expect(connectBtn).toBeTruthy();
      });
    });
  });

  describe("Check status button", () => {
    it("shows Check status button for oauth providers", async () => {
      apiMock.getProviderOAuthStatus.mockResolvedValue(oauthStatusConnected);
      render(<Providers />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText("OAuth Provider")).toBeTruthy();
      });

      await waitFor(() => {
        const checkButtons = screen.getAllByRole("button");
        const checkButton = checkButtons.find((b) =>
          b.textContent?.toLowerCase().includes("status"),
        );
        expect(checkButton).toBeTruthy();
      });
    });
  });

  describe("error handling", () => {
    it("shows error when OAuth connect fails", async () => {
      const user = userEvent.setup();
      apiMock.getProviderOAuthStatus.mockResolvedValue(oauthStatusDisconnected);
      apiMock.initiateProviderOAuth.mockRejectedValue(
        new Error("Connection failed"),
      );

      render(<Providers />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText("OAuth Provider")).toBeTruthy();
      });

      const connectBtn = await screen.findByRole("button", {
        name: /^connect$/i,
      });
      await user.click(connectBtn);

      await waitFor(() => {
        try {
          expect(screen.getByText(/connection failed/i)).toBeTruthy();
        } catch (e) {
          console.error("FAILED HTML:", document.body.innerHTML);
          throw e;
        }
      });
    });

    it("shows error when delete fails", async () => {
      const user = userEvent.setup();
      apiMock.deleteProvider.mockRejectedValue(new Error("Delete failed"));

      render(<Providers />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText("OpenAI")).toBeTruthy();
      });

      const allButtons = screen.getAllByRole("button");
      const trashBtn = allButtons.find((b) =>
        b.innerHTML.includes("lucide-trash2"),
      );
      expect(trashBtn).toBeTruthy();
      if (trashBtn) {
        await user.click(trashBtn);
      }

      const confirmDelete = await screen.findByRole("button", {
        name: "Delete",
      });
      await user.click(confirmDelete);

      await waitFor(() => {
        expect(screen.getByText(/delete failed/i)).toBeTruthy();
      });
    });
  });
});
