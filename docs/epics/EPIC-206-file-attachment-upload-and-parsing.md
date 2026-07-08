# EPIC-206: File Attachment Upload, Storage & Parsing

**Epic ID:** EPIC-206
**Status:** Proposed
**Priority:** P1 - High
**Theme:** Multi-modal Input, File Storage, Web UI, Agent Context
**Created:** 2026-06-10
**Depends On:** EPIC-129 (Multi-Modal Ingestion Tools), EPIC-064 (Decoupled Chat Sessions)

---

## 1. Context

EPICs 129–131 delivered the backend ingestion **tools** (`read_document`, `analyze_image`, `fetch_url`, `extract_figma`, `create_artifact`), agent profiles, and ingestion workflows. However, every one of those tools reads from a **filesystem path inside a worktree** — there is no way for a user to get a file *into* the system from the browser:

- No `<input type="file">` or drag-and-drop anywhere in `apps/web`.
- No multipart/upload endpoint in the API.
- `ChatMessage` has only a `text` column — no attachments.
- No storage layer for user-supplied files.

EPIC-132 (Repository File Viewer & Add Files UI) and EPIC-133 (Chat Integration for Ingestion) sketched a frontend, but they are large, still `Proposed`, and wire uploads exclusively to the heavyweight design-ingestion → work-item pipeline. This epic instead builds a **small, reusable upload + storage + parsing foundation** that any surface (chat, project workspace, future workflows) consumes the same way, and exposes it in chat and on the project workspace.

**Current State:**
- Parsing libraries already present: `pdf-parse`, `mammoth`; vision client wired into `analyze_image`.
- Parsing logic is **inlined** in `read-document.tool.ts` and `analyze-image.tool.ts` (not reusable).
- Chat send path (`POST /sessions/chat/:chatId/messages`) accepts `{ message: string }` only.
- Stack runs on docker-compose with disk-mounted volumes; no object store.

**Target State:**
- A standalone `AttachmentsModule` owning upload, storage, metadata, parsing, and read access.
- Garage (S3-compatible) object store added to the stack; bytes never stored in Postgres.
- Eager-on-upload parsing producing cached, agent-readable markdown.
- A reusable polymorphic link model (`attachment_links`) so one upload primitive serves chat, projects, and beyond.
- Agents receive parsed content via context injection; a `get_attachment` tool materializes originals on demand.
- A reusable `<FileDropzone>` + `useFileUpload` frontend primitive wired into chat and a project "Add Files" panel.
- Feature-flagged (`attachments_enabled`, default off) for safe rollout.

---

## 2. References

**Architecture:**
- `docs/specs/SDD-file-attachments.md` — Solution design for this epic
- `docs/epics/EPIC-129-multi-modal-ingestion-tools.md`
- `docs/epics/EPIC-132-repository-file-viewer-and-add-files-ui.md`
- `docs/epics/EPIC-133-chat-integration-for-ingestion.md`

**Implementation Files:**
- `apps/api/src/attachments/` — NEW module (storage, parsing, controllers)
- `apps/api/src/tool/handlers/read-document.tool.ts` — DRY refactor source
- `apps/api/src/tool/handlers/analyze-image.tool.ts` — DRY refactor source
- `apps/api/src/chat/chat-messages/` — message send path extension
- `apps/web/src/components/attachments/` — NEW reusable components
- `apps/web/src/components/chat/AgentChatPanel.tsx` — chat input integration
- `packages/core/src/schemas/attachments/` — NEW shared contracts
- `docker-compose.yaml` — Garage service + volume

**Related Skills:**
- `adding-entity-migration` — entities + migration
- `nestjs-module-conventions` — module/service/controller patterns
- `special-step-handler-implementation` / tool registration — for the `get_attachment` tool
- `testing-unit-patterns` — Vitest/NestJS test patterns

---

## 3. PR-Ready Tasks

### Task 1: Garage Object Store & `IObjectStorage`

**Scope:** Add the S3-compatible store and an injectable storage abstraction.

**Files:**
- Create: `apps/api/src/attachments/storage/object-storage.interface.ts` (`IObjectStorage` + DI token)
- Create: `apps/api/src/attachments/storage/garage-object-storage.service.ts`
- Create: `apps/api/src/attachments/storage/garage-object-storage.service.spec.ts`
- Modify: `docker-compose.yaml` (add `garage` service + named volume + bucket/key init)
- Modify: `apps/api/package.json` (add `@aws-sdk/client-s3`)

