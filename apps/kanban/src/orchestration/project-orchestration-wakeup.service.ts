import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { DispatchService } from "../dispatch/dispatch.service";
import { OrchestrationLeaseService } from "./control-plane/orchestration-lease.service";
import { OrchestrationService } from "./orchestration.service";
import type {
  RequestWakeupInput,
  RequestWakeupResult,
} from "./project-orchestration-wakeup.types";

const STALE_RECONCILER_REASON = "stale_reconciler";
const LIFECYCLE_STREAM_SOURCE = "core_lifecycle_stream";
const STALE_RECONCILER_SOURCE = "orchestration_continuation_reconciler";
const REVISION_COMPLETE_SOURCE = "revision_complete";
const AUTOMATIC_WAKEUP_SOURCES = new Set([
  LIFECYCLE_STREAM_SOURCE,
  STALE_RECONCILER_SOURCE,
  REVISION_COMPLETE_SOURCE,
]);
const AUTOMATIC_WAKEUP_COALESCE_MS = 60 * 1000;
const STALE_RECONCILER_WAKEUP_COOLDOWN_MS = 5 * 60 * 1000;

type WakeupCooldownState = {
  lastWakeupAt?: string;
  source?: string;
  reason?: string;
  lastStaleWakeupAt?: string;
  lastStaleSource?: string;
  lastStaleReason?: string;
};

@Injectable()
export class ProjectOrchestrationWakeupService {
  private readonly logger = new Logger(ProjectOrchestrationWakeupService.name);
  private readonly fallbackWakeupAnchors = new Map<string, number>();

  constructor(
    @Inject(forwardRef(() => DispatchService))
    private readonly dispatchService: DispatchService,
    private readonly orchestrationService: OrchestrationService,
    private readonly leaseService: OrchestrationLeaseService,
  ) {}

