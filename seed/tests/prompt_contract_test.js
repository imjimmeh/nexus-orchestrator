/**
 * Prompt Contract Test
 * 
 * Validates that workflow prompts do not reference tools that are not permitted
 * in the job's allow_tools list. This ensures prompt/tool permission consistency.
 * 
 * Usage:
 *   node seed/tests/prompt_contract_test.js [--verbose]
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const verbose = process.argv.includes('--verbose');

/**
 * Extract tool names mentioned in prompt examples.
 * Looks for:
 * - spawn_subagent_async examples with `tools:` field
 * - Tool call patterns like `open_war_room`, `close_war_room`, etc.
 * - set_job_output examples (for shape validation)
 */
function extractToolsFromPrompt(promptText) {
  const tools = new Set();
  
  // Pattern for spawn_subagent_async tool examples
  // Looks for lines like: tools: ["read", "write", "step_complete"]
  const spawnToolsPattern = /tools:\s*\[([^\]]+)\]/g;
  let match;
  while ((match = spawnToolsPattern.exec(promptText)) !== null) {
    const toolsStr = match[1];
    // Extract quoted tool names
    const quotedTools = toolsStr.match(/"([^"]+)"/g) || [];
    quotedTools.forEach(t => tools.add(t.replace(/"/g, '')));
  }
  
  // Pattern for tool call examples (backtick-wrapped tool names)
  // Looks for `tool_name` patterns
  const toolCallPattern = /`(\w+)`/g;
  while ((match = toolCallPattern.exec(promptText)) !== null) {
    const toolName = match[1];
    // Common orchestration tools that should be tracked
    const knownTools = [
      'open_war_room', 'close_war_room', 'update_war_room_blackboard',
      'spawn_subagent_async', 'wait_for_subagents', 'check_subagent_status',
      'set_job_output', 'step_complete', 'submit_war_room_signoff',
      'get_war_room_state', 'post_war_room_message', 'invite_war_room_participant',
      'read', 'write', 'edit', 'bash', 'query_memory'
    ];
    if (knownTools.includes(toolName)) {
      tools.add(toolName);
    }
  }
  
  // Pattern for tool references in prompt text (not in code blocks)
  // e.g., "Call open_war_room with" or "invoke spawn_subagent_async"
  const promptToolPattern = /(?:call|invoke|use)\s+(\w+(?:_\w+)*)/gi;
  while ((match = promptToolPattern.exec(promptText)) !== null) {
    const toolName = match[1];
    const knownTools = [
      'open_war_room', 'close_war_room', 'update_war_room_blackboard',
      'spawn_subagent_async', 'wait_for_subagents', 'check_subagent_status',
      'set_job_output', 'step_complete', 'submit_war_room_signoff',
      'get_war_room_state', 'post_war_room_message', 'invite_war_room_participant',
      'read', 'write', 'edit', 'bash', 'query_memory', 'kanban.project_state',
      'kanban.orchestration_timeline', 'kanban.write_probe_result', 'ls', 'find', 'grep'
    ];
    if (knownTools.includes(toolName)) {
      tools.add(toolName);
    }
  }
  
  return tools;
}

/**
 * Extract tools from prompt blocks, including markdown code blocks.
 */
function extractToolsFromPromptBlock(promptText) {
  const tools = new Set();
  
  // Extract from code blocks
  const codeBlockPattern = /```[\s\S]*?```/g;
  const codeBlocks = promptText.match(codeBlockPattern) || [];
  for (const block of codeBlocks) {
    const blockTools = extractToolsFromPrompt(block);
    blockTools.forEach(t => tools.add(t));
  }
  
  // Also extract from non-code sections
  const nonCodeTools = extractToolsFromPrompt(promptText);
  nonCodeTools.forEach(t => tools.add(t));
  
  return tools;
}

/**
 * Get tools mentioned in prompts for each job in a workflow.
 */
function getWorkflowToolsFromPrompts(workflowPath) {
  const jobTools = {};
  
  try {
    const content = fs.readFileSync(workflowPath, 'utf-8');
    const data = yaml.load(content);
    if (!data) return jobTools;
    
    const jobs = data.jobs || [];
    
    for (const job of jobs) {
      const jobId = job.id || 'unknown';
      const steps = job.steps || [];
      
      for (const step of steps) {
        // Check prompt directly in the step
        if (step.prompt) {
          const tools = extractToolsFromPromptBlock(String(step.prompt));
          if (tools.size > 0) {
            if (!jobTools[jobId]) jobTools[jobId] = new Set();
            tools.forEach(t => jobTools[jobId].add(t));
          }
        }
        
        // Check prompt_file reference
        if (step.prompt_file) {
          const promptPath = path.join(path.dirname(workflowPath), step.prompt_file);
          if (fs.existsSync(promptPath)) {
            const promptContent = fs.readFileSync(promptPath, 'utf-8');
            const tools = extractToolsFromPromptBlock(promptContent);
            if (tools.size > 0) {
              if (!jobTools[jobId]) jobTools[jobId] = new Set();
              tools.forEach(t => jobTools[jobId].add(t));
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error processing ${workflowPath}: ${error.message}`);
  }
  
  return jobTools;
}

/**
 * Extract allow_tools from each job definition.
 */
function getJobPermissions(workflowPath) {
  const jobPermissions = {};
  
  try {
    const content = fs.readFileSync(workflowPath, 'utf-8');
    const data = yaml.load(content);
    if (!data) return jobPermissions;
    
    const jobs = data.jobs || [];
    
    for (const job of jobs) {
      const jobId = job.id || 'unknown';
      const permissions = job.permissions || {};
      const allowTools = permissions.allow_tools || [];
      
      if (Array.isArray(allowTools)) {
        jobPermissions[jobId] = new Set(allowTools);
      } else {
        jobPermissions[jobId] = new Set();
      }
    }
  } catch (error) {
    console.error(`Error extracting permissions from ${workflowPath}: ${error.message}`);
  }
  
  return jobPermissions;
}

/**
 * Check that tools mentioned in prompts are allowed in job permissions.
 */
function checkWorkflowPermissions(workflowPath, verbose = false) {
  const violations = [];
  
  // Get tools from prompts
  const jobPromptTools = getWorkflowToolsFromPrompts(workflowPath);
  
  // Get job permissions
  const jobPermissions = getJobPermissions(workflowPath);
  
  for (const [jobId, mentionedTools] of Object.entries(jobPromptTools)) {
    const allowedTools = jobPermissions[jobId] || new Set();
    
    for (const tool of mentionedTools) {
      if (!allowedTools.has(tool)) {
        violations.push({ jobId, tool, reason: 'not_in_allow_tools' });
        if (verbose) {
          console.log(`  VIOLATION: Job '${jobId}' uses tool '${tool}' in prompt but not in allow_tools`);
        }
      }
    }
  }
  
  return violations;
}

/**
 * Check for spawn_subagent_async examples that include a 'tier' field.
 */
function findSpawnSubagentAsyncWithTier(workflowPath) {
  const violations = [];
  
  try {
    const content = fs.readFileSync(workflowPath, 'utf-8');
    const data = yaml.load(content);
    if (!data) return violations;
    
    const jobs = data.jobs || [];
    
    for (const job of jobs) {
      const jobId = job.id || 'unknown';
      const steps = job.steps || [];
      
      for (const step of steps) {
        let promptText = step.prompt || '';
        const promptFile = step.prompt_file;
        
        if (promptFile) {
          const promptPath = path.join(path.dirname(workflowPath), promptFile);
          if (fs.existsSync(promptPath)) {
            promptText = fs.readFileSync(promptPath, 'utf-8');
          }
        }
        
        if (promptText) {
          // Check for spawn_subagent_async with tier field
          // Look for patterns in code blocks that mention spawn_subagent_async
          const codeBlockPattern = /```[\s\S]*?```/g;
          const codeBlocks = promptText.match(codeBlockPattern) || [];
          
          for (const block of codeBlocks) {
            if (block.includes('spawn_subagent_async') && block.includes('tier')) {
              const lineNum = promptText.substring(0, promptText.indexOf(block)).split('\n').length;
              violations.push({ jobId, detail: 'tier_in_spawn_subagent_async', line: lineNum });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error checking spawn_subagent_async tier in ${workflowPath}: ${error.message}`);
  }
  
  return violations;
}

/**
 * Main function
 */
function main() {
  const seedDir = path.join(__dirname, '..');
  const workflowsDir = path.join(seedDir, 'workflows');
  
  const allViolations = [];
  const tierViolations = [];
  
  // Find all workflow files
  const workflowFiles = fs.readdirSync(workflowsDir)
    .filter(f => f.endsWith('.workflow.yaml'))
    .map(f => path.join(workflowsDir, f));
  
  console.log(`Checking ${workflowFiles.length} workflow files...`);
  console.log();
  
  for (const workflowFile of workflowFiles.sort()) {
    const workflowName = path.basename(workflowFile);
    if (verbose) {
      console.log(`Checking: ${workflowName}`);
    }
    
    // Check tool permission consistency
    const violations = checkWorkflowPermissions(workflowFile, verbose);
    allViolations.push(
      ...violations.map(v => ({
        workflow: workflowName,
        jobId: v.jobId,
        tool: v.tool,
        reason: v.reason
      }))
    );
    
    // Check for tier field in spawn_subagent_async
    const tierViols = findSpawnSubagentAsyncWithTier(workflowFile);
    tierViolations.push(
      ...tierViols.map(v => ({
        workflow: workflowName,
        jobId: v.jobId,
        detail: v.detail,
        line: v.line
      }))
    );
  }
  
  // Report results
  let hasViolations = false;
  
  if (allViolations.length > 0) {
    hasViolations = true;
    console.log('='.repeat(70));
    console.log('TOOL PERMISSION MISMATCHES FOUND');
    console.log('='.repeat(70));
    for (const v of allViolations.sort((a, b) => {
      if (a.workflow !== b.workflow) return a.workflow.localeCompare(b.workflow);
      return a.jobId.localeCompare(b.jobId);
    })) {
      console.log(`  [${v.workflow}] Job '${v.jobId}' uses '${v.tool}' without permission`);
    }
    console.log();
  }
  
  if (tierViolations.length > 0) {
    hasViolations = true;
    console.log('='.repeat(70));
    console.log('SPAWN_SUBAGENT_ASYNC WITH TIER FIELD FOUND');
    console.log('='.repeat(70));
    for (const v of tierViolations.sort((a, b) => {
      if (a.workflow !== b.workflow) return a.workflow.localeCompare(b.workflow);
      return a.jobId.localeCompare(b.jobId);
    })) {
      console.log(`  [${v.workflow}] Job '${v.jobId}' has spawn_subagent_async with tier (line ~${v.line})`);
    }
    console.log();
  }
  
  if (hasViolations) {
    console.log('FAIL: Workflow prompts reference tools without corresponding permissions');
    console.log(`Total violations: ${allViolations.length} tool mismatches, ${tierViolations.length} tier issues`);
    process.exit(1);
  } else {
    console.log('PASS: All workflow prompts are consistent with their tool permissions');
    process.exit(0);
  }
}

main();