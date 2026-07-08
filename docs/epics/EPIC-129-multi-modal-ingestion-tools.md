# EPIC-129: Multi-Modal Ingestion Tools

**Epic ID:** EPIC-129  
**Status:** Proposed  
**Priority:** P0 - Critical  
**Theme:** Multi-modal Input Processing, Tool Registry, Agent Capabilities  
**Created:** 2026-04-19  
**Depends On:** EPIC-128 (Steering Foundation), EPIC-080 (MCP Client), EPIC-017 (Agent Capability Orchestration)

---

## 1. Context

The steering foundation (EPIC-128) provides the mechanism for parsing user intent and orchestrating changes. To support design/document ingestion as a steering intent, we need tools that agents can invoke to fetch, read, and analyze multi-modal inputs (web pages, documents, images, Figma files). These tools integrate with the existing tool registry and respect agent capability permissions.

**Current State:**
- Tool registry exists at `apps/api/src/tool/`
- MCP client runtime supports external tool servers (EPIC-080)
- Agent profiles have `allowed_tools` and `denied_tools` (EPIC-017)
- Vision models are configured in `llm_models` but not explicitly used for image analysis
- No document parsing or URL fetching tools exist

**Target State:**
- Six new ingestion tools registered in the tool registry
- Vision-capable models can analyze images
- Document parsers handle PDF, DOCX, and common formats
- URL fetcher downloads and extracts web content
- Figma API integration for design system extraction
- All tools respect agent capability scopes
- Steering framework can invoke these tools when user says "ingest these designs"

---

## 2. References

**Architecture:**
- `docs/architecture/tool-registry.md`
- `docs/architecture/agent-capability-orchestration.md`
- `docs/epics/EPIC-017-agent-capability-orchestration.md`
- `docs/epics/EPIC-080-mcp-client-runtime-integration.md`
- `docs/epics/EPIC-128-conversational-orchestrator-steering-foundation.md`

**Implementation Files:**
- `apps/api/src/tool/` — Tool registry and handlers
- `apps/api/src/database/entities/llm-model.entity.ts` — Model configuration
- `apps/api/src/ai-config/services/agent-factory.service.ts` — Agent creation
- `seed/workflows/` — Workflow definitions
- `seed/agent-profiles/` — Agent profile seeds

**Related Skills:**
- `workflow-yaml-authoring` — For tool integration in workflows
- `testing-unit-patterns` — For tool handler tests

---

## 3. PR-Ready Tasks

### Task 1: Implement `fetch_url` Tool

**Scope:** Add a tool that fetches URL content, extracts text, and handles common formats.

**Files:**
- Create: `apps/api/src/tool/handlers/fetch-url.tool.ts`
- Create: `apps/api/src/tool/handlers/fetch-url.tool.spec.ts`
- Modify: `apps/api/src/tool/tool-registry.service.ts`
- Modify: `apps/api/src/tool/tool-module.ts`

**Acceptance Criteria:**
- Fetches HTML, JSON, and plain text URLs
- Extracts readable text from HTML (strip tags, scripts)
- Respects HTTP redirects
- Handles timeouts (10s default, configurable)
- Returns structured output: `{ url, title, content, content_type, status_code }`
- Has unit tests mocking HTTP requests

**Definition of Done:**
- [ ] Tool registered and discoverable by agents
- [ ] Unit tests pass (>80% coverage)
- [ ] Lint passes
- [ ] Tested with 3+ real URLs

---

### Task 2: Implement `read_document` Tool

**Scope:** Parse PDF, DOCX, and plain text files from the filesystem.

**Files:**
- Create: `apps/api/src/tool/handlers/read-document.tool.ts`
- Create: `apps/api/src/tool/handlers/read-document.tool.spec.ts`
- Modify: `apps/api/src/tool/tool-registry.service.ts`

**Acceptance Criteria:**
- Supports PDF (text extraction, not OCR for scanned images)
- Supports DOCX (text + basic formatting)
- Supports TXT, MD, CSV
- Returns: `{ filename, content, pages_or_sections, word_count }`
- Handles large files with truncation (max 100KB text)
- Secure path validation (no directory traversal)

**Definition of Done:**
- [ ] Tool registered and tested
- [ ] Unit tests with mock document files (>80% coverage)
- [ ] Security review for path handling
- [ ] Lint passes

---

### Task 3: Implement `analyze_image` Tool

**Scope:** Send images to vision-capable LLMs for analysis.

**Files:**
- Create: `apps/api/src/tool/handlers/analyze-image.tool.ts`
- Create: `apps/api/src/tool/handlers/analyze-image.tool.spec.ts`
- Modify: `apps/api/src/tool/tool-registry.service.ts`
- Modify: `apps/api/src/ai-config/services/agent-factory.service.ts`

**Acceptance Criteria:**
- Accepts image path or base64 data
- Detects image format (PNG, JPG, GIF, WEBP)
- Uses vision-capable model if available (checks agent profile model)
- Returns structured analysis: `{ description, elements_detected, text_content, ui_components }`
- Handles multiple images in single call
- Falls back gracefully if no vision model available

**Definition of Done:**
- [ ] Tool works with vision models
- [ ] Unit tests with mocked vision responses (>80% coverage)
- [ ] Fallback behavior tested
- [ ] Lint passes

---

### Task 4: Implement `extract_figma` Tool

**Scope:** Fetch Figma file structure via Figma API.

**Files:**
- Create: `apps/api/src/tool/handlers/extract-figma.tool.ts`
- Create: `apps/api/src/tool/handlers/extract-figma.tool.spec.ts`
- Modify: `apps/api/src/tool/tool-registry.service.ts`

