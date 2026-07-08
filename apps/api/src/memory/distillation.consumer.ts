import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PiSessionTreeRepository } from '../runtime/database/repositories/pi-session-tree.repository';
import { LLMService } from './llm.service';
import { TokenCounterService } from './token-counter.service';
import {
  DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW,
  DEFAULT_MEMORY_BUDGET_PERCENTS,
  MemoryTokenBudgetResolver,
} from './memory-token-budget.resolver';
import type { MemoryTokenBudget } from './memory-token-budget.resolver.types';
import { MemoryMetricsService } from './memory-metrics.service';
import { MetricsService } from '../observability/metrics.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import { AUTONOMY_EVENT_NAMES } from '../observability/autonomy-observability.types';
import { DistillationThresholdService } from './distillation-threshold.service';
import * as zlib from 'zlib';
import { promisify } from 'util';

const unzip = promisify(zlib.unzip);
const gzip = promisify(zlib.gzip);

interface DistillationJobData {
  sessionTreeId: string;
  model: string;
  threshold?: number;
  thresholdSource?: string;
}

const DISTILLATION_ERROR_CODE = 'DISTILLATION_FAILED';
const DISTILLATION_ERROR_MESSAGE = 'Distillation run failed.';

// Distillation age-based compression policy
const DISTILLATION_AGE_BAND_YOUNG_MAX_AGE = 10;
const DISTILLATION_AGE_BAND_MID_MAX_AGE = 20;
const DISTILLATION_AGE_BAND_OLD_MAX_AGE = 50;
const DISTILLATION_TARGET_NO_COMPRESSION_PERCENT = 100;
const DISTILLATION_TARGET_YOUNG_PERCENT = 70;
const DISTILLATION_TARGET_MID_PERCENT = 50;
const DISTILLATION_TARGET_OLD_PERCENT = 30;

@Injectable()
@Processor('distillation')
export class DistillationConsumer extends WorkerHost {
  private readonly logger = new Logger(DistillationConsumer.name);

  constructor(
    private readonly sessionTreeRepo: PiSessionTreeRepository,
    private readonly llmService: LLMService,
    private readonly tokenCounter: TokenCounterService,
    private readonly budgetResolver: MemoryTokenBudgetResolver,
    private readonly memoryMetrics: MemoryMetricsService,
    private readonly metrics: MetricsService,
    private readonly eventLedger: EventLedgerService,
    private readonly thresholdService: DistillationThresholdService,
  ) {
    super();
  }

