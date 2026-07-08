import {
  doctorRepairHistoryStatuses,
  listDoctorHistorySchema,
  type ListDoctorHistoryRequest,
} from '@nexus/core';

export class ListDoctorHistoryDto implements ListDoctorHistoryRequest {
  static get schema() {
    return listDoctorHistorySchema;
  }

  limit: number = 20;

  offset: number = 0;

  action_id?: string;

  status?: (typeof doctorRepairHistoryStatuses)[number];
}
