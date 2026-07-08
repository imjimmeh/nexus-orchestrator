import { MODULE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { OrchestrationActionRequestsService } from "./orchestration-action-requests.service";
import {
  ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE,
  OrchestrationCycleDecisionService,
} from "./orchestration-cycle-decision.service";
import { OrchestrationModule } from "./orchestration.module";
import { OrchestrationObservabilityService } from "./orchestration-observability.service";
import { OrchestrationRunRequestService } from "./orchestration-run-request.service";
import { OrchestrationStateLifecycleService } from "./orchestration-state-lifecycle.service";
import { ProjectStrategicStateService } from "./strategic/project-strategic-state.service";

describe("OrchestrationModule", () => {
  function getProviders(): unknown[] {
    return Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      OrchestrationModule,
    ) as unknown[];
  }

  it("provides ProjectStrategicStateService", () => {
    const providers = getProviders();
    expect(providers).toContain(ProjectStrategicStateService);
  });

  it("registers all 5 orchestration helper services as providers", () => {
    // Lock the helper DI graph introduced in the M1 refactor:
    // dropping any of these from `OrchestrationModule.providers`
    // would silently re-introduce manual DI at runtime, so the
    // registration must remain explicit and ordered consistently.
    const providers = getProviders();

    expect(providers).toContain(OrchestrationCycleDecisionService);
    expect(providers).toContain(OrchestrationActionRequestsService);
    expect(providers).toContain(OrchestrationObservabilityService);
    expect(providers).toContain(OrchestrationStateLifecycleService);
    expect(providers).toContain(OrchestrationRunRequestService);
  });

  it("registers the ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE factory token", () => {
    // The clear-pending-consecutive-failure callback breaks the
    // orchestrator ⇄ cycle-decision cycle via `forwardRef`, so the
    // factory provider must remain registered or the cycle decision
    // service's @Inject binding will resolve to `undefined` at runtime.
    const providers = getProviders() as Array<{ provide?: unknown }>;
    const hasToken = providers.some(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        "provide" in entry &&
        entry.provide === ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE,
    );

    expect(hasToken).toBe(true);
  });

  it("exports ProjectStrategicStateService", () => {
    const exports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      OrchestrationModule,
    ) as unknown[];

    expect(exports).toContain(ProjectStrategicStateService);
  });
});
