# Skill Template

Use this template for mounted skills in seed/skills.

```markdown
---
name: <skill-name>
description: <what the skill does and when to use it>
metadata:
  version: 1.0.0
  prerequisites: []
  tier: light
  estimated_duration: 15-60 minutes
---

# <Skill Title>

## Overview
- Explain the goal of the skill and the expected outcome.
- State clear activation signals.

## Prerequisites
- Required context and artifacts.
- Explicit dependency skills from metadata.prerequisites.

## Instructions
1. Describe the step-by-step execution flow.
2. Keep instructions deterministic where failure risk is high.
3. Reference project conventions and validation commands.

## Decision Points
1. Explain branching logic (when to choose path A vs B).
2. Include fallback behavior when required inputs are missing.

## Output Format
- Define required output sections and fields.
- Describe quality bar and validation checks.

## Examples
- Provide at least one good example.
- Provide one counterexample or anti-example.

## Common Pitfalls
- List common failure modes.
- Include prevention and recovery guidance.
```

## Notes

- Keep the skill concise and reusable.
- Prefer language-agnostic guidance first, then language-specific examples.
- Avoid tool names that are not available in this repository.
