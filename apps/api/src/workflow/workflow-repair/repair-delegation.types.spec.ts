import { describe, expect, it } from 'vitest';
import {
  REPAIR_DELEGATION_AUDIT_EVENT,
  REPAIR_DELEGATION_COMPLETED_EVENT,
  REPAIR_DELEGATION_DOCTOR_REQUESTED_EVENT,
  REPAIR_DELEGATION_STATE_KEY,
  REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT,
} from './repair-delegation.types';
import {
  WORKFLOW_REPAIR_DELEGATION_ENABLED_SETTING,
  WORKFLOW_REPAIR_DELEGATION_MAX_ATTEMPTS_SETTING,
} from '../../settings/repair-delegation-settings.constants';

describe('repair delegation contracts', () => {
  it('defines stable event and state names', () => {
    expect(REPAIR_DELEGATION_AUDIT_EVENT).toBe(
      'workflow.repair-delegation.decided',
    );
    expect(REPAIR_DELEGATION_DOCTOR_REQUESTED_EVENT).toBe(
      'workflow.repair-delegation.doctor.requested',
    );
    expect(REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT).toBe(
      'workflow.repair-delegation.sysadmin.requested',
    );
    expect(REPAIR_DELEGATION_COMPLETED_EVENT).toBe(
      'workflow.repair-delegation.completed',
    );
    expect(REPAIR_DELEGATION_STATE_KEY).toBe('_internal.repair_delegation');
  });

  it('defines stable system setting names', () => {
    expect(WORKFLOW_REPAIR_DELEGATION_ENABLED_SETTING).toBe(
      'workflow_repair_delegation_enabled',
    );
    expect(WORKFLOW_REPAIR_DELEGATION_MAX_ATTEMPTS_SETTING).toBe(
      'workflow_repair_delegation_max_attempts',
    );
  });
});
