import * as path from 'node:path';
import {
  Injectable,
  Logger,
  Optional,
  type Logger as NestLogger,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';
import { SystemSettingsService } from '../settings/system-settings.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import { MetricsService } from '../observability/metrics.service';
import { MemorySegment } from './database/entities/memory-segment.entity';
import { readConfidence } from './database/memory-segment.helpers';
import {
  MEMORY_DRIFT_EXEMPT_SOURCES,
  MEMORY_DRIFT_SETTING_KEYS,
} from './memory-drift.constants';
import {
  coerceConfidencePenalty,
  coerceEnabled,
} from './memory-drift.coercion';
import { coerceInteger } from '../settings/setting-coercers';
import { MemoryDriftReferenceParser } from './memory-drift-reference.parser';
import {
  MemoryDriftCheckers,
  type MemoryDriftCodeCorpus,
} from './memory-drift-checkers';
import { buildCodeCorpus, buildSchemaIndex } from './memory-drift-indexes';
import {
  emitDriftEventBestEffort,
  persistDriftOnSegment,
} from './memory-drift-persistence';
import type {
  MemoryDriftDetectionResult,
  MemoryDriftDetectionServiceOptions,
  MemoryDriftReferenceKind,
  MemoryDriftRunSummary,
} from './memory-drift.types';

/**
 * Confidence-penalty clamp bounds. The detector clamps the
 * post-penalty confidence to `[0, 1]` so a malformed operator
 * value (e.g. `-0.5`) cannot inflate the confidence past 1.0 or
 * produce a negative number that breaks downstream consumers.
 */
const CONFIDENCE_FLOOR = 0;
const CONFIDENCE_CEILING = 1;

/**
 * `MemoryDriftDetectionService` — the "Automatically updated"
 * leg of the AI-memory goal (work item
 * 0cead042-e823-4e26-9386-02042252ffb0).
 *
 * The service runs on a cron schedule (default `0 4 * * *`,
 * configurable via the `memory_drift_cron` SystemSetting) and
 * walks the `memory_segments` table for rows whose
 * `source_metadata` references a repo path, a schema column, or
 * an API endpoint. For each candidate row the service:
 *
 *   1. Checks the {@link MEMORY_DRIFT_EXEMPT_SOURCES} allowlist
 *      — human-authored sources are skipped without modification.
 *   2. Parses `source_metadata` via
 *      {@link MemoryDriftReferenceParser}. Metadata the parser
 *      cannot classify is skipped with
 *      `no_driftable_reference`.
 *   3. Dispatches to the matching checker (`file`, `schema`, or
 *      `api`).
 *   4. On drift, applies a configurable confidence penalty,
 *      stamps `drift_detected_at = now`, and emits a
 *      `memory.segment.drift_detected.v1` event.
 *
 * Settings are resolved fresh on every `runDriftPass()` so the
 * operator can tune the values between ticks without restarting
 * the application. The service NEVER throws on a per-row failure
 * — a transient DB blip will lose that row's contribution to
 * the run but not the rest of the batch. The run summary's
 * `errors[]` counter surfaces the count.
 *
 * Testability: every external dependency is `@Optional()`. The
 * service can be constructed in a unit test as
 * `new MemoryDriftDetectionService(mockRepo, dataSource, mockSettings)`.
 *
 * BullMQ wiring and prom-client metric emission are deferred to
 * milestone 3. The service is registered in `MemoryModule` only
 * once the scheduler and metric land.
 */
@Injectable()
export class MemoryDriftDetectionService {
  private readonly logger: NestLogger;
  private readonly repoRoot: string;
  private readonly codeCorpusRoot: string;

  /** Lazily-built schema index. `null` until first build. */
  private schemaIndexPromise: Promise<
    ReadonlyMap<string, ReadonlySet<string>>
  > | null = null;

  /** Lazily-built code corpus. `null` until first build. */
  private codeCorpusPromise: Promise<MemoryDriftCodeCorpus> | null = null;

  constructor(
    @InjectRepository(MemorySegment)
    private readonly memorySegments: Repository<MemorySegment>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly settings: SystemSettingsService,
    private readonly metrics: MetricsService,
    @Optional()
    private readonly eventLedger?: EventLedgerService,
    @Optional()
    private readonly referenceParser: MemoryDriftReferenceParser = new MemoryDriftReferenceParser(),
    @Optional()
    private readonly checkers: MemoryDriftCheckers = new MemoryDriftCheckers(),
    @Optional()
    loggerClass?: typeof Logger,
    @Optional()
    options?: MemoryDriftDetectionServiceOptions,
  ) {
    const LoggerClass = loggerClass ?? Logger;
    this.logger = new LoggerClass('MemoryDriftDetectionService');
    const cwd = process.cwd();
    this.repoRoot = options?.repoRoot ?? cwd;
    this.codeCorpusRoot =
      options?.codeCorpusRoot ?? path.resolve(this.repoRoot, 'apps/api/src');
  }

  /**
   * Run a single drift-detection pass. The method is the
   * test-friendly seam: it is a pure method that can be invoked
   * from a BullMQ processor, an admin trigger handler, or a
   * unit test. The `now` parameter overrides the wall-clock for
   * deterministic tests; production callers omit it.
   */
  async runDriftPass(
    opts: { now?: Date } = {},
  ): Promise<MemoryDriftRunSummary> {
    const startedAt = opts.now ?? new Date();
    const resolved = await this.resolveSettings();

    if (!resolved.enabled) {
      this.logger.log(
        `MemoryDriftDetectionService kill switch (${MEMORY_DRIFT_SETTING_KEYS.enabled}) is off; skipping pass (no rows evaluated)`,
      );
      return this.buildSummary(startedAt, {
        candidateCount: 0,
        checkedCount: 0,
        driftDetectedCount: 0,
        skipped: true,
        reason: 'disabled',
        errors: [],
      });
    }

    const candidates = await this.findDriftCandidates(
      startedAt,
      resolved.recheckAfterMs,
    );
    const candidateCount = candidates.length;

    if (candidateCount === 0) {
      this.logger.log(
        'MemoryDriftDetectionService starting: no drift candidates; skipping pass',
      );
      return this.buildSummary(startedAt, {
        candidateCount: 0,
        checkedCount: 0,
        driftDetectedCount: 0,
        skipped: true,
        reason: 'no_candidates',
        errors: [],
      });
    }

    this.logger.log(
      `MemoryDriftDetectionService starting: candidateCount=${candidateCount.toString()}, confidencePenalty=${resolved.confidencePenalty.toString()}, exemptSources=[${MEMORY_DRIFT_EXEMPT_SOURCES.join(',')}], recheckAfterMs=${resolved.recheckAfterMs?.toString() ?? 'unset'}, now=${startedAt.toISOString()}`,
    );

    let checkedCount = 0;
    let driftDetectedCount = 0;
    const errors: Array<{ segmentId: string; message: string }> = [];

    for (const candidate of candidates) {
      try {
        const result = await this.evaluateCandidate(
          candidate,
          resolved,
          startedAt,
        );
        checkedCount += 1;
        if (result.drifted) {
          driftDetectedCount += 1;
          await persistDriftOnSegment(this.memorySegments, candidate, result);
          await emitDriftEventBestEffort(
            this.eventLedger,
            this.logger,
            candidate,
            result,
          );
        }
        this.recordDriftMetric(result);
      } catch (error) {
        const err = error as Error;
        this.logger.error(
          `MemoryDriftDetectionService failed to evaluate segment ${candidate.id} (source=${candidate.source ?? 'null'}): ${err.message}`,
          err.stack,
        );
        errors.push({ segmentId: candidate.id, message: err.message });
      }
    }

    const summary = this.buildSummary(startedAt, {
      candidateCount,
      checkedCount,
      driftDetectedCount,
      skipped: false,
      errors,
    });

    this.logger.log(
      `MemoryDriftDetectionService finished: candidateCount=${candidateCount.toString()}, checkedCount=${checkedCount.toString()}, driftDetectedCount=${driftDetectedCount.toString()}, errors=${errors.length.toString()}`,
    );

    return summary;
  }

  /**
   * Compose the run summary. The summary is built in one place
   * so the `startedAt` / `completedAt` pair is always consistent
   * and the optional `reason` field is only set on skipped
   * passes.
   */
  private buildSummary(
    startedAt: Date,
    body: Omit<MemoryDriftRunSummary, 'startedAt' | 'completedAt'>,
  ): MemoryDriftRunSummary {
    return {
      startedAt,
      completedAt: new Date(),
      ...body,
    };
  }

  /**
   * Resolve the live drift-detection settings from
   * {@link SystemSettingsService}. Reads happen fresh on every
   * call — never cached at construction — so the operator can
   * tighten or loosen the values between ticks without
   * restarting the app. Each coercer carries its own default
   * fallback (the literal value declared in the constants
   * module), so the service does not duplicate the literal here.
   */
  private async resolveSettings(): Promise<{
    enabled: boolean;
    confidencePenalty: number;
    recheckAfterMs?: number;
  }> {
    const enabled = coerceEnabled(
      await this.settings.get<unknown>(MEMORY_DRIFT_SETTING_KEYS.enabled, true),
    );
    const confidencePenalty = coerceConfidencePenalty(
      await this.settings.get<unknown>(
        MEMORY_DRIFT_SETTING_KEYS.confidencePenalty,
        0.2,
      ),
    );
    // coerceRecheckAfterMs: parses the recheck-after-ms override
    // into a non-negative integer. Returns `undefined` for any
    // missing / non-numeric / negative value — the recheck window
    // is the only drift setting whose absence is meaningful
    // (meaning "skip drifted rows"); a `0` recheck window means
    // "re-check every drifted row".
    const recheckAfterMs = coerceInteger(
      await this.settings.get<unknown>(
        MEMORY_DRIFT_SETTING_KEYS.recheckAfterMs,
        undefined,
      ),
      undefined as never,
      { min: 0, allowUndefined: true },
    );
    return { enabled, confidencePenalty, recheckAfterMs };
  }

  /**
   * Query the candidate set directly via the TypeORM
   * `Repository<MemorySegment>`. The query mirrors the
   * `MemorySegmentRepository.findDriftCandidates` contract so
   * the follow-up milestone that exposes the helper on the
   * repository can swap the call site without touching the
   * per-row evaluation logic.
   */
  private async findDriftCandidates(
    now: Date,
    recheckAfterMs: number | undefined,
  ): Promise<MemorySegment[]> {
    const query = this.memorySegments
      .createQueryBuilder('segment')
      .where('segment.archived_at IS NULL');

    if (recheckAfterMs !== undefined && recheckAfterMs >= 0) {
      const recheckCutoffIso = new Date(
        now.getTime() - recheckAfterMs,
      ).toISOString();
      query.andWhere(
        '(segment.drift_detected_at IS NULL OR segment.drift_detected_at < :recheckCutoff)',
        { recheckCutoff: recheckCutoffIso },
      );
    } else {
      query.andWhere('segment.drift_detected_at IS NULL');
    }

    return query.getMany();
  }

  /**
   * Evaluate a single candidate row against the drift-detection
   * rules. The per-row body is intentionally a switch on the
   * parser's `kind` output and the configured checker so the
   * rules read top-to-bottom in source order:
   *
   *   1. Exempt source → skip.
   *   2. Unparseable metadata → `no_driftable_reference`.
   *   3. Dispatch to the matching checker.
   *   4. On drift, compute the clamped post-penalty confidence.
   */
  private async evaluateCandidate(
    candidate: MemorySegment,
    settings: { confidencePenalty: number },
    now: Date,
  ): Promise<MemoryDriftDetectionResult> {
    if (
      candidate.source !== null &&
      MEMORY_DRIFT_EXEMPT_SOURCES.includes(candidate.source)
    ) {
      return {
        segmentId: candidate.id,
        drifted: false,
        referenceKind: 'unknown',
        reference: '',
        originalConfidence: null,
        newConfidence: null,
        reason: 'exempt',
        exempt: true,
        checkedAt: now,
      };
    }

    const parsed = this.referenceParser.parse(candidate.metadata_json);
    if (parsed === null) {
      return {
        segmentId: candidate.id,
        drifted: false,
        referenceKind: 'unknown',
        reference: '',
        originalConfidence: null,
        newConfidence: null,
        reason: 'no_driftable_reference',
        exempt: false,
        checkedAt: now,
      };
    }

    const originalConfidence = readConfidence(candidate);
    const checkerResult = await this.runChecker(parsed, candidate.id);

    if (!checkerResult.drifted) {
      return {
        segmentId: candidate.id,
        drifted: false,
        referenceKind: parsed.kind,
        reference: parsed.reference,
        originalConfidence,
        newConfidence: originalConfidence,
        reason: checkerResult.reason,
        exempt: false,
        checkedAt: now,
      };
    }

    const newConfidence =
      originalConfidence === null
        ? null
        : clampConfidence(originalConfidence - settings.confidencePenalty);

    return {
      segmentId: candidate.id,
      drifted: true,
      referenceKind: parsed.kind,
      reference: parsed.reference,
      originalConfidence,
      newConfidence,
      reason: checkerResult.reason,
      exempt: false,
      checkedAt: now,
    };
  }

  /**
   * Dispatch to the right checker based on the parsed reference
   * kind. Schema-index and code-corpus construction failures
   * are caught here and converted to `{ drifted: false, reason:
   * 'checker_unavailable' }` so a transient dependency outage
   * does not lose the rest of the candidate set.
   */
  private async runChecker(
    parsed: { kind: MemoryDriftReferenceKind; reference: string },
    segmentId: string,
  ): Promise<{ drifted: boolean; reason: string }> {
    if (parsed.kind === 'file') {
      return this.checkers.checkFile(parsed.reference, this.repoRoot);
    }
    if (parsed.kind === 'schema') {
      try {
        const schemaIndex = await this.getSchemaIndex();
        return this.checkers.checkSchema(parsed.reference, schemaIndex);
      } catch (error) {
        const err = error as Error;
        this.logger.warn(
          `MemoryDriftDetectionService schema index unavailable for segment ${segmentId}; falling back to checker_unavailable: ${err.message}`,
        );
        return { drifted: false, reason: 'checker_unavailable' };
      }
    }
    if (parsed.kind === 'api') {
      try {
        const codeCorpus = await this.getCodeCorpus();
        return await this.checkers.checkApi(parsed.reference, codeCorpus);
      } catch (error) {
        const err = error as Error;
        this.logger.warn(
          `MemoryDriftDetectionService code corpus unavailable for segment ${segmentId}; falling back to checker_unavailable: ${err.message}`,
        );
        return { drifted: false, reason: 'checker_unavailable' };
      }
    }
    return { drifted: false, reason: 'unknown_reference_kind' };
  }

  /** Lazily build the schema index from the TypeORM `DataSource` metadata. */
  private getSchemaIndex(): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
    if (this.schemaIndexPromise === null) {
      this.schemaIndexPromise = Promise.resolve(
        buildSchemaIndex(this.dataSource),
      );
    }
    return this.schemaIndexPromise;
  }

  /** Lazily build the API-drift code corpus from the configured corpus root. */
  private getCodeCorpus(): Promise<MemoryDriftCodeCorpus> {
    if (this.codeCorpusPromise === null) {
      this.codeCorpusPromise = buildCodeCorpus(this.codeCorpusRoot);
    }
    return this.codeCorpusPromise;
  }

  /**
   * Record the prom-client `nexus_memory_drift_detected_total`
   * counter for one per-row outcome (work item
   * 0cead042-e823-4e26-9386-02042252ffb0). Called from the main
   * loop after `evaluateCandidate(...)` resolves so the metric
   * always reflects the actual outcome the detector produced
   * (the detector's main loop already filters errors into
   * `errors[]`).
   *
   * The mapping is:
   *   - `drifted === true`     → `outcome: 'detected'`
   *   - `result.exempt === true` → `outcome: 'exempt'`
   *   - `reason === 'checker_unavailable'` →
   *     `outcome: 'unavailable'`
   *
   * Rows the detector evaluated but did not drift (e.g. file
   * present, schema column present, API endpoint present, or
   * `no_driftable_reference`) do not bump the counter — the
   * metric is a drift-detection signal, not an
   * evaluation-counter. This matches the documented contract
   * of the work item ("set `drift_detected_at` ... applies
   * configurable confidence penalty ... emits the event").
   */
  private recordDriftMetric(result: MemoryDriftDetectionResult): void {
    if (result.drifted) {
      this.metrics.recordMemoryDriftDetected({
        source: result.referenceKind,
        outcome: 'detected',
      });
      return;
    }
    if (result.exempt) {
      this.metrics.recordMemoryDriftDetected({
        source: result.referenceKind,
        outcome: 'exempt',
      });
      return;
    }
    if (result.reason === 'checker_unavailable') {
      this.metrics.recordMemoryDriftDetected({
        source: result.referenceKind,
        outcome: 'unavailable',
      });
    }
  }
}

/**
 * Clamp a confidence value to the `[0, 1]` range. The detector
 * never produces a confidence past 1.0 or below 0.0.
 */
function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return CONFIDENCE_FLOOR;
  }
  if (value < CONFIDENCE_FLOOR) {
    return CONFIDENCE_FLOOR;
  }
  if (value > CONFIDENCE_CEILING) {
    return CONFIDENCE_CEILING;
  }
  return value;
}
