import { Injectable, Logger } from '@nestjs/common';
import { CostTrackingRepository } from '../system/database/repositories/cost-tracking.repository';

@Injectable()
export class CostTrackingService {
  private readonly logger = new Logger(CostTrackingService.name);

  // Unit prices (example values)
  private readonly LLM_PRICE_PER_1K = 0.002; // $0.002 per 1k tokens (GPT-4o-mini)
  private readonly COMPUTE_PRICE_PER_HOUR_HEAVY = 0.1;
  private readonly COMPUTE_PRICE_PER_HOUR_LIGHT = 0.02;

  constructor(private readonly repository: CostTrackingRepository) {}

  async trackLLMUsage(
    workflowRunId: string,
    model: string,
    tokens: number,
  ): Promise<void> {
    const cost = (tokens / 1000) * this.LLM_PRICE_PER_1K;
    await this.repository.recordCost({
      resource_type: 'LLM',
      model,
      units_consumed: tokens,
      cost_usd: cost,
      workflow_run_id: workflowRunId,
    });
  }

  async trackComputeUsage(
    workflowRunId: string,
    tier: 'light' | 'heavy',
    durationSeconds: number,
  ): Promise<void> {
    const hours = durationSeconds / 3600;
    const price =
      tier === 'heavy'
        ? this.COMPUTE_PRICE_PER_HOUR_HEAVY
        : this.COMPUTE_PRICE_PER_HOUR_LIGHT;
    const cost = hours * price;

    await this.repository.recordCost({
      resource_type: 'Compute',
      model: tier,
      units_consumed: hours,
      cost_usd: cost,
      workflow_run_id: workflowRunId,
    });
  }

  async getMonthlySummary(): Promise<Record<string, unknown>[]> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return this.repository.getSummary(startOfMonth, now);
  }
}
