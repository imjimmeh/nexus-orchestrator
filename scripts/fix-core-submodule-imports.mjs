import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const apiSrc = 'G:/code/AI/nexus-orchestator/apps/api/src';

// Core files that moved from project/ to project/core/
const coreFileNames = [
  'project.controller',
  'project.service',
  'project-brief.service',
  'project-brief.helpers',
  'project-completion-validator.service',
  'project-completion-validator.service.types',
  'project-import-readiness.service',
  'project-import-readiness.service.types',
  'project-import-validation',
  'project-import-validation.spec',
  'project-agents-file.service',
  'project-agents-file.service.types',
  'project-mount-policy.types',
  'project-state-query.service',
  'project-state-query.service.types',
  'project-state-summary.service',
  'project-git-metadata.service',
  'project-delete.helpers',
  'project-delete.query.helpers',
  'project-delete.war-room.helpers',
  'project-delete.agent-communication.helpers',
  'project-phase-detector.service',
  'project-phase-detector.service.types',
  'github-auth-secret.service',
  'github-auth-secret.service.types',
  'repository-acquisition.service',
  'repository-acquisition.service.types',
  'local-path-validation.service',
  'local-path-validation.service.types',
  'repo-discovery-hydration.service',
  'worktree-reconciler.service',
];

const subDirs = [
  'project/orchestration',
  'project/work-items',
  'project/work-item-dispatch',
  'project/goals',
];

let totalFixes = 0;

for (const subDir of subDirs) {
  const dirPath = join(apiSrc, subDir);
  const files = readdirSync(dirPath).filter(f => f.endsWith('.ts'));
  
  for (const f of files) {
    const fp = join(dirPath, f);
    let content = readFileSync(fp, 'utf8');
    const original = content;
    
    for (const coreFile of coreFileNames) {
      // Files in subdirs reference project root files as ../xxx
      // Now they need ../../core/xxx
      content = content.replace(new RegExp(`from '\\.\\./${coreFile}'`, 'g'), `from '../../core/${coreFile}'`);
    }
    
    if (content !== original) {
      totalFixes++;
      writeFileSync(fp, content, 'utf8');
      console.log(`Fixed ${subDir}/${f}`);
    }
  }
}

console.log(`\nTotal submodule fixes: ${totalFixes}`);