import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DoctorHistoryService } from './doctor-history.service';
import type { DoctorRepairExecutorService } from './doctor-repair-executor.service';
import type { DoctorReportService } from './doctor-report.service';
import { OperationsDoctorController } from './operations-doctor.controller';

describe('OperationsDoctorController', () => {
  const generateReportEnvelopeMock = vi.fn();
  const executeRepairMock = vi.fn();
  const listHistoryMock = vi.fn();

  const reportService = {
    generateReportEnvelope: generateReportEnvelopeMock,
  } as unknown as DoctorReportService;

  const repairExecutor = {
    execute: executeRepairMock,
  } as unknown as DoctorRepairExecutorService;

  const historyService = {
    listHistory: listHistoryMock,
  } as unknown as DoctorHistoryService;

  let controller: OperationsDoctorController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new OperationsDoctorController(
      reportService,
      repairExecutor,
      historyService,
    );
  });

  it('returns machine format doctor report', async () => {
    generateReportEnvelopeMock.mockResolvedValue({
      report: {
        generated_at: '2026-04-12T00:00:00.000Z',
        overall_status: 'ok',
        summary: { ok: 1, warn: 0, fail: 0, total: 1 },
        checks: [],
      },
      summary_markdown: '# Doctor Report',
    });

    const result = await controller.getDoctorReport({
      format: 'machine',
    });

    expect(result).toEqual({
      success: true,
      data: {
        generated_at: '2026-04-12T00:00:00.000Z',
        overall_status: 'ok',
        summary: { ok: 1, warn: 0, fail: 0, total: 1 },
        checks: [],
      },
    });
  });

  it('returns human format doctor report', async () => {
    generateReportEnvelopeMock.mockResolvedValue({
      report: {
        generated_at: '2026-04-12T00:00:00.000Z',
        overall_status: 'warn',
        summary: { ok: 0, warn: 1, fail: 0, total: 1 },
        checks: [],
      },
      summary_markdown: '# Doctor Report\n- [WARN] queue_lag',
    });

    const result = await controller.getDoctorReport({
      format: 'human',
    });

    expect(result).toEqual({
      success: true,
      data: {
        summary_markdown: '# Doctor Report\n- [WARN] queue_lag',
      },
    });
  });

  it('requires explicit confirm for non-dry-run repairs', async () => {
    await expect(
      controller.executeRepair(
        {
          action_id: 'refresh_mcp_plugin_catalogs',
          dry_run: false,
          confirm: false,
          arguments: {},
        },
        {
          user: { username: 'dev-user' },
        },
      ),
    ).rejects.toThrow(BadRequestException);

    expect(executeRepairMock).not.toHaveBeenCalled();
  });

  it('uses request identity when requested_by is omitted', async () => {
    executeRepairMock.mockResolvedValue({
      attempt_id: 'attempt-1',
      action_id: 'refresh_mcp_plugin_catalogs',
      status: 'succeeded',
      dry_run: true,
      started_at: '2026-04-12T00:00:00.000Z',
      finished_at: '2026-04-12T00:00:01.000Z',
      message: 'Dry run complete',
      changes: {},
      evidence: {},
    });

    await controller.executeRepair(
      {
        action_id: 'refresh_mcp_plugin_catalogs',
        dry_run: true,
        confirm: false,
        arguments: {},
      },
      {
        user: {
          email: 'dev@example.com',
        },
      },
    );

    expect(executeRepairMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requested_by: 'dev@example.com',
      }),
    );
  });

  it('sets required_permission metadata on GET and POST routes', () => {
    expect(
      Reflect.getMetadata(
        'required_permission',
        OperationsDoctorController.prototype.getDoctorReport,
      ),
    ).toBe('settings:read');
    expect(
      Reflect.getMetadata(
        'required_permission',
        OperationsDoctorController.prototype.executeRepair,
      ),
    ).toBe('settings:manage');
    expect(
      Reflect.getMetadata(
        'required_permission',
        OperationsDoctorController.prototype.listHistory,
      ),
    ).toBe('settings:read');
  });
});
