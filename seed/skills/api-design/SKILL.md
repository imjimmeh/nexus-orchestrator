---
name: api-design
description: >-
  Design consistent evolvable APIs for REST and GraphQL. Use when defining or
  changing public service contracts.
version: 1.0.0
tier: heavy
estimated_duration: 30-120 minutes
category: architecture
tags:
  - api
  - design
prerequisites:
  - coding-standards
metadata: {}
---

# API Design

## Overview
- Design APIs for clarity, consistency, and backward compatibility.
- Prefer explicit contracts and predictable error semantics.

## Prerequisites
- Domain model and user flows are identified.
- Consumer needs and constraints are known.

## Instructions
1. Model resources and operations with stable naming.
2. Define request and response schemas with explicit required fields.
3. Use standard HTTP methods/status codes for REST contracts.
4. Add pagination, filtering, and sorting patterns where list growth is expected.
5. For GraphQL, design schema around use cases, avoid resolver side effects.
6. Document contracts in OpenAPI/Swagger (REST) or schema docs (GraphQL).

## Decision Points
1. Use REST for coarse resource workflows and broad integration compatibility.
2. Use GraphQL when clients need flexible shape composition and field-level retrieval.
3. Version only when incompatible changes are unavoidable.

## Output Format
- Endpoint/schema table.
- Input/output contract examples.
- Error model and status-code matrix.
- Compatibility and migration notes.

## Examples
- Good: GET /projects/{id}/work-items?page=1&pageSize=20 with stable envelope metadata.
- Bad: POST /getWorkItems with mixed read/write semantics and opaque errors.

## Common Pitfalls
- Leaking internal persistence details into public API shapes.
- Inconsistent naming and status-code use across endpoints.
- Missing idempotency and pagination strategy.