**Acceptance Criteria:**
- `IObjectStorage` exposes `put`, `get`, `delete`, `head` keyed by storage key.
- `GarageObjectStorageService` uses `@aws-sdk/client-s3` against the Garage endpoint.
- Config from env: `GARAGE_S3_ENDPOINT`, `GARAGE_S3_REGION`, `GARAGE_S3_BUCKET`; credentials referenced via `secret_store` (consistent with `llm_providers.secret_id`).
- Bucket `nexus-uploads` is **private**; no public object URLs are issued.
- Unit tests mock the S3 client (no live network).

**Definition of Done:**
- [ ] Storage service + interface implemented and unit tested (>80%)
- [ ] Garage service starts in `docker compose up`; bucket/key auto-provisioned
- [ ] Lint passes

---

### Task 2: Attachments Data Model & Migration

**Scope:** Persist attachment metadata and polymorphic ownership links.

**Files:**
- Create: `apps/api/src/attachments/database/entities/attachment.entity.ts`
- Create: `apps/api/src/attachments/database/entities/attachment-link.entity.ts`
- Create: `apps/api/src/attachments/database/repositories/*`
- Create: migration under the API migrations directory
- Modify: DatabaseModule registration

**Acceptance Criteria:**
- `attachments`: `id`, `filename`, `mime_type`, `size_bytes`, `checksum`, `storage_key`, `parsed_key (nullable)`, `parse_status`, `parse_error (nullable)`, `created_by`, `created_at`.
- `attachment_links`: `id`, `attachment_id (fk)`, `owner_type`, `owner_id`, `created_at`, unique `(attachment_id, owner_type, owner_id)`.
- `parse_status` enum: `pending | parsing | parsed | failed | skipped`.
- No file bytes stored in Postgres.
- Migration is reversible.

**Definition of Done:**
- [ ] Entities, repositories, migration created and registered
- [ ] Migration up/down verified
- [ ] Lint passes

---

### Task 3: Upload Endpoint, Validation & Core Schemas

**Scope:** Accept multipart uploads, validate, store, and enqueue parsing.

**Files:**
- Create: `apps/api/src/attachments/attachments.controller.ts`
- Create: `apps/api/src/attachments/attachments.service.ts`
- Create: `apps/api/src/attachments/attachments.module.ts`
- Create: `apps/api/src/attachments/*.spec.ts`
- Create: `packages/core/src/schemas/attachments/attachment.schema.ts` (DTO, upload response, parse-status enum, MIME allowlist, size cap constant)

**Acceptance Criteria:**
- `POST /attachments` (multipart, `FileInterceptor`) validates MIME against allowlist (images: png/jpg/jpeg/gif/webp; docs: pdf/docx/txt/md/csv) and size cap (default 25 MB, configurable).
- Executables and disallowed types rejected with a clear error.
- sha256 checksum computed; identical bytes deduped to the existing attachment.
- Stores original at `nexus-uploads/<id>/original`, inserts row (`pending`), enqueues a BullMQ parse job.
- Returns `{ id, filename, mimeType, sizeBytes, parseStatus }`.
- Contracts live in `@nexus/core`; never redefined locally.

**Definition of Done:**
- [ ] Upload endpoint works with multipart form data
- [ ] Validation (type, size, dedupe) unit tested
- [ ] Core schemas exported and consumed by API + web
- [ ] Lint passes

---

### Task 4: Extract Shared Parser Services (DRY Refactor)

**Scope:** Lift inlined parsing logic out of the ingestion tools into reusable services — single source of truth.

**Files:**
- Create: `apps/api/src/attachments/parsing/document-parser.service.ts`
- Create: `apps/api/src/attachments/parsing/image-describer.service.ts`
- Create: `apps/api/src/attachments/parsing/*.spec.ts`
- Modify: `apps/api/src/tool/handlers/read-document.tool.ts` (delegate to `DocumentParserService`)
- Modify: `apps/api/src/tool/handlers/analyze-image.tool.ts` (delegate to `ImageDescriberService`)

**Acceptance Criteria:**
- `DocumentParserService` parses PDF/DOCX/TXT/MD/CSV to markdown/text with truncation, reusing `pdf-parse`/`mammoth`.
- `ImageDescriberService` wraps the existing vision client, returning the same structured analysis.
- `read_document` and `analyze_image` behavior is unchanged (existing tool tests still pass).
- No duplicated parsing logic remains in the tool handlers.

