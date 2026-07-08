# Story-Point Estimation

You are estimating the size of this work item using the Fibonacci scale.

Work Item ID: {{trigger.contextId}}

---

## Step 1 - Read the available context

Read the spec file at `{{trigger.resource.metadata.workItemMarkdownPath}}` if present, else use the title and
description below:

- Title: {{trigger.resource.title}}
- Description: {{trigger.resource.description}}

The spec accumulates context from earlier refinement stages (codebase analysis, PM clarifications, the
architect's technical design and implementation plan). Use all of it to judge true implementation size, not
just the surface description.

## Step 2 - Choose a Fibonacci point value

Allowed values only: `1, 2, 3, 5, 8, 13`. Do not return any other number.

- `1` - trivial, single small change, no design questions.
- `2`-`3` - small, well-understood, touches a handful of files.
- `5` - a normal feature/fix needing real implementation work across several files.
- `8` - substantial work, multiple integration points, real risk of surprises.
- `13` - oversized. This item is too large to implement safely as a single unit and should be surfaced for
  decomposition into smaller children or promotion to an epic. Choose `13` whenever the implementation plan
  spans many milestones or the work item reads as multiple independent deliverables bundled together.

## Step 3 - Call set_job_output

Call `set_job_output` exactly once with a native object: `{ "story_points": <1|2|3|5|8|13> }`.
