import { Injectable } from '@nestjs/common';
import type { DoctorRepairHistoryStatus } from '../runtime/database/entities/doctor-repair-history.entity.types';
import { DoctorRepairHistoryRepository } from '../runtime/database/repositories/doctor-repair-history.repository';
import type { DoctorRepairHistoryPage } from './doctor.types';

@Injectable()
export class DoctorHistoryService {
  constructor(
    private readonly historyRepository: DoctorRepairHistoryRepository,
  ) {}

  async listHistory(params: {
    limit: number;
    offset: number;
    action_id?: string;
    status?: DoctorRepairHistoryStatus;
  }): Promise<DoctorRepairHistoryPage> {
    const { data, total } = await this.historyRepository.findPaged(params);

    return {
      items: data.map((item) => ({
        id: item.id,
        action_id: item.action_id,
        status: item.status,
        dry_run: item.dry_run,
        requested_by: item.requested_by ?? null,
        input_json: item.input_json ?? null,
        result_json: item.result_json ?? null,
        evidence_json: item.evidence_json ?? null,
        error_message: item.error_message ?? null,
        started_at: item.started_at.toISOString(),
        finished_at: item.finished_at ? item.finished_at.toISOString() : null,
        created_at: item.created_at.toISOString(),
      })),
      total,
      limit: params.limit,
      offset: params.offset,
    };
  }
}
