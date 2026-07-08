import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const root = 'G:/code/AI/nexus-orchestator/apps/api/src/project/core';
const coreFiles = readdirSync(root).filter(f => f.endsWith('.ts'));

// Files that stayed in project/ root (NOT in core/)
const projectRootFiles = new Set([
  'project.module.ts',
  'amend-entity.controller.ts',
  'amend-entity.controller.spec.ts',
  'amend-entity.service.ts',
  'amend-entity.service.spec.ts',
  'amend-entity.service.types.ts',
  'amend-entity.service.helpers.ts',
  'amend-entity.service.subtask-execution.helpers.ts',
  'amend-entity.service.subtask-execution.helpers.spec.ts',
  'amend-entity.service.execution.helpers.ts',
  'amend-entity-special-step.helpers.ts',
  'amend-entity.service.helper-utils.ts',
  'git-merge.service.ts',
  'git-merge.service.spec.ts',
  'git-merge.service.types.ts',
  'learning-memory.service.ts',
  'learning-memory.service.spec.ts',
  'learning-memory.collector.ts',
  'learning-memory.consumer.ts',
  'learning-memory.config.ts',
  'learning-memory.constants.ts',
  'learning-memory.helpers.ts',
  'learning-memory.helpers.spec.ts',
  'learning-memory.polling.service.ts',
  'learning-memory.scope.ts',
  'learning-memory.sweep.ts',
  'learning-memory.types.ts',
  'learning-memory.view.ts',
  'memory-learning.controller.ts',
  'memory-learning.controller.spec.ts',
  'project-memory.controller.ts',
  'project-memory.controller.spec.ts',
  'project-retrospective.service.ts',
  'project-retrospective.service.spec.ts',
  'project-retrospective.helpers.ts',
  'project-retrospective.helpers.spec.ts',
  'project-retrospective.types.ts',
  'project-retrospective-checkpoint.helpers.ts',
  'project-retrospective-context.helpers.ts',
  'project-retrospective-execution.helpers.ts',
  'project-retrospective-internal.helpers.ts',
  'project-retrospective-lifecycle.helpers.ts',
  'project-retrospective-policy.helpers.ts',
  'project-steering.service.ts',
  'project-steering.service.spec.ts',
  'project-steering.service.types.ts',
  'project-steering.integration.spec.ts',
  'steer-project.controller.ts',
  'steer-project.controller.spec.ts',
  'steer-project.service.ts',
  'steer-project.service.spec.ts',
  'steer-project.service.types.ts',
  'steering.controller.ts',
  'steering.controller.spec.ts',
  'project-war-room.controller.ts',
  'project-war-room.controller.spec.ts',
  'project-war-room.service.ts',
  'project-war-room.service.spec.ts',
  'skill-improvement-proposals.controller.ts',
  'skill-improvement-proposals.controller.spec.ts',
  'skill-improvement-proposal.service.ts',
  'skill-improvement-proposal.service.spec.ts',
  'qa-decision-routing.ts',
]);

