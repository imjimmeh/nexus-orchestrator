import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SkillCreateCompletionListener } from './skill-create-completion.listener';
import type { WorkflowRunEvent } from '../workflow/workflow-events.types';
import type { ImprovementProposalRepository } from './database/repositories/improvement-proposal.repository';
import type { SystemSettingsService } from '../settings/system-settings.service';
import type { AgentSkillsService } from '../ai-config/services/agent-skills.service';
import type { WorkflowSkillBindingService } from '../workflow/workflow-skill-bindings/workflow-skill-binding.service';
import type { AgentProfileSkillBindingService } from '../ai-config/services/agent-profile-skill-binding.service';
import type { ScopeService } from '../scope/scope.service';

const mockRepo = {
  findById: vi.fn(),
  updateById: vi.fn(),
};

const mockSettingsService = {
  get: vi.fn(),
};

const mockSkillsService = {
  getSkill: vi.fn(),
  updateSkill: vi.fn(),
  addProfileSkillsByProfileName: vi.fn(),
};

const mockBindings = {
  addBinding: vi.fn(),
};

const mockProfileSkillBindings = {
  addProfileScopedBinding: vi.fn(),
};

const mockScopeService = {
  isLiveScope: vi.fn(),
};

function makeEvent(
  overrides: Partial<WorkflowRunEvent> = {},
): WorkflowRunEvent {
  return {
    workflowRunId: 'run-1',
    workflowId: 'wf-uuid-1',
    status: 'completed' as never,
    stateVariables: {
      trigger: { source_proposal_id: 'prop-1' },
      jobs: {
        author_skill: {
          output: {
            skill_name: 'my-skill',
            materialized: true,
            recommended_scope: { projects: ['scope-abc'] },
            scope_rationale: 'Project-specific skill',
          },
        },
      },
    },
    ...overrides,
  };
}

function buildListener(): SkillCreateCompletionListener {
  return new SkillCreateCompletionListener(
    mockRepo as unknown as ImprovementProposalRepository,
    mockSettingsService as unknown as SystemSettingsService,
    mockSkillsService as unknown as AgentSkillsService,
    mockBindings as unknown as WorkflowSkillBindingService,
    mockProfileSkillBindings as unknown as AgentProfileSkillBindingService,
    mockScopeService as unknown as ScopeService,
  );
}

