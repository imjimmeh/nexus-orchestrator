import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const root = 'G:/code/AI/nexus-orchestator/apps/api/src';

// 1. Fix files in project/ root that import ./work-item- or ./global-work-item or ./project-work-item
//    These need to become ./work-items/work-item-, ./work-items/global-work-item, etc.
const projectRootFiles = readdirSync(join(root, 'project')).filter(f => f.endsWith('.ts') && !f.startsWith('work-item-'));
let fixCount = 0;

for (const f of projectRootFiles) {
  const fp = join(root, 'project', f);
  let content = readFileSync(fp, 'utf8');
  const original = content;

  // Fix ./work-item-xxx -> ./work-items/work-item-xxx
  content = content.replace(/from '\.\/work-item-/g, "from './work-items/work-item-");
  // Fix ./work-item.xxx -> ./work-items/work-item.xxx  (but not ./work-item- which was handled above)
  content = content.replace(/from '\.\/work-item\./g, "from './work-items/work-item.");
  // Fix ./global-work-item.xxx -> ./work-items/global-work-item.xxx
  content = content.replace(/from '\.\/global-work-item-/g, "from './work-items/global-work-item-");
  content = content.replace(/from '\.\/global-work-item\./g, "from './work-items/global-work-item.");
  // Fix ./project-work-item.helpers -> ./work-items/project-work-item.helpers
  content = content.replace(/from '\.\/project-work-item\.helpers'/g, "from './work-items/project-work-item.helpers'");

  if (content !== original) {
    fixCount++;
    writeFileSync(fp, content, 'utf8');
    console.log(`Fixed project root file: ${f}`);
  }
}

// 2. Fix files outside project/ that import ../project/work-item-xxx
//    These need to become ../project/work-items/work-item-xxx
const externalDirs = ['workflow', 'telemetry', 'automation', 'operations', 'database', 'notifications'];
for (const dir of externalDirs) {
  const dirPath = join(root, dir);
  if (!dirPath) continue;
  try {
    const entries = readdirSync(dirPath, { recursive: true });
    const tsFiles = entries.filter(e => typeof e === 'string' && e.endsWith('.ts'));
    for (const f of tsFiles) {
      const fp = join(dirPath, String(f));
      let content = readFileSync(fp, 'utf8');
      const original = content;

      // Fix ../project/work-item-xxx -> ../project/work-items/work-item-xxx
      content = content.replace(/from '\.\.\/project\/work-item-/g, "from '../project/work-items/work-item-");
      // Fix ../project/work-item.xxx -> ../project/work-items/work-item.xxx
      content = content.replace(/from '\.\.\/project\/work-item\./g, "from '../project/work-items/work-item.");
      // Fix ../project/global-work-item -> ../project/work-items/global-work-item
      content = content.replace(/from '\.\.\/project\/global-work-item/g, "from '../project/work-items/global-work-item");
      // Fix ../../project/work-item-xxx (from subdirectories)
      content = content.replace(/from '\.\.\/\.\.\/project\/work-item-/g, "from '../../project/work-items/work-item-");
      content = content.replace(/from '\.\.\/\.\.\/project\/work-item\./g, "from '../../project/work-items/work-item.");
      content = content.replace(/from '\.\.\/\.\.\/project\/global-work-item/g, "from '../../project/work-items/global-work-item");

      if (content !== original) {
        fixCount++;
        writeFileSync(fp, content, 'utf8');
        console.log(`Fixed external file: ${dir}/${f}`);
      }
    }
  } catch (e) {
    // Directory might not exist, skip
  }
}

// 3. Fix work-item-dispatch files that import ../work-item-xxx
//    These were previously ../work-item in project/ root, now need ../../work-items/work-item-
const dispatchDir = join(root, 'project', 'work-item-dispatch');
const dispatchFiles = readdirSync(dispatchDir).filter(f => f.endsWith('.ts'));
for (const f of dispatchFiles) {
  const fp = join(dispatchDir, f);
  let content = readFileSync(fp, 'utf8');
  const original = content;

  // Fix imports that went to project root work-item files
  // ../work-item-xxx -> ../../work-items/work-item-xxx
  content = content.replace(/from '\.\.\/work-item-/g, "from '../../work-items/work-item-");
  // Fix ../work-item.xxx -> ../../work-items/work-item.xxx
  content = content.replace(/from '\.\.\/work-item\./g, "from '../../work-items/work-item.");

  if (content !== original) {
    fixCount++;
    writeFileSync(fp, content, 'utf8');
    console.log(`Fixed dispatch file: work-item-dispatch/${f}`);
  }
}

console.log(`\nTotal files fixed: ${fixCount}`);