import { Module } from '@nestjs/common';
import type { IInternalToolHandler } from '@nexus/core';
import { AutomationModule } from '../../automation/automation.module';
import { DatabaseModule } from '../../database/database.module';
import { MemoryModule } from '../../memory/memory.module';
import { INTERNAL_TOOL_HANDLER } from '../../tool/internal-tool.tokens';
import { InternalToolRegistryService } from '../../tool/internal-tool-registry.service';
import { AiConfigModule } from '../../ai-config/ai-config.module';
import { SkillValidationModule } from '../../ai-config/skills/skill-validation.module';
import { LearningModule } from '../../memory/learning/learning.module';
import { ImprovementModule } from '../../improvement/improvement.module';
import { WorkflowCoreModule } from '../workflow-core.module';
import { WorkflowKernelModule } from '../kernel/workflow-kernel.module';
import { WorkflowRunOperationsModule } from '../workflow-run-operations/workflow-run-operations.module';
import { SystemPromptAssemblyModule } from '../../system-prompt/system-prompt-assembly.module';
import { RememberWriteGuardService } from './handlers/remember-write-guard.service';
import { ScheduleToolsHandler } from './handlers/schedule-tools.handler';
import { TodoToolsHandler } from './handlers/todo-tools.handler';
import { WorkflowMetaToolsHandler } from './handlers/workflow-meta-tools.handler';
import { QueryMemoryHandler } from './handlers/query-memory.handler';
import { RecordLearningHandler } from './handlers/record-learning.handler';
import { RememberHandler } from './handlers/remember.handler';
import { RecordStrategicIntentHandler } from './handlers/record-strategic-intent.handler';
import { ReadStrategicIntentHandler } from './handlers/read-strategic-intent.handler';
import { ListPendingLearningCandidatesHandler } from './handlers/list-pending-learning-candidates.handler';
import { PromoteLearningCandidateHandler } from './handlers/promote-learning-candidate.handler';
import { RejectLearningCandidateHandler } from './handlers/reject-learning-candidate.handler';
import { CreateSkillProposalHandler } from './handlers/create-skill-proposal.handler';
import { QueryMemoryTool } from './tools/memory/query-memory.tool';
import { RecordLearningTool } from './tools/memory/record-learning.tool';
import { ListPendingLearningCandidatesTool } from './tools/memory/list-pending-learning-candidates.tool';
import { PromoteLearningCandidateTool } from './tools/memory/promote-learning-candidate.tool';
import { RejectLearningCandidateTool } from './tools/memory/reject-learning-candidate.tool';
import { CreateSkillProposalTool } from './tools/memory/create-skill-proposal.tool';
import { RecordStrategicIntentTool } from './tools/memory/record-strategic-intent.tool';
import { ReadStrategicIntentTool } from './tools/memory/read-strategic-intent.tool';
import { RememberTool } from './tools/memory/remember.tool';
import { CreateScheduledJobTool } from './tools/schedule/create-scheduled-job.tool';
import { DeleteScheduledJobTool } from './tools/schedule/delete-scheduled-job.tool';
import { GetScheduleTool } from './tools/schedule/get-schedule.tool';
import { ListScheduleRunsTool } from './tools/schedule/list-schedule-runs.tool';
import { ListSchedulesTool } from './tools/schedule/list-schedules.tool';
import { PauseScheduledJobTool } from './tools/schedule/pause-scheduled-job.tool';
import { ResumeScheduledJobTool } from './tools/schedule/resume-scheduled-job.tool';
import { RunScheduledJobNowTool } from './tools/schedule/run-scheduled-job-now.tool';
import { UpdateScheduledJobTool } from './tools/schedule/update-scheduled-job.tool';
import { CreateWorkflowDefinitionTool } from './tools/workflow/create-workflow-definition.tool';
import { DeleteWorkflowDefinitionTool } from './tools/workflow/delete-workflow-definition.tool';
import { GetWorkflowTool } from './tools/workflow/get-workflow.tool';
import { ListWorkflowsTool } from './tools/workflow/list-workflows.tool';
import { UpdateWorkflowDefinitionTool } from './tools/workflow/update-workflow-definition.tool';
import { SearchWorkflowsTool as SearchWorkflowsToolClass } from './tools/workflow/search-workflows.tool';
import { ReadWorkflowSummaryTool as ReadWorkflowSummaryToolClass } from './tools/workflow/read-workflow-summary.tool';
import { GetTodoListTool } from './tools/todo/get-todo-list.tool';
import { ManageTodoListTool } from './tools/todo/manage-todo-list.tool';
import { SearchSkillsTool } from './tools/skill/search-skills.tool';
import { ReadSkillManifestTool } from './tools/skill/read-skill-manifest.tool';
import { CreateSkillTool } from './tools/skill/create-skill.tool';
import { UpdateSkillTool } from './tools/skill/update-skill.tool';
import { SuggestSkillAssignmentTool } from './tools/skill/suggest-skill-assignment.tool';
import { SearchPlaybooksTool } from './tools/playbook/search-playbooks.tool';
import { ReadPlaybookTool } from './tools/playbook/read-playbook.tool';
import { FetchUrlTool } from '../../tool/handlers/fetch-url.tool';
import { WebFetchTool } from '../../tool/handlers/web-fetch.tool';
import { WebSearchTool } from '../../tool/handlers/web-search.tool';
import { ReadDocumentTool } from '../../tool/handlers/read-document.tool';
import { DocumentParserService } from '../../attachments/parsing/document-parser.service';
import { AnalyzeImageTool } from '../../tool/handlers/analyze-image.tool';
import { ImageDescriberService } from '../../attachments/parsing/image-describer.service';
import { ExtractFigmaTool } from '../../tool/handlers/extract-figma.tool';
import { CreateArtifactTool } from '../../tool/handlers/create-artifact.tool';
import { GetAttachmentTool } from '../../tool/handlers/get-attachment.tool';
import { ListAttachmentsTool } from '../../tool/handlers/list-attachments.tool';
import { AttachmentsModule } from '../../attachments/attachments.module';
import { SecurityModule } from '../../security/security.module';
import { SystemSettingsModule } from '../../settings/system-settings.module';
import { ToolPromptContributorBridge } from './tool-prompt-contributor.bridge';

