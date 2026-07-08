import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContainerOrchestratorService } from '../docker/container-orchestrator.service';
import {
  CONTAINER_SKILLS_ROOT,
  SKILL_CATALOG_FILE_NAME,
} from '../tool-runtime/skill-mounting.constants';
import { WorkflowSkillRuntimeDiagnosticsService } from './workflow-skill-runtime-diagnostics.service';

describe('WorkflowSkillRuntimeDiagnosticsService', () => {
  const docker = {
    listContainers: vi.fn(),
    getContainer: vi.fn(),
  };

  const containerOrchestrator = {
    getContainerHostMountBindings: vi.fn(),
  };

  let service: WorkflowSkillRuntimeDiagnosticsService;
  let tempRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-skill-diag-'));
    service = new WorkflowSkillRuntimeDiagnosticsService(
      docker,
      containerOrchestrator as unknown as ContainerOrchestratorService,
    );
  });

  afterEach(() => {
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('includes skills_library authoring bindings alongside assigned skill diagnostics', async () => {
    const catalogPath = path.join(tempRoot, SKILL_CATALOG_FILE_NAME);
    fs.writeFileSync(
      catalogPath,
      JSON.stringify([
        { name: 'skill-a' },
        { name: 'skill-a' },
        { name: 'skill-b' },
      ]),
      'utf8',
    );

    docker.listContainers.mockResolvedValue([
      {
        Id: 'container-1',
        Names: ['/container-1'],
        State: 'running',
      },
    ]);
    docker.getContainer.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'container-1',
        Name: '/container-1',
        Config: {
          Labels: {
            'nexus.job_id': 'job-1',
            'nexus.step_id': 'step-1',
          },
        },
        State: {
          Status: 'running',
        },
        Mounts: [
          {
            Source: tempRoot,
            Destination: CONTAINER_SKILLS_ROOT,
          },
        ],
      }),
    });
    containerOrchestrator.getContainerHostMountBindings.mockResolvedValue([
      {
        alias: 'project_docs',
        hostPath: 'G:/docs',
        containerPath: '/workspace/host-shares/project_docs',
        mode: 'ro',
        readOnly: true,
      },
      {
        alias: 'skills_library',
        hostPath: 'G:/skills',
        containerPath: '/workspace/host-shares/skills_library',
        mode: 'rw',
        readOnly: false,
      },
    ]);

    await expect(service.getRunSkillMountDiagnostics('run-1')).resolves.toEqual(
      {
        workflowRunId: 'run-1',
        containerSkillRoot: CONTAINER_SKILLS_ROOT,
        containers: [
          {
            containerId: 'container-1',
            containerName: 'container-1',
            status: 'running',
            jobId: 'job-1',
            stepId: 'step-1',
            hasSkillMount: true,
            authoringBindings: [
              {
                alias: 'skills_library',
                hostPath: 'G:/skills',
                containerPath: '/workspace/host-shares/skills_library',
                mode: 'rw',
                readOnly: false,
              },
            ],
            mountSourcePath: tempRoot,
            mountContainerPath: CONTAINER_SKILLS_ROOT,
            readableMountPath: tempRoot,
            skillCatalogPath: catalogPath,
            assignedSkillNames: ['skill-a', 'skill-b'],
            catalogLoadError: null,
          },
        ],
      },
    );
  });

  it('correctly detects skill mount destined for claude-code path (/root/.claude/skills)', async () => {
    docker.listContainers.mockResolvedValue([
      {
        Id: 'container-2',
        Names: ['/container-2'],
        State: 'running',
      },
    ]);
    docker.getContainer.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'container-2',
        Name: '/container-2',
        Config: {
          Labels: {
            'nexus.job_id': 'job-2',
            'nexus.step_id': 'step-2',
          },
        },
        State: {
          Status: 'running',
        },
        Mounts: [
          {
            Source: tempRoot,
            Destination: '/root/.claude/skills',
          },
        ],
      }),
    });
    containerOrchestrator.getContainerHostMountBindings.mockResolvedValue([]);

    const result = await service.getRunSkillMountDiagnostics('run-2');
    expect(result.containers[0].hasSkillMount).toBe(true);
    expect(result.containers[0].mountContainerPath).toBe(
      '/root/.claude/skills',
    );
  });
});
