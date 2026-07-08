import { describe, it, expect, vi } from 'vitest';
import { JobOutputContractResolverService } from './job-output-contract-resolver.service';
import type {
  IWorkflowDefinitionRepository,
  IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';

function build(overrides?: {
  run?: unknown;
  workflow?: unknown;
  parsed?: unknown;
}) {
  const runRepo = { findById: vi.fn().mockResolvedValue(overrides?.run) };
  const workflowRepo = {
    findByIdentifier: vi.fn().mockResolvedValue(overrides?.workflow),
  };
  const parser = {
    parseWorkflow: vi.fn().mockReturnValue(overrides?.parsed),
  };
  const service = new JobOutputContractResolverService(
    runRepo as unknown as IWorkflowRunRepository,
    workflowRepo as unknown as IWorkflowDefinitionRepository,
    parser as never,
  );
  return { service, runRepo, workflowRepo, parser };
}

describe('JobOutputContractResolverService', () => {
  it('returns the output_contract for the named job', async () => {
    const contract = { required: ['x'], types: { x: 'array' } };
    const { service } = build({
      run: { workflow_id: 'wf-1' },
      workflow: { yaml_definition: 'yaml' },
      parsed: { jobs: [{ id: 'job-a', output_contract: contract }] },
    });
    await expect(service.resolveContract('run-1', 'job-a')).resolves.toEqual(
      contract,
    );
  });

  it('returns null when the run is missing', async () => {
    const { service } = build({ run: null });
    await expect(service.resolveContract('run-1', 'job-a')).resolves.toBeNull();
  });

  it('returns null when the job has no contract', async () => {
    const { service } = build({
      run: { workflow_id: 'wf-1' },
      workflow: { yaml_definition: 'yaml' },
      parsed: { jobs: [{ id: 'job-a' }] },
    });
    await expect(service.resolveContract('run-1', 'job-a')).resolves.toBeNull();
  });
});
