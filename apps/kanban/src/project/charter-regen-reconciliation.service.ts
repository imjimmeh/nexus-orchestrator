import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ProjectService } from "./project.service";
import { CharterRegenEnqueuer } from "./charter-regen.enqueuer";

const DEFAULT_SWEEP_INTERVAL_MS = 900_000; // 15 minutes

function readSweepIntervalMs(): number {
  const value = Number(process.env.KANBAN_CHARTER_RECONCILE_INTERVAL_MS);
  return Number.isFinite(value) && value > 0
    ? Math.round(value)
    : DEFAULT_SWEEP_INTERVAL_MS;
}

@Injectable()
export class CharterRegenReconciliationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CharterRegenReconciliationService.name);
  private readonly intervalMs = readSweepIntervalMs();
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor(
    private readonly projects: ProjectService,
    private readonly enqueuer: CharterRegenEnqueuer,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.sweepOnce();
    this.timer = setInterval(() => void this.sweepOnce(), this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async sweepOnce(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      const enqueued = await this.reconcileAll();
      this.logger.log(`charter reconciliation enqueued ${enqueued} project(s)`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`charter reconciliation sweep failed: ${reason}`);
    } finally {
      this.inFlight = false;
    }
  }

  async reconcileAll(): Promise<number> {
    const projects = await this.projects.list();
    let enqueued = 0;
    for (const project of projects) {
      if (!project.basePath) {
        continue;
      }
      try {
        await this.enqueuer.enqueue(project.id);
        enqueued += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `charter reconciliation failed for ${project.id}: ${reason}`,
        );
      }
    }
    return enqueued;
  }
}
