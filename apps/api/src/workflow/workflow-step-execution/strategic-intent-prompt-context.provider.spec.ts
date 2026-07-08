import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMemorySegment } from '@nexus/core';
import type { MemoryManagerService } from '../../memory/memory-manager.service';
import type { IWorkflowRunRepository } from '../kernel/interfaces/workflow-kernel.ports';
import { StrategicIntentPromptContextProvider } from './strategic-intent-prompt-context.provider';

/**
 * EPIC-208 (Milestone 2) — verifies the "Strategic Intent" block that
 * is injected into the CEO cycle prompt context (the modern replacement
 * for the legacy `decide.md` prompt).
 *
 *  - When the run is NOT a CEO cycle, no block is rendered.
 *  - When no strategic intent has been recorded, the block is omitted
 *    entirely (not rendered as an empty stub).
 *  - When a strategic intent IS recorded, all four required fields
 *    (`horizon`, `priority_themes`, `focus_areas`, `constraints`) are
 *    present in the rendered block.
 *  - The block refreshes each new run (per-call lookup, not cached).
 */
describe('StrategicIntentPromptContextProvider', () => {
  let runRepo: {
    findById: ReturnType<typeof vi.fn>;
  };
  let memoryManager: {
    getStrategicIntentSegment: ReturnType<typeof vi.fn>;
  };
  let provider: StrategicIntentPromptContextProvider;

  const CEO_CYCLE_RUN_ID = 'run-ceo-1';
  const OTHER_RUN_ID = 'run-other-1';
  const PROJECT_SCOPE_ID = 'project-1';

  const ceoCycleRun = {
    id: CEO_CYCLE_RUN_ID,
    workflow_id: StrategicIntentPromptContextProvider.CEO_CYCLE_WORKFLOW_ID,
  };

  const otherRun = {
    id: OTHER_RUN_ID,
    workflow_id: 'some_other_workflow',
  };

  const stateVariablesForCeoCycle = {
    trigger: { scopeId: PROJECT_SCOPE_ID },
  };

  const stateVariablesMissingScope = {
    trigger: {},
  };

  const strategicIntentSegment: IMemorySegment = {
    id: 'segment-strategic-1',
    entity_type:
      StrategicIntentPromptContextProvider.STRATEGIC_INTENT_ENTITY_TYPE,
    entity_id: PROJECT_SCOPE_ID,
    memory_type: 'strategic_intent',
    content:
      'horizon=Q1-2026 themes=memory coverage focus=intent tool wiring constraints=no silent lint regressions',
    version: 1,
    metadata_json: {
      horizon: 'Q1-2026',
      priority_themes: ['memory schema coverage', 'CEO refresh loop'],
      focus_areas: ['strategic intent tool wiring'],
      constraints: ['no silent lint regressions'],
      rationale: 'Lean into memory schema coverage this cycle.',
      updated_at: '2026-06-19T12:00:00.000Z',
      updated_by: 'ceo',
    },
    created_at: new Date('2026-06-19T12:00:00.000Z'),
    updated_at: new Date('2026-06-19T12:00:00.000Z'),
  };

  beforeEach(() => {
    runRepo = {
      findById: vi.fn(async (id: string) => {
        if (id === CEO_CYCLE_RUN_ID) {
          return ceoCycleRun;
        }
        if (id === OTHER_RUN_ID) {
          return otherRun;
        }
        return null;
      }),
    };
    memoryManager = {
      getStrategicIntentSegment: vi.fn(async () => strategicIntentSegment),
    };
    provider = new StrategicIntentPromptContextProvider(
      runRepo as unknown as IWorkflowRunRepository,
      memoryManager as unknown as MemoryManagerService,
    );
  });

  it('renders an empty string for runs that are not the CEO cycle', async () => {
    const result = await provider.buildContext({
      workflowRunId: OTHER_RUN_ID,
      stateVariables: stateVariablesForCeoCycle,
    });

    expect(result).toBe('');
    expect(runRepo.findById).toHaveBeenCalledWith(OTHER_RUN_ID);
    expect(memoryManager.getStrategicIntentSegment).not.toHaveBeenCalled();
  });

  it('renders an empty string when no strategic intent has been recorded', async () => {
    memoryManager.getStrategicIntentSegment.mockResolvedValueOnce(null);

    const result = await provider.buildContext({
      workflowRunId: CEO_CYCLE_RUN_ID,
      stateVariables: stateVariablesForCeoCycle,
    });

    expect(result).toBe('');
    expect(memoryManager.getStrategicIntentSegment).toHaveBeenCalledWith(
      StrategicIntentPromptContextProvider.STRATEGIC_INTENT_ENTITY_TYPE,
      PROJECT_SCOPE_ID,
    );
  });

  it('renders an empty string when the run is a CEO cycle but no scope id can be resolved', async () => {
    const result = await provider.buildContext({
      workflowRunId: CEO_CYCLE_RUN_ID,
      stateVariables: stateVariablesMissingScope,
    });

    expect(result).toBe('');
    expect(memoryManager.getStrategicIntentSegment).not.toHaveBeenCalled();
  });

  it('renders a strategic-intent block with all four fields when a segment is recorded', async () => {
    const result = await provider.buildContext({
      workflowRunId: CEO_CYCLE_RUN_ID,
      stateVariables: stateVariablesForCeoCycle,
    });

    expect(result).toContain('Strategic Intent');
    // All four required fields must be rendered in the block.
    expect(result).toContain('horizon:');
    expect(result).toContain('Q1-2026');
    expect(result).toContain('priority_themes:');
    expect(result).toContain('memory schema coverage');
    expect(result).toContain('CEO refresh loop');
    expect(result).toContain('focus_areas:');
    expect(result).toContain('strategic intent tool wiring');
    expect(result).toContain('constraints:');
    expect(result).toContain('no silent lint regressions');
    // Optional rationale should be rendered when present.
    expect(result).toContain('Lean into memory schema coverage this cycle.');
    expect(result).toContain('Recorded by:');
    expect(result).toContain('ceo');
  });

  it('falls back to "ceo" as the default updated_by when metadata omits it', async () => {
    const segmentWithoutUpdatedBy: IMemorySegment = {
      ...strategicIntentSegment,
      metadata_json: {
        horizon: 'Q1-2026',
        priority_themes: ['memory schema coverage'],
        focus_areas: ['strategic intent tool wiring'],
        constraints: ['no silent lint regressions'],
      },
    };
    memoryManager.getStrategicIntentSegment.mockResolvedValueOnce(
      segmentWithoutUpdatedBy,
    );

    const result = await provider.buildContext({
      workflowRunId: CEO_CYCLE_RUN_ID,
      stateVariables: stateVariablesForCeoCycle,
    });

    expect(result).toContain('Recorded by:');
    expect(result).toContain('ceo');
  });

  it('does not render an empty stub when required fields are missing', async () => {
    const segmentWithoutHorizon: IMemorySegment = {
      ...strategicIntentSegment,
      metadata_json: {
        priority_themes: [],
        focus_areas: [],
        constraints: [],
      },
    };
    memoryManager.getStrategicIntentSegment.mockResolvedValueOnce(
      segmentWithoutHorizon,
    );

    const result = await provider.buildContext({
      workflowRunId: CEO_CYCLE_RUN_ID,
      stateVariables: stateVariablesForCeoCycle,
    });

    expect(result).toBe('');
  });

  it('renders the empty-state placeholder text when priority arrays are empty', async () => {
    const segmentWithOnlyHorizon: IMemorySegment = {
      ...strategicIntentSegment,
      metadata_json: {
        horizon: 'Q1-2026',
        priority_themes: [],
        focus_areas: [],
        constraints: [],
        updated_by: 'ceo',
      },
    };
    memoryManager.getStrategicIntentSegment.mockResolvedValueOnce(
      segmentWithOnlyHorizon,
    );

    const result = await provider.buildContext({
      workflowRunId: CEO_CYCLE_RUN_ID,
      stateVariables: stateVariablesForCeoCycle,
    });

    expect(result).toContain('horizon:');
    expect(result).toContain('Q1-2026');
    expect(result).toContain('_none recorded_');
  });

  it('degrades to an empty string when the run lookup throws', async () => {
    runRepo.findById.mockRejectedValueOnce(new Error('db down'));

    const result = await provider.buildContext({
      workflowRunId: CEO_CYCLE_RUN_ID,
      stateVariables: stateVariablesForCeoCycle,
    });

    expect(result).toBe('');
  });

  it('renders the strategic-intent block freshly on each call (no cross-cycle caching)', async () => {
    const first = await provider.buildContext({
      workflowRunId: CEO_CYCLE_RUN_ID,
      stateVariables: stateVariablesForCeoCycle,
    });
    const second = await provider.buildContext({
      workflowRunId: CEO_CYCLE_RUN_ID,
      stateVariables: stateVariablesForCeoCycle,
    });

    expect(first).toBe(second);
    expect(runRepo.findById).toHaveBeenCalledTimes(2);
    expect(memoryManager.getStrategicIntentSegment).toHaveBeenCalledTimes(2);
  });
});
