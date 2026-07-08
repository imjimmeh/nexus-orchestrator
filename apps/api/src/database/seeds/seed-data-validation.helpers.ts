import {
  SeedValidationIssue,
  SeedValidationParams,
  SeedValidationReport,
} from './seed-data-validation.types';
import {
  addIssue,
  buildKnownToolNameSet,
  resolveSeedRoot,
  resolveSeedRoots,
  validateSeedRootDirectories,
} from './seed-data-validation.shared';
import {
  collectParsedAgents,
  validateSeedSkills,
  validateSkillToolAlignment,
} from './seed-data-validation.agent.helpers';
import { validateSeedContractGraph } from './seed-data-validation.contract-compiler.helpers';
import { collectWorkflowPromptContractMentions } from './seed-data-validation.prompt-contract-source.helpers';
import {
  collectParsedWorkflows,
  validateWorkflowCrossReferences,
  validateWorkflowTriggersAndEvents,
} from './seed-data-validation.workflow.helpers';

export async function validateSeedDataDeterministically(
  params: SeedValidationParams,
): Promise<SeedValidationReport> {
  const errors: SeedValidationIssue[] = [];
  const warnings: SeedValidationIssue[] = [];

  const seedRoot = resolveSeedRoot();
  const roots = resolveSeedRoots(seedRoot);
  validateSeedRootDirectories(roots, errors);

  if (errors.length > 0) {
    return {
      summary: {
        workflowCount: 0,
        agentCount: 0,
        skillCount: 0,
        errorCount: errors.length,
        warningCount: warnings.length,
      },
      errors,
      warnings,
    };
  }

  const knownToolNames = buildKnownToolNameSet(params);
  const modelNames = new Set(params.modelNames);
  const providerNames = new Set(params.providerNames);

  const skillNames = validateSeedSkills(roots.skillsRoot, errors);
  const parsedAgents = collectParsedAgents({
    agentsRoot: roots.agentsRoot,
    skillNames,
    knownToolNames,
    errors,
    warnings,
  });

  const parsedWorkflows = await collectParsedWorkflows({
    workflowsRoot: roots.workflowsRoot,
    knownToolNames,
    errors,
    warnings,
  });

  validateWorkflowCrossReferences({
    parsedWorkflows,
    parsedAgents,
    modelNames,
    providerNames,
    knownToolNames,
    errors,
    warnings,
  });

  validateWorkflowTriggersAndEvents({
    parsedWorkflows,
    warnings,
  });

  const promptMentionsByWorkflowJob = collectWorkflowPromptContractMentions({
    parsedWorkflows,
    workflowsRoot: roots.workflowsRoot,
  });
  const contractDiagnostics = validateSeedContractGraph({
    parsedWorkflows,
    promptMentionsByWorkflowJob,
    knownToolNames,
  });

  for (const diagnostic of contractDiagnostics) {
    addIssue(diagnostic.severity === 'error' ? errors : warnings, {
      code: diagnostic.code,
      filePath: diagnostic.filePath ?? seedRoot,
      workflowId: diagnostic.workflowId,
      message: diagnostic.message,
    });
  }

  validateSkillToolAlignment({
    parsedAgents,
    skillsRoot: roots.skillsRoot,
    errors,
  });

  return {
    summary: {
      workflowCount: parsedWorkflows.length,
      agentCount: parsedAgents.length,
      skillCount: skillNames.size,
      errorCount: errors.length,
      warningCount: warnings.length,
    },
    errors,
    warnings,
  };
}
