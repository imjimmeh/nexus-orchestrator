import type { Logger } from '@nestjs/common';
import type { IMcpReloadResult } from '@nexus/core';
import type { EventLedgerService } from '../observability/event-ledger.service';

type McpReconciliationLoopParams = {
  logger: Logger;
  eventLedger: EventLedgerService;
  isEnabled: () => boolean;
  resolveDelayMs: (failureStreak: number) => number;
  reloadAllServers: () => Promise<IMcpReloadResult>;
  getErrorMessage: (error: unknown) => string;
};

export class McpReconciliationLoop {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private failureStreak = 0;

  constructor(private readonly params: McpReconciliationLoopParams) {}

  start(): void {
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (!this.params.isEnabled()) {
      this.params.logger.log(
        'MCP reconciliation loop disabled by configuration',
      );
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
    }

    const delayMs = this.params.resolveDelayMs(this.failureStreak);
    this.timer = setTimeout(() => {
      void this.runTick();
    }, delayMs);
    this.timer.unref?.();
  }

  private async runTick(): Promise<void> {
    if (this.running) {
      this.params.logger.warn(
        'Skipping MCP reconciliation tick while previous tick is running',
      );
      this.scheduleNext();
      return;
    }

    this.running = true;
    const startedAt = Date.now();

    try {
      await this.params.eventLedger.emitBestEffort({
        domain: 'mcp',
        eventName: 'mcp.reconcile.scheduled.started',
        outcome: 'in_progress',
        payload: {
          failure_streak: this.failureStreak,
        },
      });

      const result = await this.params.reloadAllServers();
      this.failureStreak = 0;

      await this.params.eventLedger.emitBestEffort({
        domain: 'mcp',
        eventName: 'mcp.reconcile.scheduled.completed',
        outcome: result.failed_servers > 0 ? 'failure' : 'success',
        payload: {
          total_servers: result.total_servers,
          succeeded_servers: result.succeeded_servers,
          failed_servers: result.failed_servers,
          duration_ms: Date.now() - startedAt,
        },
      });
    } catch (error) {
      this.failureStreak += 1;
      const message = this.params.getErrorMessage(error);
      this.params.logger.warn(
        `Scheduled MCP reconciliation failed: ${message}`,
      );

      await this.params.eventLedger.emitBestEffort({
        domain: 'mcp',
        eventName: 'mcp.reconcile.scheduled.failed',
        outcome: 'failure',
        payload: {
          failure_streak: this.failureStreak,
          duration_ms: Date.now() - startedAt,
        },
        errorMessage: message,
      });
    } finally {
      this.running = false;
      this.scheduleNext();
    }
  }
}
