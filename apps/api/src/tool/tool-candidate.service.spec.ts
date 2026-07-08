import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi, Mock } from 'vitest';
import { ToolCandidateService } from '../tool-runtime/tool-candidate.service';
import { ToolArtifactRepository } from './database/repositories/tool-artifact.repository';
import { ToolValidationRunRepository } from './database/repositories/tool-validation-run.repository';
import { ToolRegistryRepository } from './database/repositories/tool-registry.repository';
import { EventLedgerService } from '../observability/event-ledger.service';
import { ToolSandboxService } from '../tool-runtime/tool-sandbox.service';

describe('ToolCandidateService', () => {
  let service: ToolCandidateService;
  let artifactRepository: {
    findMaxVersionByToolName: Mock;
    create: Mock;
    findPaged: Mock;
    findById: Mock;
    update: Mock;
    deactivateActiveForToolName: Mock;
  };
  let validationRunRepository: {
    findByArtifactIdPaged: Mock;
    findLatestByArtifactId: Mock;
    create: Mock;
  };
  let registryRepository: {
    findByName: Mock;
    create: Mock;
    update: Mock;
  };
  let eventLedger: { emitBestEffort: Mock };
  let sandboxService: { validateCandidate: Mock };

  beforeEach(() => {
    artifactRepository = {
      findMaxVersionByToolName: vi.fn(),
      create: vi.fn(),
      findPaged: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      deactivateActiveForToolName: vi.fn().mockResolvedValue(undefined),
    };
    validationRunRepository = {
      findByArtifactIdPaged: vi.fn(),
      findLatestByArtifactId: vi.fn(),
      create: vi.fn(),
    };
    registryRepository = {
      findByName: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };
    eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    sandboxService = {
      validateCandidate: vi.fn(),
    };

    service = new ToolCandidateService(
      artifactRepository as unknown as ToolArtifactRepository,
      validationRunRepository as unknown as ToolValidationRunRepository,
      registryRepository as unknown as ToolRegistryRepository,
      eventLedger as unknown as EventLedgerService,
      sandboxService as unknown as ToolSandboxService,
    );
  });

  it('createDraft increments version and persists checksum with draft status', async () => {
    artifactRepository.findMaxVersionByToolName.mockResolvedValue(2);
    artifactRepository.create.mockImplementation(
      async (payload: Record<string, unknown>) => ({
        id: 'artifact-3',
        ...payload,
      }),
    );

    const sourceCode =
      'export async function execute(params) { return { ok: !!params }; }';
    const created = await service.createDraft({
      tool_name: 'tool-alpha',
      language: 'node',
      source_code: sourceCode,
      schema: { type: 'object' },
    });

    expect(artifactRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_name: 'tool-alpha',
        version: 3,
        status: 'draft',
        checksum: createHash('sha256').update(sourceCode).digest('hex'),
      }),
    );
    expect(created.version).toBe(3);
    expect(created.status).toBe('draft');
  });

  it('validateCandidate stores validation run and marks artifact validated on pass', async () => {
    artifactRepository.findById.mockResolvedValue({
      id: 'artifact-1',
      tool_name: 'adder',
      language: 'node',
      source_code: 'export const execute = () => 1;',
      status: 'draft',
    });
    sandboxService.validateCandidate.mockResolvedValue({
      status: 'passed',
      exit_code: 0,
      stdout: 'ok',
      stderr: '',
      duration_ms: 18,
      sandbox_image: 'local-node-sandbox',
      policy_denials: null,
    });
    validationRunRepository.create.mockResolvedValue({
      id: 'run-1',
      artifact_id: 'artifact-1',
      status: 'passed',
    });
    artifactRepository.update.mockResolvedValue({
      id: 'artifact-1',
      tool_name: 'adder',
      status: 'validated',
      latest_validation_run_id: 'run-1',
    });

    const result = await service.validateCandidate('artifact-1');

    expect(validationRunRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        artifact_id: 'artifact-1',
        status: 'passed',
      }),
    );
    expect(artifactRepository.update).toHaveBeenCalledWith(
      'artifact-1',
      expect.objectContaining({
        latest_validation_run_id: 'run-1',
        status: 'validated',
        validated_at: expect.any(Date),
      }),
    );
    expect(result.validation_run.id).toBe('run-1');
    expect(result.artifact.status).toBe('validated');
  });

  it('publishCandidate blocks when latest validation is not passed', async () => {
    artifactRepository.findById.mockResolvedValue({
      id: 'artifact-1',
      tool_name: 'adder',
      language: 'node',
      source_code: 'export const execute = () => 1;',
      version: 2,
      schema: { type: 'object' },
    });
    validationRunRepository.findLatestByArtifactId.mockResolvedValue({
      id: 'run-1',
      artifact_id: 'artifact-1',
      status: 'failed',
    });

    await expect(service.publishCandidate('artifact-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(
      artifactRepository.deactivateActiveForToolName,
    ).not.toHaveBeenCalled();
    expect(registryRepository.update).not.toHaveBeenCalled();
  });

  it('publishCandidate activates artifact and updates registry publication metadata', async () => {
    artifactRepository.findById.mockResolvedValue({
      id: 'artifact-1',
      tool_name: 'adder',
      language: 'node',
      source_code: 'export const execute = (p) => p;',
      version: 2,
      schema: { type: 'object', properties: { a: { type: 'number' } } },
      status: 'validated',
    });
    validationRunRepository.findLatestByArtifactId.mockResolvedValue({
      id: 'run-2',
      artifact_id: 'artifact-1',
      status: 'passed',
    });
    artifactRepository.update.mockResolvedValue({
      id: 'artifact-1',
      tool_name: 'adder',
      language: 'node',
      source_code: 'export const execute = (p) => p;',
      version: 2,
      schema: { type: 'object', properties: { a: { type: 'number' } } },
      status: 'published',
      is_active: true,
    });
    registryRepository.findByName.mockResolvedValue({
      id: 'registry-1',
      name: 'adder',
    });
    registryRepository.update.mockResolvedValue({
      id: 'registry-1',
      name: 'adder',
      publication_status: 'published',
      published_artifact_id: 'artifact-1',
      published_version: 2,
    });

    const result = await service.publishCandidate('artifact-1');

    expect(artifactRepository.deactivateActiveForToolName).toHaveBeenCalledWith(
      'adder',
    );
    expect(registryRepository.update).toHaveBeenCalledWith(
      'registry-1',
      expect.objectContaining({
        publication_status: 'published',
        published_artifact_id: 'artifact-1',
        published_version: 2,
        api_callback: {
          method: 'POST',
          path_template: '/api/tools/runtime/adder/execute',
        },
      }),
    );
    expect(result.artifact.status).toBe('published');
    expect(result.registry.published_artifact_id).toBe('artifact-1');
  });
});
