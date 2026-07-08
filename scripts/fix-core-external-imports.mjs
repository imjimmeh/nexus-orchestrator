import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
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

// Dirs to scan (exclude project/core itself since we already fixed it, and project/orchestration, project/work-items, project/work-item-dispatch, project/goals since they have their own imports)
const dirsToScan = [
  'project', // root files only
  'workflow',
  'telemetry',
  'tool',
  'session',
  'database',
  'ai-config',
  'orchestration',
  'settings',
  'redis',
  'docker',
  'observability',
  'auth',
];

function processDir(dirPath) {
  if (!existsSync(dirPath)) return 0;
  let fixes = 0;
  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      // Skip submodule dirs inside project
      if (dirPath.includes('project') && ['core', 'orchestration', 'work-items', 'work-item-dispatch', 'goals', 'dto', 'events'].includes(entry.name)) {
        continue;
      }
      fixes += processDir(fullPath);
    } else if (entry.name.endsWith('.ts')) {
      let content = readFileSync(fullPath, 'utf8');
      const original = content;
      
      for (const coreFile of coreFileNames) {
        // From '../project/xxx' -> '../project/core/xxx' or '../../project/core/xxx' etc
        // Also handle './' if somehow referencing from same dir
        // Pattern 1: from '../project/xxx' (one level up)
        content = content.replace(new RegExp(`from '\\.\\./project/${coreFile}'`, 'g'), `from '../project/core/${coreFile}'`);
        // Pattern 2: from '../../project/xxx' (two levels up)
        content = content.replace(new RegExp(`from '\\.\\./\\.\\./project/${coreFile}'`, 'g'), `from '../../project/core/${coreFile}'`);
        // Pattern 3: from '../../../project/xxx'
        content = content.replace(new RegExp(`from '\\.\\./\\.\\./\\.\\./project/${coreFile}'`, 'g'), `from '../../../project/core/${coreFile}'`);
        // Pattern 4: from '../../../../project/xxx'
        content = content.replace(new RegExp(`from '\\.\\./\\.\\./\\.\\./\\.\\./project/${coreFile}'`, 'g'), `from '../../../../project/core/${coreFile}'`);
      }
      
      if (content !== original) {
        writeFileSync(fullPath, content, 'utf8');
        fixes++;
        console.log(`Fixed: ${fullPath.replace(apiSrc + '/', '')}`);
      }
    }
  }
  return fixes;
}

// Also scan project root files (not in subdirs) for references to core files via ./
const projectRoot = join(apiSrc, 'project');
const projectRootFiles = readdirSync(projectRoot).filter(f => f.endsWith('.ts'));
let rootFixes = 0;

for (const f of projectRootFiles) {
  const fp = join(projectRoot, f);
  const stat = statSync(fp);
  if (stat.isDirectory()) continue;
  
  let content = readFileSync(fp, 'utf8');
  const original = content;
  
  for (const coreFile of coreFileNames) {
    // From './xxx' -> './core/xxx' (references from project root to core files)
    content = content.replace(new RegExp(`from '\\./${coreFile}'`, 'g'), `from './core/${coreFile}'`);
  }
  
  if (content !== original) {
    writeFileSync(fp, content, 'utf8');
    rootFixes++;
    console.log(`Fixed project root: ${f}`);
  }
}

console.log(`Project root fixes: ${rootFixes}`);

// Scan external dirs
let externalFixes = 0;
for (const dir of dirsToScan) {
  if (dir === 'project') continue; // handled above
  externalFixes += processDir(join(apiSrc, dir));
}
console.log(`External fixes: ${externalFixes}`);