**Definition of Done:**
- [ ] Parser services extracted and unit tested
- [ ] Tool handlers delegate; their existing tests pass unchanged
- [ ] Lint passes

---

### Task 5: Eager Parse Worker

**Scope:** Background job that produces cached, agent-readable content on upload.

**Files:**
- Create: `apps/api/src/attachments/parsing/attachment-parse.processor.ts`
- Create: `apps/api/src/attachments/parsing/attachment-parse.processor.spec.ts`
- Modify: `attachments.module.ts` (register BullMQ queue/consumer)

**Acceptance Criteria:**
- Consumes the parse queue: docs → `DocumentParserService`, images → `ImageDescriberService`.
- Stores parsed markdown at `nexus-uploads/<id>/parsed.md`; sets `parsed_key`, transitions row to `parsed`.
- Text extraction is always eager.
- Image-vision gated by `ATTACHMENTS_IMAGE_VISION_EAGER` (default on) and a per-upload-batch cap; over-cap images are marked `skipped` and parse lazily on first access.
- Failures set `failed` + `parse_error` without crashing the worker.

**Definition of Done:**
- [ ] Worker parses docs and images, caches results
- [ ] Eager/skip/lazy and failure paths unit tested
- [ ] Lint passes

---

### Task 6: Read Endpoints (Metadata / Content / Parsed)

**Scope:** Authenticated retrieval for previews, downloads, and agent context.

**Files:**
- Modify: `apps/api/src/attachments/attachments.controller.ts`
- Modify: `apps/api/src/attachments/attachments.service.ts`

**Acceptance Criteria:**
- `GET /attachments/:id` → metadata.
- `GET /attachments/:id/content` → streams original bytes (auth-gated; never a public Garage URL).
- `GET /attachments/:id/parsed` → parsed markdown (or status if not ready).
- 404 for unknown ids; access respects auth guard.

**Definition of Done:**
- [ ] All three read paths work and are unit tested
- [ ] Content served through the API only
- [ ] Lint passes

---

### Task 7: Agent Access Bridge

**Scope:** Make attachments reachable by agents — via context injection and an on-demand tool.

**Files:**
- Create: `apps/api/src/tool/handlers/get-attachment.tool.ts` (+ spec)
- Create: `apps/api/src/tool/handlers/list-attachments.tool.ts` (+ spec)
- Modify: tool registry registration
- Modify: chat context assembly to inject linked parsed content

**Acceptance Criteria:**
- When a chat turn has linked attachments, their cached parsed markdown is injected into agent context (truncated to a budget).
- `get_attachment` accepts `{ attachment_id }`, materializes the original into the run worktree at `.attachments/<id>/<filename>` (path-validated, no traversal), returns `{ path, parsed_content, mime_type }`.
- `list_attachments` enumerates attachments linked to the current session/run.
- Tools respect the existing capability/permission hierarchy.

**Definition of Done:**
- [ ] Context injection works for chat sessions
- [ ] `get_attachment` / `list_attachments` registered and unit tested
- [ ] Path validation tested (no traversal)
- [ ] Lint passes

---

### Task 8: Reusable Frontend Upload Primitive

**Scope:** One surface-agnostic upload component + hook + API client.

**Files:**
- Create: `apps/web/src/lib/api/client.attachments.ts`
- Create: `apps/web/src/hooks/useFileUpload.ts` (+ spec)
- Create: `apps/web/src/components/attachments/FileDropzone.tsx` (+ spec)
- Create: `apps/web/src/components/attachments/AttachmentChip.tsx`
- Create: `apps/web/src/components/attachments/ImageThumbnail.tsx`
- Create: `apps/web/src/components/attachments/index.ts`

**Acceptance Criteria:**
- `useFileUpload` handles multi-file selection, client-side validation (type/size), upload progress, and abort.
- `<FileDropzone>` supports drag-and-drop and a file picker; emits attachment ids on success.
- `<AttachmentChip>` / `<ImageThumbnail>` render docs and images (click to preview/download).
- Components are presentation-focused; side effects live in the hook/client (web quality gate).

**Definition of Done:**
- [ ] Hook + components implemented and unit tested
- [ ] No surface-specific coupling
- [ ] Lint passes

---

### Task 9: Chat Attachment Integration

**Scope:** Wire the primitive into the web chat send flow.