  async process(job: Job<DistillationJobData, unknown>): Promise<unknown> {
    const { sessionTreeId, model } = job.data;
    this.logger.log(`Starting distillation for session tree ${sessionTreeId}`);

    const startedAt = Date.now();
    let inputSegmentCount = 0;
    let initialTokenCount = 0;
    try {
      const tree = await this.sessionTreeRepo.findById(sessionTreeId);
      if (!tree) throw new Error(`Session tree ${sessionTreeId} not found`);

      // 1. Decompress data
      const base64Data = String(tree.jsonl_data[0]);
      const compressedBuffer = Buffer.from(base64Data, 'base64');
      const decompressedBuffer = await unzip(compressedBuffer);
      const jsonlString = decompressedBuffer.toString('utf-8');
      const nodes = jsonlString
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>);

      inputSegmentCount = nodes.length;
      initialTokenCount = this.tokenCounter.countJSONLTokens(nodes, model);
      this.logger.log(`Initial token count: ${initialTokenCount.toString()}`);

      // 1a. Live threshold re-check.
      const thresholdOutcome = await this.checkLiveThreshold({
        sessionTreeId,
        model,
        nodes,
        inputSegmentCount,
        initialTokenCount,
        startedAt,
      });
      if (thresholdOutcome !== null) {
        return thresholdOutcome;
      }

      // 1b. Memory budget resolution and within-budget check.
      const memoryBudget = await this.resolveMemoryBudgetSafe();
      this.logger.log(
        `Memory budget for active model: ${memoryBudget.memory.toString()} ` +
          `tokens (context window: ${memoryBudget.contextWindow.toString()}, ` +
          `slice ${memoryBudget.memoryPercent.toString()}/` +
          `${memoryBudget.workingPercent.toString()}/` +
          `${memoryBudget.reservedPercent.toString()})`,
      );

      if (initialTokenCount <= memoryBudget.memory) {
        return await this.recordWithinMemoryBudgetSkip({
          sessionTreeId,
          model,
          base64Data,
          inputSegmentCount,
          initialTokenCount,
          memoryBudget,
          startedAt,
        });
      }

      // 2. Recursive summarisation + 3. compress & save.
      const finalTokenCount = await this.summarizeAndCompress(
        nodes,
        model,
        sessionTreeId,
        initialTokenCount,
      );

      return await this.recordSuccessOutcome({
        sessionTreeId,
        model,
        inputSegmentCount,
        initialTokenCount,
        finalTokenCount,
        nodeCount: nodes.length,
        startedAt,
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const failurePayload = {
        input_segment_count: inputSegmentCount,
        output_segment_count: 0,
        compression_ratio: 0,
        tokens_before: initialTokenCount,
        tokens_after: 0,
        model,
        duration_ms: durationMs,
      };
      this.memoryMetrics.recordDistillationCompleted('failure', failurePayload);
      this.metrics.recordDistillationCompleted('failure', 0);
      const err = error as Error;
      await this.eventLedger.emitBestEffort({
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.distillationFailed,
        outcome: 'failure',
        sessionTreeId,
        errorCode: DISTILLATION_ERROR_CODE,
        errorMessage: err.message ?? DISTILLATION_ERROR_MESSAGE,
        payload: {
          ...failurePayload,
          error_message: err.message ?? DISTILLATION_ERROR_MESSAGE,
        },
      });
      throw error;
    }
  }

  /**
   * Re-evaluate the live trigger threshold and short-circuit with a
   * recorded skip when the snapshot is no longer over the live
   * threshold. Returns `null` when distillation should proceed.
   */
  private async checkLiveThreshold(params: {
    sessionTreeId: string;
    model: string;
    nodes: Array<Record<string, unknown>>;
    inputSegmentCount: number;
    initialTokenCount: number;
    startedAt: number;
  }): Promise<unknown> {
    const {
      sessionTreeId,
      model,
      nodes,
      inputSegmentCount,
      initialTokenCount,
      startedAt,
    } = params;
    // The resolver is the single source of truth and emits a
    // MemorySettingChanged event when the resolved `(value, source)`
    // tuple drifts from the previous resolution. If the current
    // snapshot is no longer over the live threshold (e.g. the
    // operator raised the global SystemSetting between enqueue and
    // processing), skip the run rather than burn tokens compressing
    // a tree the operator no longer wants distilled.
    const { value: liveThreshold, source: liveSource } =
      await this.thresholdService.resolve(sessionTreeId);
    const overThreshold = await this.tokenCounter.isOverThreshold(
      nodes,
      model,
      liveThreshold,
    );
    if (!overThreshold) {
      return await this.recordThresholdSkip({
        sessionTreeId,
        model,
        inputSegmentCount,
        initialTokenCount,
        liveThreshold,
        liveSource,
        startedAt,
      });
    }
    return null;
  }

  /**
   * Run the age-based recursive summarisation over the parsed nodes,
   * gzip the result, persist the new tree, and return the final token
   * count.
   *
   * Age of Node         | Target Compression
   * 0-`DISTILLATION_AGE_BAND_YOUNG_MAX_AGE` turns old      | `DISTILLATION_TARGET_NO_COMPRESSION_PERCENT` (No compression)
   * >`DISTILLATION_AGE_BAND_YOUNG_MAX_AGE`-`DISTILLATION_AGE_BAND_MID_MAX_AGE` turns old | `DISTILLATION_TARGET_YOUNG_PERCENT`
   * >`DISTILLATION_AGE_BAND_MID_MAX_AGE`-`DISTILLATION_AGE_BAND_OLD_MAX_AGE` turns old  | `DISTILLATION_TARGET_MID_PERCENT`
   * >`DISTILLATION_AGE_BAND_OLD_MAX_AGE` turns old       | `DISTILLATION_TARGET_OLD_PERCENT`
   */
  private async summarizeAndCompress(
    nodes: Array<Record<string, unknown>>,
    model: string,
    sessionTreeId: string,
    initialTokenCount: number,
  ): Promise<number> {
    const totalNodes = nodes.length;
    for (let i = 0; i < totalNodes; i++) {
      const age = totalNodes - 1 - i;
      const node = nodes[i];

      if (node.type === 'tool_use' || node.type === 'tool_result') {
        continue;
      }

      let targetPercentage = DISTILLATION_TARGET_NO_COMPRESSION_PERCENT;
      if (age > DISTILLATION_AGE_BAND_OLD_MAX_AGE)
        targetPercentage = DISTILLATION_TARGET_OLD_PERCENT;
      else if (age > DISTILLATION_AGE_BAND_MID_MAX_AGE)
        targetPercentage = DISTILLATION_TARGET_MID_PERCENT;
      else if (age > DISTILLATION_AGE_BAND_YOUNG_MAX_AGE)
        targetPercentage = DISTILLATION_TARGET_YOUNG_PERCENT;

      if (
        targetPercentage < DISTILLATION_TARGET_NO_COMPRESSION_PERCENT &&
        typeof node.content === 'string'
      ) {
        const context = nodes
          .slice(Math.max(0, i - 2), i + 3)
          .map(
            (n) => `${String(n.type)}: ${String(n.content).substring(0, 100)}`,
          )
          .join('\n');

        node.content = await this.llmService.summarizeNode(
          node.content,
          context,
          targetPercentage,
        );
        node.distilled = true;
      }
    }

    const newJsonlString = nodes.map((n) => JSON.stringify(n)).join('\n');
    const newCompressedBuffer = await gzip(
      Buffer.from(newJsonlString, 'utf-8'),
    );
    const newBase64Data = newCompressedBuffer.toString('base64');

    const finalTokenCount = this.tokenCounter.countJSONLTokens(nodes, model);
    this.logger.log(
      `Final token count: ${finalTokenCount.toString()} (Ratio: ${((finalTokenCount / initialTokenCount) * 100).toFixed(2)}%)`,
    );

    await this.sessionTreeRepo.update(sessionTreeId, {
      jsonl_data: [newBase64Data],
    });

    return finalTokenCount;
  }

  /**
   * Record the "under live threshold" skip path: the snapshot was over
   * the threshold at enqueue time but the live SystemSetting has since
   * moved so the consumer refuses to run. Emits a `distillationCompleted`
   * event with outcome `skipped` so audit pipelines can still observe
   * the no-op.
   */
  private async recordThresholdSkip(params: {
    sessionTreeId: string;
    model: string;
    inputSegmentCount: number;
    initialTokenCount: number;
    liveThreshold: number;
    liveSource: string;
    startedAt: number;
  }): Promise<{
    initialTokens: number;
    finalTokens: number;
    ratio: number;
    skipped: true;
    threshold: number;
    thresholdSource: string;
  }> {
    const {
      sessionTreeId,
      model,
      inputSegmentCount,
      initialTokenCount,
      liveThreshold,
      liveSource,
      startedAt,
    } = params;
    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `Skipping distillation for session tree ${sessionTreeId}: under live threshold (${initialTokenCount} <= limit*${liveThreshold}, source=${liveSource})`,
    );
    this.memoryMetrics.recordDistillationCompleted('skipped', {
      input_segment_count: inputSegmentCount,
      output_segment_count: inputSegmentCount,
      compression_ratio: 1,
      tokens_before: initialTokenCount,
      tokens_after: initialTokenCount,
      model,
      duration_ms: durationMs,
    });
    this.metrics.recordDistillationCompleted('skipped', 1);
    await this.eventLedger.emitBestEffort({
      domain: 'memory',
      eventName: AUTONOMY_EVENT_NAMES.distillationCompleted,
      outcome: 'denied',
      sessionTreeId,
      payload: {
        reason: 'under_live_threshold',
        threshold: liveThreshold,
        threshold_source: liveSource,
        tokens_before: initialTokenCount,
        model,
        duration_ms: durationMs,
      },
    });
    return {
      initialTokens: initialTokenCount,
      finalTokens: initialTokenCount,
      ratio: 1,
      skipped: true,
      threshold: liveThreshold,
      thresholdSource: liveSource,
    };
  }

