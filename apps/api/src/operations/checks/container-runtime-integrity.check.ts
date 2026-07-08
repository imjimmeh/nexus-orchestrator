import { Injectable } from '@nestjs/common';
import type { DoctorCheck } from './doctor-check.types';
import {
  type DoctorCheckResult,
  type DoctorCheckStatus,
} from '../doctor.types';
import { RuntimeArtifactsInspectorService } from '../runtime-artifacts-inspector.service';
import type { RuntimeArtifactsInspection } from '../runtime-artifacts-inspector.types';

@Injectable()
export class ContainerRuntimeIntegrityCheckService implements DoctorCheck {
  readonly checkId = 'container_runtime_integrity_check';

  constructor(
    private readonly runtimeArtifactsInspector: RuntimeArtifactsInspectorService,
  ) {}

  async run(): Promise<DoctorCheckResult> {
    const inspection: RuntimeArtifactsInspection =
      await this.runtimeArtifactsInspector.inspect();

    const status = this.resolveStatus(inspection);
    const summary = this.buildSummary(inspection);

    const hasRecoverableArtifacts =
      inspection.orphaned_container_ids.length > 0 ||
      inspection.stale_container_ids.length > 0 ||
      inspection.stale_mount_directories.length > 0 ||
      inspection.stale_host_share_mounts.length > 0;

    return {
      check_id: this.checkId,
      status,
      evidence: {
        summary,
        details: {
          ...inspection,
        },
      },
      repair_action_id: hasRecoverableArtifacts
        ? 'prune_orphaned_runtime_artifacts'
        : undefined,
    };
  }

  private resolveStatus(
    inspection: RuntimeArtifactsInspection,
  ): DoctorCheckStatus {
    if (inspection.orphaned_container_ids.length > 0) {
      return 'fail';
    }

    if (
      inspection.stale_container_ids.length > 0 ||
      inspection.stale_mount_directories.length > 0 ||
      inspection.stale_host_share_mounts.length > 0
    ) {
      return 'warn';
    }

    return 'ok';
  }

  private buildSummary(inspection: RuntimeArtifactsInspection): string {
    if (inspection.orphaned_container_ids.length > 0) {
      return `Detected ${inspection.orphaned_container_ids.length.toString()} orphaned managed container(s).`;
    }

    if (
      inspection.stale_container_ids.length > 0 ||
      inspection.stale_mount_directories.length > 0 ||
      inspection.stale_host_share_mounts.length > 0
    ) {
      return `Detected ${inspection.stale_container_ids.length.toString()} stale container(s), ${inspection.stale_mount_directories.length.toString()} stale runtime mount directorie(s), and ${inspection.stale_host_share_mounts.length.toString()} stale host-share mount diagnostic(s).`;
    }

    return 'Container runtime integrity check passed.';
  }
}
