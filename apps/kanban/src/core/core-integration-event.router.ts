import { Injectable } from "@nestjs/common";
import {
  CoreIntegrationPrMergedEventEnvelopeV1Schema,
  CoreIntegrationPrStatusEventEnvelopeV1Schema,
  ImprovementTaskRequestedEventEnvelopeV1Schema,
} from "@nexus/core";
import { CoreLifecycleStreamImprovementTaskHandler } from "./core-lifecycle-stream-improvement-task.handler";
import { CoreLifecycleStreamPrMergedHandler } from "./core-lifecycle-stream-pr-merged.handler";
import { CoreLifecycleStreamPrStatusHandler } from "./core-lifecycle-stream-pr-status.handler";

export const PR_MERGED_EVENT_TYPE = "core.integration.pr_merged.v1";
export const PR_STATUS_EVENT_TYPE = "core.integration.pr_status.v1";
export const IMPROVEMENT_TASK_REQUESTED_EVENT_TYPE =
  "improvement.task.requested.v1";

/**
 * Routes neutral `core.integration.*` lifecycle stream entries (plus the
 * neutral `improvement.task.requested.v1` event) to their dedicated
 * handlers: `pr_merged` closes the lifecycle, `pr_status` refreshes the
 * dynamic PR observation, `improvement.task.requested.v1` files a
 * self-improvement work item. Keeps envelope parsing/dispatch out of the
 * broad workflow-run consumer so each concern stays single-purpose.
 */
@Injectable()
export class CoreIntegrationEventRouter {
  constructor(
    private readonly prMergedHandler: CoreLifecycleStreamPrMergedHandler,
    private readonly prStatusHandler: CoreLifecycleStreamPrStatusHandler,
    private readonly improvementTaskHandler: CoreLifecycleStreamImprovementTaskHandler,
  ) {}

  /** True when this router owns the given stream entry event type. */
  handles(eventType: string | undefined): boolean {
    return (
      eventType === PR_MERGED_EVENT_TYPE ||
      eventType === PR_STATUS_EVENT_TYPE ||
      eventType === IMPROVEMENT_TASK_REQUESTED_EVENT_TYPE
    );
  }

  async route(
    eventType: string | undefined,
    envelopeJson: string | undefined,
  ): Promise<void> {
    if (eventType === PR_MERGED_EVENT_TYPE) {
      await this.prMergedHandler.handle(this.parseMerged(envelopeJson));
      return;
    }
    if (eventType === PR_STATUS_EVENT_TYPE) {
      await this.prStatusHandler.handle(this.parseStatus(envelopeJson));
      return;
    }
    if (eventType === IMPROVEMENT_TASK_REQUESTED_EVENT_TYPE) {
      await this.improvementTaskHandler.handle(
        this.parseImprovementTask(envelopeJson),
      );
      return;
    }
  }

  private parseMerged(value: string | undefined) {
    if (!value) {
      throw new Error("Malformed pr_merged event: missing envelope");
    }
    return CoreIntegrationPrMergedEventEnvelopeV1Schema.parse(JSON.parse(value))
      .payload;
  }

  private parseStatus(value: string | undefined) {
    if (!value) {
      throw new Error("Malformed pr_status event: missing envelope");
    }
    return CoreIntegrationPrStatusEventEnvelopeV1Schema.parse(JSON.parse(value))
      .payload;
  }

  private parseImprovementTask(value: string | undefined) {
    if (!value) {
      throw new Error("Malformed improvement task event: missing envelope");
    }
    return ImprovementTaskRequestedEventEnvelopeV1Schema.parse(
      JSON.parse(value),
    ).payload;
  }
}
