import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceFlowModal } from "./DeviceFlowModal";

const startMutateAsync = vi.fn();
const submitMutateAsync = vi.fn();
const useCredentialOAuthStatusMock = vi.fn();

vi.mock("@/hooks/useHarnessCredentials", () => ({
  useStartCredentialOAuth: () => ({
    mutateAsync: startMutateAsync,
    isPending: false,
  }),
  useSubmitCredentialOAuthCode: () => ({
    mutateAsync: submitMutateAsync,
    isPending: false,
  }),
  useCredentialOAuthStatus: (...args: unknown[]) =>
    useCredentialOAuthStatusMock(...args),
}));

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("DeviceFlowModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startMutateAsync.mockResolvedValue({
      sessionId: "sess-1",
      modality: "device",
      userCode: "ABCD-EFGH",
      verificationUri: "https://example.com/device",
      intervalSeconds: 5,
      expiresAt: "2026-06-12T00:00:00.000Z",
    });
    useCredentialOAuthStatusMock.mockReturnValue({
      data: { status: "pending" },
    });
  });

  it("starts the oauth flow on open and shows the user code + verification uri", async () => {
    renderWithClient(
      <DeviceFlowModal
        open
        harnessId="claude-code"
        credentialKey="anthropic"
        scopeNodeId="scope-1"
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(startMutateAsync).toHaveBeenCalledWith({
        harnessId: "claude-code",
        key: "anthropic",
        body: { scopeNodeId: "scope-1" },
      }),
    );

    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/device")).toBeInTheDocument();
  });

  it("renders the authcode panel and submits a pasted code", async () => {
    startMutateAsync.mockResolvedValue({
      sessionId: "sess-2",
      modality: "authcode",
      authorizeUrl: "https://example.com/authorize",
      instructions: "Paste the code from the callback page.",
      expiresAt: "2026-06-12T00:00:00.000Z",
    });
    submitMutateAsync.mockResolvedValue({ accepted: true });
    const user = userEvent.setup();

    renderWithClient(
      <DeviceFlowModal
        open
        harnessId="claude-code"
        credentialKey="anthropic"
        scopeNodeId={undefined}
        onOpenChange={vi.fn()}
      />,
    );

    const input = await screen.findByLabelText(/paste the authorization code/i);
    await user.type(input, "auth-code-123");
    await user.click(screen.getByRole("button", { name: /submit code/i }));

    await waitFor(() =>
      expect(submitMutateAsync).toHaveBeenCalledWith({
        harnessId: "claude-code",
        key: "anthropic",
        body: { session_id: "sess-2", code: "auth-code-123" },
      }),
    );
  });

  it("shows a success message when status becomes connected", async () => {
    useCredentialOAuthStatusMock.mockReturnValue({
      data: { status: "connected" },
    });

    renderWithClient(
      <DeviceFlowModal
        open
        harnessId="claude-code"
        credentialKey="anthropic"
        scopeNodeId={undefined}
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText(/authorized/i)).toBeInTheDocument();
  });

  it("shows an expiry message when status becomes expired", async () => {
    useCredentialOAuthStatusMock.mockReturnValue({
      data: { status: "expired" },
    });

    renderWithClient(
      <DeviceFlowModal
        open
        harnessId="claude-code"
        credentialKey="anthropic"
        scopeNodeId={undefined}
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText(/expired/i)).toBeInTheDocument();
  });

  it("shows a denial message when status becomes denied", async () => {
    useCredentialOAuthStatusMock.mockReturnValue({
      data: { status: "denied" },
    });

    renderWithClient(
      <DeviceFlowModal
        open
        harnessId="claude-code"
        credentialKey="anthropic"
        scopeNodeId={undefined}
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText(/denied/i)).toBeInTheDocument();
  });

  it("does not start the flow when closed", () => {
    renderWithClient(
      <DeviceFlowModal
        open={false}
        harnessId="claude-code"
        credentialKey="anthropic"
        scopeNodeId={undefined}
        onOpenChange={vi.fn()}
      />,
    );

    expect(startMutateAsync).not.toHaveBeenCalled();
  });
});
