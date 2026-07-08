import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import { ProjectService } from "./project.service";
import { CharterDocRenderService } from "./charter-doc-render.service";
import {
  CHARTER_REGEN_QUEUE,
  type CharterRegenJob,
} from "./charter-regen.queue";

const CHARTER_PATH = "docs/project-context/CHARTER.md";
const CHARTER_COMMIT_MESSAGE = "docs(charter): regenerate from project intent";

@Processor(CHARTER_REGEN_QUEUE)
export class CharterRegenProcessor extends WorkerHost {
  private readonly logger = new Logger(CharterRegenProcessor.name);
  constructor(
    private readonly render: CharterDocRenderService,
    private readonly projects: ProjectService,
    private readonly core: CoreWorkflowClientService,
  ) {
    super();
  }

  async process(job: Job<CharterRegenJob>): Promise<void> {
    const { projectId } = job.data;
    const project = await this.projects.get(projectId).catch(() => null);
    if (!project?.basePath) {
      this.logger.warn(`charter-regen skipped: no basePath for ${projectId}`);
      return;
    }

    try {
      const content = await this.render.render(projectId);
      await this.core.writeRepoFile({
        repoPath: project.basePath,
        filePath: CHARTER_PATH,
        content,
        message: CHARTER_COMMIT_MESSAGE,
        push: true,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`charter-regen failed for ${projectId}: ${reason}`);
      throw error instanceof Error ? error : new Error(reason);
    }
  }
}
