import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const dir = 'G:/code/AI/nexus-orchestator/apps/api/src/project/work-items';
const files = readdirSync(dir).filter(f => f.endsWith('.ts'));
let totalChanges = 0;

for (const f of files) {
  const fp = join(dir, f);
  let content = readFileSync(fp, 'utf8');
  const original = content;

  // Category 2: ./<project-root-file> that isn't a work-item file
  // These reference files in project/ root, need ../ prefix
  const projectRootImports = [
    'git-merge.service',
    'project-git-metadata.service',
    'project-orchestration.helpers',
    'qa-decision-routing',
    'project.service',
    'project.service.types',
    'project-brief.service',
    'project-orchestration-runtime.service',
    'project-orchestration-action-execution.service',
    'project-orchestration-mutating-action.operations',
  ];
  for (const imp of projectRootImports) {
    const re = new RegExp(`from '\\./${imp}'`, 'g');
    content = content.replace(re, `from '../${imp}'`);
  }

  // Category 3: Subdirectory paths need ../ instead of ./
  content = content.replace(/from '\.\/dto\//g, "from '../dto/");
  content = content.replace(/from '\.\/events\//g, "from '../events/");
  content = content.replace(/from '\.\/work-item-dispatch\//g, "from '../work-item-dispatch/");
  content = content.replace(/from '\.\/goals\//g, "from '../goals/");

  // Category 4: ../<top-level-module>/ → ../../<top-level-module>/
  content = content.replace(/from '\.\.\/auth\//g, "from '../../auth/");
  content = content.replace(/from '\.\.\/common\//g, "from '../../common/");
  content = content.replace(/from '\.\.\/database\//g, "from '../../database/");
  content = content.replace(/from '\.\.\/observability\//g, "from '../../observability/");
  content = content.replace(/from '\.\.\/settings\//g, "from '../../settings/");
  content = content.replace(/from '\.\.\/workflow\//g, "from '../../workflow/");

  if (content !== original) {
    totalChanges++;
    writeFileSync(fp, content, 'utf8');
  }
}
console.log(`Updated ${totalChanges} files`);