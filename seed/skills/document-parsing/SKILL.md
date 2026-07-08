---
name: document-parsing
description: "Parse and extract structured information from PDFs, Word, markdown, and text. Use when ingesting source documents that need clean structured output."
version: 1.0.0
tier: heavy
estimated_duration: 3-10 minutes
category: implementation
tags:
  - document
  - parsing
  - ingestion
prerequisites: []
metadata: {}
---

# Document Parsing

## Overview

Extract useful information from documents by understanding their structure and intent, not just their raw text.

## Prerequisites

- One or more document files are available (PDF, DOCX, Markdown, or plain text)
- The `read_document` tool is available for reading file contents
- A `docs/analysis/` directory exists or can be created for output

## Instructions

Follow the approach below to parse each document:

## Approach

### 1. Identify Document Type

Determine whether the document is:

- **Specification:** Technical or product requirements
- **Design doc:** Architecture or system design
- **Process doc:** Business process or workflow description
- **Reference:** API docs, style guides, glossaries

### 2. Extract by Section

For each major section of the document:

- Note the heading and purpose
- Extract key facts, constraints, and requirements
- Flag ambiguous or contradictory statements

### 3. Handle Formatting Artifacts

PDFs and DOCXs often have:

- Line breaks mid-sentence (join them)
- Page numbers (strip)
- Headers/footers (strip)
- Table content run together (restructure)

### 4. Produce Summary

Create a `docs/analysis/<doc-name>-analysis.md` with:

```markdown
## Document: [Name]

**Type:** [specification/design/process/reference]
**Summary:** [1-2 sentence summary]

### Key Requirements

- [Requirement 1]
- [Requirement 2]

### Key Constraints

- [Constraint 1]

### Open Questions

- [Ambiguity or gap needing clarification]
```

## Output Format

- One analysis file per document saved to `docs/analysis/<doc-name>-analysis.md`
- Each file contains: document type, summary, key requirements, key constraints, and open questions
- Commit: `git add docs/analysis/ && git commit -m "analysis: parse <doc-name>"`