  async requestWakeup(input: RequestWakeupInput): Promise<RequestWakeupResult> {
    // Human stop-decision suppression (legitimate, kept).
    const suppressionState =
      await this.orchestrationService.getAutoWakeSuppressionState(
        input.projectId,
      );
    if (suppressionState.suppressed && this.isAutomaticWakeup(input)) {
      return { emitted: false, reason: "orchestration_auto_wake_suppressed" };
    }

    // Debounce throttles (legitimate, kept).
    const cooldownState =
      await this.orchestrationService.getWakeupCooldownState(input.projectId);
    if (this.isInsideAutomaticWakeupCoalesceWindow(input, cooldownState)) {
      return { emitted: false, reason: "automatic_wakeup_coalesced" };
    }
    if (this.isInsideStaleWakeupCooldown(input, cooldownState)) {
      return { emitted: false, reason: "stale_wakeup_cooldown" };
    }

    // Single concurrency guard: acquire the cycle lease.
    const correlationId = `${input.source ?? "manual"}:${input.reason}`;
    const lease = await this.leaseService.acquireCycleLease(
      input.projectId,
      correlationId,
    );
    if (!lease.acquired) {
      return { emitted: false, reason: "active_cycle_exists" };
    }

    const dedupeKey = this.buildWakeupDedupeKey(
      input.projectId,
      input,
      new Date(Date.now()),
      cooldownState,
    );

    try {
      await this.dispatchService.requestOrchestrationCycle(input.projectId, {
        reason: input.reason,
        source: input.source,
        dedupeKey,
      });
    } catch (error) {
      // Launch failed — do not strand the lease.
      await this.leaseService.releaseCycleLease(input.projectId);
      throw error;
    }

    if (input.source) {
      try {
        await this.orchestrationService.recordWakeup(input.projectId, {
          reason: input.reason,
          source: input.source,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Failed to record orchestration wakeup metadata for project ${input.projectId}: ${reason}`,
        );
      }
    }

    return { emitted: true };
  }

  private isInsideAutomaticWakeupCoalesceWindow(
    input: RequestWakeupInput,
    cooldownState: WakeupCooldownState | null,
  ): boolean {
    if (
      !input.source ||
      !AUTOMATIC_WAKEUP_SOURCES.has(input.source) ||
      !cooldownState?.source ||
      !AUTOMATIC_WAKEUP_SOURCES.has(cooldownState.source) ||
      !cooldownState.lastWakeupAt
    ) {
      return false;
    }

    return this.isInsideWindow(
      cooldownState.lastWakeupAt,
      AUTOMATIC_WAKEUP_COALESCE_MS,
    );
  }

  private isInsideStaleWakeupCooldown(
    input: RequestWakeupInput,
    cooldownState: WakeupCooldownState | null,
  ): boolean {
    if (!this.isStaleReconcilerWakeup(input)) {
      return false;
    }

    const staleWakeupAt = this.resolveLastStaleWakeupAt(cooldownState);

    if (!staleWakeupAt) {
      return false;
    }

    return this.isInsideWindow(
      staleWakeupAt,
      STALE_RECONCILER_WAKEUP_COOLDOWN_MS,
    );
  }

  private buildWakeupDedupeKey(
    projectId: string,
    input: RequestWakeupInput,
    now: Date,
    cooldownState: WakeupCooldownState | null,
  ): string | undefined {
    if (input.dedupeKey) {
      return input.dedupeKey;
    }

    if (!this.isAutomaticWakeup(input)) {
      return undefined;
    }

    if (this.isStaleReconcilerWakeup(input)) {
      const windowId = this.buildAcceptedWakeupWindowId(
        projectId,
        input,
        now,
        cooldownState,
        STALE_RECONCILER_WAKEUP_COOLDOWN_MS,
      );

      return `project-orchestration-cycle:${projectId}:${STALE_RECONCILER_SOURCE}:${STALE_RECONCILER_REASON}:${windowId}`;
    }

    const windowMs = AUTOMATIC_WAKEUP_COALESCE_MS;
    const windowId = this.buildAcceptedWakeupWindowId(
      projectId,
      input,
      now,
      cooldownState,
      windowMs,
    );

    return `project-orchestration-cycle:${projectId}:${input.source}:${input.reason}:${windowId}`;
  }

  private buildAcceptedWakeupWindowId(
    projectId: string,
    input: RequestWakeupInput,
    now: Date,
    cooldownState: WakeupCooldownState | null,
    windowMs: number,
  ): string {
    const anchorWakeupAt = this.isStaleReconcilerWakeup(input)
      ? this.resolveLastStaleWakeupAt(cooldownState)
      : cooldownState?.lastWakeupAt;
    const anchorTime = anchorWakeupAt ? Date.parse(anchorWakeupAt) : NaN;

    if (!Number.isFinite(anchorTime)) {
      const fallbackAnchor = this.resolveFallbackWakeupAnchor(
        projectId,
        input,
        now,
        windowMs,
      );
      return `initial:${fallbackAnchor}`;
    }

    this.fallbackWakeupAnchors.delete(
      this.buildFallbackWakeupAnchorKey(projectId, input),
    );

    const elapsedMs = now.getTime() - anchorTime;
    if (elapsedMs < 0) {
      return `${now.getTime()}:0`;
    }

    return `${anchorTime}:${Math.floor(elapsedMs / windowMs)}`;
  }

  private resolveFallbackWakeupAnchor(
    projectId: string,
    input: RequestWakeupInput,
    now: Date,
    windowMs: number,
  ): number {
    const anchorKey = this.buildFallbackWakeupAnchorKey(projectId, input);
    const currentAnchor = this.fallbackWakeupAnchors.get(anchorKey);
    const nowTime = now.getTime();

    if (
      currentAnchor !== undefined &&
      nowTime >= currentAnchor &&
      nowTime - currentAnchor < windowMs
    ) {
      return currentAnchor;
    }

    this.fallbackWakeupAnchors.set(anchorKey, nowTime);
    return nowTime;
  }

  private buildFallbackWakeupAnchorKey(
    projectId: string,
    input: RequestWakeupInput,
  ): string {
    return `${projectId}:${input.source ?? ""}:${input.reason}`;
  }

  private resolveLastStaleWakeupAt(
    cooldownState: WakeupCooldownState | null,
  ): string | null {
    if (!cooldownState) {
      return null;
    }

    if (
      cooldownState.lastStaleSource === STALE_RECONCILER_SOURCE &&
      cooldownState.lastStaleReason === STALE_RECONCILER_REASON &&
      cooldownState.lastStaleWakeupAt
    ) {
      return cooldownState.lastStaleWakeupAt;
    }

    if (
      cooldownState.source === STALE_RECONCILER_SOURCE &&
      cooldownState.reason === STALE_RECONCILER_REASON &&
      cooldownState.lastWakeupAt
    ) {
      return cooldownState.lastWakeupAt;
    }

    return null;
  }

  private isInsideWindow(lastWakeupAt: string, windowMs: number): boolean {
    const lastWakeupTime = Date.parse(lastWakeupAt);
    if (!Number.isFinite(lastWakeupTime)) {
      return false;
    }

    const ageMs = Date.now() - lastWakeupTime;
    return ageMs >= 0 && ageMs < windowMs;
  }

  private isStaleReconcilerWakeup(input: RequestWakeupInput): boolean {
    return (
      input.reason === STALE_RECONCILER_REASON &&
      input.source === STALE_RECONCILER_SOURCE
    );
  }

  private isAutomaticWakeup(input: RequestWakeupInput): boolean {
    return (
      input.source !== undefined && AUTOMATIC_WAKEUP_SOURCES.has(input.source)
    );
  }
}
