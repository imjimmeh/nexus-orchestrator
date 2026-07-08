import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { KanbanOrchestrationLeaseRepository } from "../../database/repositories/kanban-orchestration-lease.repository";

const SWEEP_INTERVAL_MS = 30000;

@Injectable()
export class OrchestrationLeaseSweeperService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OrchestrationLeaseSweeperService.name);
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;

  constructor(private readonly leases: KanbanOrchestrationLeaseRepository) {}

  onModuleInit(): void {
    this.intervalId = setInterval(
      () => void this.runSweep(),
      SWEEP_INTERVAL_MS,
    );
  }

  onModuleDestroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async sweep(): Promise<{ reclaimed: number }> {
    const reclaimed = await this.leases.expireOverdue(new Date());
    for (const lease of reclaimed) {
      this.logger.warn(
        `Reclaimed expired orchestration lease ${lease.id} ` +
          `(project=${lease.project_id} key=${lease.conflict_key_value} ` +
          `owner=${lease.owner_kind}:${lease.owner_id}) — holder died without releasing.`,
      );
    }
    return { reclaimed: reclaimed.length };
  }

  private async runSweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.sweep();
    } catch (error) {
      this.logger.warn(
        `lease sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.sweeping = false;
    }
  }
}
