import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const apiSrc = 'G:/code/AI/nexus-orchestator/apps/api/src';
const coreDir = join(apiSrc, 'project', 'core');
const coreFiles = readdirSync(coreDir).filter(f => f.endsWith('.ts'));

let totalFixes = 0;

for (const f of coreFiles) {
  const fp = join(coreDir, f);
  let content = readFileSync(fp, 'utf8');
  const original = content;

  // Fix: ../database/ -> ../../database/
  content = content.replace(/from '\.\.\/database\//g, "from '../../database/");
  // Fix: ../workflow/ -> ../../workflow/
  content = content.replace(/from '\.\.\/workflow\//g, "from '../../workflow/");
  // Fix: ../ai-config/ -> ../../ai-config/
  content = content.replace(/from '\.\.\/ai-config\//g, "from '../../ai-config/");
  // Fix: ../common/ -> ../../common/
  content = content.replace(/from '\.\.\/common\//g, "from '../../common/");
  // Fix: ../settings/ -> ../../settings/
  content = content.replace(/from '\.\.\/settings\//g, "from '../../settings/");
  // Fix: ../auth/ -> ../../auth/
  content = content.replace(/from '\.\.\/auth\//g, "from '../../auth/");
  // Fix: ../observability/ -> ../../observability/
  content = content.replace(/from '\.\.\/observability\//g, "from '../../observability/");
  // Fix: ../automation/ -> ../../automation/
  content = content.replace(/from '\.\.\/automation\//g, "from '../../automation/");
  // Fix: ./orchestration/ -> ../orchestration/
  content = content.replace(/from '\.\/orchestration\//g, "from '../orchestration/");

  if (content !== original) {
    totalFixes++;
    writeFileSync(fp, content, 'utf8');
    console.log(`Fixed core: ${f}`);
  }
}

// Also fix dto/update-project-mount-policy.dto.ts -> ../core/project-mount-policy.types
const dtoFile = join(apiSrc, 'project', 'dto', 'update-project-mount-policy.dto.ts');
let dtoContent = readFileSync(dtoFile, 'utf8');
const dtoOriginal = dtoContent;
dtoContent = dtoContent.replace(/from '\.\.\/project-mount-policy\.types'/g, "from '../core/project-mount-policy.types'");
if (dtoContent !== dtoOriginal) {
  writeFileSync(dtoFile, dtoContent, 'utf8');
  console.log('Fixed: dto/update-project-mount-policy.dto.ts');
}

console.log(`\nTotal fixes: ${totalFixes}`);