import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const apiSrc = 'G:/code/AI/nexus-orchestator/apps/api/src';

// The submodule fixer incorrectly changed ../project-xxx to ../../core/project-xxx
// In orchestration/ and work-items/ (one level deep), it should be ../core/project-xxx
function fixDir(subDir) {
  const dirPath = join(apiSrc, subDir);
  const files = readdirSync(dirPath).filter(f => f.endsWith('.ts'));
  let totalFixes = 0;
  
  for (const f of files) {
    const fp = join(dirPath, f);
    let content = readFileSync(fp, 'utf8');
    const original = content;
    
    // Fix ../../core/ -> ../core/ (was over-corrected)
    content = content.replace(/from '\.\.\/\.\.\/core\//g, "from '../core/");
    
    if (content !== original) {
      totalFixes++;
      writeFileSync(fp, content, 'utf8');
      console.log(`Fixed ${subDir}/${f}`);
    }
  }
  return totalFixes;
}

let total = 0;
total += fixDir('project/orchestration');
total += fixDir('project/work-items');
total += fixDir('project/work-item-dispatch');

console.log(`\nTotal fixes: ${total}`);