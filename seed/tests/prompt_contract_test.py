#!/usr/bin/env python3
"""
Prompt Contract Test

Validates that workflow prompts do not reference tools that are not permitted
in the job's allow_tools list. This ensures prompt/tool permission consistency.

Usage:
    python seed/tests/prompt_contract_test.py [--verbose] [--fix]
    python -m pytest seed/tests/prompt_contract_test.py -v
"""

import re
import sys
from pathlib import Path
from typing import Dict, List, Set, Tuple

import yaml


def extract_tools_from_prompt(prompt_text: str) -> Set[str]:
    """
    Extract tool names mentioned in prompt examples.
    
    Looks for:
    - spawn_subagent_async examples with `tools:` field
    - set_job_output examples
    - Other tool call examples
    
    Returns a set of tool names.
    """
    tools = set()
    
    # Pattern for spawn_subagent_async tool examples
    # Looks for lines like: tools: ["read", "write", "step_complete"]
    spawn_tools_pattern = r'tools:\s*\[([^\]]+)\]'
    for match in re.finditer(spawn_tools_pattern, prompt_text):
        tools_str = match.group(1)
        # Extract quoted tool names
        quoted_tools = re.findall(r'"([^"]+)"', tools_str)
        tools.update(quoted_tools)
    
    # Pattern for set_job_output examples
    # Looks for JSON-like patterns that indicate tool call structure
    set_output_pattern = r'set_job_output\s*\(\s*\{([^}]+)\}\s*\)'
    for match in re.finditer(set_output_pattern, prompt_text, re.DOTALL):
        # set_job_output takes a direct object, not a wrapped one
        pass  # No tools to extract from set_job_output itself
    
    # Pattern for other tool call examples (e.g., open_war_room, close_war_room, etc.)
    # Looks for tool names followed by colon or used as function calls
    tool_call_pattern = r'`(\w+)`'
    for match in re.finditer(tool_call_pattern, prompt_text):
        tool_name = match.group(1)
        # Common orchestration tools that should be tracked
        if tool_name in [
            'open_war_room', 'close_war_room', 'update_war_room_blackboard',
            'spawn_subagent_async', 'wait_for_subagents', 'check_subagent_status',
            'set_job_output', 'step_complete', 'submit_war_room_signoff',
            'get_war_room_state', 'post_war_room_message', 'invite_war_room_participant'
        ]:
            tools.add(tool_name)
    
    return tools


def extract_tools_from_prompt_block(prompt_text: str) -> Set[str]:
    """
    Extract tools from prompt blocks, including markdown code blocks.
    """
    tools = set()
    
    # Extract from code blocks
    code_blocks = re.findall(r'```[\s\S]*?```', prompt_text)
    for block in code_blocks:
        block_tools = extract_tools_from_prompt(block)
        tools.update(block_tools)
    
    # Also extract from non-code sections that reference tools
    non_code_tools = extract_tools_from_prompt(prompt_text)
    tools.update(non_code_tools)
    
    return tools


