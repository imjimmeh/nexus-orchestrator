import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { WorkflowSeedService } from './workflows.seed';

vi.mock('node:fs', () => {
  return {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import * as fs from 'node:fs';

const VALID_YAML = [
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

describe('WorkflowSeedService — override-safe re-seeding (EPIC-204F T7)', () => {
  const mockRepository = {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn((value: unknown) => value),
    save: vi.fn(),
  };

  const mockCache = {
    invalidate: vi.fn(),
  };

  function buildService(cacheArg?: typeof mockCache): WorkflowSeedService {
    return new WorkflowSeedService(
      mockRepository,
      undefined,
      undefined,
      cacheArg as never,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      'sample.workflow.yaml',
    ] as never);
    vi.mocked(fs.readFileSync).mockReturnValue(VALID_YAML);
    mockRepository.find.mockResolvedValue([]);
  });

  describe('existence check is scoped to defaults (scope_node_id IS NULL AND source = seeded)', () => {
    it('inserts a new record when no matching seeded default row exists', async () => {
      // Arrange: repo has no existing workflow rows
      mockRepository.find.mockResolvedValue([]);

      // Act
      const service = buildService();
      await service.seed();

      // Assert: creates and saves a new row
      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Sample Workflow', is_active: true }),
      );
      expect(mockRepository.save).toHaveBeenCalledTimes(1);
    });

    it('does NOT match a row whose scope_node_id is non-null when looking up existing seeded defaults', async () => {
      // The repository is queried with WHERE scope_node_id IS NULL AND source = 'seeded'.
      // A real DB would exclude scoped rows — mock returns [] to simulate that.
      mockRepository.find.mockResolvedValue([]);

      const service = buildService();
      await service.seed();

      // Because no default row existed, a new platform-default row must be inserted.
      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Sample Workflow' }),
      );
    });
  });

  describe('locked guard', () => {
    it('skips update when existing seeded-default row has locked = true', async () => {
      const lockedWorkflow = {
        id: 'locked-1',
        name: 'Sample Workflow',
        yaml_definition: VALID_YAML.replace('Sample Workflow', 'Old Name'),
        is_active: true,
        scope_node_id: null,
        source: 'seeded',
        locked: true,
        overrides: null,
      };

      mockRepository.find.mockResolvedValue([lockedWorkflow]);

      const service = buildService();
      await service.seed();

      // save must NOT be called for the locked row (yaml content changed but locked)
      expect(mockRepository.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: 'locked-1' }),
      );
    });
  });

  describe('overrides guard', () => {
    it('skips update when existing seeded-default row has overrides != null', async () => {
      const customisedWorkflow = {
        id: 'customised-1',
        name: 'Sample Workflow',
        yaml_definition: VALID_YAML.replace('Sample Workflow', 'Old Name'),
        is_active: true,
        scope_node_id: null,
        source: 'seeded',
        locked: false,
        overrides: { custom_field: true },
      };

      mockRepository.find.mockResolvedValue([customisedWorkflow]);

      const service = buildService();
      await service.seed();

      expect(mockRepository.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: 'customised-1' }),
      );
    });

    it('skips reseed and keeps the applied YAML when overrides carries an improvement_proposal marker (EPIC-D)', async () => {
      // A WorkflowDefinitionChangeApplier.apply() has already pinned this
      // row's overrides and replaced its yaml_definition; the seed's
      // yaml_definition (the pre-improvement default) must NOT clobber it,
      // and the row's applied YAML must survive untouched.
      const appliedYaml = VALID_YAML.replace(
        'Test prompt',
        'Test prompt with retry',
      );
      const improvedWorkflow = {
        id: 'improved-1',
        name: 'Sample Workflow',
        yaml_definition: appliedYaml,
        is_active: true,
        scope_node_id: null,
        source: 'seeded',
        locked: false,
        overrides: {
          improvement_proposal: {
            proposal_id: 'proposal-uuid-1',
            applied_at: '2026-07-02T00:00:00.000Z',
          },
        },
      };

      mockRepository.find.mockResolvedValue([improvedWorkflow]);

      const service = buildService();
      await service.seed();

      expect(mockRepository.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: 'improved-1' }),
      );
      expect(improvedWorkflow.yaml_definition).toBe(appliedYaml);
    });
  });

  describe('normal update path', () => {
    it('updates an existing unlocked, uncustomised seeded-default row when yaml changes', async () => {
      const existingWorkflow = {
        id: 'existing-1',
        name: 'Sample Workflow',
        yaml_definition: VALID_YAML.replace('Sample Workflow', 'Old Name'),
        is_active: true,
        scope_node_id: null,
        source: 'seeded',
        locked: false,
        overrides: null,
      };

      mockRepository.find.mockResolvedValue([existingWorkflow]);

      const service = buildService();
      await service.seed();

      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'existing-1',
          yaml_definition: VALID_YAML,
          is_active: true,
        }),
      );
    });
  });

  describe('cache invalidation', () => {
    it('calls ConfigResolutionCache.invalidate after inserting a new workflow', async () => {
      mockRepository.find.mockResolvedValue([]);

      const service = buildService(mockCache);
      await service.seed();

      expect(mockCache.invalidate).toHaveBeenCalledWith(
        'workflow',
        'Sample Workflow',
      );
    });

    it('calls ConfigResolutionCache.invalidate after updating an existing workflow', async () => {
      const existingWorkflow = {
        id: 'existing-1',
        name: 'Sample Workflow',
        yaml_definition: VALID_YAML.replace('Sample Workflow', 'Old Name'),
        is_active: true,
        scope_node_id: null,
        source: 'seeded',
        locked: false,
        overrides: null,
      };

      mockRepository.find.mockResolvedValue([existingWorkflow]);

      const service = buildService(mockCache);
      await service.seed();

      expect(mockCache.invalidate).toHaveBeenCalledWith(
        'workflow',
        'Sample Workflow',
      );
    });

    it('does NOT call ConfigResolutionCache.invalidate when the row is skipped due to locked', async () => {
      const lockedWorkflow = {
        id: 'locked-1',
        name: 'Sample Workflow',
        yaml_definition: VALID_YAML.replace('Sample Workflow', 'Old Name'),
        is_active: true,
        scope_node_id: null,
        source: 'seeded',
        locked: true,
        overrides: null,
      };

      mockRepository.find.mockResolvedValue([lockedWorkflow]);

      const service = buildService(mockCache);
      await service.seed();

      expect(mockCache.invalidate).not.toHaveBeenCalled();
    });

    it('does NOT call ConfigResolutionCache.invalidate when the row is skipped due to overrides', async () => {
      const customisedWorkflow = {
        id: 'customised-1',
        name: 'Sample Workflow',
        yaml_definition: VALID_YAML.replace('Sample Workflow', 'Old Name'),
        is_active: true,
        scope_node_id: null,
        source: 'seeded',
        locked: false,
        overrides: { custom_field: true },
      };

      mockRepository.find.mockResolvedValue([customisedWorkflow]);

      const service = buildService(mockCache);
      await service.seed();

      expect(mockCache.invalidate).not.toHaveBeenCalled();
    });
  });
});