@Module({
  imports: [
    AutomationModule,
    AiConfigModule,
    SkillValidationModule,
    DatabaseModule,
    MemoryModule,
    LearningModule,
    ImprovementModule,
    WorkflowCoreModule,
    WorkflowKernelModule,
    WorkflowRunOperationsModule,
    SystemPromptAssemblyModule,
    SecurityModule,
    SystemSettingsModule,
    AttachmentsModule,
  ],
  providers: [
    RememberWriteGuardService,
    ScheduleToolsHandler,
    TodoToolsHandler,
    WorkflowMetaToolsHandler,
    QueryMemoryHandler,
    RecordLearningHandler,
    RememberHandler,
    RecordStrategicIntentHandler,
    ReadStrategicIntentHandler,
    ListPendingLearningCandidatesHandler,
    PromoteLearningCandidateHandler,
    RejectLearningCandidateHandler,
    CreateSkillProposalHandler,
    QueryMemoryTool,
    RecordLearningTool,
    ListPendingLearningCandidatesTool,
    PromoteLearningCandidateTool,
    RejectLearningCandidateTool,
    CreateSkillProposalTool,
    RecordStrategicIntentTool,
    ReadStrategicIntentTool,
    RememberTool,
    GetTodoListTool,
    ManageTodoListTool,
    ListWorkflowsTool,
    GetWorkflowTool,
    CreateWorkflowDefinitionTool,
    UpdateWorkflowDefinitionTool,
    DeleteWorkflowDefinitionTool,
    SearchWorkflowsToolClass,
    ReadWorkflowSummaryToolClass,
    ListSchedulesTool,
    GetScheduleTool,
    CreateScheduledJobTool,
    UpdateScheduledJobTool,
    PauseScheduledJobTool,
    ResumeScheduledJobTool,
    RunScheduledJobNowTool,
    DeleteScheduledJobTool,
    ListScheduleRunsTool,
    SearchSkillsTool,
    ReadSkillManifestTool,
    CreateSkillTool,
    UpdateSkillTool,
    SuggestSkillAssignmentTool,
    SearchPlaybooksTool,
    ReadPlaybookTool,
    DocumentParserService,
    ImageDescriberService,
    FetchUrlTool,
    WebFetchTool,
    WebSearchTool,
    ReadDocumentTool,
    AnalyzeImageTool,
    ExtractFigmaTool,
    CreateArtifactTool,
    GetAttachmentTool,
    ListAttachmentsTool,
    ToolPromptContributorBridge,
    InternalToolRegistryService,
    {
      provide: INTERNAL_TOOL_HANDLER,
      useFactory: (...handlers: IInternalToolHandler[]) => handlers,
      inject: [
        QueryMemoryTool,
        RecordLearningTool,
        ListPendingLearningCandidatesTool,
        PromoteLearningCandidateTool,
        RejectLearningCandidateTool,
        CreateSkillProposalTool,
        RecordStrategicIntentTool,
        ReadStrategicIntentTool,
        RememberTool,
        ListWorkflowsTool,
        GetWorkflowTool,
        CreateWorkflowDefinitionTool,
        UpdateWorkflowDefinitionTool,
        DeleteWorkflowDefinitionTool,
        SearchWorkflowsToolClass,
        ReadWorkflowSummaryToolClass,
        ListSchedulesTool,
        GetScheduleTool,
        CreateScheduledJobTool,
        GetTodoListTool,
        ManageTodoListTool,
        UpdateScheduledJobTool,
        PauseScheduledJobTool,
        ResumeScheduledJobTool,
        RunScheduledJobNowTool,
        DeleteScheduledJobTool,
        ListScheduleRunsTool,
        SearchSkillsTool,
        ReadSkillManifestTool,
        CreateSkillTool,
        UpdateSkillTool,
        SuggestSkillAssignmentTool,
        SearchPlaybooksTool,
        ReadPlaybookTool,
        FetchUrlTool,
        WebFetchTool,
        WebSearchTool,
        ReadDocumentTool,
        AnalyzeImageTool,
        ExtractFigmaTool,
        CreateArtifactTool,
        GetAttachmentTool,
        ListAttachmentsTool,
      ],
    },
  ],
  exports: [INTERNAL_TOOL_HANDLER, InternalToolRegistryService],
})
export class WorkflowInternalToolsModule {}
