import { describe, expect, it, vi } from "vitest";
import { OrchestrationLeaseSweeperService } from "./orchestration-lease-sweeper.service";

describe("OrchestrationLeaseSweeperService.sweep", () => {
  it("expires overdue leases and logs each reclaimed holder", async () => {
    const repo = {
      expireOverdue: vi.fn().mockResolvedValue([
        {
          id: "l1",
          project_id: "p1",
          owner_kind: "workflow_run",
          owner_id: "run-9",
          conflict_key_value: "project_orchestration_cycle_ceo:p1",
        },
      ]),
    };
    const service = new OrchestrationLeaseSweeperService(repo as never);
    const warn = vi.spyOn(
      (service as never as { logger: { warn: () => void } }).logger,
      "warn",
    );

    const result = await service.sweep();

    expect(result.reclaimed).toBe(1);
    expect(repo.expireOverdue).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });
});
