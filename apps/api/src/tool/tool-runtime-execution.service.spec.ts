import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi, Mock } from 'vitest';
import { ToolRuntimeExecutionService } from '../tool-runtime/tool-runtime-execution.service';
import { ToolArtifactRepository } from './database/repositories/tool-artifact.repository';
import { ToolSandboxService } from '../tool-runtime/tool-sandbox.service';
import { EventLedgerService } from '../observability/event-ledger.service';

describe('ToolRuntimeExecutionService', () => {
  let service: ToolRuntimeExecutionService;
  let artifactRepository: { findActivePublishedByToolName: Mock };
  let sandboxService: { executeCandidate: Mock };
  let eventLedger: { emitBestEffort: Mock };

  beforeEach(() => {
    artifactRepository = {
      findActivePublishedByToolName: vi.fn(),
    };
    sandboxService = {
      executeCandidate: vi.fn(),
    };
    eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };

    service = new ToolRuntimeExecutionService(
      artifactRepository as unknown as ToolArtifactRepository,
      sandboxService as unknown as ToolSandboxService,
      eventLedger as unknown as EventLedgerService,
    );
  });

  it('throws NotFoundException when there is no active published artifact', async () => {
    artifactRepository.findActivePublishedByToolName.mockResolvedValue(null);

    await expect(
      service.executePublishedTool('adder', { a: 1, b: 2 }),
    ).rejects.toThrow(NotFoundException);
    expect(sandboxService.executeCandidate).not.toHaveBeenCalled();
  });

  it('executes sandbox and returns structured payload with completion event', async () => {
    artifactRepository.findActivePublishedByToolName.mockResolvedValue({
      id: 'artifact-1',
      tool_name: 'adder',
      version: 7,
      language: 'node',
      source_code: 'export async function execute({ a, b }) { return a + b; }',
    });
    sandboxService.executeCandidate.mockResolvedValue({
      status: 'passed',
      exit_code: 0,
      stdout: '__NEXUS_RESULT__3\n',
      stderr: '',
      duration_ms: 10,
      sandbox_image: 'local-node-sandbox',
      output: { sum: 3 },
    });

    const result = await service.executePublishedTool('adder', { a: 1, b: 2 });

    expect(sandboxService.executeCandidate).toHaveBeenCalledWith({
      language: 'node',
      source_code: 'export async function execute({ a, b }) { return a + b; }',
      params: { a: 1, b: 2 },
    });
    expect(result).toEqual({
      tool_name: 'adder',
      artifact_id: 'artifact-1',
      version: 7,
      status: 'passed',
      exit_code: 0,
      stdout: '__NEXUS_RESULT__3\n',
      stderr: '',
      duration_ms: 10,
      sandbox_image: 'local-node-sandbox',
      output: { sum: 3 },
    });
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'tool',
        eventName: 'tool.runtime.execute.completed',
        outcome: 'success',
        payload: expect.objectContaining({
          artifact_id: 'artifact-1',
          version: 7,
          status: 'passed',
        }),
      }),
    );
  });
});
