---
name: sdd-authoring
description: "Write a Solution Design Document from a PRD and analysis. Use when translating an approved PRD into architecture, data models, and APIs."
version: 1.0.0
tier: heavy
estimated_duration: 20-40 minutes
category: architecture
tags:
  - sdd
  - architecture
  - documentation
  - ingestion
prerequisites:
  - prd-authoring
metadata: {}
---

# SDD Authoring

## Overview

Transform PRDs and analysis into a technical Solution Design Document saved at `docs/SDD.md`.

## Prerequisites

- `docs/PRD.md` exists and is complete (the `prd-authoring` skill has been applied)
- Analysis documents exist in `docs/analysis/`
- Architecture constraints and technology choices are understood

## Instructions

Follow the authoring process below to produce the SDD:

## SDD Template

```markdown
# Solution Design Document: [Project Name]

**Version:** 1.0
**Status:** Draft
**Source PRD:** docs/PRD.md

## 1. Architecture Overview

[2-3 sentence description of the high-level architecture]

## 2. Components

### [Component Name]

- **Responsibility:** [What it does]
- **Technology:** [Language/framework/service]
- **Interfaces:** [How it communicates with other components]

## 3. Data Models

### [Entity Name]

| Field | Type | Description |
| ----- | ---- | ----------- |
| id    | UUID | Primary key |
| ...   | ...  | ...         |

## 4. APIs

### [Endpoint]

- **Method:** GET/POST/PUT/DELETE
- **Path:** /api/[resource]
- **Request:** [schema]
- **Response:** [schema]

## 5. Technical Risks

| Risk   | Likelihood   | Impact       | Mitigation   |
| ------ | ------------ | ------------ | ------------ |
| [Risk] | High/Med/Low | High/Med/Low | [Mitigation] |

## 6. Implementation Phases

1. [Phase 1]: [What gets built]
2. [Phase 2]: [What gets built]
```

## SDD Authoring Process

1. Read `docs/PRD.md` and all `docs/analysis/` files
2. Identify system boundaries and components
3. Define data models based on entities mentioned in requirements
4. Specify APIs for user stories that require them
5. Save to `docs/SDD.md`
6. Commit: `git add docs/SDD.md && git commit -m "docs: generate SDD from PRD and design analysis"`

## Output Format

- `docs/SDD.md` created and committed to the repository
- The file follows the SDD template above with all sections populated
- Technical risks are documented with likelihood, impact, and mitigation