def get_workflow_tools_from_prompts(workflow_path: Path) -> Dict[str, Set[str]]:
    """
    Extract all tools mentioned in prompts for each job in a workflow.
    
    Returns a dict: job_id -> set of tool names
    """
    job_tools: Dict[str, Set[str]] = {}
    
    try:
        with open(workflow_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Parse YAML
        data = yaml.safe_load(content)
        if not data:
            return job_tools
        
        jobs = data.get('jobs', [])
        
        for job in jobs:
            job_id = job.get('id', 'unknown')
            steps = job.get('steps', [])
            
            for step in steps:
                # Check prompt directly in the step
                if 'prompt' in step:
                    tools = extract_tools_from_prompt_block(str(step['prompt']))
                    if tools:
                        if job_id not in job_tools:
                            job_tools[job_id] = set()
                        job_tools[job_id].update(tools)
                
                # Check prompt_file reference
                if 'prompt_file' in step:
                    prompt_file = step['prompt_file']
                    # The prompt_file is relative to the workflow file
                    prompt_path = workflow_path.parent / prompt_file
                    if prompt_path.exists():
                        with open(prompt_path, 'r', encoding='utf-8') as f:
                            prompt_content = f.read()
                        tools = extract_tools_from_prompt_block(prompt_content)
                        if tools:
                            if job_id not in job_tools:
                                job_tools[job_id] = set()
                            job_tools[job_id].update(tools)
    
    except Exception as e:
        print(f"Error processing {workflow_path}: {e}")
    
    return job_tools


def get_job_permissions(workflow_path: Path) -> Dict[str, Set[str]]:
    """
    Extract allow_tools from each job definition.
    
    Returns a dict: job_id -> set of allowed tool names
    """
    job_permissions: Dict[str, Set[str]] = {}
    
    try:
        with open(workflow_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        data = yaml.safe_load(content)
        if not data:
            return job_permissions
        
        jobs = data.get('jobs', [])
        
        for job in jobs:
            job_id = job.get('id', 'unknown')
            permissions = job.get('permissions', {})
            allow_tools = permissions.get('allow_tools', [])
            
            if isinstance(allow_tools, list):
                job_permissions[job_id] = set(allow_tools)
            else:
                job_permissions[job_id] = set()
    
    except Exception as e:
        print(f"Error extracting permissions from {workflow_path}: {e}")
    
    return job_permissions


def check_workflow_permissions(
    workflow_path: Path,
    verbose: bool = False
) -> List[Tuple[str, str, str]]:
    """
    Check that tools mentioned in prompts are allowed in job permissions.
    
    Returns a list of (job_id, tool_name, permission_type) tuples for violations.
    """
    violations = []
    
    # Get tools from prompts
    job_prompt_tools = get_workflow_tools_from_prompts(workflow_path)
    
    # Get job permissions
    job_permissions = get_job_permissions(workflow_path)
    
    for job_id, mentioned_tools in job_prompt_tools.items():
        allowed_tools = job_permissions.get(job_id, set())
        
        for tool in mentioned_tools:
            if tool not in allowed_tools:
                violations.append((job_id, tool, 'not_in_allow_tools'))
                if verbose:
                    print(f"  VIOLATION: Job '{job_id}' uses tool '{tool}' in prompt but not in allow_tools")
    
    return violations


def find_spawn_subagent_async_with_tier(workflow_path: Path) -> List[Tuple[str, str, int]]:
    """
    Check for spawn_subagent_async examples that include a 'tier' field.
    
    Returns list of (job_id, tool_name, line_number) tuples.
    """
    violations = []
    
    try:
        with open(workflow_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        data = yaml.safe_load(content)
        if not data:
            return violations
        
        jobs = data.get('jobs', [])
        
        for job in jobs:
            job_id = job.get('id', 'unknown')
            steps = job.get('steps', [])
            
            for step in steps:
                prompt_text = step.get('prompt', '')
                prompt_file = step.get('prompt_file', '')
                
                if prompt_file:
                    prompt_path = workflow_path.parent / prompt_file
                    if prompt_path.exists():
                        with open(prompt_path, 'r', encoding='utf-8') as f:
                            prompt_text = f.read()
                
                if prompt_text:
                    # Check for spawn_subagent_async with tier field
                    # Look for patterns like: spawn_subagent_async ... tier:
                    # This is typically in code blocks or example snippets
                    
                    # Find all spawn_subagent_async tool call examples
                    spawn_pattern = r'`spawn_subagent_async`[\s\S]*?(?=`|$)'
                    for match in re.finditer(spawn_pattern, prompt_text):
                        snippet = match.group(0)
                        # Check if tier is mentioned in this spawn context
                        if 'tier:' in snippet or 'tier :' in snippet:
                            line_num = prompt_text[:match.start()].count('\n') + 1
                            violations.append((job_id, 'tier_in_spawn_subagent_async', line_num))
    
    except Exception as e:
        print(f"Error checking spawn_subagent_async tier in {workflow_path}: {e}")
    
    return violations


def main():
    verbose = '--verbose' in sys.argv
    fix = '--fix' in sys.argv
    
    seed_dir = Path(__file__).parent.parent
    workflows_dir = seed_dir / 'workflows'
    
    all_violations = []
    tier_violations = []
    
    # Find all workflow files
    workflow_files = list(workflows_dir.glob('*.workflow.yaml'))
    
    print(f"Checking {len(workflow_files)} workflow files...")
    print()
    
    for workflow_file in sorted(workflow_files):
        if verbose:
            print(f"Checking: {workflow_file.name}")
        
        # Check tool permission consistency
        violations = check_workflow_permissions(workflow_file, verbose)
        all_violations.extend(
            (workflow_file.name, job_id, tool, reason)
            for job_id, tool, reason in violations
        )
        
        # Check for tier field in spawn_subagent_async
        tier_viols = find_spawn_subagent_async_with_tier(workflow_file)
        tier_violations.extend(
            (workflow_file.name, job_id, detail, line)
            for job_id, detail, line in tier_viols
        )
    
    # Report results
    has_violations = False
    
    if all_violations:
        has_violations = True
        print("=" * 70)
        print("TOOL PERMISSION MISMATCHES FOUND")
        print("=" * 70)
        for workflow, job_id, tool, reason in sorted(all_violations):
            print(f"  [{workflow}] Job '{job_id}' uses '{tool}' without permission")
        print()
    
    if tier_violations:
        has_violations = True
        print("=" * 70)
        print("SPAWN_SUBAGENT_ASYNC WITH TIER FIELD FOUND")
        print("=" * 70)
        for workflow, job_id, detail, line in sorted(tier_violations):
            print(f"  [{workflow}] Job '{job_id}' has spawn_subagent_async with tier (line ~{line})")
        print()
    
    if has_violations:
        print("FAIL: Workflow prompts reference tools without corresponding permissions")
        print(f"Total violations: {len(all_violations)} tool mismatches, {len(tier_violations)} tier issues")
        return 1
    else:
        print("PASS: All workflow prompts are consistent with their tool permissions")
        return 0


if __name__ == '__main__':
    sys.exit(main())