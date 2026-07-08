import { setJobOutputInputSchema } from '@nexus/core';
import { Capability } from '../../capability-infra/capability.decorator';

export class JobOutputCapabilityProvider {
  @Capability({
    name: 'set_job_output',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['context'],
    description:
      'Persist structured output data for the current job. The data becomes available to downstream jobs via template substitution at jobs.{jobId}.output. Multiple calls merge (last-write-wins per key). For output_contract jobs: Call set_job_output and wait for success before step_complete. The workflow runtime validates output_contract fields against this data after container exit.',
    inputSchema: setJobOutputInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/jobs/set-output',
      bodyMapping: {
        data: 'data',
      },
    },
  })
  setJobOutput() {
    return { ok: true };
  }
}
