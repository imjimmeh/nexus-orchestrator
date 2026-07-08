import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CredentialBindingPanel } from "./CredentialBindingPanel";

const useCredentialRequirementsMock = vi.fn();
const bindMutateAsync = vi.fn();
const unbindMutateAsync = vi.fn();

vi.mock("@/hooks/useHarnessCredentials", () => ({
  useCredentialRequirements: (...args: unknown[]) =>
    useCredentialRequirementsMock(...args),
  useBindCredential: () => ({ mutateAsync: bindMutateAsync, isPending: false }),
  useUnbindCredential: () => ({
    mutateAsync: unbindMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/hooks/useSecrets", () => ({
  useSecrets: () => ({
    data: [
      { id: "secret-1", name: "anthropic-key", metadata: {} },
      { id: "secret-2", name: "other-key", metadata: {} },
    ],
    isLoading: false,
  }),
}));

describe("CredentialBindingPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCredentialRequirementsMock.mockReturnValue({
      data: {
        harnessId: "claude-code",
        requirements: [
          {
            key: "anthropic",
            displayName: "Anthropic API Key / OAuth",
            authTypes: ["api_key", "oauth_device"],
            primary: true,
            bound: false,
          },
        ],
      },
      isLoading: false,
    });
  });

  it("renders each requirement with its display name", () => {
    render(
      <CredentialBindingPanel
        harnessId="claude-code"
        scopeNodeId={undefined}
        onStartDeviceFlow={vi.fn()}
      />,
    );

    expect(screen.getByText("Anthropic API Key / OAuth")).toBeInTheDocument();
  });

  it("shows an unbound status badge when no binding exists", () => {
    render(
      <CredentialBindingPanel
        harnessId="claude-code"
        scopeNodeId={undefined}
        onStartDeviceFlow={vi.fn()}
      />,
    );

    expect(screen.getByText(/not bound/i)).toBeInTheDocument();
  });

  it("offers an OAuth connect button when authTypes includes oauth_device", () => {
    render(
      <CredentialBindingPanel
        harnessId="claude-code"
        scopeNodeId={undefined}
        onStartDeviceFlow={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /connect via oauth/i }),
    ).toBeInTheDocument();
  });

  it("invokes onStartDeviceFlow with the requirement key when clicked", async () => {
    const onStartDeviceFlow = vi.fn();
    const user = userEvent.setup();

    render(
      <CredentialBindingPanel
        harnessId="claude-code"
        scopeNodeId="scope-1"
        onStartDeviceFlow={onStartDeviceFlow}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /connect via oauth/i }),
    );

    expect(onStartDeviceFlow).toHaveBeenCalledWith("anthropic");
  });

  it("shows a bound status when the requirement is bound", () => {
    useCredentialRequirementsMock.mockReturnValue({
      data: {
        harnessId: "claude-code",
        requirements: [
          {
            key: "anthropic",
            displayName: "Anthropic API Key / OAuth",
            authTypes: ["api_key"],
            primary: true,
            bound: true,
            boundAuthType: "api_key",
            boundSecretId: "secret-1",
          },
        ],
      },
      isLoading: false,
    });

    render(
      <CredentialBindingPanel
        harnessId="claude-code"
        scopeNodeId={undefined}
        onStartDeviceFlow={vi.fn()}
      />,
    );

    expect(screen.getByText(/bound/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unbind/i })).toBeInTheDocument();
  });
});