  /**
   * Record the "within memory budget" skip path: the snapshot is over
   * the live trigger threshold (so distillation was queued) but the
   * payload already fits inside the active model's memory slice. The
   * tree is re-emitted unchanged and a `distillationCompleted` event
   * is emitted with outcome `skipped` so audit pipelines can still
   * observe the no-op.
   */
  private async recordWithinMemoryBudgetSkip(params: {
    sessionTreeId: string;
    model: string;
    base64Data: string;
    inputSegmentCount: number;
    initialTokenCount: number;
    memoryBudget: MemoryTokenBudget;
    startedAt: number;
  }): Promise<{
    initialTokens: number;
    finalTokens: number;
    ratio: number;
    skipped: true;
    reason: 'within_memory_budget';
    memoryBudget: number;
  }> {
    const {
      sessionTreeId,
      model,
      base64Data,
      inputSegmentCount,
      initialTokenCount,
      memoryBudget,
      startedAt,
    } = params;
    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `Skipping distillation for session tree ${sessionTreeId}: payload (${initialTokenCount.toString()}) fits inside active model memory budget (${memoryBudget.memory.toString()})`,
    );

    await this.sessionTreeRepo.update(sessionTreeId, {
      jsonl_data: [base64Data],
    });

    this.memoryMetrics.recordDistillationCompleted('skipped', {
      input_segment_count: inputSegmentCount,
      output_segment_count: inputSegmentCount,
      compression_ratio: 1,
      tokens_before: initialTokenCount,
      tokens_after: initialTokenCount,
      model,
      duration_ms: durationMs,
    });
    this.metrics.recordDistillationCompleted('skipped', 1);
    await this.eventLedger.emitBestEffort({
      domain: 'memory',
      eventName: AUTONOMY_EVENT_NAMES.distillationCompleted,
      outcome: 'skipped',
      sessionTreeId,
      payload: {
        reason: 'within_memory_budget',
        memory_budget: memoryBudget.memory,
        context_window: memoryBudget.contextWindow,
        tokens_before: initialTokenCount,
        model,
        duration_ms: durationMs,
      },
    });
    return {
      initialTokens: initialTokenCount,
      finalTokens: initialTokenCount,
      ratio: 1,
      skipped: true,
      reason: 'within_memory_budget',
      memoryBudget: memoryBudget.memory,
    };
  }

  /**
   * Record a successful distillation outcome: emit metrics, the
   * EventLedger entry, and the consumer return value. The summarisation
   * itself happens inline in {@link process}; this helper centralises
   * everything that follows the final `sessionTreeRepo.update` so the
   * main flow stays readable.
   */
  private async recordSuccessOutcome(params: {
    sessionTreeId: string;
    model: string;
    inputSegmentCount: number;
    initialTokenCount: number;
    finalTokenCount: number;
    nodeCount: number;
    startedAt: number;
  }): Promise<{
    initialTokens: number;
    finalTokens: number;
    ratio: number;
  }> {
    const {
      sessionTreeId,
      model,
      inputSegmentCount,
      initialTokenCount,
      finalTokenCount,
      nodeCount,
      startedAt,
    } = params;
    const durationMs = Date.now() - startedAt;
    const compressionRatio =
      initialTokenCount > 0 ? finalTokenCount / initialTokenCount : 0;
    const payload = {
      input_segment_count: inputSegmentCount,
      output_segment_count: nodeCount,
      compression_ratio: compressionRatio,
      tokens_before: initialTokenCount,
      tokens_after: finalTokenCount,
      model,
      duration_ms: durationMs,
    };
    this.memoryMetrics.recordDistillationCompleted('success', payload);
    this.metrics.recordDistillationCompleted('success', compressionRatio);
    await this.eventLedger.emitBestEffort({
      domain: 'memory',
      eventName: AUTONOMY_EVENT_NAMES.distillationCompleted,
      outcome: 'success',
      sessionTreeId,
      payload,
    });
    return {
      initialTokens: initialTokenCount,
      finalTokens: finalTokenCount,
      ratio: finalTokenCount / initialTokenCount,
    };
  }

  /**
   * Resolve the active model's memory token budget via the injected
   * `MemoryTokenBudgetResolver`, applying a defensive fallback when
   * the resolver is unavailable (e.g. transient AI config outage).
   *
   * The fallback mirrors the resolver's own default `contextWindow`
   * (128_000 tokens, sliced 60/30/10) so the historical cap is
   * preserved when the resolver cannot be reached, while keeping the
   * rest of the consumer's behaviour intact. The consumer never re-
   * implements the budget math; it either consumes the resolver's
   * `budget.memory` directly or the documented fallback slice.
   */
  private async resolveMemoryBudgetSafe(): Promise<MemoryTokenBudget> {
    try {
      const budget = await this.budgetResolver.resolve();
      if (Number.isFinite(budget.memory) && budget.memory > 0) {
        return budget;
      }
      this.logger.warn(
        `MemoryTokenBudgetResolver returned a non-positive memory slice ` +
          `(${budget.memory.toString()}); falling back to ` +
          `${DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW.toString()} tokens.`,
      );
    } catch (error) {
      this.logger.warn(
        `MemoryTokenBudgetResolver failed during distillation; falling back to ` +
          `${DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW.toString()} tokens. ` +
          `Error: ${(error as Error).message}`,
      );
    }

    const contextWindow = DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW;
    return MemoryTokenBudgetResolver.sliceMemoryBudget(
      contextWindow,
      DEFAULT_MEMORY_BUDGET_PERCENTS,
    );
  }
}
