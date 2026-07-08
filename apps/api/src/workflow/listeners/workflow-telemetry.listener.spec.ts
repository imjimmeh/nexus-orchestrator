import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { WorkflowStatus } from '@nexus/core';
import { WorkflowTelemetryListener } from './workflow-telemetry.listener';
import { MetricsService } from '../../observability/metrics.service';
import type { WorkflowRunEvent } from '../workflow-events.types';

describe('WorkflowTelemetryListener', () => {
  let listener: WorkflowTelemetryListener;
  let metricsService: {
    workflowExecutionsTotal: { inc: ReturnType<typeof vi.fn> };
    workflowsActive: {
      inc: ReturnType<typeof vi.fn>;
      dec: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(async () => {
    metricsService = {
      workflowExecutionsTotal: { inc: vi.fn() },
      workflowsActive: { inc: vi.fn(), dec: vi.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [
        WorkflowTelemetryListener,
        { provide: MetricsService, useValue: metricsService },
      ],
    }).compile();

    listener = module.get(WorkflowTelemetryListener);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const runEvent = (status: WorkflowStatus): WorkflowRunEvent => ({
    workflowRunId: 'run-1',
    workflowId: 'wf-1',
    status,
    stateVariables: {},
  });

  it('increments workflowsActive and workflowExecutionsTotal on run started', () => {
    listener.onRunStarted(runEvent(WorkflowStatus.RUNNING));

    expect(metricsService.workflowsActive.inc).toHaveBeenCalledWith({
      workflow_id: 'wf-1',
    });
    expect(metricsService.workflowExecutionsTotal.inc).toHaveBeenCalledWith({
      workflow_id: 'wf-1',
      status: WorkflowStatus.RUNNING,
    });
  });

  it('decrements workflowsActive and increments workflowExecutionsTotal on run completed', () => {
    listener.onRunCompleted(runEvent(WorkflowStatus.COMPLETED));

    expect(metricsService.workflowsActive.dec).toHaveBeenCalledWith({
      workflow_id: 'wf-1',
    });
    expect(metricsService.workflowExecutionsTotal.inc).toHaveBeenCalledWith({
      workflow_id: 'wf-1',
      status: WorkflowStatus.COMPLETED,
    });
  });

  it('decrements workflowsActive and increments workflowExecutionsTotal on run failed', () => {
    listener.onRunFailed(runEvent(WorkflowStatus.FAILED));

    expect(metricsService.workflowsActive.dec).toHaveBeenCalledWith({
      workflow_id: 'wf-1',
    });
    expect(metricsService.workflowExecutionsTotal.inc).toHaveBeenCalledWith({
      workflow_id: 'wf-1',
      status: WorkflowStatus.FAILED,
    });
  });

  it('decrements workflowsActive and increments workflowExecutionsTotal on run cancelled', () => {
    listener.onRunCancelled(runEvent(WorkflowStatus.CANCELLED));

    expect(metricsService.workflowsActive.dec).toHaveBeenCalledWith({
      workflow_id: 'wf-1',
    });
    expect(metricsService.workflowExecutionsTotal.inc).toHaveBeenCalledWith({
      workflow_id: 'wf-1',
      status: WorkflowStatus.CANCELLED,
    });
  });
});
