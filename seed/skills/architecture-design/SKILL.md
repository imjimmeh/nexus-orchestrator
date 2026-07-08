---
name: architecture-design
description: "Design a scalable system architecture from requirements. Use when selecting components, interfaces, and technologies for a new system or major change."
version: 1.0.0
tier: heavy
estimated_duration: 20-45 minutes
category: architecture
tags:
  - architecture
  - design
  - ingestion
prerequisites: []
metadata: {}
---

# Architecture Design

## Overview

Transform product requirements into a coherent technical architecture that is scalable, maintainable, and aligned with constraints.

## Prerequisites

- PRD and requirements documents are available in `docs/` or provided as input
- Non-functional requirements (performance, scale, security) have been identified
- Integration constraints and existing system boundaries are known

## Instructions

Follow the process below to design the architecture:

## Process

### 1. Understand Requirements

Read all PRD and requirements documents. Identify:

- Core use cases that drive architecture decisions
- Non-functional requirements (performance, scale, security)
- Integration constraints (existing systems, APIs)

### 2. Identify System Boundaries

Define what is inside and outside the system scope:

- External systems the solution integrates with
- Data flows crossing system boundaries
- Authentication and authorization boundaries

### 3. Decompose into Components

For each major responsibility:

- Name the component and define its single responsibility
- Specify its technology and deployment model
- Define its interfaces (API, events, shared data)

### 4. Validate Against Requirements

Check each architectural decision against:

- Can it meet the performance requirements?
- Does it satisfy the security constraints?
- Is it aligned with the team's existing capabilities?

### 5. Document Risks

For each major architectural decision:

- Identify the risk if this decision is wrong
- Specify the mitigation or rollback strategy

## Output Format

- Architecture design saved to `docs/architecture/ARCHITECTURE.md`
- Document includes: system boundary diagram (ASCII or description), component list with responsibilities, interface definitions, and a risk register
- Commit: `git add docs/architecture/ && git commit -m "docs: generate architecture design"`
