import { describe, expect, it, vi } from "vitest";
import { getCycleRequestsForProject } from "./project-orchestration-cycle-request-test.helpers";

describe("project orchestration cycle request test helpers", () => {
  it("matches cycle requests by scopeId with projectId fallback", () => {
    const coreClient = {
      emitDomainEvent: vi.fn(),
    };
    coreClient.emitDomainEvent({
      eventName: "ProjectOrchestrationCycleRequestedEvent",
      payload: { scopeId: "project-1" },
    });
    coreClient.emitDomainEvent({
      eventName: "ProjectOrchestrationCycleRequestedEvent",
      payload: { projectId: "project-1" },
    });
    coreClient.emitDomainEvent({
      eventName: "OtherEvent",
      payload: { scopeId: "project-1" },
    });
    coreClient.emitDomainEvent({
      eventName: "ProjectOrchestrationCycleRequestedEvent",
      payload: { scopeId: "project-2" },
    });

    expect(getCycleRequestsForProject(coreClient, "project-1")).toHaveLength(2);
  });
});
