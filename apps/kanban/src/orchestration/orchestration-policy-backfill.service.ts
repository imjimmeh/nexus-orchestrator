import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import {
  autonomyValuesForMode,
  AUTONOMY_DISPATCH_KEY,
  AUTONOMY_BACKLOG_PROMOTION_KEY,
  AUTONOMY_MERGE_KEY,
  type OrchestrationPolicyMode,
} from "@nexus/kanban-contracts";
import { CoreVariablesClientService } from "../core/core-variables-client.service";
import { KanbanOrchestrationRepository } from "../database/repositories/kanban-orchestration.repository";

const AUTONOMY_KEYS = [
  AUTONOMY_DISPATCH_KEY,
  AUTONOMY_BACKLOG_PROMOTION_KEY,
  AUTONOMY_MERGE_KEY,
] as const;

@Injectable()
export class OrchestrationPolicyBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrchestrationPolicyBackfillService.name);

  constructor(
    private readonly orchestrations: KanbanOrchestrationRepository,
    private readonly variablesClient: CoreVariablesClientService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    let backfilled = 0;
    const projects = await this.orchestrations
      .listAllModes()
      .catch((err: unknown) => {
        this.logger.error(`Backfill skipped: ${String(err)}`);
        return [] as Array<{ projectId: string; mode: string }>;
      });

    for (const { projectId, mode } of projects) {
      try {
        if (await this.hasProjectScopedAutonomy(projectId)) continue;
        const autonomy = autonomyValuesForMode(this.normalizeMode(mode));
        for (const key of AUTONOMY_KEYS) {
          await this.variablesClient.upsert({
            scopeNodeId: projectId,
            key,
            value: autonomy[key],
            valueType: "string",
          });
        }
        backfilled += 1;
      } catch (err: unknown) {
        this.logger.warn(
          `Autonomy backfill failed for ${projectId}: ${String(err)}`,
        );
      }
    }

    this.logger.log(`Orchestration autonomy backfill complete: ${backfilled}`);
  }

  private async hasProjectScopedAutonomy(projectId: string): Promise<boolean> {
    const effective = await this.variablesClient.getEffective(projectId);
    return effective.some(
      (v) =>
        AUTONOMY_KEYS.includes(v.key as (typeof AUTONOMY_KEYS)[number]) &&
        v.layer !== "global",
    );
  }

  private normalizeMode(mode: string): OrchestrationPolicyMode {
    if (mode === "autonomous" || mode === "notifications_only") return mode;
    return "supervised";
  }
}
