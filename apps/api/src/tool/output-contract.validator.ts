import { IJob } from '@nexus/core';
import type {
  CapabilityPreflightResult,
  CapabilityResolutionSnapshot,
} from './capability-preflight.types';

/**
 * Validator for job output contracts.
 * Ensures jobs with output_contract have the required set_job_output tool available.
 */
export class OutputContractValidator {
  validateOutputContract(
    job: IJob,
    callableSet: Set<string>,
    snapshot: CapabilityResolutionSnapshot,
  ): CapabilityPreflightResult | null {
    if (!job.output_contract) {
      return null;
    }
    const { required } = job.output_contract;
    if (!Array.isArray(required) || required.length === 0) {
      return {
        ...snapshot,
        ok: false,
        reasonCode: 'output_contract_invalid',
        failedTool: 'set_job_output',
        message: `output_contract.required must be a non-empty array of field names`,
        remediation:
          'Update job.output_contract.required to list the required output field names.',
      };
    }
    if (!callableSet.has('set_job_output')) {
      return {
        ...snapshot,
        ok: false,
        reasonCode: 'output_contract_tool_not_callable',
        failedTool: 'set_job_output',
        message: `Job declares output_contract but set_job_output is not callable in this execution context`,
        remediation:
          'Ensure set_job_output is available in the tool registry and is allowed by the job permissions.',
      };
    }
    return null;
  }
}
