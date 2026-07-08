# EPIC-066 Specialized Skill Template

Use this template for EPIC-066 mounted skills to keep behavior deterministic.

```markdown
---
name: <skill-name>
description: <one-line purpose>
---

# <Skill Title>

## When to activate
1. <activation signal 1>
2. <activation signal 2>

## Required context and inputs
1. <required artifact or input>
2. <required artifact or input>

## Execution guidance
1. <step 1>
2. <step 2>
3. <step 3>

## Safety constraints
1. <safety rule 1>
2. <safety rule 2>

## Output expectations
1. <expected output 1>
2. <expected output 2>

## Language-agnostic discovery order
1. Project config/scripts first (for example package.json, pyproject.toml, pom.xml, go.mod, *.csproj).
2. Lockfiles and workspace metadata second (for example package-lock.json, pnpm-lock.yaml, poetry.lock).
3. Command probing only when config is missing or ambiguous.
```
