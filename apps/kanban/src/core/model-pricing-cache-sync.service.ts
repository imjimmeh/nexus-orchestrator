import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { KanbanModelPricingCacheRepository } from "../database/repositories/kanban-model-pricing-cache.repository";
import { CoreModelPricingClientService } from "./core-model-pricing-client.service";

const DEFAULT_SYNC_INTERVAL_MS = 15 * 60 * 1000;

type PollTimer = ReturnType<typeof setInterval>;

@Injectable()
export class ModelPricingCacheSyncService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ModelPricingCacheSyncService.name);
  private timer: PollTimer | null = null;

  constructor(
    private readonly pricingClient: CoreModelPricingClientService,
    private readonly cache: KanbanModelPricingCacheRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.syncOnce();
    this.timer = setInterval(() => {
      void this.syncOnce();
    }, this.readIntervalMs());
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async syncOnce(): Promise<void> {
    try {
      const rates = await this.pricingClient.fetchActiveModelRates();
      await this.cache.upsertRates(rates);
    } catch (error) {
      this.logger.warn(
        `Failed to sync model pricing cache: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private readIntervalMs(): number {
    const raw = process.env.KANBAN_MODEL_PRICING_SYNC_INTERVAL_MS;
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_SYNC_INTERVAL_MS;
  }
}