**Acceptance Criteria:**
- Takes Figma file URL or file key
- Fetches file structure (pages, frames, components)
- Extracts text content from nodes
- Returns: `{ file_name, pages, components, text_content, styles }`
- Requires Figma API token from secret_store
- Handles rate limiting (Figma has 1000 req/hour limit)

**Definition of Done:**
- [ ] Tool fetches real Figma files
- [ ] Unit tests with mocked API responses (>80% coverage)
- [ ] Token retrieval from secret_store tested
- [ ] Lint passes

---

### Task 5: Implement `create_artifact` Tool

**Scope:** Write structured files to the repository/worktree.

**Files:**
- Create: `apps/api/src/tool/handlers/create-artifact.tool.ts`
- Create: `apps/api/src/tool/handlers/create-artifact.tool.spec.ts`
- Modify: `apps/api/src/tool/tool-registry.service.ts`

**Acceptance Criteria:**
- Creates files in worktree or project path
- Supports markdown, JSON, YAML, plain text
- Validates paths (no directory traversal outside project)
- Can create directories if needed
- Returns: `{ path, created, size_bytes }`
- Overwrite protection (fails if file exists unless `force: true`)

**Definition of Done:**
- [ ] Tool creates files in worktrees
- [ ] Path validation tested
- [ ] Unit tests pass (>80% coverage)
- [ ] Lint passes

---

### Task 6: Implement `propose_work_items` Tool

**Scope:** Generate structured work item proposals from analysis.

**Files:**
- Create: `apps/api/src/tool/handlers/propose-work-items.tool.ts`
- Create: `apps/api/src/tool/handlers/propose-work-items.tool.spec.ts`
- Modify: `apps/api/src/tool/tool-registry.service.ts`
- Modify: `apps/api/src/project/project-orchestration.service.ts`

**Acceptance Criteria:**
- Accepts structured JSON describing work items
- Creates draft work items (not yet on board)
- Returns: `{ proposed_items, validation_errors }`
- Validates required fields (title, type, acceptance_criteria)
- Supports epics, tasks, and subtasks
- Links to source analysis document

**Definition of Done:**
- [ ] Tool creates draft work items
- [ ] Validation logic tested
- [ ] Integration with project service tested
- [ ] Unit tests pass (>80% coverage)
- [ ] Lint passes

---

### Task 7: Update Agent Factory for Vision Support

**Scope:** Enable agent factory to select vision-capable models when image analysis is expected.

**Files:**
- Modify: `apps/api/src/ai-config/services/agent-factory.service.ts`
- Modify: `apps/api/src/database/entities/agent-profile.entity.ts`

**Acceptance Criteria:**
- Agent profile can specify `supports_vision: boolean`
- Factory selects vision model if tool requires it
- Falls back to non-vision if no vision model configured
- Backward compatible with existing profiles

**Definition of Done:**
- [ ] Vision model selection works
- [ ] Existing profiles unaffected
- [ ] Unit tests pass
- [ ] Lint passes

---

### Task 8: Seed Ingestion Tool Permissions

**Scope:** Add ingestion tools to default agent profile allowed_tools.

**Files:**
- Modify: `apps/api/src/database/seeds/agent-profiles/`
- Modify: `seed/agent-profiles/`

**Acceptance Criteria:**
- `design_analyst` profile has: fetch_url, read_document, analyze_image, extract_figma, create_artifact
- `product_manager` profile has: fetch_url, read_document, create_artifact, propose_work_items
- `technical_architect` profile has: fetch_url, read_document, create_artifact
- Tools respect capability hierarchy (agent > workflow > step)

**Definition of Done:**
- [ ] Profiles seeded correctly
- [ ] Tool permissions validated
- [ ] Seed tests pass
- [ ] Lint passes

---

### Task 9: Write Tool Documentation

**Scope:** Document the new ingestion tools.

**Files:**
- Create: `docs/architecture/ingestion-tools.md`
- Modify: `docs/architecture/tool-registry.md`

**Acceptance Criteria:**
- Document covers:
  - Each tool's purpose and parameters
  - Return values and error handling
  - Security considerations
  - Example usage in workflows
- Tool registry README updated with new tools
- How to add new ingestion tools

**Definition of Done:**
- [ ] Documentation complete
- [ ] Examples included
- [ ] Peer reviewed

---

## 4. Definition of Done (Epic Level)

- [ ] All 6 ingestion tools implemented and registered
- [ ] Tools have unit tests with >80% coverage
- [ ] Vision model support integrated in agent factory
- [ ] Agent profiles seeded with appropriate tool permissions
- [ ] All tests pass (`npm run test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Tools tested in real agent sessions
- [ ] Documentation updated
- [ ] Feature flag: `ingestion_tools_enabled` (default: false)
- [ ] No E2E tests required (deferred to future epic)

---

## 5. Dependencies

- **EPIC-128 (Steering Foundation):** Provides the orchestration framework that will use these tools
- **EPIC-080 (MCP Client):** For external tool server patterns
- **EPIC-017 (Capability Orchestration):** For tool permission hierarchy
- **EPIC-129 depends on:** EPIC-128
- **Blocks:** EPIC-130, EPIC-131, EPIC-132, EPIC-133

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Vision models expensive | Use only when explicitly needed; batch images |
| Figma API rate limits | Cache responses; implement backoff |
| Document parsing edge cases | Start with common formats; iterate |
| Security (path traversal) | Strict path validation in all file tools |
