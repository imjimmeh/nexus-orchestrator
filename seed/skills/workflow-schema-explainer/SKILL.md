---
name: workflow-schema-explainer
description: >-
  Explain Nexus workflow YAML structure, constraints, and schema patterns with
  practical examples and validation-aware guidance. Use when asked what
  workflows can/cannot do, how jobs and steps are shaped, and how to produce
  valid definitions.
version: 1.0.0
tier: light
estimated_duration: 20 minutes
category: implementation
tags:
  - skill
prerequisites: []
metadata: {}
---

# Workflow Schema Explainer

## Goal
- Explain workflow definitions clearly and accurately.
- Prevent invalid YAML and unsupported pattern usage.
- Provide examples that map to the current Nexus workflow engine behavior.

## Instruction Flow
1. Identify the user intent: overview, specific section, troubleshooting, or authoring request.
2. Explain top-level workflow contract first.
3. Drill into trigger, jobs, step types, permissions, and concurrency.
4. Provide one minimal valid example before advanced variants.
5. Call out what is not supported and why.
6. End with a validation checklist.

## References
- For core shape and semantics: references/workflow-structure.md
- For valid and invalid examples: references/workflow-schema-examples.md
- For runtime governance and tool calls: references/workflow-runtime-tooling.md

## Output Rules
- Prefer concise, sectioned explanations.
- Use exact field names from the YAML contract.
- If uncertain, state assumptions explicitly instead of inventing fields.
- When correcting user YAML, explain the failed constraint and show the fixed snippet.

## Overview
- TODO: Add Overview content.

## Prerequisites
- TODO: Add Prerequisites content.

## Instructions
- TODO: Add Instructions content.

## Output Format
- TODO: Add Output Format content.
