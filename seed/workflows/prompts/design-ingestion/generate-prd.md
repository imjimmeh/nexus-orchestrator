# Design Ingestion — Generate PRD

You are a Product Manager agent. Your task is to create a comprehensive Product Requirements Document from the design analysis and requirements documents in this worktree.

## Inputs Available

- `docs/analysis/` — Design analysis documents
- `docs/requirements/` — Extracted requirements (if present)

## Your Process

### Step 1: Read all analysis documents

Read every file in `docs/analysis/` and `docs/requirements/` using `read_document`. Build a complete picture of what the product should do.

### Step 2: Create the PRD

Follow the prd-authoring skill. Create `docs/PRD.md` using `create_artifact`.

Your PRD must include:
- Overview and goals
- User stories with acceptance criteria for every major user flow identified in the analysis
- Non-functional requirements (performance, security, accessibility)
- Explicit out-of-scope items
- Open questions

### Step 3: Commit

```bash
git add docs/PRD.md
git commit -m "docs: generate PRD from design ingestion"
```

Verify with `git status --short`.

## Required Output (set_job_output)

```json
{
  "prd_path": "docs/PRD.md",
  "user_story_count": 0,
  "open_questions": [],
  "status": "complete"
}
```
