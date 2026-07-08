---
name: requirement-elicitation
description: "Extract and structure functional/non-functional requirements. Use when turning documents, designs, or analysis into a structured requirement set."
version: 1.0.0
tier: heavy
estimated_duration: 10-20 minutes
category: product
tags:
  - requirements
  - product
  - ingestion
prerequisites:
  - document-parsing
metadata: {}
---

# Requirement Elicitation

## Overview

Transform raw analysis and documents into categorized, actionable requirements.

## Prerequisites

- Analysis documents exist in `docs/analysis/` or raw source documents are available
- The `document-parsing` skill has been applied to produce structured analysis
- A `docs/requirements/` directory exists or can be created

## Instructions

Follow the extraction process below to produce the requirements file:

## Requirement Categories

- **Functional:** What the system must do
- **Non-functional:** Performance, security, accessibility, reliability constraints
- **Integration:** External systems, APIs, or data sources required
- **Data:** What data must be stored, processed, or displayed

## Extraction Process

### 1. Read All Analysis Documents

Read every document in `docs/analysis/` and `docs/requirements/`.

### 2. Extract Requirements

For each piece of analysis, extract explicit and implied requirements:

- Explicit: "The user can log in with email and password"
- Implied: A login form implies email validation, password masking, error states

### 3. Write to Requirements File

Save to `docs/requirements/<feature-name>-requirements.md`:

```markdown
# Requirements: [Feature Name]

## Functional Requirements

- [REQ-F-001] [Description]
- [REQ-F-002] [Description]

## Non-Functional Requirements

- [REQ-NF-001] [Description]

## Open Questions

- [Question requiring product/design clarification]
```

### 4. Commit

```bash
git add docs/requirements/
git commit -m "requirements: extract from <source>"
```

## Output Format

- Requirements file saved to `docs/requirements/<feature-name>-requirements.md`
- The file contains categorised functional, non-functional, and open questions sections
- Each requirement has a unique identifier (e.g., `REQ-F-001`) for traceability
