import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StartupSeedService } from './startup-seed.service';

describe('StartupSeedService', () => {
  const mockRepo = {
    save: vi.fn().mockResolvedValue(undefined),
    findOne: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockReturnValue({}),
  };
  const dataSource = { getRepository: vi.fn().mockReturnValue(mockRepo) };
  const roleSeedService = { seed: vi.fn() };
  const setupConfigSeedService = { seed: vi.fn() };
  const llmSecretSeedService = { seed: vi.fn() };
  const llmProviderSeedService = { seed: vi.fn() };
  const llmModelSeedService = { seed: vi.fn() };
  const fallbackChainSeedService = { seed: vi.fn() };
  const skillSeedService = { seed: vi.fn() };
  const agentProfileSeedService = { seed: vi.fn() };
  const agentSkillAssignmentsSeedService = { seed: vi.fn() };
  const toolApprovalRulesSeedService = { seed: vi.fn() };
  const scopedVariableSeedService = { seed: vi.fn() };
  const workflowSeedService = { seed: vi.fn() };
  const workflowRepo = { findByIdentifier: vi.fn() };
  const scheduledJobRepo = { findAll: vi.fn(), create: vi.fn() };

  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const loggerDebugSpy = vi
    .spyOn(Logger.prototype, 'debug')
    .mockImplementation(() => {});

  let service: StartupSeedService;

  beforeEach(() => {
    vi.clearAllMocks();
    roleSeedService.seed.mockResolvedValue(undefined);
    setupConfigSeedService.seed.mockResolvedValue(undefined);
    llmSecretSeedService.seed.mockResolvedValue('secret-id');
    llmProviderSeedService.seed.mockResolvedValue(undefined);
    llmModelSeedService.seed.mockResolvedValue(undefined);
    fallbackChainSeedService.seed.mockResolvedValue(undefined);
    skillSeedService.seed.mockResolvedValue(undefined);
    agentProfileSeedService.seed.mockResolvedValue(undefined);
    agentSkillAssignmentsSeedService.seed.mockResolvedValue(undefined);
    toolApprovalRulesSeedService.seed.mockResolvedValue(undefined);
    scopedVariableSeedService.seed.mockResolvedValue(undefined);
    workflowSeedService.seed.mockResolvedValue(undefined);
    workflowRepo.findByIdentifier.mockResolvedValue({ id: 'workflow-uuid' });
    scheduledJobRepo.findAll.mockResolvedValue({ data: [] });
    scheduledJobRepo.create.mockResolvedValue(undefined);

    service = new StartupSeedService(
      dataSource as never,
      roleSeedService as never,
      setupConfigSeedService as never,
      llmSecretSeedService as never,
      llmProviderSeedService as never,
      llmModelSeedService as never,
      skillSeedService as never,
      agentProfileSeedService as never,
      agentSkillAssignmentsSeedService as never,
      toolApprovalRulesSeedService as never,
      scopedVariableSeedService as never,
      workflowSeedService as never,
      workflowRepo as never,
      scheduledJobRepo as never,
      fallbackChainSeedService as never,
    );
  });

  it('seeds startup prerequisites including workflows and scheduled jobs', async () => {
    await service.seedOnStartup();

    expect(roleSeedService.seed).toHaveBeenCalledTimes(1);
    expect(setupConfigSeedService.seed).toHaveBeenCalledTimes(1);
    expect(llmSecretSeedService.seed).toHaveBeenCalledTimes(1);
    expect(llmProviderSeedService.seed).toHaveBeenCalledWith({
      secretId: 'secret-id',
    });
    expect(llmModelSeedService.seed).toHaveBeenCalledTimes(1);
    expect(fallbackChainSeedService.seed).toHaveBeenCalledTimes(1);
    expect(skillSeedService.seed).toHaveBeenCalledTimes(1);
    expect(agentProfileSeedService.seed).toHaveBeenCalledTimes(1);
    expect(agentSkillAssignmentsSeedService.seed).toHaveBeenCalledTimes(1);
    expect(toolApprovalRulesSeedService.seed).toHaveBeenCalledTimes(1);
    // Global default variables (orchestration policy: gates.*, backlog.*,
    // autonomy.*) must be seeded on every boot, not only at first-time setup —
    // otherwise the CEO cycle's vars.* render undefined and its gate/promotion
    // conditions silently never fire.
    expect(scopedVariableSeedService.seed).toHaveBeenCalledTimes(1);
    expect(workflowSeedService.seed).toHaveBeenCalledTimes(1);
    expect(workflowRepo.findByIdentifier).toHaveBeenCalledWith(
      'memory_learning_sweep',
    );
    expect(scheduledJobRepo.findAll).toHaveBeenCalled();
    expect(scheduledJobRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Nightly Memory Learning Sweep',
        schedule_expression: '0 2 * * *',
        execution_target_ref: 'workflow-uuid',
      }),
    );
  });

  it('skips scheduled job seeding if job already exists', async () => {
    scheduledJobRepo.findAll.mockResolvedValue({
      data: [
        {
          execution_target_type: 'workflow',
          execution_target_ref: 'workflow-uuid',
        },
      ],
    });

    await service.seedOnStartup();

    expect(workflowRepo.findByIdentifier).toHaveBeenCalledWith(
      'memory_learning_sweep',
    );
    expect(scheduledJobRepo.create).not.toHaveBeenCalled();
  });

  it('emits startup progress as debug logs instead of direct console output', async () => {
    await service.seedOnStartup();

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(loggerDebugSpy).toHaveBeenCalledWith(
      'StartupSeedService: seeding roles...',
    );
    expect(loggerDebugSpy).toHaveBeenCalledWith(
      'StartupSeedService: seeding complete.',
    );
  });
});
