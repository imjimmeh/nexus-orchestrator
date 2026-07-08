// apps/web/src/components/scope/manage/TenantBoundaryToggle.spec.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TenantBoundaryToggle } from "./TenantBoundaryToggle";
import { useUpdateScopeNode } from "@/hooks/useScope";
import type { ScopeNode } from "@/lib/api/client.scope.types";

vi.mock("@/hooks/useScope", () => ({
  useUpdateScopeNode: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const mockMutateAsync = vi.fn();

function makeNode(overrides: Partial<ScopeNode> = {}): ScopeNode {
  return {
    id: "node-1",
    parentId: "parent-1",
    type: "org",
    name: "Acme",
    slug: "acme",
    metadata: {},
    isTenantRoot: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("TenantBoundaryToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue(undefined);
    vi.mocked(useUpdateScopeNode).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateScopeNode>);
  });

  it("renders nothing for a team node", () => {
    const { container } = render(
      <TenantBoundaryToggle node={makeNode({ type: "team" })} />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("renders a switch reflecting isTenantRoot for an org node", () => {
    render(<TenantBoundaryToggle node={makeNode({ isTenantRoot: true })} />);

    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("data-state")).toBe("checked");
  });

  it("renders an unchecked switch for a platform node with isTenantRoot false", () => {
    render(
      <TenantBoundaryToggle
        node={makeNode({ type: "platform", isTenantRoot: false })}
      />,
    );

    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("data-state")).toBe("unchecked");
  });

  it("calls mutateAsync with the flipped isTenantRoot value when toggled", () => {
    render(<TenantBoundaryToggle node={makeNode({ isTenantRoot: false })} />);

    fireEvent.click(screen.getByRole("switch"));

    expect(mockMutateAsync).toHaveBeenCalledWith({ isTenantRoot: true });
  });

  it("passes disabled through to the switch", () => {
    render(<TenantBoundaryToggle node={makeNode()} disabled />);

    expect(screen.getByRole("switch")).toBeDisabled();
  });
});