**Files:**
- Modify: `apps/web/src/components/chat/AgentChatPanel.tsx`
- Modify: `apps/web/src/components/chat/ChatMessageItem.tsx`
- Modify: `apps/api/src/chat/chat-messages/chat-messages.controller.ts`
- Modify: `apps/api/src/chat/chat-messages/chat-messages.service.ts`
- Modify: `packages/core/src/schemas/chat/chat-message-requests.schema.ts` (add optional `attachmentIds: string[]`)

**Acceptance Criteria:**
- Chat input hosts `<FileDropzone>` + a pending-attachment tray; send uploads first, then posts the message with `attachmentIds`.
- Send endpoint links attachments to the created message (`owner_type:'chat_message'`).
- `ChatMessageItem` renders attachments (image thumbnails, doc chips).
- Message endpoint stays JSON (upload is a separate call).

**Definition of Done:**
- [ ] Drag-drop/picker works in chat; attachments render on messages
- [ ] Send-with-attachments unit tested (web + API)
- [ ] Lint passes

---

### Task 10: Project "Add Files" Panel

**Scope:** Reuse the primitive on the project workspace.

**Files:**
- Create: `apps/web/src/components/attachments/AddFilesPanel.tsx` (+ spec)
- Modify: project workspace page to host the panel

**Acceptance Criteria:**
- `<AddFilesPanel>` reuses `useFileUpload` + `<FileDropzone>`, linking uploads to `owner_type:'project'`.
- Lists a project's attachments with parse status and download.
- No duplicated upload logic versus the chat surface.

**Definition of Done:**
- [ ] Panel uploads and lists project attachments
- [ ] Reuses the shared hook/components
- [ ] Lint passes

---

### Task 11: Feature Flag, Config & Documentation

**Scope:** Safe rollout and docs.

**Files:**
- Modify: config/flag wiring (`attachments_enabled`, default off)
- Modify: `.env.example` / compose env (Garage + flags)
- Create: `docs/guides/file-attachments.md`
- Modify: `docs/architecture/ingestion-tools.md` (link `get_attachment` / `list_attachments`)

**Acceptance Criteria:**
- `attachments_enabled` gates upload endpoint, chat UI, and project panel.
- All new env vars documented (`GARAGE_S3_*`, `ATTACHMENTS_IMAGE_VISION_EAGER`, size cap, flag).
- Guide covers supported formats, size limits, how agents consume attachments, and security notes.

**Definition of Done:**
- [ ] Flag gates all new surfaces
- [ ] Config documented
- [ ] Guide written and peer-reviewed

---

## 4. Definition of Done (Epic Level)

- [ ] Reusable `AttachmentsModule` (storage + metadata + parsing + read) implemented
- [ ] Garage object store integrated into the stack; bucket private
- [ ] Eager parse worker caches agent-readable markdown
- [ ] Parser logic deduplicated (tools delegate to shared services)
- [ ] Agents receive parsed content via context injection + `get_attachment` tool
- [ ] Reusable frontend primitive wired into chat **and** project workspace
- [ ] All new code unit tested (>80%); existing tool tests unchanged
- [ ] All tests pass (`npm run test`), lint passes (`npm run lint`)
- [ ] Feature flag `attachments_enabled` (default off)
- [ ] Documentation updated

---

## 5. Dependencies

- **EPIC-129 (Ingestion Tools):** Reuses `pdf-parse`/`mammoth` and the vision client; refactors `read_document` / `analyze_image`.
- **EPIC-064 (Chat Sessions):** Chat surface for attachment send/render.
- **Supersedes** the upload/storage portions of EPIC-132 (Tasks 3–4) and EPIC-133 (Task 2, Task 6) with a reusable foundation; the remaining EPIC-132/133 scope (file viewer, Figma import, kanban styling, Telegram, command discovery) is unaffected and out of scope here.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Eager image-vision token cost | `ATTACHMENTS_IMAGE_VISION_EAGER` flag + per-batch cap; over-cap parses lazily |
| New infra (Garage) ops burden | Single lightweight service; private bucket; mocked in tests |
| Object store ↔ filesystem-tool mismatch | Materialize originals to worktree on demand via `get_attachment` |
| Malicious uploads | MIME allowlist, size cap, no executables, checksum dedupe, never log bytes |
| Path traversal on materialization | Strict path validation confined to `.attachments/<id>/` |
| Scope creep into EPIC-132/133 | Explicit out-of-scope list; foundation only |