// Files in orchestration/ submodule
const orchestrationFiles = new Set([
  'project-orchestration.service.ts',
  'project-orchestration.service.spec.ts',
  'project-orchestration.service.types.ts',
  'project-orchestration.controller.ts',
  'project-orchestration.controller.spec.ts',
  'project-orchestration.helpers.ts',
  'orchestration-session-state.types.ts',
  'orchestration-session-state.service.ts',
  'orchestration-session-state.service.spec.ts',
  'orchestration-session-state.helpers.ts',
  'orchestration-session-state.helpers.spec.ts',
  'project-orchestration-import.service.ts',
  'project-orchestration-import.service.spec.ts',
  'project-orchestration-mode-policy.service.ts',
  'project-orchestration-mode-policy.service.spec.ts',
  'project-orchestration-mode-policy.service.types.ts',
  'project-orchestration-validation.service.ts',
  'project-orchestration-state.service.ts',
  'project-orchestration-observability.service.ts',
  'project-orchestration-observability.service.spec.ts',
  'project-orchestration-events.service.ts',
  'project-orchestration-events.helpers.ts',
  'project-orchestration-decision-log.service.ts',
  'project-orchestration-goals.helpers.ts',
  'project-orchestration-settings.helpers.ts',
  'project-orchestration-action-execution.service.ts',
  'project-orchestration-action-operations.dependencies.ts',
  'project-orchestration-action-request-approval.operations.ts',
  'project-orchestration-blueprint-input.ts',
  'project-orchestration-dispatch.service.ts',
  'project-orchestration-dispatch.execution.ts',
  'project-orchestration-dispatch.execution.spec.ts',
  'project-orchestration-dispatch.shared.ts',
  'project-orchestration-dispatch.types.ts',
  'project-orchestration-lifecycle.operations.ts',
  'project-orchestration-lifecycle.operations.spec.ts',
  'project-orchestration-lifecycle.operations.types.ts',
  'project-orchestration-mutating-action.execution.ts',
  'project-orchestration-mutating-action.operations.ts',
  'project-orchestration-runtime.service.ts',
  'project-orchestration-workflow-invocation.service.ts',
  'project-orchestration-workflow-invocation.service.spec.ts',
  'project-orchestration-workflow-invocation.helpers.ts',
  'project-orchestration-workflow-auto-restart.operations.ts',
  'project-orchestration-workflow-self-heal.operations.ts',
  'project-orchestration-workflow-status.service.ts',
  'project-orchestration-workflow-status.operations.ts',
  'project-orchestration-workflow-status.operations.types.ts',
  'project-orchestration-diagnostics.controller.ts',
  'project-orchestration-diagnostics.controller.spec.ts',
  'orchestration-action-requests.controller.ts',
  'orchestration-action-requests.controller.spec.ts',
  'orchestration-delegation-completion.listener.ts',
  'orchestration-delegation-completion.listener.spec.ts',
]);

let totalFixes = 0;

for (const f of coreFiles) {
  const fp = join(root, f);
  let content = readFileSync(fp, 'utf8');
  const original = content;

  // Fix: imports that reference project-root files using ./ need ../ prefix
  // Pattern: from './project-xxx' where project-xxx is in projectRootFiles
  for (const rootFile of projectRootFiles) {
    const baseName = rootFile.replace(/\.ts$/, '');
    const regex = new RegExp(`from '\\./${baseName}'`, 'g');
    content = content.replace(regex, `from '../${baseName}'`);
  }

  // Fix: imports from ./project-orchestration-xxx or ./orchestration-xxx need ../orchestration/
  for (const orchFile of orchestrationFiles) {
    const baseName = orchFile.replace(/\.ts$/, '');
    const regex = new RegExp(`from '\\./${baseName}'`, 'g');
    content = content.replace(regex, `from '../orchestration/${baseName}'`);
  }

  // Fix: imports from ./dto/xxx -> ../dto/xxx
  content = content.replace(/from '\.\/dto\//g, "from '../dto/");

  // Fix: imports from ./events/xxx -> ../events/ (unlikely in core but check)
  content = content.replace(/from '\.\/events\//g, "from '../events/");

  // Fix: imports from ./goals/xxx -> ../goals/
  content = content.replace(/from '\.\/goals\//g, "from '../goals/");

  // Fix: imports from ./work-items/xxx -> ../work-items/
  content = content.replace(/from '\.\/work-items\//g, "from '../work-items/");

  // Fix: imports from ./work-item-dispatch/xxx -> ../work-item-dispatch/
  content = content.replace(/from '\.\/work-item-dispatch\//g, "from '../work-item-dispatch/");

  if (content !== original) {
    totalFixes++;
    writeFileSync(fp, content, 'utf8');
    console.log(`Fixed core: ${f}`);
  }
}

console.log(`\nTotal core fixes: ${totalFixes}`);