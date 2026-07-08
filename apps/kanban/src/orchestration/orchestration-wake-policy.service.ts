import { Injectable, Logger } from "@nestjs/common";
import { ProjectService } from "../project/project.service";
import { KanbanSettingsService } from "../settings/kanban-settings.service";
import {
  resolveWakePolicy,
  type WakePolicy,
} from "./orchestration-wake-policy";
import type { ProjectOrchestrationSettings } from "@nexus/kanban-contracts";

@Injectable()
export class OrchestrationWakePolicyService {
  private readonly logger = new Logger(OrchestrationWakePolicyService.name);

  constructor(
    private readonly projects: ProjectService,
    private readonly settings: KanbanSettingsService,
  ) {}

  async resolveForProject(projectId: string): Promise<WakePolicy> {
    try {
      const [projectSettings, globalValue] = await Promise.all([
        this.projects
          .getOrchestrationSettings(projectId)
          .catch((): ProjectOrchestrationSettings => ({})),
        this.settings.get<unknown>("orchestration_wake_policy"),
      ]);
      return resolveWakePolicy(projectSettings.wakePolicy, globalValue);
    } catch (error) {
      this.logger.warn(
        `resolveForProject failed for ${projectId}; failing open: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return resolveWakePolicy(undefined, undefined);
    }
  }
}
