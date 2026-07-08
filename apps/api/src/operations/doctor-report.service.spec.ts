import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DoctorCheckRegistryService } from './doctor-check-registry.service';
import { DoctorReportService } from './doctor-report.service';

describe('DoctorReportService', () => {
  const runAllMock = vi.fn();

  const registry = {
    runAll: runAllMock,
  } as unknown as DoctorCheckRegistryService;

  let service: DoctorReportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DoctorReportService(registry);
  });

  it('sorts checks by severity and computes summary counts', async () => {
    runAllMock.mockResolvedValue([
      {
        check_id: 'queue_check',
        status: 'warn',
        evidence: {
          summary: 'Queue warning',
          details: {},
        },
      },
      {
        check_id: 'workflow_check',
        status: 'fail',
        evidence: {
          summary: 'Workflow stuck',
          details: {},
        },
        repair_action_id: 'requeue_recoverable_workflow_runs',
      },
      {
        check_id: 'contracts_check',
        status: 'ok',
        evidence: {
          summary: 'Contracts aligned',
          details: {},
        },
      },
    ]);

    const report = await service.generateReport();

    expect(report.overall_status).toBe('fail');
    expect(report.summary).toEqual({
      ok: 1,
      warn: 1,
      fail: 1,
      total: 3,
    });
    expect(report.checks.map((check) => check.check_id)).toEqual([
      'workflow_check',
      'queue_check',
      'contracts_check',
    ]);
  });

  it('builds markdown summary in the report envelope', async () => {
    runAllMock.mockResolvedValue([
      {
        check_id: 'tool_check',
        status: 'warn',
        evidence: {
          summary: 'Tool drift detected',
          details: {},
        },
        repair_action_id: 'refresh_mcp_plugin_catalogs',
      },
    ]);

    const envelope = await service.generateReportEnvelope();

    expect(envelope.summary_markdown).toContain('# Doctor Report');
    expect(envelope.summary_markdown).toContain('[WARN] tool_check');
    expect(envelope.summary_markdown).toContain(
      'repair_action_id: refresh_mcp_plugin_catalogs',
    );
  });
});
