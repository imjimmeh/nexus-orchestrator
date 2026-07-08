// apps/web/src/pages/scopes/OrgHierarchyPage.spec.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrgHierarchyPage } from "./OrgHierarchyPage";

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );

  return {
    ...actual,
    useParams: () => ({ id: "org-1" }),
  };
});

const orgHierarchyManagerMock = vi.hoisted(() => ({
  component: vi.fn((_props: { rootScopeNodeId: string }) => (
    <div data-testid="org-hierarchy-manager-stub" />
  )),
}));

vi.mock("@/components/scope/manage/OrgHierarchyManager", () => ({
  OrgHierarchyManager: orgHierarchyManagerMock.component,
}));

describe("OrgHierarchyPage", () => {
  it("renders a heading and the OrgHierarchyManager with rootScopeNodeId from the route param", () => {
    render(<OrgHierarchyPage />);

    expect(
      screen.getByRole("heading", { name: /org hierarchy/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("org-hierarchy-manager-stub"),
    ).toBeInTheDocument();
    expect(orgHierarchyManagerMock.component).toHaveBeenCalledWith(
      expect.objectContaining({ rootScopeNodeId: "org-1" }),
      undefined,
    );
  });
});
