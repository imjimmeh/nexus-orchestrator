import { afterEach, describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ReconciliationDiffService } from './reconciliation-diff.service';
import { DriftDetectionService } from './drift-detection.service';
import { ReconciliationService } from './reconciliation.service';
import { DesiredStateLoaderService } from './desired-state-loader.service';
import { ActualStateReaderService } from './actual-state-reader.service';
import { ReconciliationApplyService } from './reconciliation-apply.service';
import { GitOpsReconciliationLoopService } from './gitops-reconciliation-loop.service';
import { GitOpsRepositoryBindingService } from './gitops-repository-binding.service';
import { GitOpsInboundReconcileService } from './gitops-inbound-reconcile.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import { MetricsService } from '../observability/metrics.service';
import { buildGitOpsCredentialsOptionsFromEnv } from './gitops.module';
import { DEFAULT_GITOPS_CREDENTIALS_OPTIONS } from './gitops-credentials-resolver.service';

describe('GitOpsModule wiring', () => {
  it('resolves the orchestrator with its collaborators', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReconciliationDiffService,
        DriftDetectionService,
        ReconciliationService,
        GitOpsReconciliationLoopService,
        { provide: DesiredStateLoaderService, useValue: {} },
        { provide: ActualStateReaderService, useValue: {} },
        { provide: ReconciliationApplyService, useValue: {} },
        { provide: GitOpsRepositoryBindingService, useValue: {} },
        { provide: GitOpsInboundReconcileService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: EventLedgerService, useValue: {} },
        {
          provide: MetricsService,
          useValue: {
            gitopsReconciliationTickCompletedTotal: { inc: () => undefined },
          },
        },
      ],
    }).compile();
    expect(moduleRef.get(ReconciliationService)).toBeInstanceOf(
      ReconciliationService,
    );
    expect(moduleRef.get(ReconciliationDiffService)).toBeInstanceOf(
      ReconciliationDiffService,
    );
    expect(moduleRef.get(GitOpsReconciliationLoopService)).toBeInstanceOf(
      GitOpsReconciliationLoopService,
    );
  });
});

describe('buildGitOpsCredentialsOptionsFromEnv', () => {
  afterEach(() => {
    delete process.env['GITOPS_REQUIRE_CREDENTIALS'];
    delete process.env['GITOPS_ANONYMOUS_ALLOWED_HOSTS'];
    delete process.env['GITOPS_CREDENTIALS_TTL_MS'];
  });

  it('returns the milestone-1 defaults when no env vars are set', () => {
    const options = buildGitOpsCredentialsOptionsFromEnv();
    expect(options).toEqual({ ...DEFAULT_GITOPS_CREDENTIALS_OPTIONS });
  });

  it('parses GITOPS_REQUIRE_CREDENTIALS=true and =1 as strict mode', () => {
    process.env['GITOPS_REQUIRE_CREDENTIALS'] = 'true';
    expect(buildGitOpsCredentialsOptionsFromEnv().requireCredentials).toBe(
      true,
    );
    process.env['GITOPS_REQUIRE_CREDENTIALS'] = '1';
    expect(buildGitOpsCredentialsOptionsFromEnv().requireCredentials).toBe(
      true,
    );
  });

  it('parses other GITOPS_REQUIRE_CREDENTIALS values as false (default OFF)', () => {
    process.env['GITOPS_REQUIRE_CREDENTIALS'] = 'yes';
    expect(buildGitOpsCredentialsOptionsFromEnv().requireCredentials).toBe(
      false,
    );
  });

  it('overrides the anonymous-allowed host list via GITOPS_ANONYMOUS_ALLOWED_HOSTS', () => {
    process.env['GITOPS_ANONYMOUS_ALLOWED_HOSTS'] =
      'git.example.com,git.Other.example.com';
    expect(
      buildGitOpsCredentialsOptionsFromEnv().anonymousAllowedHosts,
    ).toEqual(['git.example.com', 'git.other.example.com']);
  });

  it('falls back to the default host list when GITOPS_ANONYMOUS_ALLOWED_HOSTS is empty', () => {
    process.env['GITOPS_ANONYMOUS_ALLOWED_HOSTS'] = '   ';
    expect(
      buildGitOpsCredentialsOptionsFromEnv().anonymousAllowedHosts,
    ).toEqual(DEFAULT_GITOPS_CREDENTIALS_OPTIONS.anonymousAllowedHosts);
  });

  it('overrides the cache TTL via GITOPS_CREDENTIALS_TTL_MS', () => {
    process.env['GITOPS_CREDENTIALS_TTL_MS'] = '5000';
    expect(buildGitOpsCredentialsOptionsFromEnv().ttlMs).toBe(5000);
  });

  it('falls back to the default TTL when GITOPS_CREDENTIALS_TTL_MS is invalid', () => {
    process.env['GITOPS_CREDENTIALS_TTL_MS'] = 'not-a-number';
    expect(buildGitOpsCredentialsOptionsFromEnv().ttlMs).toBe(
      DEFAULT_GITOPS_CREDENTIALS_OPTIONS.ttlMs,
    );
  });
});
