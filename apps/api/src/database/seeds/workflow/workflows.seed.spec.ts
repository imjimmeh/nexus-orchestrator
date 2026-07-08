import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { seedWorkflows } from './workflows.seed';

vi.mock('node:fs', () => {
  return {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import * as fs from 'node:fs';

describe('seedWorkflows', () => {
  const repository = {
    find: vi.fn(),
    create: vi.fn((value) => value),
    save: vi.fn(),
    findOne: vi.fn().mockResolvedValue(null),
  };

  const validYaml = [
    'workflow_id: sample_workflow',
    'name: Sample Workflow',
    'jobs:',
    '  - id: step_1',
    '    type: execution',
    '    tier: light',
    '    steps:',
    '      - id: default',
    '        prompt: Test prompt',
    '',
  ].join('\n');

  const todoDispatchYaml = [
    'workflow_id: resource_todo_dispatch_default',
    'name: Work Item Todo Auto-Dispatch',
    'jobs:',
    '  - id: step_1',
    '    type: execution',
    '    tier: light',
    '    steps:',
    '      - id: default',
    '        prompt: Test prompt',
    '',
  ].join('\n');

  const dataSource = {
    getRepository: vi.fn(() => repository),
  } as unknown as DataSource;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      'sample.workflow.yaml',
    ] as never);
  });

  it('updates existing workflow when yaml content has changed', async () => {
    const existingWorkflow = {
      id: 'existing-1',
      name: 'Old Name',
      yaml_definition: validYaml.replace('Sample Workflow', 'Old Name'),
      is_active: true,
    };

    repository.find.mockResolvedValue([existingWorkflow]);

    vi.mocked(fs.readFileSync).mockReturnValue(
      validYaml.replace('Sample Workflow', 'New Name'),
    );

    await seedWorkflows(dataSource);

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'existing-1',
        yaml_definition: validYaml.replace('Sample Workflow', 'New Name'),
        is_active: true,
      }),
    );
  });

  it('skips update when existing workflow yaml has not changed', async () => {
    const yamlContent = validYaml;

    repository.find.mockResolvedValue([
      {
        id: 'existing-1',
        name: 'Sample Workflow',
        yaml_definition: yamlContent,
        is_active: true,
      },
    ]);

    vi.mocked(fs.readFileSync).mockReturnValue(yamlContent);

    await seedWorkflows(dataSource);

    expect(repository.save).not.toHaveBeenCalled();
  });

  it('seeds workflow when workflow_id is new', async () => {
    repository.find.mockResolvedValue([]);

    vi.mocked(fs.readFileSync).mockReturnValue(validYaml);

    await seedWorkflows(dataSource);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Sample Workflow',
        is_active: true,
      }),
    );
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it('deactivates duplicate workflow rows that match seeded identity', async () => {
    const canonical = {
      id: 'canonical-1',
      name: 'Sample Workflow',
      yaml_definition: validYaml,
      is_active: true,
    };

    const duplicate = {
      id: 'duplicate-1',
      name: 'Sample Workflow',
      yaml_definition: validYaml,
      is_active: true,
    };

    repository.find
      .mockResolvedValueOnce([canonical, duplicate])
      .mockResolvedValueOnce([canonical, duplicate]);

    vi.mocked(fs.readFileSync).mockReturnValue(validYaml);

    await seedWorkflows(dataSource);

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'duplicate-1',
        is_active: false,
      }),
    );
  });

  it('does not deactivate workflow rows when no retired workflow ids are configured', async () => {
    const existingWorkflow = {
      id: 'existing-1',
      name: 'Work Item Todo Auto-Dispatch',
      yaml_definition: todoDispatchYaml,
      is_active: true,
    };

    repository.find
      .mockResolvedValueOnce([existingWorkflow])
      .mockResolvedValueOnce([existingWorkflow]);

    vi.mocked(fs.readFileSync).mockReturnValue(validYaml);

    await seedWorkflows(dataSource);

    expect(repository.save).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'existing-1',
        is_active: false,
      }),
    );
  });

  it('deactivates retired retrospective autorun workflow rows', async () => {
    const retiredWorkflow = {
      id: 'retired-1',
      name: 'Project Retrospective Autorun',
      yaml_definition: [
        'workflow_id: project_retrospective_autorun',
        'name: Project Retrospective Autorun',
        'jobs:',
        '  - id: retrospective_event_checkpoint',
        '    type: run_command',
        '',
      ].join('\n'),
      is_active: true,
    };

    repository.find
      .mockResolvedValueOnce([retiredWorkflow])
      .mockResolvedValueOnce([retiredWorkflow]);

    vi.mocked(fs.readFileSync).mockReturnValue(validYaml);

    await seedWorkflows(dataSource);

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'retired-1',
        is_active: false,
      }),
    );
  });

  it('throws when a workflow seed fails validation', async () => {
    repository.find.mockResolvedValue([]);

    vi.mocked(fs.readFileSync).mockReturnValue(
      'workflow_id: sample_workflow\nname: Sample Workflow\nsteps: []\n',
    );

    await expect(seedWorkflows(dataSource)).rejects.toThrow(
      /Invalid workflow seed 'sample.workflow.yaml'/,
    );
  });
});
