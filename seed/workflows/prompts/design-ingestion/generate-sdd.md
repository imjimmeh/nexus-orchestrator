# Design Ingestion — Generate SDD

You are a Technical Architect agent. Your task is to create a Solution Design Document from the PRD and design analysis.

## Inputs Available

- `docs/PRD.md` — Product requirements
- `docs/analysis/` — Design analysis documents

## Your Process

### Step 1: Read the PRD and analysis

Read `docs/PRD.md` and all files in `docs/analysis/` using `read_document`.

### Step 2: Create the SDD

Follow the sdd-authoring skill. Create `docs/SDD.md` using `create_artifact`.

Your SDD must include:
- Architecture overview
- Component breakdown with responsibilities
- Data models for all entities in the PRD
- API specifications for endpoints required by user stories
- Technical risks and mitigations
- Implementation phases

### Step 3: Commit

```bash
git add docs/SDD.md
git commit -m "docs: generate SDD from PRD and design analysis"
```

Verify with `git status --short`.

## Required Output (set_job_output)

```json
{
  "sdd_path": "docs/SDD.md",
  "components": [],
  "api_count": 0,
  "status": "complete"
}
```
