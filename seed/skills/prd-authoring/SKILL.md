---
name: prd-authoring
description: "Write a comprehensive PRD from analysis and requirements. Use when producing a PRD document during ingestion or product definition."
version: 1.0.0
tier: heavy
estimated_duration: 15-30 minutes
category: product
tags:
  - prd
  - product
  - documentation
  - ingestion
prerequisites:
  - requirement-elicitation
metadata: {}
---

# PRD Authoring

## Overview

Transform requirements and analysis into a structured PRD saved at `docs/PRD.md`.

## Prerequisites

- Analysis documents exist in `docs/analysis/` or `docs/requirements/`
- Requirements have been elicited (the `requirement-elicitation` skill has been applied)
- The project scope and goals are understood

## Instructions

Follow the authoring process below to produce the PRD:

## PRD Template

```markdown
# Product Requirements Document: [Project Name]

**Version:** 1.0
**Status:** Draft
**Source:** Design ingestion — [list of input files/URLs]

## 1. Overview

[2-3 sentence description of the product/feature]

## 2. Goals

- [Goal 1]
- [Goal 2]

## 3. User Stories

### [Feature Area]

- As a [user type], I want to [action], so that [benefit].
  - Acceptance Criteria:
    - [ ] [Criterion 1]
    - [ ] [Criterion 2]

## 4. Non-Functional Requirements

- **Performance:** [e.g., page load under 2s]
- **Security:** [e.g., all data encrypted at rest]
- **Accessibility:** [e.g., WCAG 2.1 AA]

## 5. Out of Scope

- [What this PRD explicitly does NOT cover]

## 6. Open Questions

- [Question 1] — [Who needs to answer this]
```

## PRD Authoring Process

1. Read all files in `docs/analysis/` and `docs/requirements/`
2. Group requirements by feature area
3. Write user stories with acceptance criteria
4. Fill in non-functional requirements from constraints found in analysis
5. Save to `docs/PRD.md`
6. Commit: `git add docs/PRD.md && git commit -m "docs: generate PRD from design ingestion"`

## Output Format

- `docs/PRD.md` created and committed to the repository
- The file follows the PRD template above with all sections populated
- Open questions are listed for stakeholder review