describe('SkillCreateCompletionListener', () => {
  let listener: SkillCreateCompletionListener;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.findById.mockResolvedValue({
      id: 'prop-1',
      kind: 'skill_create',
      status: 'applied',
      payload: { target_skill_name: 'my-skill' },
      provenance: {},
    });
    mockRepo.updateById.mockResolvedValue(undefined);
    mockSettingsService.get.mockResolvedValue('manual');
    mockSkillsService.getSkill.mockReturnValue({
      skillMarkdown: '---\nname: my-skill\ndescription: d\n---\nbody',
    });
    mockSkillsService.updateSkill.mockReturnValue({});
    mockSkillsService.addProfileSkillsByProfileName.mockResolvedValue([]);
    mockBindings.addBinding.mockResolvedValue({});
    mockProfileSkillBindings.addProfileScopedBinding.mockResolvedValue(
      undefined,
    );
    mockScopeService.isLiveScope.mockResolvedValue(true);
    listener = buildListener();
  });

  it('returns early when stateVariables.trigger has no source_proposal_id', async () => {
    const event = makeEvent({ stateVariables: { trigger: {}, jobs: {} } });

    await listener.handleWorkflowCompleted(event);

    expect(mockRepo.findById).not.toHaveBeenCalled();
  });

  it('returns early when proposal is not found', async () => {
    mockRepo.findById.mockResolvedValue(null);

    await listener.handleWorkflowCompleted(makeEvent());

    expect(mockRepo.updateById).not.toHaveBeenCalled();
  });

  it('writes provenance.materialization scope_confirmation pending:true when materialized=true', async () => {
    await listener.handleWorkflowCompleted(makeEvent());

    expect(mockRepo.updateById).toHaveBeenCalledWith(
      'prop-1',
      expect.objectContaining({
        status: 'applied',
        applied_at: expect.any(Date),
        provenance: expect.objectContaining({
          materialization: expect.objectContaining({
            materialized: true,
            scope_confirmation: expect.objectContaining({
              pending: true,
              recommended_scope: { projects: ['scope-abc'] },
              scope_rationale: 'Project-specific skill',
            }),
          }),
        }),
      }),
    );
  });

  it('downgrades to status=failed and records error_message when materialized=false', async () => {
    const event = makeEvent({
      stateVariables: {
        trigger: { source_proposal_id: 'prop-1' },
        jobs: {
          author_skill: {
            output: {
              skill_name: 'my-skill',
              materialized: false,
              rejection_reason: 'Frontmatter was invalid',
            },
          },
        },
      },
    });

    await listener.handleWorkflowCompleted(event);

    expect(mockRepo.updateById).toHaveBeenCalledWith(
      'prop-1',
      expect.objectContaining({
        status: 'failed',
        provenance: expect.objectContaining({
          materialization: expect.objectContaining({
            materialized: false,
            error_message: 'Frontmatter was invalid',
          }),
        }),
      }),
    );
  });

  it('uses a fallback error_message when rejection_reason is absent', async () => {
    const event = makeEvent({
      stateVariables: {
        trigger: { source_proposal_id: 'prop-1' },
        jobs: {
          author_skill: {
            output: { skill_name: 'my-skill', materialized: false },
          },
        },
      },
    });

    await listener.handleWorkflowCompleted(event);

    const [, update] = mockRepo.updateById.mock.calls[0];
    const materialization = (update.provenance as Record<string, unknown>)
      .materialization as Record<string, unknown>;
    expect(materialization.error_message).toEqual(expect.any(String));
    expect((materialization.error_message as string).length).toBeGreaterThan(0);
  });

  it('preserves unrelated provenance keys when recording materialization', async () => {
    mockRepo.findById.mockResolvedValue({
      id: 'prop-1',
      kind: 'skill_create',
      status: 'applied',
      payload: { target_skill_name: 'my-skill' },
      provenance: { apply_detail: 'materialization dispatched (run r1)' },
    });

    await listener.handleWorkflowCompleted(makeEvent());

    expect(mockRepo.updateById).toHaveBeenCalledWith(
      'prop-1',
      expect.objectContaining({
        provenance: expect.objectContaining({
          apply_detail: 'materialization dispatched (run r1)',
          materialization: expect.any(Object),
        }),
      }),
    );
  });

  describe('auto-apply scope (mode: auto)', () => {
    beforeEach(() => {
      mockSettingsService.get.mockResolvedValue('auto');
    });

    it('applies the recommended scope to the skill and writes auto_applied:true when scope has content', async () => {
      // The recommendation only auto-applies within the run's known origin
      // scope (Task 4's clamp rule), so the origin here must match the
      // recommended `projects` entry below.
      mockRepo.findById.mockResolvedValue({
        id: 'prop-1',
        kind: 'skill_create',
        status: 'applied',
        payload: { target_skill_name: 'my-skill' },
        provenance: { scope_id: 'scope-abc' },
      });

      await listener.handleWorkflowCompleted(makeEvent());

      expect(mockSkillsService.getSkill).toHaveBeenCalledWith('my-skill');
      expect(mockSkillsService.updateSkill).toHaveBeenCalledWith(
        'my-skill',
        expect.objectContaining({
          skill_markdown: expect.stringContaining('scope'),
        }),
      );
      expect(mockRepo.updateById).toHaveBeenLastCalledWith(
        'prop-1',
        expect.objectContaining({
          provenance: expect.objectContaining({
            materialization: expect.objectContaining({
              scope_confirmation: expect.objectContaining({
                pending: false,
                auto_applied: true,
              }),
            }),
          }),
        }),
      );
    });

    it('does not apply scope and keeps pending:true when recommended_scope is null', async () => {
      const event = makeEvent({
        stateVariables: {
          trigger: { source_proposal_id: 'prop-1' },
          jobs: {
            author_skill: {
              output: {
                skill_name: 'my-skill',
                materialized: true,
                recommended_scope: null,
                scope_rationale: 'No scope',
              },
            },
          },
        },
      });

      await listener.handleWorkflowCompleted(event);

      expect(mockSkillsService.updateSkill).not.toHaveBeenCalled();
      expect(mockRepo.updateById).toHaveBeenCalledWith(
        'prop-1',
        expect.objectContaining({
          provenance: expect.objectContaining({
            materialization: expect.objectContaining({
              scope_confirmation: expect.objectContaining({ pending: true }),
            }),
          }),
        }),
      );
    });

    it('falls back to pending:true when applying the scope throws (fail-soft)', async () => {
      // Same clamp rule as the sibling "applies the recommended scope" test
      // above: `decideScopeApplication` stages unconditionally when
      // `originScopeId` is null, before it ever reaches the
      // `applyScopeToSkill` call this test means to exercise. The origin
      // here must match the recommended `projects` entry from `makeEvent()`
      // so the auto-apply path is actually reached and `getSkill` (mocked to
      // throw below) is the thing that fails.
      //
      // `applyOriginScope` (unconditional, fires first) and `tryAutoApplyScope`
      // (fires second, gated on the real `originScopeId`/mode decision) both
      // call `getSkill` on this same mock when a scope_id is present. To
      // discriminate which fail-soft catch actually produces the
      // `pending:true` outcome under test — as opposed to a regression that
      // hardcodes `tryAutoApplyScope`'s `originScopeId` back to `null` (which
      // would make `decideScopeApplication` stage and skip its own
      // `applyScopeToSkill`/`getSkill` call entirely) — the first `getSkill`
      // call (from `applyOriginScope`) is made to succeed, and only the
      // second call (from `tryAutoApplyScope`) throws. If the `originScopeId`
      // wiring were reverted, `getSkill` would be called only once here and
      // the `toHaveBeenCalledTimes(2)` assertion below would fail.
      mockRepo.findById.mockResolvedValue({
        id: 'prop-1',
        kind: 'skill_create',
        status: 'applied',
        payload: { target_skill_name: 'my-skill' },
        provenance: { scope_id: 'scope-abc' },
      });
      mockSkillsService.getSkill
        .mockImplementationOnce(() => ({
          skillMarkdown: '---\nname: my-skill\ndescription: d\n---\nbody',
        }))
        .mockImplementationOnce(() => {
          throw new Error('skill not found');
        });

      await listener.handleWorkflowCompleted(makeEvent());

      expect(mockSkillsService.getSkill).toHaveBeenCalledTimes(2);
      expect(mockSkillsService.getSkill).toHaveBeenNthCalledWith(2, 'my-skill');

      const hasAutoApplied = (
        mockRepo.updateById.mock.calls as unknown[][]
      ).some((args) => {
        const update = args[1] as Record<string, unknown>;
        const provenance = update?.provenance as
          | Record<string, unknown>
          | undefined;
        const materialization = provenance?.materialization as
          | Record<string, unknown>
          | undefined;
        const conf = materialization?.scope_confirmation as
          | Record<string, unknown>
          | undefined;
        return conf?.auto_applied === true;
      });
      expect(hasAutoApplied).toBe(false);
    });
  });

  describe('regression guard: mode manual', () => {
    it('does not apply scope and keeps pending:true when mode is manual', async () => {
      await listener.handleWorkflowCompleted(makeEvent());

      expect(mockSkillsService.updateSkill).not.toHaveBeenCalled();
      expect(mockRepo.updateById).toHaveBeenCalledWith(
        'prop-1',
        expect.objectContaining({
          provenance: expect.objectContaining({
            materialization: expect.objectContaining({
              scope_confirmation: expect.objectContaining({ pending: true }),
            }),
          }),
        }),
      );
    });
  });

  describe('origin scope auto-apply', () => {
    it('applies the origin scope_id to the skill frontmatter unconditionally, even in manual mode', async () => {
      mockRepo.findById.mockResolvedValue({
        id: 'prop-1',
        kind: 'skill_create',
        status: 'applied',
        payload: { target_skill_name: 'my-skill' },
        provenance: { scope_id: 'scope-1' },
      });
      mockSettingsService.get.mockResolvedValue('manual');
      mockSkillsService.getSkill.mockReturnValue({
        skillMarkdown: '---\nname: my-skill\ndescription: does things\n---\n',
      });

      await listener.handleWorkflowCompleted(makeEvent());

      expect(mockSkillsService.updateSkill).toHaveBeenCalledWith(
        'my-skill',
        expect.objectContaining({
          skill_markdown: expect.stringContaining('scope-1'),
        }),
      );
    });

    it('does not apply any scope when provenance has no scope_id', async () => {
      mockRepo.findById.mockResolvedValue({
        id: 'prop-1',
        kind: 'skill_create',
        status: 'applied',
        payload: { target_skill_name: 'my-skill' },
        provenance: {},
      });
      mockSettingsService.get.mockResolvedValue('manual');

      await listener.handleWorkflowCompleted(makeEvent());

      expect(mockSkillsService.updateSkill).not.toHaveBeenCalled();
    });

    it('does not apply origin scope when scope_id does not resolve to a live scope node', async () => {
      mockRepo.findById.mockResolvedValue({
        id: 'prop-1',
        kind: 'skill_create',
        status: 'applied',
        payload: { target_skill_name: 'my-skill' },
        provenance: { scope_id: 'archived-scope' },
      });
      mockScopeService.isLiveScope.mockResolvedValue(false);
      mockSettingsService.get.mockResolvedValue('manual');

      await listener.handleWorkflowCompleted(makeEvent());

      expect(mockSkillsService.updateSkill).not.toHaveBeenCalled();
    });

    it('treats an invalid origin scope as null when deciding auto-apply (never auto-applies against a stale scope)', async () => {
      mockRepo.findById.mockResolvedValue({
        id: 'prop-1',
        kind: 'skill_create',
        status: 'applied',
        payload: { target_skill_name: 'my-skill' },
        provenance: { scope_id: 'archived-scope' },
      });
      mockScopeService.isLiveScope.mockResolvedValue(false);
      mockSettingsService.get.mockResolvedValue('auto');
      mockSkillsService.getSkill.mockReturnValue({
        skillMarkdown: '---\nname: my-skill\ndescription: does things\n---\n',
      });

      await listener.handleWorkflowCompleted(
        makeEvent({
          stateVariables: {
            trigger: { source_proposal_id: 'prop-1' },
            jobs: {
              author_skill: {
                output: {
                  skill_name: 'my-skill',
                  materialized: true,
                  recommended_scope: { projects: ['archived-scope'] },
                  scope_rationale: 'Project-specific skill',
                },
              },
            },
          },
        }),
      );

      // auto-apply must not fire off a stale origin scope; only the (skipped)
      // origin-scope write and no confirmed-scope write should have happened.
      expect(mockSkillsService.updateSkill).not.toHaveBeenCalled();
    });
  });

  describe('assignment targets (Epic B)', () => {
    it('applies agent_profile and workflow_step targets and records rollback_data.applied_targets', async () => {
      mockRepo.findById.mockResolvedValue({
        id: 'prop-1',
        kind: 'skill_create',
        status: 'applied',
        payload: {
          target_skill_name: 'my-skill',
          assignment_targets: [
            { type: 'agent_profile', profileName: 'merge-agent' },
            { type: 'workflow_step', workflowName: 'auto_merge' },
            {
              type: 'workflow_step',
              workflowName: 'auto_merge',
              stepId: 'quality_gate',
            },
          ],
        },
        provenance: {},
        rollback_data: null,
      });

      await listener.handleWorkflowCompleted(makeEvent());

      expect(
        mockSkillsService.addProfileSkillsByProfileName,
      ).toHaveBeenCalledWith('merge-agent', ['my-skill']);
      expect(mockBindings.addBinding).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowName: 'auto_merge',
          stepId: null,
          skillName: 'my-skill',
        }),
      );
      expect(mockBindings.addBinding).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowName: 'auto_merge',
          stepId: 'quality_gate',
          skillName: 'my-skill',
        }),
      );

      const rollbackCall = (mockRepo.updateById.mock.calls as unknown[][]).find(
        (args) => {
          const patch = args[1] as Record<string, unknown>;
          return patch.rollback_data !== undefined;
        },
      );
      expect(rollbackCall).toBeDefined();
      const rollbackData = (rollbackCall as unknown[])[1] as Record<
        string,
        unknown
      >;
      expect(
        (rollbackData.rollback_data as Record<string, unknown>).applied_targets,
      ).toHaveLength(3);
      expect(
        (rollbackData.rollback_data as Record<string, unknown>)
          .unrouted_targets,
      ).toEqual([]);
    });

    it('records unresolved targets as unrouted without throwing', async () => {
      mockRepo.findById.mockResolvedValue({
        id: 'prop-1',
        kind: 'skill_create',
        status: 'applied',
        payload: {
          target_skill_name: 'my-skill',
          assignment_targets: [
            { type: 'agent_profile', profileName: 'ghost-agent' },
          ],
        },
        provenance: {},
        rollback_data: null,
      });
      mockSkillsService.addProfileSkillsByProfileName.mockRejectedValue(
        new Error('Agent profile with name ghost-agent not found'),
      );

      await expect(
        listener.handleWorkflowCompleted(makeEvent()),
      ).resolves.not.toThrow();

      const rollbackCall = (mockRepo.updateById.mock.calls as unknown[][]).find(
        (args) => {
          const patch = args[1] as Record<string, unknown>;
          return patch.rollback_data !== undefined;
        },
      );
      expect(rollbackCall).toBeDefined();
      const rollbackData = (
        (rollbackCall as unknown[])[1] as Record<string, unknown>
      ).rollback_data as Record<string, unknown>;
      expect(rollbackData.applied_targets).toEqual([]);
      expect(rollbackData.unrouted_targets).toEqual([
        expect.objectContaining({
          target: { type: 'agent_profile', profileName: 'ghost-agent' },
          reason: 'Agent profile with name ghost-agent not found',
        }),
      ]);
    });

    it('does not touch skills/bindings or write rollback_data when assignment_targets is absent (Epic A behavior unchanged)', async () => {
      await listener.handleWorkflowCompleted(makeEvent());

      expect(
        mockSkillsService.addProfileSkillsByProfileName,
      ).not.toHaveBeenCalled();
      expect(mockBindings.addBinding).not.toHaveBeenCalled();
      expect(mockRepo.updateById).toHaveBeenCalledTimes(1);
    });

    it('passes provenance.scope_id through when applying assignment_targets post-materialization', async () => {
      mockRepo.findById.mockResolvedValue({
        id: 'prop-1',
        kind: 'skill_create',
        status: 'applied',
        payload: {
          target_skill_name: 'incident-response',
          assignment_targets: [
            { type: 'agent_profile', profileName: 'backend-engineer' },
          ],
        },
        provenance: { scope_id: 'scope-1' },
        rollback_data: null,
      });

      await listener.handleWorkflowCompleted(makeEvent());

      expect(
        mockProfileSkillBindings.addProfileScopedBinding,
      ).toHaveBeenCalledWith({
        skillName: 'incident-response',
        scopeNodeId: 'scope-1',
        profileName: 'backend-engineer',
      });
      expect(
        mockSkillsService.addProfileSkillsByProfileName,
      ).not.toHaveBeenCalled();
    });
  });
});
