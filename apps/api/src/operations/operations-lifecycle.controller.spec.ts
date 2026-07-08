import { describe, expect, it } from 'vitest';
import type { StartupResumeCoordinator } from '../execution-lifecycle/startup-resume.coordinator';
import type { ResumeSummary } from '../execution-lifecycle/startup-resume.coordinator.types';
import { OperationsLifecycleController } from './operations-lifecycle.controller';

describe('OperationsLifecycleController', () => {
  const buildCoordinator = (summary: ResumeSummary): StartupResumeCoordinator =>
    ({ lastResumeSummary: summary }) as unknown as StartupResumeCoordinator;

  it('returns the coordinator resume summary', () => {
    const summary: ResumeSummary = {
      frozenFound: 5,
      resumed: 4,
      failed: 1,
      lastResumeAt: '2026-06-14T00:00:00.000Z',
    };
    const controller = new OperationsLifecycleController(
      buildCoordinator(summary),
    );

    expect(controller.getResumeSummary()).toEqual({
      success: true,
      data: summary,
    });
  });

  it('reports the empty summary when no resume has occurred', () => {
    const summary: ResumeSummary = {
      frozenFound: 0,
      resumed: 0,
      failed: 0,
      lastResumeAt: null,
    };
    const controller = new OperationsLifecycleController(
      buildCoordinator(summary),
    );

    const result = controller.getResumeSummary();

    expect(result.success).toBe(true);
    expect(result.data.lastResumeAt).toBeNull();
  });

  it('requires settings:read permission on the resume-summary route', () => {
    expect(
      Reflect.getMetadata(
        'required_permission',
        OperationsLifecycleController.prototype.getResumeSummary,
      ),
    ).toBe('settings:read');
  });
});
