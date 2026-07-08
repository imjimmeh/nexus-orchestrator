import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const root = 'G:/code/AI/nexus-orchestator/apps/api/src';

// Fix 1: In work-item-dispatch/, change ../../work-items/ to ../work-items/
const dispatchDir = join(root, 'project', 'work-item-dispatch');
for (const f of readdirSync(dispatchDir).filter(f => f.endsWith('.ts'))) {
  const fp = join(dispatchDir, f);
  let content = readFileSync(fp, 'utf8');
  const original = content;
  content = content.replace(/from '\.\.\/\.\.\/work-items\//g, "from '../work-items/");
  if (content !== original) {
    writeFileSync(fp, content, 'utf8');
    console.log(`Fixed dispatch: ${f}`);
  }
}

// Fix 2: In project/ root, change ./work-items/work-item-dispatch/ to ./work-item-dispatch/
const projectDir = join(root, 'project');
for (const f of readdirSync(projectDir).filter(f => f.endsWith('.ts') && !f.startsWith('work-item'))) {
  const fp = join(projectDir, f);
  let content = readFileSync(fp, 'utf8');
  const original = content;
  content = content.replace(/from '\.\/work-items\/work-item-dispatch\//g, "from './work-item-dispatch/");
  if (content !== original) {
    writeFileSync(fp, content, 'utf8');
    console.log(`Fixed project root: ${f}`);
  }
}

console.log('Done');