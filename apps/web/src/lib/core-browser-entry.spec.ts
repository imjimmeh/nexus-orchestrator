import * as core from "@nexus/core";
import * as KanbanContracts from "@nexus/kanban-contracts";

describe("web workspace package entries", () => {
  it("keeps server-only request context exports out of the frontend graph", () => {
    expect(core).not.toHaveProperty("BaseRequestContextService");
    expect(core).not.toHaveProperty("CorrelationIdMiddleware");
  });

  it("loads kanban contracts from the same source entry used by TypeScript", () => {
    expect(KanbanContracts.WORK_ITEM_STATUS_GROUPS.active).toContain(
      "refinement",
    );
  });
});
