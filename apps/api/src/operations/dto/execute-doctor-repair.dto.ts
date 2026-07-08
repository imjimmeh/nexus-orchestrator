import {
  doctorRepairActionIds,
  executeDoctorRepairSchema,
  type ExecuteDoctorRepairRequest,
} from '@nexus/core';

export class ExecuteDoctorRepairDto implements ExecuteDoctorRepairRequest {
  static get schema() {
    return executeDoctorRepairSchema;
  }

  action_id: (typeof doctorRepairActionIds)[number];

  dry_run: boolean = false;

  confirm: boolean = false;

  arguments: Record<string, unknown> = {};

  requested_by?: string;
}
