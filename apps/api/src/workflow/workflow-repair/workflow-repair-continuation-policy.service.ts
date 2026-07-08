import { Injectable } from '@nestjs/common';

@Injectable()
export class WorkflowRepairContinuationPolicyService {
  resolveFailureDoctorWorkflowIdentifier(): string {
    return 'workflow_failure_doctor';
  }

  resolveFailureDoctorOutputJobId(): string {
    return 'diagnose_failure';
  }
}
