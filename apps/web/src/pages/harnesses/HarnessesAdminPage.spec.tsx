import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ScopeProvider } from "@/context/ScopeContext";
import { HarnessesAdminPage } from "./HarnessesAdminPage";
import type { HarnessDefinition } from "@/lib/api/harness-api.types";

function renderPage(initialEntries: string[] = ["/"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ScopeProvider>
        <HarnessesAdminPage />
      </ScopeProvider>
    </MemoryRouter>,
  );
}

// IDs are intentionally distinct from harnessIds to catch regressions where
// the wrong field is passed to delete/validate mutations.
const MOCK_HARNESSES: HarnessDefinition[] = [
  {
    id: "uuid-builtin-1",
    harnessId: "pi",
    displayName: "PI",
    source: "builtin",
    capabilities: {},
    imageRef: "nexus-pi:latest",
    transport: "stdio",
    enabled: true,
    secretRefs: {},
    defaultEnv: {},
    policyScope: {},
  },
  {
    id: "uuid-custom-2",
    harnessId: "custom:my-harness",
    displayName: "My Custom Harness",
    source: "custom",
    capabilities: {},
    imageRef: "my-registry/my-harness:latest",
    transport: "http",
    enabled: true,
    secretRefs: {},
    defaultEnv: {},
    policyScope: {},
  },
];

const MOCK_CLAUDE_CODE_HARNESS: HarnessDefinition = {
  id: "1",
  harnessId: "claude-code",
  displayName: "Claude Code",
  source: "builtin",
  imageRef: "nexus-claude-code:latest",
  transport: "kernel",
  enabled: true,
  capabilities: {},
  secretRefs: {},
  defaultEnv: {},
  policyScope: {},
};

const mockDeleteMutateAsync = vi.fn();
const mockValidateMutateAsync = vi.fn();
const mockUseHarnesses = vi.fn();

vi.mock("@/hooks/useHarnesses", () => ({
  useHarnesses: (...args: unknown[]) => mockUseHarnesses(...args),
  useCreateHarness: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteHarness: () => ({
    mutateAsync: mockDeleteMutateAsync,
    isPending: false,
  }),
  useValidateHarness: () => ({
    mutateAsync: mockValidateMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/components/harnesses/ScopedDefaultsForm", () => ({
  ScopedDefaultsForm: ({ scopeNodeId }: { scopeNodeId: string }) => (
    <div data-testid="scoped-defaults-form" data-scope-node-id={scopeNodeId} />
  ),
}));

vi.mock("@/components/harnesses/CredentialBindingPanel", () => ({
  CredentialBindingPanel: (props: { harnessId: string }) => {
    credentialBindingPanelSpy(props);
    return <div data-testid="credential-binding-panel">{props.harnessId}</div>;
  },
}));

vi.mock("@/components/harnesses/DeviceFlowModal", () => ({
  DeviceFlowModal: (props: { open: boolean }) =>
    props.open ? <div data-testid="device-flow-modal" /> : null,
}));

const credentialBindingPanelSpy = vi.fn();

describe("HarnessesAdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseHarnesses.mockReturnValue({
      data: MOCK_HARNESSES,
      isLoading: false,
    });
  });

  it("lists harnesses and shows Validate action per row", () => {
    renderPage();

    const validateButtons = screen.getAllByRole("button", {
      name: /validate/i,
    });
    expect(validateButtons.length).toBeGreaterThan(0);
  });

  it("renders builtin harnesses with a builtin badge", () => {
    renderPage();

    expect(screen.getByText("builtin")).toBeInTheDocument();
  });

  it("renders custom harnesses with a custom badge", () => {
    renderPage();

    expect(screen.getByText("custom")).toBeInTheDocument();
  });

  it("renders the Register Custom Harness button", () => {
    renderPage();

    expect(
      screen.getByRole("button", { name: /register custom harness/i }),
    ).toBeInTheDocument();
  });

  it("shows Delete action only for custom harnesses", () => {
    renderPage();

    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    // Only the custom harness has a Delete button
    expect(deleteButtons).toHaveLength(1);
  });

  it("calls delete mutation with harnessId, not the DB id", async () => {
    renderPage();

    const deleteButton = screen.getByRole("button", { name: /delete/i });
    fireEvent.click(deleteButton);

    expect(mockDeleteMutateAsync).toHaveBeenCalledWith("custom:my-harness");
    expect(mockDeleteMutateAsync).not.toHaveBeenCalledWith("uuid-custom-2");
  });

  it("calls validate mutation with harnessId, not the DB id", async () => {
    const user = userEvent.setup();
    renderPage();

    const validateButtons = screen.getAllByRole("button", {
      name: /validate/i,
    });
    await user.click(validateButtons[0]);

    await waitFor(() => {
      expect(mockValidateMutateAsync).toHaveBeenCalledWith(
        MOCK_HARNESSES[0].harnessId,
      );
    });
    expect(mockValidateMutateAsync).not.toHaveBeenCalledWith(
      MOCK_HARNESSES[0].id,
    );
  });
});

describe("HarnessesAdminPage scope awareness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseHarnesses.mockReturnValue({
      data: MOCK_HARNESSES,
      isLoading: false,
    });
  });

  it("does not show a platform-wide note at the global scope", () => {
    renderPage();

    expect(screen.queryByText(/platform-wide/i)).not.toBeInTheDocument();
  });

  it("shows a platform-wide note when a non-global scope is active", () => {
    renderPage(["/?scope=n1"]);

    expect(screen.getByText(/platform-wide/i)).toBeInTheDocument();
  });

  it("does not send a scopeNodeId to the harnesses list query", () => {
    renderPage(["/?scope=n1"]);

    expect(mockUseHarnesses).toHaveBeenCalledWith();
  });
});

describe("HarnessesAdminPage credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseHarnesses.mockReturnValue({
      data: [MOCK_CLAUDE_CODE_HARNESS],
      isLoading: false,
    });
  });

  it("reveals the credential binding panel when a harness row is expanded", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /credentials/i }));

    expect(screen.getByTestId("credential-binding-panel")).toBeInTheDocument();
    expect(credentialBindingPanelSpy).toHaveBeenCalledWith(
      expect.objectContaining({ harnessId: "claude-code" }),
    );
  });
});
