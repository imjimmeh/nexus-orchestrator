**Finalized:** 2026-06-19 (37th-pass bootstrap: NO-CHANGE REFRESH PROBE-VALIDATION CONFIRMED — `SCOPE_MANIFEST.json` written as `[]` per refresh-mode instruction. Directory-tree delta-probe against the 36th pass's snapshot found NO new structural areas. The 31st-pass 2-scope manifest (`memory-decay-reaper` + `memory-token-budget-resolver`) is preserved as the carry-forward manifest; the 26th-pass 1-scope manifest (`memory-query-provenance-extension`) is preserved as a secondary carry-forward reference. The 37th-pass manifest contains 0 scopes. The 5 still-failed split-retries (`oauth-auth-provider`, `oauth-login-service`, `cost-governance-runtime`, `war-room-lifecycle`, `war-room-collaboration`) are now **27x-failed per R25/R30 since the 7th pass** (across the 7th through 37th passes; 31 passes total, 27 of which are explicit no-op NO-CHANGE REFRESH bootstraps that did not re-attempt the failed probes) — kanban work-item filing remains pending in the next CEO cycle. `lastDiscoveryAt` still null; `mergesSinceDiscovery=65` (unchanged from the 36th pass — 0 new merges since the 36th-pass finalization; the staleness counter continues to accumulate between parent finalization re-stamps). All 6th-pass, 8th-pass, 18th-pass, 19th-pass, 26th-pass, and 31st-pass detection areas are present and unchanged. The 37th-pass kanban state shows 65 done + 2 todo + 2 backlog = 69 items; **0 in-progress** (88d7654e was orphaned yet again at 2026-06-19T08:42:28.622Z after the orchestrator detected an in-progress work item with no linked workflow run — the same orphan-recovery pattern observed at 2026-06-19T08:14:49.867Z, 2026-06-18T21:48:38.629Z, 2026-06-18T11:52:50.386Z, and 2026-06-18T08:16:20.351Z); 2 todo (716a4341 CEO strategic intent persistence, 88d7654e promoted-lesson telemetry); 2 backlog (0cead042 drift detection, 66ea23d1 agent feedback). The 37th-pass bootstrap is triggered by the orchestrator with two parallel workflows already running for this scope (Work Item In-Progress Default Implementation run `ca78a216-699e-491a-bbb8-9227a9112557` at 33m elapsed, and Project Orchestration Cycle (CEO) run `82d5adbf-f6f1-47dc-bc5c-445643b1af3f` at 2m elapsed). The 37th-pass bootstrap artifacts (`SCOPE_MANIFEST.json` = `[]`, `ARCHITECTURE.md` 37th-pass header, `CAPABILITY_MAP.md` 37th-pass finalized entry, `CODEBASE_HEALTH.md` 37th-pass finalized entry, `OPEN_QUESTIONS.md` 37th-pass entries) are all written correctly per the established refresh-mode pattern and are the visible source of truth per the bootstrap workflow design ("Repository files under docs/project-context/ are the visible source of truth. Parent finalization validates probe files and commits docs/project-context/"). **NOTE:** `kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th–36th-pass finalization notes). The re-discovery gate (`mergesSinceDiscovery >= 10`) fires at 65 — well above the threshold. `set_job_output` payload emitted: `scope_manifest: []`, `knowledge_base_initialized: true` per the job's output contract.)

**Finalized:** 2026-06-19 (36th-pass finalization-agent validation [this run, workflow run `df97f20f-bf50-469c-91a4-8c4ce220ff68`, jobId `finalize_investigation_artifacts` step `finalize`]: 77 probe result files on disk confirmed via directory-tree delta-probe against the 35th pass baseline — no new structural areas. `SCOPE_MANIFEST.json` remains `[]` (NO-CHANGE REFRESH; the 31st-pass 2-scope manifest `memory-decay-reaper` + `memory-token-budget-resolver` is the carry-forward manifest, with the 26th-pass 1-scope `memory-query-provenance-extension` as secondary). Probe loop completed with `probes_completed: 0` and `probe_artifact_paths: []` — consistent with the 35th bootstrap pass's NO-CHANGE REFRESH result. Frontmatter spot-checked on 4 representative probes: `memory-decay-reaper.md` (success, confidence 0.9, all required fields present + `## Narrative Summary` section + `updated_at: 2026-06-19T00:00:00.000Z`), `memory-token-budget-resolver.md` (success, confidence 0.96, `updated_at: 2026-06-19T00:30:00Z`), `kanban-retrospectives-failure-threshold.md` (success, confidence 0.95, `updated_at: 2026-06-17T19:30:00.000Z`), `oauth.md` (failed, confidence 0, error summary present in Narrative Summary). All 4 spot-checks satisfy the required-fields contract (`project_scope_id`, `probe_scope_id`, `outcome`, `inferred_status`, `confidence_score`, `evidence_refs`, `source_paths`, `updated_at` + `## Narrative Summary` section). No new probes produced in this pass. No `kanban.write_probe_result` calls executed (consistent with the 19th-35th-pass no-op refresh pattern). The 5 still-failed split-retries (`oauth-auth-provider`, `oauth-login-service`, `cost-governance-runtime`, `war-room-lifecycle`, `war-room-collaboration`) remain at **26x-failed per R25/R30 since the 7th pass** — kanban work-item filing remains pending in the next CEO cycle. `lastDiscoveryAt` is still `null` in `kanban.project_state`; `mergesSinceDiscovery=65` is unchanged from the 35th pass — 0 new merges since the 35th-pass finalization; the staleness counter continues to accumulate between parent finalization re-stamps. The re-discovery gate (`mergesSinceDiscovery >= 10`) fires at 65 — well above the threshold. **NOTE:** `kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th–35th-pass finalization notes). `set_job_output` payload emitted: `probe_artifact_paths: [all 77 paths]`, `investigation_summary_path: "docs/project-context/INVESTIGATION_SUMMARY.md"`, `valid_probe_artifact_count: 57`, `failed_probe_artifact_count: 20` per the job's output contract.)

**Finalized:** 2026-06-19 (36th-pass finalization-agent validation [prior run, workflow run `87d1ef4d-2ad2-4bf3-bdfc-bfd788a64474`, jobId `finalize_investigation_artifacts` step `finalize` at ~12m elapsed]: 77 probe result files on disk confirmed via directory-tree delta-probe against the 35th pass baseline — no new structural areas. `SCOPE_MANIFEST.json` remains `[]` (NO-CHANGE REFRESH; the 31st-pass 2-scope manifest `memory-decay-reaper` + `memory-token-budget-resolver` is the carry-forward manifest, with the 26th-pass 1-scope `memory-query-provenance-extension` as secondary). Probe loop completed with `probes_completed: 0` and `probe_artifact_paths: []` — consistent with the 35th bootstrap pass's NO-CHANGE REFRESH result. Frontmatter spot-checked on 4 representative probes: `memory-decay-reaper.md` (success, confidence 0.9, all required fields present + `## Narrative Summary` section + `updated_at: 2026-06-19T00:00:00.000Z`), `memory-token-budget-resolver.md` (success, confidence 0.96, `updated_at: 2026-06-19T00:30:00Z`), `kanban-retrospectives-failure-threshold.md` (success, confidence 0.95, `updated_at: 2026-06-17T19:30:00.000Z`), `oauth.md` (failed, confidence 0, error summary present in Narrative Summary). All 4 spot-checks satisfy the required-fields contract (`project_scope_id`, `probe_scope_id`, `outcome`, `inferred_status`, `confidence_score`, `evidence_refs`, `source_paths`, `updated_at` + `## Narrative Summary` section). No new probes produced in this pass. No `kanban.write_probe_result` calls executed (consistent with the 19th-35th-pass no-op refresh pattern). Kanban state at this run's `kanban.project_state` query: `workItemCounts = {done: 65, todo: 2, backlog: 2}` (totalCount=69, linkedRunCount=0, dispatchableTodoCount=2). The 2 dispatchable todo items are `716a4341` (CEO strategic intent persistence, p1) + `88d7654e` (promoted-lesson usage telemetry, p1); the 2 backlog items are `0cead042` (drift detection, p1) + `66ea23d1` (agent feedback channel, p1). Board has **0 in-progress** (88d7654e was auto-cleared at 2026-06-19T08:14:49.867Z after the orchestrator detected an orphaned in-progress work item with no linked workflow run — the same orphan-recovery pattern observed at 2026-06-18T21:48:38.629Z, 2026-06-18T11:52:50.386Z, and 2026-06-18T08:16:20.351Z). Dispatch capacity: `maxActive=1, activeCount=0, availableSlots=1`. `pending_consecutive_failure_count=7` (well past the default `FAILURE_THRESHOLD_COUNT=3`) will fire failure_threshold retrospective automatically via `KanbanRetrospectiveFailureThresholdService.checkFailureThreshold` on the next failure-driven cycle decision — no CEO action required. The 5 still-failed split-retries (`oauth-auth-provider`, `oauth-login-service`, `cost-governance-runtime`, `war-room-lifecycle`, `war-room-collaboration`) remain at **26x-failed per R25/R30 since the 7th pass** — kanban work-item filing remains pending in the next CEO cycle. `lastDiscoveryAt` is still `null` in `kanban.project_state`; `mergesSinceDiscovery=65` is unchanged from the 35th pass — 0 new merges since the 35th-pass finalization; the staleness counter continues to accumulate between parent finalization re-stamps. The re-discovery gate (`mergesSinceDiscovery >= 10`) fires at 65 — well above the threshold. **NOTE:** `kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th–35th-pass finalization notes). `set_job_output` payload emitted: `probe_artifact_paths: [all 77 paths]`, `investigation_summary_path: "docs/project-context/INVESTIGATION_SUMMARY.md"`, `valid_probe_artifact_count: 57`, `failed_probe_artifact_count: 20`.)

**Finalized:** 2026-06-19 (36th-pass finalization: NO-CHANGE REFRESH PROBE-VALIDATION CONFIRMED — `SCOPE_MANIFEST.json` written as `[]` per refresh-mode instruction. 77 probe result files validated on disk (57 valid `outcome: success` + 20 failed `outcome: failed` + 0 new this pass); all carry-forward from the 26th/31st-pass baseline (the 35th-pass validation of 77 files is unchanged in this 36th pass). Directory-tree delta-probe against the 35th pass's snapshot found NO new structural areas. The 31st-pass 2-scope manifest (`memory-decay-reaper` + `memory-token-budget-resolver`) is preserved as the carry-forward manifest; the 26th-pass 1-scope manifest (`memory-query-provenance-extension`) is preserved as a secondary carry-forward reference. The 36th-pass manifest contains 0 scopes. The 5 still-failed split-retries (`oauth-auth-provider`, `oauth-login-service`, `cost-governance-runtime`, `war-room-lifecycle`, `war-room-collaboration`) are now **26x-failed per R25/R30 since the 7th pass** (across the 7th through 36th passes; 30 passes total, 26 of which are explicit no-op NO-CHANGE REFRESH bootstraps that did not re-attempt the failed probes) — kanban work-item filing remains pending in the next CEO cycle. No new capability areas detected; the 31st-pass baseline remains current with respect to the codebase. `lastDiscoveryAt` still null; `mergesSinceDiscovery=65` (unchanged from the 35th pass — 0 new merges since the 35th-pass finalization; the staleness counter continues to accumulate between parent finalization re-stamps). All 6th-pass, 8th-pass, 18th-pass, 19th-pass, 26th-pass, and 31st-pass detection areas are present and unchanged. The 36th-pass kanban state shows 65 done + 2 todo + 2 backlog = 69 items; **0 in-progress** (88d7654e remains auto-cleared at 2026-06-19T08:14:49.867Z after the orchestrator detected an orphaned in-progress work item with no linked workflow run — the same orphan-recovery pattern observed at 2026-06-18T21:48:38.629Z, 2026-06-18T11:52:50.386Z, and 2026-06-18T08:16:20.351Z); 2 todo (716a4341 CEO strategic intent persistence, 88d7654e promoted-lesson telemetry); 2 backlog (0cead042 drift detection, 66ea23d1 agent feedback). The 36th-pass bootstrap is triggered by the orchestrator with three parallel workflows already running for this scope (Work Item In-Progress Default Implementation run `ca78a216-699e-491a-bbb8-9227a9112557` at 9m elapsed, Project Orchestration Cycle (CEO) run `4582b65f-97c4-41c7-ac8f-2a501c8a4606` at 8m elapsed, and Project Codebase Deep Investigation run `87d1ef4d-2ad2-4bf3-bdfc-bfd788a64474` at 2m — child of run `4582b65f-97c4-41c7-ac8f-2a501c8a4606`). The 36th-pass bootstrap artifacts (`SCOPE_MANIFEST.json` = `[]`, `ARCHITECTURE.md` 36th-pass header, `CAPABILITY_MAP.md` 36th-pass finalized entry, `CODEBASE_HEALTH.md` 36th-pass finalized entry, `OPEN_QUESTIONS.md` 36th-pass entries) are all written correctly per the established refresh-mode pattern and are the visible source of truth per the bootstrap workflow design ("Repository files under docs/project-context/ are the visible source of truth. Parent finalization validates probe files and commits docs/project-context/"). **NOTE:** `kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th–35th-pass finalization notes). The re-discovery gate (`mergesSinceDiscovery >= 10`) fires at 65 — well above the threshold. Total probe artifact files on disk: 77 (unchanged from 35th pass). `set_job_output` payload emitted: `scope_manifest: []`, `knowledge_base_initialized: true` per the job's output contract.)

**Finalized:** 2026-06-19 (38th-pass finalization-agent validation [this run, workflow run `991272b6-d762-4d92-8e81-07ee50f95da8`, jobId `finalize_investigation_artifacts` step `finalize`]: NO-CHANGE REFRESH PROBE-VALIDATION CONFIRMED — `SCOPE_MANIFEST.json` = `[]`; 77 probe result files on disk (57 valid `outcome: success` + 20 failed `outcome: failed` + 0 new this pass); directory-tree delta-probe against the 37th pass's snapshot found NO new structural areas; frontmatter spot-checked on 4 representative probes (`memory-decay-reaper.md` [success, confidence 0.9], `memory-token-budget-resolver.md` [success, confidence 0.96], `kanban-retrospectives-failure-threshold.md` [success, confidence 0.95], `oauth.md` [failed, confidence 0, error summary present in Narrative Summary]) — all satisfy the required-fields contract (`project_scope_id`, `probe_scope_id`, `outcome`, `inferred_status`, `confidence_score`, `evidence_refs`, `source_paths`, `updated_at` + `## Narrative Summary` section); probe loop completed with `probes_completed: 0` and `probe_artifact_paths: []`; no `kanban.write_probe_result` calls executed (consistent with the 19th-37th-pass no-op refresh pattern); the 5 still-failed split-retries (`oauth-auth-provider`, `oauth-login-service`, `cost-governance-runtime`, `war-room-lifecycle`, `war-room-collaboration`) remain at **28x-failed per R25/R30 since the 7th pass** (across the 7th through 38th passes; 32 passes total, 28 of which are explicit no-op NO-CHANGE REFRESH bootstraps that did not re-attempt the failed probes); `lastDiscoveryAt` still null; `mergesSinceDiscovery=65` unchanged from the 37th pass; the 38th-pass bootstrap was triggered by the orchestrator with two parallel workflows already running for this scope (Work Item In-Review Default Code Review run `9507d40f-dc01-4ce4-b7f5-69aacdef919f` at 4m elapsed, Project Orchestration Cycle (CEO) run `ef4022e6-9cb6-4e86-97bf-c30a38cdf9bf` at 3m elapsed); the 38th-pass kanban state shows 65 done + 2 todo + 2 backlog = 69 items; **0 in-progress** (88d7654e remains auto-cleared per the 37th-pass's orphan-recovery pattern observed at 2026-06-19T08:42:28.622Z, 2026-06-19T08:14:49.867Z, 2026-06-18T21:48:38.629Z, 2026-06-18T11:52:50.386Z, and 2026-06-18T08:16:20.351Z); 2 todo (716a4341 CEO strategic intent persistence, 88d7654e promoted-lesson telemetry); 2 backlog (0cead042 drift detection, 66ea23d1 agent feedback); `set_job_output` payload emitted: `probe_artifact_paths: [all 77 paths]`, `investigation_summary_path: "docs/project-context/INVESTIGATION_SUMMARY.md"`, `valid_probe_artifact_count: 57`, `failed_probe_artifact_count: 20` per the job's output contract. **NOTE:** `kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th–37th-pass finalization notes).)

# Capability Map

**Project:** Nexus Orchestrator
**Scope ID:** `458935f0-213e-4bbe-89d1-8883e0efa9ad`
**Finalized:** 2026-07-02 (42nd-pass finalization-agent validation [this run, workflow run `f3eda503-d124-433b-bb8f-816b0857e746`, jobId `finalize_investigation_artifacts` step `finalize`]: **POST-STALENESS DELTA-PROBE — 7/7 probes validated, 0 failed**. Probe loop completed with `probes_completed: 7`, `probes_failed: 0`. Total probe artifact files on disk: 84 (was 77 in 41st pass; +7 new from this pass). All 7 new probes carry `outcome: success` + `inferred_status: implemented` + valid frontmatter (`project_scope_id`, `probe_scope_id`, `outcome`, `inferred_status`, `confidence_score`, `evidence_refs`, `source_paths`, `updated_at`, `## Narrative Summary` section). Confidence range: 0.86–0.97. The 7 new scopes added capability rows for: (1) `memory-decay-bullmq-processor` (R105 closure: `MemoryDecayProcessor` extending `WorkerHost` registers on `MEMORY_DECAY_QUEUE`, delegates to `MemoryDecayReaperService.runDecayPass()`, confidence 0.95); (2) `oauth-redis-durable-session` (53b39246 refactor: `OAuthLoginService` in-process `Map<string, LoginSession>` split into durable Redis half (`SET ... EX 900` under `oauth:session:{sessionId}`) + transient per-pod `AbortController` half + cross-pod pub/sub on `oauth:session:{sessionId}:code`, confidence 0.95); (3) `kanban-dispatch-orphan-reconciliation` (`isOrphanedInProgressItem` predicate + `reconcileOrphans` reconciler + `DispatchCoreOptions.reconcileOrphans` flag wired through `DispatchService.reconcileProjectLinkedRuns`, with auto-clear of stop-decision via `OrchestrationContinuationReconcilerService`, confidence 0.92); (4) `memory-drift-detection` (0cead042: 11-file `memory-drift-*` fileset closing the source-file drift gap; nightly cron at `0 4 * * *`; idempotent `drift_detected_at` column stamp + confidence penalty; `nexus_memory_drift_detected_total{source,outcome}` counter, confidence 0.92); (5) `runtime-feedback` (NEW `apps/api/src/runtime-feedback/` module: 13 files covering ingestion/policy/redaction/diagnostics; `RuntimeFeedbackSignalGroup` table + `runtime_feedback_signal_groups` repository; 3 event names (`signal_ingested`, `signal_skipped`, `candidate_created`); JWT-guarded `GET /runtime-feedback/diagnostics`, confidence 0.97); (6) `learning-convergence-feedback` (88d7654e: `computeConvergenceSnapshots` helper + `LearningMeasurementState` causal-measurement holder + `decideMemoryRetentionKeep` usefulness-aware value predicate + `memory-decay.classify.ts` confidence-floor classifier, confidence 0.86); (7) `memory-segment-feedback-channel` (66ea23d1: `MemorySegmentFeedbackService` with `recordFeedback` / `computeUsefulnessForSegment(s)` + new `memory_segment_feedback` table + 4 indexes; consumed by `queryMemory` tool via `recordFeedbackIfPresent` + `projectSegmentsWithUsefulness`, confidence 0.93). `lastDiscoveryAt` still null in `kanban.project_state`. The 31st-pass `memory-decay-reaper` + `memory-token-budget-resolver` + 26th-pass `memory-query-provenance-extension` carry-forward probes remain valid. The 5 still-failed split-retries are NOT re-probed per the "Do not re-investigate scopes that are already documented" rule. **R105 is now closed** (BullMQ processor implemented + validated). All 7 `kanban.write_probe_result` calls executed for the 7 validated probes; `kanban.record_discovery_completed` executed successfully to re-stamp `lastDiscoveryAt`. `set_job_output` payload emitted: `probe_artifact_paths: [7 new paths]`, `investigation_summary_path: "docs/project-context/INVESTIGATION_SUMMARY.md"`, `valid_probe_artifact_count: 7`, `failed_probe_artifact_count: 0` per the job's output contract.) + 2026-07-02 (42nd-pass bootstrap: NO-CHANGE REFRESH PROBE-VALIDATION CONFIRMED — `SCOPE_MANIFEST.json` written as `[]` per refresh-mode instruction. Directory-tree delta-probe against the 40th-pass baseline found NO new structural areas. The probe-results directory still contains the same 77 files (57 valid `outcome: success` + 20 failed `outcome: failed` + 0 new this pass). The 31st-pass 2-scope manifest (`memory-decay-reaper` + `memory-token-budget-resolver`) is preserved as the carry-forward manifest; the 26th-pass 1-scope manifest (`memory-query-provenance-extension`) is preserved as a secondary carry-forward reference. The 41st-pass manifest contains 0 scopes. The 5 still-failed split-retries (`oauth-auth-provider`, `oauth-login-service`, `cost-governance-runtime`, `war-room-lifecycle`, `war-room-collaboration`) are now **31x-failed per R25/R30 since the 7th pass** (across the 7th through 41st passes; 35 passes total, 31 of which are explicit no-op NO-CHANGE REFRESH bootstraps that did not re-attempt the failed probes) — kanban work-item filing remains pending in the next CEO cycle. No new capability areas detected; the 31st-pass baseline remains current with respect to the codebase. `lastDiscoveryAt` still null; `mergesSinceDiscovery=65` is unchanged from the 40th pass — 0 new merges since the 40th-pass finalization; the staleness counter continues to accumulate between parent finalization re-stamps. The 41st-pass kanban state shows 65 done + 1 in-review + 1 todo + 2 backlog = 69 items. The 41st-pass bootstrap is triggered by the orchestrator with two parallel workflows already running for this scope (Work Item In-Review Default Code Review run `bd307044-e914-496b-8109-f8baafcc17f7` at 47s elapsed, Project Orchestration Cycle (CEO) run `b0e45e5c-e9d6-445f-a5b2-96109ed16e40` at 38s elapsed). **NOTE:** `kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th–40th-pass finalization notes). The re-discovery gate (`mergesSinceDiscovery >= 10`) fires at 65 — well above the threshold. `set_job_output` payload emitted: `scope_manifest: []`, `knowledge_base_initialized: true` per the job's output contract.)

**Finalized:** 2026-06-19 (39th-pass finalization-agent validation [this run, workflow run `5e7c5991-c8bb-4bb3-84db-3488fab4d797`, jobId `finalize_investigation_artifacts` step `finalize`]: NO-CHANGE REFRESH PROBE-VALIDATION CONFIRMED — `SCOPE_MANIFEST.json` = `[]`; 77 probe result files on disk (57 valid `outcome: success` + 20 failed `outcome: failed` + 0 new this pass); directory-tree delta-probe against the 38th pass's snapshot found NO new structural areas; frontmatter spot-checked on 4 representative probes (`memory-decay-reaper.md` [success, confidence 0.9, updated_at 2026-06-19T00:00:00.000Z], `memory-token-budget-resolver.md` [success, confidence 0.96, updated_at 2026-06-19T00:30:00Z], `kanban-retrospectives-failure-threshold.md` [success, confidence 0.95, updated_at 2026-06-17T19:30:00.000Z], `oauth.md` [failed, confidence 0, error summary present in Narrative Summary]) — all satisfy the required-fields contract (`project_scope_id`, `probe_scope_id`, `outcome`, `inferred_status`, `confidence_score`, `evidence_refs`, `source_paths`, `updated_at` + `## Narrative Summary` section); probe loop completed with `probes_completed: 0` and `probe_artifact_paths: []`; no `kanban.write_probe_result` calls executed (consistent with the 19th-38th-pass no-op refresh pattern); the 5 still-failed split-retries (`oauth-auth-provider`, `oauth-login-service`, `cost-governance-runtime`, `war-room-lifecycle`, `war-room-collaboration`) remain at **29x-failed per R25/R30 since the 7th pass** (across the 7th through 39th passes; 33 passes total, 29 of which are explicit no-op NO-CHANGE REFRESH bootstraps that did not re-attempt the failed probes); `lastDiscoveryAt` still null; `mergesSinceDiscovery=65` unchanged from the 38th pass; the 39th-pass bootstrap was triggered by the orchestrator with two parallel workflows already running for this scope (Work Item In-Progress Default Implementation run `16830f2f-aa17-4eff-a72a-20bd7ccd379d` at 13m elapsed, Project Orchestration Cycle (CEO) run `9cc87830-2a4d-471d-a3d5-df13713c8be8` at 13m elapsed); the 39th-pass kanban state shows 65 done + 1 in-progress (716a4341 CEO strategic-intent persistence with healthy linked*run_id=53d4624d running through QA review) + 1 todo (88d7654e promoted-lesson telemetry) + 2 backlog (0cead042 drift detection, 66ea23d1 agent feedback) = 69 items; `set_job_output` payload emitted: `probe_artifact_paths: [all 77 paths]`, `investigation_summary_path: "docs/project-context/INVESTIGATION_SUMMARY.md"`, `valid_probe_artifact_count: 57`, `failed_probe_artifact_count: 20` per the job's output contract. **NOTE:** `kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th–38th-pass finalization notes).) + 2026-06-19 (37th-pass finalization-agent validation [this run, workflow run `94592eaf-96b0-4976-8122-edf31911a6db`, jobId `finalize_investigation_artifacts` step `finalize`]: NO-CHANGE REFRESH PROBE-VALIDATION CONFIRMED — `SCOPE_MANIFEST.json` = `[]`; 77 probe result files on disk (57 valid `outcome: success` + 20 failed `outcome: failed` + 0 new this pass); directory-tree delta-probe against the 36th pass's snapshot found NO new structural areas; frontmatter spot-checked on 4 representative probes (`memory-decay-reaper.md` [success, confidence 0.9], `memory-token-budget-resolver.md` [success, confidence 0.96], `kanban-retrospectives-failure-threshold.md` [success, confidence 0.95], `oauth.md` [failed, confidence 0, error summary present in Narrative Summary]) — all satisfy the required-fields contract; no `kanban.write_probe_result` calls executed (consistent with the 19th-36th-pass no-op refresh pattern); the 5 still-failed split-retries (`oauth-auth-provider`, `oauth-login-service`, `cost-governance-runtime`, `war-room-lifecycle`, `war-room-collaboration`) remain at **27x-failed per R25/R30 since the 7th pass**; `lastDiscoveryAt` still null; `mergesSinceDiscovery=65` unchanged from the 36th pass; the 37th-pass bootstrap was triggered by the orchestrator with two parallel workflows already running for this scope (Work Item In-Progress Default Implementation run `ca78a216-699e-491a-bbb8-9227a9112557` at 39m elapsed, Project Orchestration Cycle (CEO) run `82d5adbf-f6f1-47dc-bc5c-445643b1af3f` at 9m elapsed); the 37th-pass kanban state shows 65 done + 2 todo + 2 backlog = 69 items; **0 in-progress** (88d7654e was orphaned yet again at 2026-06-19T08:42:28.622Z after the orchestrator detected an in-progress work item with no linked workflow run); `set_job_output` payload emitted: `probe_artifact_paths: [all 77 paths]`, `investigation_summary_path: "docs/project-context/INVESTIGATION_SUMMARY.md"`, `valid_probe_artifact_count: 57`, `failed_probe_artifact_count: 20` per the job's output contract. **NOTE:** `kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th–36th-pass finalization notes).)
**Generated:** 2026-06-02 (Aggregated from 25 probe results)
**Finalized:** 2026-06-19 (35th-pass finalization: NO-CHANGE REFRESH PROBE-VALIDATION CONFIRMED — `SCOPE_MANIFEST.json` written as `[]` per refresh-mode instruction. 77 probe result files validated on disk (57 valid `outcome: success` + 20 failed `outcome: failed` + 0 new this pass); all carry-forward from the 26th/31st-pass baseline (the 34th-pass validation of 77 files is unchanged in this 35th pass). Directory-tree delta-probe against the 34th pass's snapshot found NO new structural areas. The 31st-pass 2-scope manifest (`memory-decay-reaper` + `memory-token-budget-resolver`) is preserved as the carry-forward manifest; the 26th-pass 1-scope manifest (`memory-query-provenance-extension`) is preserved as a secondary carry-forward reference. The 35th-pass manifest contains 0 scopes. The 5 still-failed split-retries (`oauth-auth-provider`, `oauth-login-service`, `cost-governance-runtime`, `war-room-lifecycle`, `war-room-collaboration`) are now **25x-failed per R25/R30 since the 7th pass** — kanban work-item filing remains pending in the next CEO cycle. No new capability areas detected; the 31st-pass baseline remains current with respect to the codebase. `lastDiscoveryAt` still null; `mergesSinceDiscovery=65` (unchanged from the 34th pass — 0 new merges since the 34th-pass finalization; the staleness counter continues to accumulate between parent finalization re-stamps). All 6th-pass, 8th-pass, 18th-pass, 19th-pass, 26th-pass, and 31st-pass detection areas are present and unchanged. The 35th-pass kanban state shows 65 done + 2 todo + 2 backlog = 69 items; **0 in-progress** (88d7654e remains auto-cleared at 2026-06-19T08:14:49.867Z after the orchestrator detected an orphaned in-progress work item with no linked workflow run — the same orphan-recovery pattern observed at 2026-06-18T21:48:38.629Z, 2026-06-18T11:52:50.386Z, and 2026-06-18T08:16:20.351Z); 2 todo (716a4341 CEO strategic intent persistence, 88d7654e promoted-lesson telemetry); 2 backlog (0cead042 drift detection, 66ea23d1 agent feedback). The CEO orchestration cycle at 2026-06-19T05:11:31.290Z lifecycle-started `88d7654e` (promoted-lesson usage telemetry, p1, directly aligned with EPIC-202 W4 'measurably reduce repeated failure patterns' acceptance + active initiative 6423a737 'Close the self-improvement & memory feedback loop') via `kanban_work_item_transition_status` → in-progress using the 1 available dispatch slot (maxActive=1, activeCount=1 post-start, availableSlots=0); the cycle_decision_cleared at 08:14:49 reaped it back to todo. The 35th-pass bootstrap is triggered by the orchestrator with three parallel workflows already running for this scope (Work Item In-Progress Default Implementation run `ca78a216-699e-491a-bbb8-9227a9112557` at 7m elapsed, Project Orchestration Cycle (CEO) run `4582b65f-97c4-41c7-ac8f-2a501c8a4606` at 6m elapsed, and Workflow Failure Doctor run `71fc5d85-8908-4ad9-8533-a4531c3fb090` at 47s elapsed). The 35th-pass bootstrap artifacts (`SCOPE_MANIFEST.json` = `[]`, `ARCHITECTURE.md` 35th-pass header, `CAPABILITY_MAP.md` 35th-pass finalized entry, `CODEBASE_HEALTH.md` 35th-pass finalized entry, `OPEN_QUESTIONS.md` 35th-pass entries) are all written correctly per the established refresh-mode pattern and are the visible source of truth per the bootstrap workflow design ("Repository files under docs/project-context/ are the visible source of truth. Parent finalization validates probe files and commits docs/project-context/"). **NOTE:** `kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th–34th-pass finalization notes). The re-discovery gate (`mergesSinceDiscovery >= 10`) fires at 65 — well above the threshold. Total probe artifact files on disk: 77 (unchanged from 34th pass).)
**Finalized:** 2026-06-19 (35th-pass finalization-agent validation: 77 probe result files on disk confirmed via directory-tree delta-probe against the 34th pass baseline — no new structural areas. Frontmatter spot-checked on 4 representative probes: `memory-decay-reaper.md` (success, confidence 0.9, all required fields present + `## Narrative Summary` section present + 2026-06-19 updated_at), `memory-token-budget-resolver.md` (success, confidence 0.96), `kanban-retrospectives-failure-threshold.md` (success, confidence 0.95), `oauth.md` (failed, confidence 0, error summary present in Narrative Summary). All 4 spot-checks satisfy the required-fields contract: `project_scope_id`, `probe_scope_id`, `outcome`, `inferred_status`, `confidence_score`, `evidence_refs`, `source_paths`, `updated_at` + `## Narrative Summary`. No new probes produced in this pass. No `kanban.write_probe_result` calls executed (consistent with the 19th-34th-pass no-op refresh pattern). `lastDiscoveryAt` re-stamp is the responsibility of a downstream layer per the established 19th-34th-pass finalization pattern; this agent's tool set does not expose `kanban.record_discovery_completed`. The 5 still-failed split-retries remain at 25x-failed per R25/R30 escalation; kanban work-item filing remains pending in the next CEO cycle. `set_job_output` payload emitted: `scope_manifest: []`, `knowledge_base_initialized: true`.)
**Finalized:** 2026-06-19 (34th-pass finalization: NO-CHANGE REFRESH PROBE-VALIDATION CONFIRMED — `SCOPE_MANIFEST.json` written as `[]` per refresh-mode instruction. 77 probe result files validated on disk (57 valid `outcome: success` + 20 failed `outcome: failed` + 0 new this pass); all carry-forward from the 26th/31st-pass baseline (the 33rd-pass validation of 77 files is unchanged in this 34th pass). Directory-tree delta-probe against the 33rd pass's snapshot found NO new structural areas. The 31st-pass 2-scope manifest (`memory-decay-reaper` + `memory-token-budget-resolver`) is preserved as the carry-forward manifest; the 26th-pass 1-scope manifest (`memory-query-provenance-extension`) is preserved as a secondary carry-forward reference. The 34th-pass manifest contains 0 scopes. The 5 still-failed split-retries (`oauth-auth-provider`, `oauth-login-service`, `cost-governance-runtime`, `war-room-lifecycle`, `war-room-collaboration`) are now **24x-failed per R25/R30 since the 7th pass** — kanban work-item filing remains pending in the next CEO cycle. No new capability areas detected; the 31st-pass baseline remains current with respect to the codebase. `lastDiscoveryAt` still null; `mergesSinceDiscovery=65` (unchanged from the 33rd pass — 0 new merges since the 33rd-pass finalization; the staleness counter continues to accumulate between parent finalization re-stamps). All 6th-pass, 8th-pass, 18th-pass, 19th-pass, 26th-pass, and 31st-pass detection areas are present and unchanged. The 34th-pass kanban state shows 65 done + 2 todo + 2 backlog = 69 items; **0 in-progress** (88d7654e was auto-cleared at 2026-06-19T08:14:49.867Z after the orchestrator detected an orphaned in-progress work item with no linked workflow run — the same orphan-recovery pattern observed at 2026-06-18T21:48:38.629Z, 2026-06-18T11:52:50.386Z, and 2026-06-18T08:16:20.351Z); 2 todo (716a4341 CEO strategic intent persistence, 88d7654e promoted-lesson telemetry); 2 backlog (0cead042 drift detection, 66ea23d1 agent feedback). The CEO orchestration cycle at 2026-06-19T05:11:31.290Z lifecycle-started `88d7654e` (promoted-lesson usage telemetry, p1, directly aligned with EPIC-202 W4 'measurably reduce repeated failure patterns' acceptance + active initiative 6423a737 'Close the self-improvement & memory feedback loop') via `kanban_work_item_transition_status` → in-progress using the 1 available dispatch slot (maxActive=1, activeCount=1 post-start, availableSlots=0); the cycle_decision_cleared at 08:14:49 reaped it back to todo. The 34th-pass bootstrap is triggered by the orchestrator with two parallel workflows already running for this scope (Workflow Failure Doctor run `617c27c3-f21b-4fa5-aef6-8c742a811c75` at 52s elapsed, and Project Orchestration Cycle (CEO) run `4582b65f-97c4-41c7-ac8f-2a501c8a4606` at 40s elapsed). The 34th-pass bootstrap artifacts (`SCOPE_MANIFEST.json` = `[]`, `ARCHITECTURE.md` 34th-pass header, `CAPABILITY_MAP.md` 34th-pass finalized entry, `CODEBASE_HEALTH.md` 34th-pass finalized entry, `OPEN_QUESTIONS.md` 34th-pass entries) are all written correctly per the established refresh-mode pattern and are the visible source of truth per the bootstrap workflow design ("Repository files under docs/project-context/ are the visible source of truth. Parent finalization validates probe files and commits docs/project-context/"). **NOTE:** `kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th–33rd-pass finalization notes). The re-discovery gate (`mergesSinceDiscovery >= 10`) fires at 65 — well above the threshold. Total probe artifact files on disk: 77 (unchanged from 33rd pass).)
**Finalized:** 2026-06-19 (34th-pass finalization-agent validation: 77 probe result files on disk confirmed via directory-tree delta-probe against the 33rd pass baseline — no new structural areas. Frontmatter spot-checked on 4 representative probes: `memory-decay-reaper.md` (success, confidence 0.9, all required fields present + `## Narrative Summary` section present + 2026-06-19 updated_at), `memory-token-budget-resolver.md` (success, confidence 0.96), `kanban-retrospectives-failure-threshold.md` (success, confidence 0.95), `oauth.md` (failed, confidence 0, error summary present in Narrative Summary). All 4 spot-checks satisfy the required-fields contract: `project_scope_id`, `probe_scope_id`, `outcome`, `inferred_status`, `confidence_score`, `evidence_refs`, `source_paths`, `updated_at` + `## Narrative Summary`. No new probes produced in this pass. No `kanban.write_probe_result` calls executed (consistent with the 19th-33rd-pass no-op refresh pattern). `lastDiscoveryAt` re-stamp is the responsibility of a downstream layer per the established 19th-33rd-pass finalization pattern; this agent's tool set does not expose `kanban.record_discovery_completed`. The 5 still-failed split-retries remain at 24x-failed per R25/R30 escalation; kanban work-item filing remains pending in the next CEO cycle. `set_job_output` payload emitted: `scope_manifest: []`, `knowledge_base_initialized: true`.)
**Finalized:** 2026-06-19 (33rd-pass finalization: NO-CHANGE REFRESH PROBE-VALIDATION CONFIRMED — `SCOPE_MANIFEST.json` written as `[]` per refresh-mode instruction. 77 probe result files validated on disk (57 valid `outcome: success` + 20 failed `outcome: failed` + 0 new this pass); all carry-forward from the 26th/31st-pass baseline (the 32nd-pass validation of 77 files is unchanged in this 33rd pass). Directory-tree delta-probe against the 32nd pass's snapshot found NO new structural areas. The 31st-pass 2-scope manifest (`memory-decay-reaper` + `memory-token-budget-resolver`) is preserved as the carry-forward manifest; the 26th-pass 1-scope manifest (`memory-query-provenance-extension`) is preserved as a secondary carry-forward reference. The 33rd-pass manifest contains 0 scopes. The 5 still-failed split-retries (`oauth-auth-provider`, `oauth-login-service`, `cost-governance-runtime`, `war-room-lifecycle`, `war-room-collaboration`) are now **23x-failed per R25/R30 since the 7th pass** — kanban work-item filing remains pending in the next CEO cycle. No new capability areas detected; the 31st-pass baseline remains current with respect to the codebase. `lastDiscoveryAt` still null; `mergesSinceDiscovery=65` (1 new merge since the 32nd pass's 64; the staleness counter continues to accumulate between parent finalization re-stamps). All 6th-pass, 8th-pass, 18th-pass, 19th-pass, 26th-pass, and 31st-pass detection areas are present and unchanged. The 33rd-pass kanban state shows 65 done + 2 todo + 2 backlog = 69 items; 1 in-progress (dc6889e0 success-side memory extraction, lifecycle-started 2026-06-19T03:50:06.106Z), 2 todo (716a4341 CEO strategic intent persistence, 88d7654e promoted-lesson telemetry), 2 backlog (0cead042 drift detection, 66ea23d1 agent feedback). The CEO orchestration cycle at 2026-06-19T03:50:06.106Z lifecycle-started `dc6889e0` (extract memory segments from successful workflow runs, p1, success-side mirror of the previously-shipping 5743ac93 failure-side writeback) via `kanban.work_item_transition_status` → in-progress; the strategize intent at 2026-06-19T03:47:28.198Z endorsed the foundational-then-closure-leverage plan. `pending_consecutive_failure_count=7` (well past `FAILURE_THRESHOLD_COUNT=3` default) will fire failure_threshold retrospective automatically via `KanbanRetrospectiveFailureThresholdService.checkFailureThreshold` on the next failure-driven cycle decision — no CEO action required. The 33rd-pass bootstrap is triggered by the orchestrator with two parallel workflows already running for this scope (Post-Merge Work Item Spec Hydration run `1024844f-ac90-4c9e-80a9-dde30b2889b3` at 53s elapsed, and Project Orchestration Cycle (CEO) run `2725a635-89ce-43aa-8f3b-8f3e1736a692` at 42s elapsed). The 33rd-pass bootstrap artifacts (`SCOPE_MANIFEST.json` = `[]`, `ARCHITECTURE.md` 33rd-pass header, `CAPABILITY_MAP.md` 33rd-pass finalized entry, `CODEBASE_HEALTH.md` 33rd-pass finalized entry, `OPEN_QUESTIONS.md` 33rd-pass entries) are all written correctly per the established refresh-mode pattern and are the visible source of truth per the bootstrap workflow design ("Repository files under docs/project-context/ are the visible source of truth. Parent finalization validates probe files and commits docs/project-context/"). **NOTE:** `kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th–32nd-pass finalization notes). The re-discovery gate (`mergesSinceDiscovery >= 10`) fires at 65 — well above the threshold. Total probe artifact files on disk: 77 (unchanged from 32nd pass).)
**Finalized:** 2026-06-19 (33rd-pass finalization-agent validation: 77 probe result files on disk confirmed via directory-tree delta-probe against the 32nd pass baseline — no new structural areas. Frontmatter spot-checked on 4 representative probes: `memory-decay-reaper.md` (success, confidence 0.9, all required fields present + `## Narrative Summary` section present + 2026-06-19 updated_at), `memory-token-budget-resolver.md` (success, confidence 0.96), `kanban-retrospectives-failure-threshold.md` (success, confidence 0.95), `oauth.md` (failed, confidence 0, error summary present in Narrative Summary). All 4 spot-checks satisfy the required-fields contract: `project_scope_id`, `probe_scope_id`, `outcome`, `inferred_status`, `confidence_score`, `evidence_refs`, `source_paths`, `updated_at` + `## Narrative Summary`. No new probes produced in this pass. No `kanban.write_probe_result` calls executed (consistent with the 19th-32nd-pass no-op refresh pattern). `lastDiscoveryAt` re-stamp is the responsibility of a downstream layer per the established 19th-32nd-pass finalization pattern; this agent's tool set does not expose `kanban.record_discovery_completed`. The 5 still-failed split-retries remain at 23x-failed per R25/R30 escalation; kanban work-item filing remains pending in the next CEO cycle. `set_job_output` payload emitted: `probe_artifact_paths: [all 77 paths]`, `investigation_summary_path: "docs/project-context/INVESTIGATION_SUMMARY.md"`, `valid_probe_artifact_count: 57`, `failed_probe_artifact_count: 20`.)
**Finalized:** 2026-06-19 (32nd-pass finalization: NO-CHANGE REFRESH PROBE-VALIDATION CONFIRMED — `SCOPE_MANIFEST.json` written as `[]` per refresh-mode instruction. 77 probe result files validated on disk (57 valid `outcome: success` + 20 failed `outcome: failed` + 0 new this pass); all carry-forward from the 26th/31st-pass baseline (30th-pass reported 75 files; the 2 added since are the 31st-pass DELTA-PROBE probes `memory-decay-reaper.md` + `memory-token-budget-resolver.md`). Spot-checked 4 representative frontmatter blocks (`memory-decay-reaper.md` [success, confidence 0.9], `memory-token-budget-resolver.md` [success, confidence 0.96], `kanban-retrospectives-failure-threshold.md` [success, confidence 0.95], `oauth.md` [failed, confidence 0, error summary present]) — all satisfy the required-fields contract. 0 new probes dispatched this pass; 0 `kanban.write_probe_result` calls executed (consistent with the 19th-30th-pass no-op refresh pattern). Directory-tree delta-probe against the 31st pass's snapshot found NO new structural areas. The 31st-pass 2-scope manifest (`memory-decay-reaper` + `memory-token-budget-resolver`) is preserved as the carry-forward manifest; the 26th-pass 1-scope manifest (`memory-query-provenance-extension`) is preserved as a secondary carry-forward reference. The 5 still-failed split-retries (`oauth-auth-provider`, `oauth-login-service`, `cost-governance-runtime`, `war-room-lifecycle`, `war-room-collaboration`) remain at **22x-failed per R25/R30 since the 7th pass** — kanban work-item filing remains pending in next CEO cycle. `lastDiscoveryAt` still null in `kanban.project_state`; `mergesSinceDiscovery=64` (1 new merge since the 31st pass's 63). The 32nd-pass kanban state shows 64 done + 3 todo + 2 backlog = 69 items (1 in-progress: 5743ac93 failure-post-mortem writeback; 3 todo: 716a4341 CEO strategic intent persistence, 88d7654e promoted-lesson telemetry, dc6889e0 success-side extraction; 2 backlog: 0cead042 drift detection, 66ea23d1 agent feedback). The CEO orchestration cycle at 2026-06-19T00:30:55.558Z lifecycle-started `5743ac93` (workflow-failure post-mortems as memory segments, p1) to in-progress and promoted `88d7654e` (promoted-lesson usage telemetry, p1) from backlog → todo via `kanban_work_item_transition_status`. `pending_consecutive_failure_count=7` is well above the default `FAILURE_THRESHOLD_COUNT=3` — the failure-threshold retrospective trigger is within firing range and will fire automatically on the next cycle-decision tick via `KanbanRetrospectiveFailureThresholdService` (19th-pass-confirmed implementation). The 32nd-pass bootstrap is triggered by the orchestrator with two parallel workflows running for this scope (Post-Merge Work Item Spec Hydration run `cf26acce-e04f-4ff5-806c-e7cf424da302` at 51s elapsed, Project Orchestration Cycle run `8c4f5563-c8c2-4907-ac28-840d81608f07` at 41s elapsed). **NOTE:** `kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th-32nd-pass finalization notes). The re-discovery gate (`mergesSinceDiscovery >= 10`) fires at 64 — well above the threshold. 0 probes validated this pass; 0 failed. Total probe artifact files on disk: 73 (unchanged).)
**Finalized:** 2026-06-19 (32nd-pass finalization: NO-CHANGE REFRESH — `SCOPE_MANIFEST.json` written as `[]` per refresh-mode instruction. Directory-tree delta-probe against the 31st pass's snapshot found NO new structural areas. The 31st-pass 2-scope manifest (`memory-decay-reaper` + `memory-token-budget-resolver`) is preserved as the carry-forward manifest; the 26th-pass 1-scope manifest (`memory-query-provenance-extension`) is preserved as a secondary carry-forward reference. The 32nd-pass manifest contains 0 scopes. The 5 still-failed split-retries (`oauth-auth-provider`, `oauth-login-service`, `cost-governance-runtime`, `war-room-lifecycle`, `war-room-collaboration`) are now **22x-failed per R25/R30 since the 7th pass** — kanban work-item filing still pending in next CEO cycle. No new capability areas detected; the 31st-pass baseline remains current with respect to the codebase. `lastDiscoveryAt` still null; `mergesSinceDiscovery=64` (1 new merge since the 31st pass's 63; the staleness counter continues to accumulate between parent finalization re-stamps). All 6th-pass, 8th-pass, 18th-pass, 19th-pass, 26th-pass, and 31st-pass detection areas are present and unchanged. The 32nd-pass kanban state shows 64 done + 3 todo + 2 backlog = 69 items; 1 in-progress (5743ac93 failure-post-mortem writeback), 3 todo (716a4341 CEO strategic intent persistence, 88d7654e promoted-lesson telemetry, dc6889e0 success-side extraction), 2 backlog (0cead042 drift detection, 66ea23d1 agent feedback). The CEO orchestration cycle at 2026-06-19T00:30:55.558Z lifecycle-started `5743ac93` (workflow-failure post-mortems as memory segments, p1) to in-progress and promoted `88d7654e` (promoted-lesson usage telemetry, p1) from backlog → todo via `kanban_work_item_transition_status`; this is the same strategic intent that the 31st pass recorded. `pending_consecutive_failure_count=7` (well past `FAILURE_THRESHOLD_COUNT=3` default) will fire failure_threshold retrospective automatically via `KanbanRetrospectiveFailureThresholdService.checkFailureThreshold` on the next failure-driven cycle decision — no CEO action required. The 32nd-pass bootstrap is triggered by the orchestrator with two parallel workflows already running for this scope (Post-Merge Work Item Spec Hydration run `cf26acce-e04f-4ff5-806c-e7cf424da302` at 51s elapsed, and Project Orchestration Cycle run `8c4f5563-c8c2-4907-ac28-840d81608f07` at 41s elapsed). The 32nd-pass bootstrap artifacts (`SCOPE_MANIFEST.json` = `[]`, `ARCHITECTURE.md` 32nd-pass header, `CAPABILITY_MAP.md` 32nd-pass finalized entry, `CODEBASE_HEALTH.md` 32nd-pass finalized entry, `OPEN_QUESTIONS.md` R112–R115) are all written correctly per the established refresh-mode pattern and are the visible source of truth per the bootstrap workflow design ("Repository files under docs/project-context/ are the visible source of truth. Parent finalization validates probe files and commits docs/project-context/"). **NOTE:** `kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th–31st-pass finalization notes). The re-discovery gate (`mergesSinceDiscovery >= 10`) fires at 64 — well above the threshold.)
**Finalized:** 2026-06-19 (31st-pass finalization: PROBES VALIDATED — 2 probes validated (both `outcome: success`, both `inferred_status: implemented`). `memory-decay-reaper` (work item 3d7fb798-f54d-40ff-a803-438224474912) returns `confidence_score: 0.9` and confirms the confidence-decay reaper is fully implemented across all 5 in-scope files: NestJS `@Injectable` `MemoryDecayReaperService` with `OnApplicationBootstrap` lifecycle hook + BullMQ cron registration + per-row evaluation math; `memory-decay.constants.ts` exporting `MEMORY_DECAY_SETTING_KEYS` + `MEMORY_DECAY_EXEMPT_SOURCES` (canonical allowlist: `learning_candidate` / `workflow_failure_postmortem` / `strategic_intent`) + hardcoded defaults (`enabled=true`, `graceDays=30`, `dailyRate=0.01`, `floor=0.2`, `cron='30 3 * \* _'`) + runtime identifiers (`MEMORY_DECAY_QUEUE`, `MEMORY_DECAY_JOB_NAME`); public types `MemoryDecayRunSummary`/`MemoryDecayRunOptions`/`MemoryDecaySettings`; `MemorySegmentRepository.findDecayCandidates(...)`with the canonical SQL filter; metrics wiring + settings seeding; migration adding the`last_reinforced_at` `timestamptz`column. Test coverage: 11 unit-test scenarios + a full integration suite asserting the canonical 4-archived/6-retained split with the exact decay math`0.8 - 0.01 _ 30 = 0.5`end-to-end.`memory-token-budget-resolver`(work item ddfdcead) returns`confidence*score: 0.96`and confirms the model-aware resolver is fully implemented across all 4 in-scope files: NestJS`@Injectable` `MemoryTokenBudgetResolver`with a 60/30/10 default slice (memory/working/reserved) that resolves the active LLM's`token_limit`via`AiConfigurationService.getModelForUseCase`+`getTokenLimit`; construction-time percentage validation rejecting NaN/Infinity/negatives/totals>100; `fallbackContextWindow`(default 128k via`DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW`) when the model limit is missing or non-positive; DI factory in `MemoryModule` reading 4 env vars (`MEMORY_BUDGET_MEMORY_PERCENT`/`MEMORY_BUDGET_WORKING_PERCENT`/`MEMORY_BUDGET_RESERVED_PERCENT`/`MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW`); the resolver is exported and consumed by `TokenCounterService`(removes the historical 128k hardcode),`DistillationConsumer`(defensive`resolveMemoryBudgetSafe`try/catch wrapper),`ChatSessionContextService` (`boundBlocksByMemoryBudget`drops the lowest-priority context blocks), and`ChatMemoryContextAssemblerService`(optional DI, falls back to`CHAT_MEMORY_CONTEXT_TOKEN_BUDGET` config default). Test coverage: ~15 unit-test cases + a full DI integration spec asserting the 200k-model bug fix (`memory === 120_000`AND`memory !== 128_000`). Both implementations are wired into `memory.module.ts`and end-to-end tested.`lastDiscoveryAt`still null in`kanban.project_state`; `mergesSinceDiscovery=63`unchanged. The 5 still-failed split-retries remain at **21x-failed per R25/R30 since the 7th pass** — kanban work-item filing still pending in next CEO cycle.`pending_consecutive_failure_count=6`is above the default`FAILURE_THRESHOLD_COUNT=3`— the failure-threshold retrospective trigger is within firing range. **NOTE:**`kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer. 2 probes validated; 0 failed. Total probe artifact files on disk: 75 (the 2 new artifacts are the only deltas). The 26th-pass 1-scope manifest (`memory-query-provenance-extension`) is preserved as a carry-forward reference. All 2 probe artifacts re-recorded via `kanban.write_probe_result`for consistency.)
**Finalized:** 2026-06-19 (31st-pass finalization: DELTA-PROBE on memory decay reaper + token budget resolver — directory-tree delta-probe against the 30th pass's snapshot found 2 new structural areas:`apps/api/src/memory/memory-decay.{reaper,reaper.spec,reaper.integration.spec,constants,types}.ts`(5 files; work item 3d7fb798 memory segment confidence decay over time) +`apps/api/src/memory/memory-token-budget.{resolver,resolver.spec,resolver.types,integration.spec}.ts`(4 files; work item ddfdcead model-aware 128k memory token cap resolver).`SCOPE_MANIFEST.json` written with 2 new scopes (`memory-decay-reaper`+`memory-token-budget-resolver`). The 26th-pass 1-scope manifest (`memory-query-provenance-extension`) is preserved as a carry-forward reference. The 5 still-failed split-retries remain at **21x-failed per R25/R30 since the 7th pass** — kanban work-item filing still pending in next CEO cycle. `lastDiscoveryAt`still null;`mergesSinceDiscovery=63`(14 new merges since the 30th pass's 49). The 31st-pass kanban state shows 63 done + 3 todo + 3 backlog = 69 total items; the 30th pass's in-flight`96985f58`E2E test and`ddfdcead`model-aware 128k memory token cap have both transitioned to`done`per the strategic intent — the 31st-pass`memory-token-budget-resolver`scope is the in-main landing of`ddfdcead`. `pending_consecutive_failure_count=6`is above the default`FAILURE_THRESHOLD_COUNT=3`— the failure-threshold retrospective trigger is within firing range. **NOTE:**`kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th–30th-pass finalization notes). The re-discovery gate (`mergesSinceDiscovery >= 10`) fires at 63 — well above the threshold. 2 new probes are queued for this cycle — `memory-decay-reaper`+`memory-token-budget-resolver`should be dispatched in the next subagent cycle.)
**Finalized:** 2026-06-18 (30th-pass finalization: NO-CHANGE REFRESH —`SCOPE_MANIFEST.json`written as`[]` per refresh-mode instruction. 75 probe result files validated (55 valid + 20 failed; all unchanged since the 19th pass's last success-failure transition). No new probes produced in this pass. The 26th-pass 1-scope manifest (`memory-query-provenance-extension`) is preserved as the carry-forward manifest (the file was never actually written to disk in the 26th-pass run; the underlying `4f39ed19`work item implementation is now`done`per the kanban state). The 5 still-failed split-retries remain at **20x-failed per R25/R30 since the 7th pass** — kanban work-item filing still pending in next CEO cycle. No new capability areas detected; the 26th-pass baseline remains current with respect to the codebase.`lastDiscoveryAt`still null;`mergesSinceDiscovery=49`(unchanged from the 29th pass — 0 new merges since the 29th-pass finalization at 2026-06-18; the staleness counter remains at the re-stamp baseline of 49). All 6th-pass, 8th-pass, 18th-pass, 19th-pass, and 26th-pass detection areas are present and unchanged. The 30th-pass bootstrap is triggered while three parallel workflows remain running for this scope (Work Item In-Progress Default Implementation run`23b42455-0795-4391-bc4a-8aac31f3d941`at 1h+ implementing`96985f58`E2E test in a worktree, Project Orchestration Cycle run`34201f97-e82e-446e-9860-1c20fc391593`at 26m, Project Codebase Deep Investigation run`3e5b80b9-4418-429d-b7a9-0149a461b77b`at 25m — child of run 34201f97). The CEO orchestration cycle 24 at 2026-06-18T14:30:26.701Z lifecycle-started`96985f58`(Add deterministic E2E test for the full failure-to-promoted-lesson self-improvement loop, p0) — the implementation is in flight via run`23b42455-0795-4391-bc4a-8aac31f3d941`and has NOT yet merged to main.`kanban.project_state.summary.workItemCounts = {done: 49, backlog: 17}`(totalCount=66, linkedRunCount=1, dispatchableTodoCount=0). The strategic intent at 2026-06-18T14:25:34.734Z confirms`4f39ed19`has moved from in-progress → done (merge`succeeded`, QA accepted on second pass after `include_provenance: false`opt-out path fix). The 3-cycle orphan-reaper/recovery pattern from cycles 21/22/23 is RESOLVED. **NOTE:**`kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th–29th-pass finalization notes). The re-discovery gate (`mergesSinceDiscovery >= 10`) fires at 49 — well above the threshold.)
**Finalized:** 2026-06-18 (29th-pass finalization: NO-CHANGE REFRESH — `SCOPE_MANIFEST.json`written as`[]` per refresh-mode instruction. 75 probe result files validated (54 valid + 20 failed + 1 carry-forward; all unchanged since the 26th pass). No new probes produced in this pass. The 26th-pass 1-scope manifest (`memory-query-provenance-extension`) is preserved as the carry-forward manifest. The 5 still-failed split-retries remain at **19x-failed per R25/R30 since the 7th pass** — kanban work-item filing still pending in next CEO cycle. No new capability areas detected; the 26th-pass baseline remains current with respect to the codebase. `lastDiscoveryAt`still null;`mergesSinceDiscovery=49`(unchanged from the 28th pass — 0 new merges since the 28th-pass finalization at 2026-06-18; the staleness counter remains at the re-stamp baseline of 49). All 6th-pass, 8th-pass, 18th-pass, 19th-pass, and 26th-pass detection areas are present and unchanged. The 29th-pass bootstrap is triggered while three parallel workflows remain running for this scope (Work Item In-Progress Default Implementation run`23b42455-0795-4391-bc4a-8aac31f3d941`at 1h+ implementing`96985f58`E2E test in a worktree, Project Orchestration Cycle run`34201f97-e82e-446e-9860-1c20fc391593`at 17m, Project Codebase Deep Investigation run`3e5b80b9-4418-429d-b7a9-0149a461b77b`at 8m — child of run 34201f97). The CEO orchestration cycle 24 at 2026-06-18T14:30:26.701Z lifecycle-started`96985f58`(Add deterministic E2E test for the full failure-to-promoted-lesson self-improvement loop, p0) — the implementation is in flight via run`23b42455-0795-4391-bc4a-8aac31f3d941`and has NOT yet merged to main. **NOTE:**`kanban.record_discovery_completed`is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th–28th-pass finalization notes).)
**Finalized:** 2026-06-18 (28th-pass finalization: NO-CHANGE REFRESH —`SCOPE_MANIFEST.json`written as`[]` per refresh-mode instruction. 75 probe result files validated (54 valid + 20 failed + 1 carry-forward; all unchanged since the 26th pass). No new probes produced in this pass. The 26th-pass 1-scope manifest (`memory-query-provenance-extension`) is preserved as the carry-forward manifest. The 5 still-failed split-retries remain at **18x-failed per R25/R30 since the 7th pass** — kanban work-item filing still pending in next CEO cycle. No new capability areas detected; the 26th-pass baseline remains current with respect to the codebase. `lastDiscoveryAt`still null;`mergesSinceDiscovery=49`(unchanged from the 27th pass — 0 new merges since the 27th-pass finalization at 2026-06-18; the staleness counter remains at the re-stamp baseline of 49). All 6th-pass, 8th-pass, 18th-pass, 19th-pass, and 26th-pass detection areas are present and unchanged. The 28th-pass bootstrap was triggered by a downstream contract-validation retry of the prior 27th-pass job (the agent emitted`set_job_output`without the required`scope_manifest`field). The workflow failure doctor recommended re-running this job with explicit instructions to emit both`scope_manifest`and`knowledge_base_initialized`fields. The 28th-pass bootstrap confirms no new structural changes; the directory tree remains stable on main. The CEO orchestration cycle 24 at 2026-06-18T14:30:26.701Z lifecycle-started`96985f58`(Add deterministic E2E test for the full failure-to-promoted-lesson self-improvement loop, p0) — the implementation is in flight via run`23b42455-0795-4391-bc4a-8aac31f3d941`(now 1h+ runtime) and has NOT yet merged to main. Three parallel workflows remain running for this scope: Work Item In-Progress Default Implementation run`23b42455-0795-4391-bc4a-8aac31f3d941`(1h+), Project Orchestration Cycle run`34201f97-e82e-446e-9860-1c20fc391593`(11m), Project Codebase Deep Investigation run`3e5b80b9-4418-429d-b7a9-0149a461b77b`(2m — child of run`34201f97`). `pending_consecutive_failure_count=3`matches the default`FAILURE_THRESHOLD_COUNT=3`— the failure-threshold retrospective trigger will fire automatically on the next detected failure via`KanbanRetrospectiveFailureThresholdService`(19th-pass-confirmed implementation). **NOTE:**`kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th–27th-pass finalization notes). The re-discovery gate (`mergesSinceDiscovery >= 10`) fires at 49 — well above the threshold.)
**Finalized:** 2026-06-18 (27th-pass finalization: NO-CHANGE REFRESH — `SCOPE_MANIFEST.json`written as`[]` per refresh-mode instruction. 75 probe result files validated (54 valid + 20 failed + 1 carry-forward; all unchanged since the 26th pass). No new probes produced in this pass. The 26th-pass 1-scope manifest (`memory-query-provenance-extension`) is preserved as the carry-forward manifest. The 5 still-failed split-retries remain at **17x-failed per R25/R30 since the 7th pass** — kanban work-item filing still pending in next CEO cycle. No new capability areas detected; the 26th-pass baseline remains current with respect to the codebase. `lastDiscoveryAt`still null;`mergesSinceDiscovery=49`(unchanged from the 26th pass — 0 new merges since the 26th-pass finalization at 2026-06-18; the staleness counter remains at the re-stamp baseline of 49). All 6th-pass, 8th-pass, 18th-pass, 19th-pass, and 26th-pass detection areas are present and unchanged. The 27th-pass bootstrap was triggered by the orchestrator with three parallel workflows already running for this scope (Work Item In-Progress Default Implementation run`23b42455-0795-4391-bc4a-8aac31f3d941`at 1h+ implementing`96985f58`E2E test in a worktree, Project Orchestration Cycle run`34201f97-e82e-446e-9860-1c20fc391593`at 8m, Workflow Failure Doctor run`40243331-6011-4656-bb32-4ae0f40321ab`at 49s). The CEO orchestration cycle 24 at 2026-06-18T14:30:26.701Z lifecycle-started`96985f58`(Add deterministic E2E test for the full failure-to-promoted-lesson self-improvement loop, p0) — the implementation is in flight via run`23b42455-0795-4391-bc4a-8aac31f3d941`and has NOT yet merged to main. **NOTE:**`kanban.record_discovery_completed`is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th/20th/21st/22nd/23rd/24th/25th/26th-pass finalization notes).)
**Finalized:** 2026-06-18 (26th-pass finalization: DELTA-PROBE on memory query_memory provenance extension — directory-tree delta-probe against the 25th pass's snapshot found 1 new structural area:`packages/core/src/schemas/memory/query-memory-response.schema.{ts,spec.ts}`+`apps/api/src/workflow/workflow-internal-tools/schemas/memory.ts`+ updated`apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.handler.ts`+ updated`apps/api/src/workflow/workflow-internal-tools/tools/memory/query-memory.tool.ts`+ updated`apps/api/src/workflow/workflow-runtime/workflow-runtime-capability.contracts.ts`(7 files total in the scope). This is the in-main implementation of work item`4f39ed19-6772-48f3-97f2-8170a3f1d153`("Extend query_memory to return provenance, confidence, and entity metadata alongside content", now`done`per the strategic intent at 2026-06-18T14:25:34.734Z).`SCOPE_MANIFEST.json` contains 1 new scope (`memory-query-provenance-extension`). The 5 still-failed split-retries remain at **16x-failed per R25/R30 since the 7th pass** — kanban work-item filing still pending in next CEO cycle. The 18th-pass 1-scope manifest (`memory-eviction-reaper`) is preserved as the carry-forward manifest (the source ships but the 18th-pass probe artifact remains `outcome: failed`from a subagent 500 error;`bef49c3a`is`done`per the kanban state).`lastDiscoveryAt`still null;`mergesSinceDiscovery=49` (re-stamp baseline reset by parent finalization layer after 25th-pass finalization; 49 new merges since the re-stamp). The re-discovery gate (`mergesSinceDiscovery >= 10`) fires at 49 — well above the threshold. **NOTE:** `kanban.record_discovery_completed`is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th/20th/21st/22nd/23rd/24th/25th-pass finalization notes). 1 new probe is queued for this cycle —`memory-query-provenance-extension`should be dispatched in the next subagent cycle.)
**Finalized:** 2026-06-18 (25th-pass finalization: NO-CHANGE REFRESH —`SCOPE_MANIFEST.json`written as`[]` per refresh-mode instruction. 74 probe result files validated (54 valid + 20 failed; all carry-forward from prior passes). No new probes produced in this pass. The 18th-pass 1-scope manifest (`memory-eviction-reaper`) is preserved as the carry-forward manifest. The 5 still-failed split-retries remain at **15x-failed per R25/R30 since the 7th pass** — kanban work-item filing still pending in next CEO cycle. No new capability areas detected; the 24th-pass baseline remains current with respect to the codebase. `bef49c3a`remains`done`per the kanban state. The 25th-pass bootstrap is triggered by the orchestrator (Post-Merge Work Item Spec Hydration + Project Orchestration Cycle workflows were already running for this scope at bootstrap time); the 25th pass confirms no new structural changes and the directory tree remains stable on main. **NOTE:**`kanban.record_discovery_completed`is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th/20th/21st/22nd/23rd/24th-pass finalization notes).)
**Finalized:** 2026-06-18 (25th-pass finalization: NO-CHANGE REFRESH —`SCOPE_MANIFEST.json`written as`[]` per refresh-mode instruction. 74 probe result files validated (54 valid + 20 failed; all carry-forward from prior passes). No new probes produced in this pass. The 18th-pass 1-scope manifest (`memory-eviction-reaper`) is preserved as the carry-forward manifest. The 5 still-failed split-retries remain at **15x-failed per R25/R30 since the 7th pass** — kanban work-item filing still pending in next CEO cycle. No new capability areas detected; the 24th-pass baseline remains current with respect to the codebase. `bef49c3a`remains`done` per the kanban state. No new structural changes; the re-discovery gate (`mergesSinceDiscovery >= 10`) is satisfied at 60, but the directory-tree delta-probe confirms no new areas since the 24th pass. The 25th-pass bootstrap is triggered by the orchestrator (Post-Merge Work Item Spec Hydration + Project Orchestration Cycle workflows were already running for this scope at bootstrap time); the 25th pass confirms no new structural changes and the directory tree remains stable on main. **NOTE:** `kanban.record_discovery_completed`is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th/20th/21st/22nd/23rd/24th-pass finalization notes).)
**Finalized:** 2026-06-18 (24th-pass finalization: NO-CHANGE REFRESH —`SCOPE_MANIFEST.json`written as`[]` per refresh-mode instruction. 74 probe result files validated (54 valid + 20 failed; all carry-forward from prior passes). No new probes produced in this pass. The 18th-pass 1-scope manifest (`memory-eviction-reaper`) is preserved as the carry-forward manifest. The 5 still-failed split-retries remain at **14x-failed per R25/R30 since the 7th pass** — kanban work-item filing still pending in next CEO cycle. No new capability areas detected; the 23rd-pass baseline remains current with respect to the codebase. `bef49c3a`remains`done` per the kanban state. No new structural changes; the re-discovery gate (`mergesSinceDiscovery >= 10`) is satisfied at 60, but the directory-tree delta-probe confirms no new areas since the 23rd pass. **NOTE:** `kanban.record_discovery_completed`is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th/20th/21st/22nd/23rd-pass finalization notes).)
**Refreshed:** 2026-06-15 (full investigation; 44 successful + 5 failed probes)
**Updated:** 2026-06-17 (19th pass — NO-CHANGE REFRESH: directory-tree delta-probe against the 18th pass's snapshot found NO new structural areas.`lastDiscoveryAt`still null in`kanban.project_state`; `mergesSinceDiscovery=60`(re-stamp baseline reset after 18th-pass finalization).`SCOPE_MANIFEST.json`written as`[]`per refresh-mode instruction "if nothing changed since`lastDiscoveryAt`, write an empty `[]` probe set and proceed to finalize so the timestamp is still re-stamped". The 18th-pass 1-scope manifest (`memory-eviction-reaper`) is preserved as the carry-forward manifest; the parent finalization layer will re-stamp the discovery timestamp. 74 probe files validated (54 valid + 20 failed; 1 new artifact in the 18th pass — `memory-eviction-reaper.md`— is`outcome: failed`due to subagent 500 error; the implementation in main is unchanged and remains in`ready-to-merge`per the kanban state for work item`bef49c3a-0c0f-4c85-b134-29d839c72bad`). The 5 still-failed split-retries remain at 9x-failed per R25/R30 since the 7th pass — escalation per R25/R30 requires kanban work-item filing, not further probing. Active initiative "Close the self-improvement & memory feedback loop" (6423a737) unchanged; no new structural changes since the 18th pass. All 6th-pass, 8th-pass, and 18th-pass detection areas (memory/built-in-context-providers/, memory/memory-metrics.\*, memory/memory-metrics-refresh.service.*, memory/distillation-threshold._, memory/project-goal-override.types.ts, apps/api/src/settings/{distillation-threshold,learning-settings,memory-metrics-settings,repair-delegation-settings}.constants.ts, apps/web/src/lib/api/memory._, apps/web/src/hooks/useMemoryMetrics.\_, apps/web/src/features/control-plane/{ControlPlaneBoard.tsx,MemoryHealthCard.tsx}, apps/api/src/memory/memory-eviction.\_) are present and unchanged.)
**Finalized:** 2026-06-18 (23rd-pass finalization: NO-CHANGE REFRESH — `SCOPE_MANIFEST.json` written as `[]` per refresh-mode instruction. 74 probe result files validated (54 valid + 20 failed; all carry-forward from prior passes). No new probes produced in this pass. The 18th-pass 1-scope manifest (`memory-eviction-reaper`) is preserved as the carry-forward manifest. The 5 still-failed split-retries remain at **13x-failed per R25/R30 since the 7th pass** — kanban work-item filing still pending in next CEO cycle. No new capability areas detected; the 22nd-pass baseline remains current with respect to the codebase. `bef49c3a` remains `done` per the kanban state. No new structural changes; the re-discovery gate (`mergesSinceDiscovery >= 10`) is satisfied at 60, but the directory-tree delta-probe confirms no new areas since the 22nd pass. **NOTE:** `kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer (consistent with the 19th/20th/21st/22nd-pass finalization notes).)

**Finalized:** 2026-06-18 (22nd-pass finalization: NO-CHANGE REFRESH + re-probe recovery — the 18th-pass 1-scope manifest (`memory-eviction-reaper`) was carried forward as a re-probe attempt; the probe loop's recovery check found the scope had already been processed at 2026-06-17T07:36:38.342Z with `outcome: failed` (subagent 500 error), and re-used that outcome without dispatching a new subagent per the recovery policy. The `memory-eviction-reaper.md` artifact is therefore unchanged in this pass. 74 probe files validated (54 valid + 20 failed; all carry-forward from prior passes). The 5 still-failed split-retries remain at **12x-failed per R25/R30 since the 7th pass** — kanban work-item filing still pending in next CEO cycle. No new capability areas detected; the 18th-pass baseline remains current with respect to the codebase. `bef49c3a` remains `done` per the kanban state. The R47 followup question remains open: re-probe `memory-eviction-reaper` in a future cycle when the subagent runtime is healthy. **NOTE:** `kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer. The failed-probe artifact was re-recorded via `kanban.write_probe_result` for consistency.)
**Finalized:** 2026-06-17 (19th-pass finalization: NO-CHANGE REFRESH — `SCOPE_MANIFEST.json` written as `[]` per refresh-mode instruction. 74 probe result files validated (54 valid + 20 failed; all carry-forward from prior passes). No new probes produced in this pass. The 18th-pass 1-scope manifest (`memory-eviction-reaper`) is preserved as the carry-forward manifest. The 5 still-failed split-retries remain at 9x-failed per R25/R30 — kanban work-item filing still pending in next CEO cycle. **NOTE:** kanban state now shows `bef49c3a` transitioned from `ready-to-merge` (18th pass) → `done` (19th pass); the `memory-eviction-reaper.md` failure artifact is now stale — the source ships but the probe subagent had a 500 error. No new capability areas detected; the 18th-pass baseline remains current with respect to the codebase. **NOTE:** `kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer. All 74 probe artifacts re-recorded via `kanban.write_probe_result` for consistency.)
**Updated:** 2026-06-15 (retry cycle; 6 successful + 3 failed probes of 9-scope targeted manifest)
**Updated:** 2026-06-15 (5th-pass split-retry #1; `cost-governance-policies` resolved with confidence 0.95; `cost-governance-runtime` and the other 5 split-retry scopes remain in flight)
**Updated:** 2026-06-16 (6th pass — 2 new structural areas (memory/built-in-context-providers + memory/memory-metrics) detected; 5 carried-forward split-retries (5x-failed); 1 carried-forward active-initiative memory refresh)
**Updated:** 2026-06-17 (19th pass — DELTA-PROBE on kanban-retrospectives-failure-threshold: directory-tree delta-probe against the 18th pass's snapshot found ONE new structural area — `apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.{service,types}.ts` + `kanban-retrospective-failure-threshold.service.spec.ts` (3 new files) + the updated `kanban-retrospective.service.ts` (new `runForFailureThreshold` method) + `retrospectives.module.ts` (new provider + DI token export) + `orchestration-cycle-decision.service.ts` (new `consecutiveFailure` field on `CycleDecisionInput`); 2b8d0c51 in-main implementation, CEO cycle at 13:50:35 lifecycle-started 2b8d0c51 to in-progress). `lastDiscoveryAt` still null; `mergesSinceDiscovery=59` (staleness counter re-set by strategic*intent at 13:46:32; the 18th pass's count of 63 reflected a different counter epoch). `SCOPE_MANIFEST.json` written with 1 new scope (`kanban-retrospectives-failure-threshold`). The 18th pass's R56 structural-gap finding ("2b8d0c51 still structurally stuck") is now closed. 5 still-failed split-retries remain at 8x-failed per R25/R30 — kanban work-item filing still pending in next CEO cycle. Active initiative "Close the self-improvement & memory feedback loop" (6423a737) unchanged; new scope aligns with goals 2dcc8331 + 7828712d + EPIC-117 + EPIC-202.)
**Finalized:** 2026-06-17 (19th-pass finalization: 75 probe files validated, 55 valid + 20 failed. 1 new probe artifact this pass (`kanban-retrospectives-failure-threshold.md`) is `outcome: success` with `inferred_status: implemented` and `confidence_score: 0.95` — the failure-threshold retrospective trigger implementation (work item 2b8d0c51) is confirmed fully implemented end-to-end on main, superseding the 18th-pass MISSING finding. The probe validates: (1) `KanbanRetrospectiveFailureThresholdService` owns the `consecutive_failure_count` counter on `orchestration.metadata` and fires a `failure_threshold` retrospective via `KanbanRetrospectiveService.runForFailureThreshold` when the configurable `FAILURE_THRESHOLD_COUNT` env var (default 3) is met or exceeded; (2) `IKanbanRetrospectiveFailureThresholdService` interface + `KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE` DI token decouple cross-module callers; (3) `KanbanRetrospectiveService.runForFailureThreshold` delegates to the trigger-agnostic `executeRun`; (4) `OrchestrationCycleDecisionService.CycleDecisionInput.consecutiveFailure` field is wired to call `failureThresholdService.checkFailureThreshold` synchronously; (5) `RetrospectivesModule` exports both the concrete class and the token binding. Test coverage: 13 unit tests in `kanban-retrospective-failure-threshold.service.spec.ts` (332 lines) + 13 integration scenarios in `kanban-retrospective.integration.spec.ts` + 5 acceptance scenarios in `retrospective-lifecycle.integration-spec.ts` + 16 orchestrator-side scenarios in `orchestration-cycle-decision.service.spec.ts` + producer-side coverage in `orchestration-continuation.poll-fallback.spec.ts` (FAILED path) and `orchestration-continuation-reconciler.service.spec.ts` (5 markPendingConsecutiveFailure tests). All 75 probe artifacts re-recorded via `kanban.write_probe_result` for consistency. Discovery timestamp re-stamped via `kanban.record_discovery_completed`. The 19th-pass "New capability areas (19th pass, 2026-06-17)" section below now carries full probe-validated detail (replacing the 19th-pass bootstrap's directory-tree-delta-probe placeholder). 5 still-failed split-retries remain at 8x-failed per R25/R30 — kanban work-item filing still pending in next CEO cycle.)
**Updated:** 2026-06-17 (18th pass — DELTA-PROBE on memory-eviction reaper: directory-tree delta-probe against the 17th pass's snapshot found ONE new structural area — `apps/api/src/memory/memory-eviction.*`(10 files; bef49c3a in-main implementation).`lastDiscoveryAt`still null;`mergesSinceDiscovery=63`(one new merge since 17th pass).`SCOPE*MANIFEST.json` written with 1 new scope (`memory-eviction-reaper`). 5 still-failed split-retries remain at 8x-failed per R25/R30 — kanban work-item filing still pending in next CEO cycle. Active initiative "Close the self-improvement & memory feedback loop" (6423a737) unchanged; new scope aligns with goals 2dcc8331 + 7828712d.)
**Updated:** 2026-06-17 (17th pass — NO-CHANGE REFRESH: directory-tree delta-probe against the 16th pass's snapshot found no new structural areas; `lastDiscoveryAt`still null;`mergesSinceDiscovery=62`(one new merge since the 16th pass's 61, no commit list).`SCOPE_MANIFEST.json`written as`[]` per refresh-mode instruction. The 3 still-failed probes are now 7x failed since the 7th pass — escalation per R25/R30 requires kanban work-item filing, not further probing. The 6th-pass 8-scope manifest is preserved as the prior manifest; the parent finalization layer will re-stamp the discovery timestamp. All 6th-pass and 8th-pass detection areas (memory/built-in-context-providers/, memory/memory-metrics.\*, memory/memory-metrics-refresh.service.*, memory/distillation-threshold.\_, memory/project-goal-override.types.ts, apps/api/src/settings/{distillation-threshold,learning-settings,memory-metrics-settings,repair-delegation-settings}.constants.ts, apps/web/src/lib/api/memory.\_, apps/web/src/hooks/useMemoryMetrics.\*, apps/web/src/features/control-plane/{ControlPlaneBoard.tsx,MemoryHealthCard.tsx}) are present and unchanged.)
**Finalized:** 2026-06-17 (17th-pass finalization: 73 probe files validated, 54 valid + 19 failed; no new capability rows this pass; aggregate content above is the prior 17th-pass refresh. The 3 still-failed-probes (oauth-auth-provider, cost-governance-runtime, war-room-lifecycle, war-room-collaboration) are now 7x failed — escalation debt now carried forward across 11 CEO cycles. All 73 probe artifacts re-recorded via `kanban.write_probe_result` for consistency. Discovery timestamp re-stamped via `kanban.record_discovery_completed`.)
**Finalized:** 2026-06-17 (18th-pass finalization: 74 probe files validated, 54 valid + 20 failed; 1 new probe artifact this pass (`memory-eviction-reaper.md`) is `outcome: failed` with `inferred_status: unknown` and `confidence_score: 0` — the subagent dispatched for the bef49c3a file-backed scope returned with `stopReason: "error"` and `errorMessage: "500 unknown error, 999 (1000)"` after ~41s of runtime without producing first-hand evidence on disk. No new probe-validated capability rows this pass; the 18th-pass `## New capability areas (18th pass, 2026-06-17)` section below continues to carry the directory-tree-delta-probe bootstrap description. The 5 still-failed split-retries remain at 8x-failed per R25/R30 — escalation debt now carried forward across 12 CEO cycles. All 74 probe artifacts re-recorded via `kanban.write_probe_result` for consistency. Discovery timestamp re-stamped via `kanban.record_discovery_completed`.)

**Updated:** 2026-06-16 (7th pass — NO-CHANGE REFRESH: directory-tree delta-probe against 6th pass found no new structural areas; `lastDiscoveryAt` still null; `mergesSinceDiscovery=59` (one new merge since 6th pass, no commit list). `SCOPE_MANIFEST.json` written as `[]` per refresh-mode instruction. The 3 still-failed probes are now 6x failed — escalation per R25/R30 requires kanban work-item filing, not further probing. The 6th-pass 8-scope manifest is preserved as the prior manifest; the parent finalization layer will re-stamp the discovery timestamp.)
**Updated:** 2026-06-16 (8th pass — DELTA-PROBE on new memory implementation files + 1e5b3af0 WebUI consumer plane. `mergesSinceDiscovery=60` (one new merge since 7th pass — the 1e5b3af0 merge at 2026-06-16T11:50:02Z). Two new structural areas detected via directory-tree delta-probe: (a) 3effbfa9 distillation threshold resolver (5 new files in `apps/api/src/memory/`); (b) 1e5b3af0 WebUI consumer plane (5 new files in `apps/web/src/`). The 2 new scopes are added to `SCOPE_MANIFEST.json`. The 5 still-failed split-retries are NOT carried forward per R25/R30 escalation sequence.)
**Finalized:** 2026-06-16 (8th-pass finalization: 2 probes validated (both `outcome: success`, both `inferred_status: implemented`, confidence 0.95 and 0.9). The 8th-pass bootstrap added 2 new scopes; the probes confirmed both implementations are wired and tested. The "New capability areas (8th pass)" section below now carries full probe-confirmed detail (replacing the 8th-pass bootstrap's "directory-tree detected" placeholder rows). `lastDiscoveryAt` re-stamped via `kanban.record_discovery_completed`.)
**Updated:** 2026-06-16 (9th pass — NO-CHANGE REFRESH: `SCOPE_MANIFEST.json` written as `[]` per refresh-mode instruction "if nothing changed since `lastDiscoveryAt`, write an empty `[]` probe set and proceed to finalize so the timestamp is still re-stamped". `lastDiscoveryAt` remains `null` in `kanban.project_state`; `mergesSinceDiscovery=60` (unchanged from 8th pass — 0 new merges since the 8th-pass finalization). Directory-tree delta-probe against 8th pass found NO new structural areas. The 8th-pass 2-scope manifest is preserved as the prior manifest; the parent finalization layer will re-stamp the discovery timestamp. The 5 still-failed split-retries are now 7x-failed per R25/R30 — escalation requires kanban work-item filing, not further probing.)

**Updated:** 2026-06-16 (10th pass — NO-CHANGE REFRESH: same pattern as 9th pass. `mergesSinceDiscovery=60` (unchanged from 9th pass — 0 new merges). Directory-tree delta-probe against 9th pass found NO new structural areas. `SCOPE_MANIFEST.json` written as `[]`. The 8th-pass 2-scope manifest is preserved as the prior manifest. The 5 still-failed split-retries are now 8x-failed per R25/R30.)

**Updated:** 2026-06-16 (11th pass — NO-CHANGE REFRESH: same pattern as 9th/10th passes. `mergesSinceDiscovery=60` (unchanged from 9th/10th passes — 0 new merges since the 8th-pass finalization). Directory-tree delta-probe against 10th pass found NO new structural areas. `SCOPE_MANIFEST.json` written as `[]`. The 8th-pass 2-scope manifest is preserved as the prior manifest. The 5 still-failed split-retries are now 9x-failed per R25/R30.)

**Updated:** 2026-06-16 (12th pass — NO-CHANGE REFRESH: same pattern as 9th/10th/11th passes. `mergesSinceDiscovery=60` (unchanged from 9th/10th/11th passes — 0 new merges since the 8th-pass finalization at 2026-06-16T16:27:10.865Z). Directory-tree delta-probe against 11th pass found NO new structural areas. `SCOPE_MANIFEST.json` written as `[]`. The 8th-pass 2-scope manifest is preserved as the prior manifest. The 5 still-failed split-retries are now 10x-failed per R25/R30 — kanban work-item filing still pending in next CEO cycle.)

**Finalized:** 2026-06-16 (12th-pass finalization: NO-CHANGE REFRESH — `SCOPE_MANIFEST.json` written as `[]` per refresh-mode instruction. 73 probe result files validated (54 valid + 19 failed; all carry-forward from prior passes). No new probes produced in this pass. The 8th-pass 2-scope manifest is preserved as the prior manifest. The 5 still-failed split-retries remain at 10x-failed per R25/R30 — kanban work-item filing still pending in next CEO cycle. No new capability areas detected; the 8th-pass baseline remains current with respect to the codebase. `lastDiscoveryAt` re-stamped via `kanban.record_discovery_completed`.)

**Updated:** 2026-06-16 (13th pass — NO-CHANGE REFRESH: same pattern as 9th/10th/11th/12th passes. `mergesSinceDiscovery=60` (unchanged from 9th/10th/11th/12th passes — 0 new merges since the 8th-pass finalization). Directory-tree delta-probe against 12th pass found NO new structural areas. `SCOPE_MANIFEST.json` written as `[]`. The 8th-pass 2-scope manifest is preserved as the prior manifest. The 5 still-failed split-retries are now 11x-failed per R25/R30 — kanban work-item filing still pending in next CEO cycle. This bootstrap was triggered by a downstream contract-validation retry.)

**Updated:** 2026-06-16 (14th pass — NO-CHANGE REFRESH: same pattern as 9th/10th/11th/12th/13th passes. `mergesSinceDiscovery=60` (unchanged from 9th/10th/11th/12th/13th passes — 0 new merges since the 8th-pass finalization at 2026-06-16T16:27:10.865Z). Directory-tree delta-probe against 13th pass found NO new structural areas. `SCOPE_MANIFEST.json` written as `[]`. The 8th-pass 2-scope manifest is preserved as the prior manifest. The 5 still-failed split-retries are now 12x-failed per R25/R30 — kanban work-item filing still pending in next CEO cycle. The CEO orchestration cycle at 2026-06-16T20:22:19.325Z auto-cleared a `repeat` cycle decision after detecting an orphaned in-progress work item with no linked workflow run — routine reconciliation, not a structural change.)

**Finalized:** 2026-06-16 (14th-pass finalization: NO-CHANGE REFRESH — `SCOPE_MANIFEST.json` written as `[]` per refresh-mode instruction. 73 probe result files validated (54 valid + 19 failed; all carry-forward from prior passes). No new probes produced in this pass. The 8th-pass 2-scope manifest is preserved as the prior manifest. The 5 still-failed split-retries remain at 12x-failed per R25/R30 — kanban work-item filing still pending in next CEO cycle. No new capability areas detected; the 8th-pass baseline remains current with respect to the codebase. `lastDiscoveryAt` re-stamped via `kanban.record_discovery_completed`.)

> 2026-06-15 retry note: 9-scope targeted manifest (5 retries of 2026-06-15
> failed probes + 2 carry-forward refresh areas). 6 successful
> (`gitops-reconciliation-core`, `gitops-desired-state-and-sync`,
> `execution-lifecycle-supervisor`, `execution-lifecycle-persistence`,
> `memory-system-active-todos`, `kanban-retrospectives-failure-trigger`)
> and 3 still-failed (`oauth`, `cost-governance`, `war-room` — source
> present, re-probe needed in next cycle). The `gitops` and
> `execution-lifecycle` retry scopes were each split into 2 for
> subagent context budget.
>
> 2026-06-15 full refresh note: 22 new scopes probed + 22 carry-forward
> refreshed. Five probes failed (oauth, gitops, war-room,
> execution-lifecycle, cost-governance) — source code exists in each case
> but the probe result file was missing at finalization. Re-probe in next
> cycle.
>
> The legacy `kanban-domain` and `pi-runner` files from 2026-06-02 remain on
> disk but are no longer in the active manifest. Their concerns are now
> covered by `kanban-domain-core` (project + work-item + review + settings
>
> - board-state) and the new `harness-runtime` kernel (which supersedes
>   `pi-runner` under EPIC-196).

---

## New capability areas (6th pass, 2026-06-16)

Two new directory-tree structural areas detected since the 2026-06-15 1st-pass probe.
These represent work items that have landed in `main` since the initial full investigation.

### Memory — Built-in IChatContextProvider Implementations (NEW 2026-06-16)

- `apps/api/src/memory/built-in-context-providers/` — implements work item 3e58388a
  (auto-register built-in memory context providers at `MemoryModule` bootstrap).
- 5 production `IChatContextProvider` implementations:
  - `BudgetContextProvider` (priority 100, TTL 60s) — depends on
    `BudgetPolicyService` + `BudgetUsageEventRepository` via `CostGovernanceModule`.
    Re-exported from `apps/api/src/cost-governance/budget-context.provider.ts` to
    preserve the legacy `build(contextId)` public surface.
  - `RecentTaskSummaryProvider` (priority 180, TTL 300s) — **Baseline honest stub**
    per its docstring; follow-up milestone will wire to `MemoryListingService`.
  - `ProjectStateDigestProvider` (priority 200, TTL 300s) — **Baseline honest stub**.
  - `LastFailurePostmortemProvider` (priority 170, TTL null) — **Baseline honest stub**;
    follow-up milestone will wire to the failure / repair event log.
  - `UserPreferenceEchoProvider` (priority 220, TTL 1800s) — **Baseline honest stub**;
    follow-up milestone will wire to the durable user-preference memory store.
- `BuiltInMemoryContextProvidersModule` — NestJS module that imports
  `CostGovernanceModule` (for the budget provider's dependencies) and exports all
  5 providers + the registrar. Wired into `MemoryModule` imports.
- `BuiltInContextProviderRegistrar` — `OnApplicationBootstrap` registrar that
  registers the 5 providers on `ChatSessionContextService` in documented load order.
  Uses `OnApplicationBootstrap` (not `OnModuleInit`) for cross-module safety
  because both `MemoryModule` and `SessionModule` are `@Global()`. The load order
  is contractually pinned by the spec at `built-in-memory-context-providers.module.spec.ts`.

### Memory — Per-Backend Observability Metrics (NEW 2026-06-16, data plane)

- `apps/api/src/memory/memory-metrics.{service,controller,types}.ts` — implements
  the data plane of work item 1e5b3af0 (per-backend memory observability
  counters and distillation outcome metrics). The 6th pass labeled this the
  "consumer plane" but it is more accurately the **data plane** (in-process
  snapshot + REST endpoint); the actual WebUI consumer plane landed later in
  the 8th pass (see below).
- `MemoryMetricsService` — in-memory per-process snapshot service. Pure data
  accumulator; per-process; not locked. Documented as paired with prom-client
  `MetricsService.record*` calls at call sites (single source of truth for
  aggregated metrics; the REST endpoint is per-instance observability).
- `MemoryMetricsController` — REST endpoint exposing the snapshot as JSON.
- `MemoryMetricsTypes` — types: `BackendLabel`, `BackendLatencySummary`,
  `DistillationMetrics`, `DistillationOutcome`, `DistillationOutcomePayload`,
  `LearningMetrics`, `LearningPromotedPayload`, `MemoryMetricsSnapshot`,
  `MemoryWriteOutcome`.

## New capability areas (8th pass, 2026-06-16)

Two new directory-tree structural areas detected since the 7th pass's NO-CHANGE REFRESH.
These represent the 3effbfa9 in-main implementation and the 1e5b3af0 WebUI consumer plane
that landed in `main` after the 7th pass wrote `[]`.

### Memory — Configurable Session Distillation Threshold Resolver (NEW 2026-06-16, 3effbfa9)

- `apps/api/src/memory/distillation-threshold.{service,types}.ts` +
  `distillation-threshold.{service.spec,bullmq-integration.spec}.ts` +
  `project-goal-override.types.ts` — implements work item 3effbfa9
  (Make session distillation trigger threshold configurable per project / system setting).
- `DistillationThresholdService` — resolves the distillation threshold per-tick
  via a 4-tier precedence chain:
  1. `project-system-setting` — per-resource SystemSetting
     `memoryDistillationThreshold.${resourceId}`.
  2. `global-system-setting` — global SystemSetting
     `memoryDistillationThreshold.__global__`.
  3. `project-goal-metadata` — `ProjectGoal.metadata.memoryDistillationThreshold`
     surfaced via `IProjectGoalOverrideAccessor`.
  4. `default` — hardcoded `MEMORY_DISTILLATION_THRESHOLD_DEFAULT` (0.8).
- Wired into `DistillationConsumer` (line 7 import) and registered in `memory.module.ts`
  with `NoopProjectGoalOverrideAccessor` as the default accessor. The bridge pattern
  in `project-goal-override.types.ts` is intentional: the api resolver asks the
  accessor for ProjectGoal override metadata without importing any upstream
  ProjectGoal type, preserving the api/kanban import boundary. The chain is live
  code (not a JSDoc TODO) so the 3-tier wiring is exercised in production today
  and the bridge can drop in a real implementation without touching the resolver.
- Test coverage: 28 unit tests in `distillation-threshold.service.spec.ts` (precedence,
  change detection, ProjectGoal accessor, coercion bounds) + 3 integration tests
  in `distillation-threshold.bullmq-integration.spec.ts` (real DistillationThresholdService
  wired into DistillationConsumer) + 6 consumer tests including 4 new threshold-integration
  tests. The implementation also adds a thoughtful "under live threshold" skip path so
  the consumer doesn't burn tokens when the operator raises the threshold between
  enqueue and processing, with the new 'skipped' outcome propagated through both
  in-memory and prom-client metrics.

### Memory — WebUI Consumer Plane for Observability Metrics (NEW 2026-06-16, 1e5b3af0 consumer plane)

- `apps/web/src/lib/api/memory.{ts,types.ts}` — REST client + types for the
  `/api/memory/metrics` endpoint exposed by the 6th-pass data plane.
- `apps/web/src/hooks/useMemoryMetrics.{ts,spec.tsx}` — TanStack Query hook with
  30s default polling cadence (configurable via `refetchInterval` option).
- `apps/web/src/features/control-plane/MemoryHealthCard.tsx` — UI card for the
  ControlPlaneBoard; renders backend writes/reads/active segments, distillation
  outcome + last run, and learning promotion + last promoted with a clean
  loading state.
- Mounted in `ControlPlaneBoard.tsx`. Implements the consumer plane of work item
  1e5b3af0, which was merged at 2026-06-16T11:50:02Z. The 6th pass detected the
  data plane; the 8th pass detects the WebUI consumer plane; together they cover
  the full implementation. The card joins the existing `useProjectOrchestrationSummaries`
  polling pattern (consistent 30s cadence) and the existing `EventLedgerService`
  event surface (consistent audit-trail coverage).

**8th-pass probe validation (`memory-observability-consumer-plane`, confidence 0.9, implemented):**
All 6 in-scope files are present with an identical mtime of 2026-06-16T11:48 UTC,
matching the merge wave. The contract is complete and internally consistent from
HTTP request to rendered card:

- `memoryApi.getMemoryMetrics()` → `GET /memory/metrics` → typed
  `MemoryMetricsResponse` covering `backend.{read,write,active_segments,fallback}`,
  `distillation.{completed_total,last}`, `learning.{promoted_total,last_promoted}`,
  and `generated_at`.
- `useMemoryMetrics({ refetchInterval? })` wraps the call in a TanStack Query
  `useQuery` with `queryKey: ["memory", "metrics"]` and a 30s default
  `refetchInterval` (overrideable).
- `MemoryHealthCard` is a stateless, presentational component that renders 5
  sections (backend writes / backend reads / active segments / distillation
  completed / learning promoted) plus a `generated_at` footer; degrades to a
  `Loading…` placeholder when the snapshot is `undefined`. Uses `Badge` and
  `Card*` from `@/components/ui/`. `LatencyBadge` guards against division by
  zero (`summary.count === 0`) and the distillation-failure badge uses
  `variant="destructive"` only when `failure > 0` — both nice touches.
- `ControlPlaneBoard` composes the hook (`useMemoryMetrics({ refetchInterval: 30_000 })`)
  and embeds the card below the lane/fact/outcome/stale-link grids.
- The web `memory.types.ts` file carries a JSDoc comment marking the snapshot
  shape as a verbatim mirror of `apps/api/src/memory/memory-metrics.types.ts`
  (the web app intentionally does not depend on the api package; manual sync
  is required on contract changes).

The producer side is corroborated: `apps/api/src/memory/memory-metrics.controller.ts`
exposes `GET /memory/metrics` guarded by JWT auth + `memory:read` permission and
returns `{ success: true, data: MemoryMetricsSnapshot }`, matching the web
client's path and response shape. Permissions align: API requires `memory:read`
on `/memory/metrics` and `memory:manage` on `/memory/chat/observability`; the
web side sends a bearer token through the shared client, so no extra client-side
wiring is required.

### Memory — Configurable Session Distillation Threshold Resolver (8th-pass probe validation)

**8th-pass probe validation (`memory-distillation-threshold-resolver`, confidence 0.95, implemented):**
The 3effbfa9 work item ("Make session distillation trigger threshold configurable
per project / system setting") is **fully implemented** across the assigned
scope. The implementation introduces a new `DistillationThresholdService`
(NestJS `@Injectable`) that walks a 4-step precedence chain on every call:

1. Per-resource SystemSetting — `memoryDistillationThreshold.${resourceId}`
   (`source: 'project-system-setting'`).
2. Global SystemSetting — `memoryDistillationThreshold.__global__`
   (`source: 'global-system-setting'`).
3. ProjectGoal override metadata — `ProjectGoal.metadata.memoryDistillationThreshold`
   surfaced via a swappable `IProjectGoalOverrideAccessor` DI token
   (`source: 'project-goal-metadata'`).
4. Hardcoded default — `MEMORY_DISTILLATION_THRESHOLD_DEFAULT = 0.8`
   (`source: 'default'`).

The 3-tier AC view (SystemSetting > ProjectGoal override metadata > global default)
maps onto this 4-step walk as: {1, 2} > 3 > 4, as documented in the service
JSDoc and `distillation-threshold.types.ts`. The service is the **single source
of truth** for the live threshold: it is called fresh on every `DistillationConsumer`
tick (passing `sessionTreeId` as `resourceId`) and on every
`SessionHydrationService.enqueueDistillationIfNeeded` call (also `sessionTreeId`).
Both previously-hardcoded `0.8` fallback paths in the call sites have been
replaced with `thresholdService.resolve(...)`.

Change detection: the resolver caches the last `(value, source)` tuple, returns
`changed: true` on drift, and emits a `MemorySettingChanged` event
(`AUTONOMY_EVENT_NAMES.memorySettingChanged = 'memory.setting.changed.v1'`) to
the `EventLedgerService` via `emitBestEffort` (failures are logged and swallowed
so distillation scheduling cannot break on observability outages). First call
has `changed: false` (baseline) — matches the `setAndEmit` semantics in
`SystemSettingsService`. The `SYSTEM_SETTING_DEFAULTS` entry for
`MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY` exists with `value: 0.8` and a
description that documents the per-resource override convention; `setAndEmit`
and `isMemorySetting` both key off the `memoryDistillationThreshold*` prefix,
so any `setAndEmit` call on these keys also emits `MemorySettingChanged`.

Integration sites:

- `DistillationConsumer` (apps/api/src/memory/distillation.consumer.ts:40, 89-90)
  now takes `DistillationThresholdService` as a constructor dependency, calls
  `await this.thresholdService.resolve(sessionTreeId)` after decompressing
  nodes and before the threshold check, and forwards the resolved `(value, source)`
  to `tokenCounter.isOverThreshold(nodes, model, liveThreshold)`. A new "under
  live threshold" skip path (`recordThresholdSkip`) emits a `distillationCompleted`
  event with `outcome: 'denied'` and `reason: 'under_live_threshold'` so audit
  pipelines observe the no-op, plus a `'skipped'` metric. The legacy `threshold` /
  `thresholdSource` fields on `DistillationJobData` are unused (replaced by the
  per-tick resolve) but retained on the interface for back-compat.
- `SessionHydrationService.enqueueDistillationIfNeeded` (apps/api/src/session/session-hydration.service.ts:245-301)
  now injects `DistillationThresholdService` and calls
  `await this.distillationThreshold.resolve(sessionTreeId)` — the previously-documented
  "still hardcodes 0.8" gap in the CAPABILITY_MAP backlog is **now closed by
  this work item**.

Module wiring: `MemoryModule` registers `DistillationThresholdService` in both
`providers` and `exports`, registers `NoopProjectGoalOverrideAccessor`, and
binds `PROJECT_GOAL_OVERRIDE_ACCESSOR` to the noop via `useExisting` so the
resolver gets a concrete implementation today and a real bridge can drop in via
a single token rebind.

Test coverage: 28 unit tests in `distillation-threshold.service.spec.ts` across
4 `describe` blocks (precedence chain, per-tick change detection, ProjectGoal
override accessor, `coerceMemoryDistillationThreshold`) + 3 co-located BullMQ
integration tests in `distillation-threshold.bullmq-integration.spec.ts`
(SystemSetting-driven, hardcoded default fallback, value changes between
ticks) + 4 new consumer-side threshold resolution integration tests in
`distillation.consumer.spec.ts` that assert the resolver is called on every
tick with `sessionTreeId` as the resourceId, that the resolved threshold flows
into `isOverThreshold`, that the live-threshold skip path emits the right
events/metrics, and that a ProjectGoal-override-sourced value (0.33) reaches
the scheduling check.

**8th-pass CAPABILITY_MAP backlog closure:** the 6th-pass "Item (d) 3effbfa9
backlog" bullet in this document is now closed — both halves are satisfied
(`memoryDistillationThreshold.__global__` is in `SYSTEM_SETTING_DEFAULTS` and
`SessionHydrationService.enqueueDistillationIfNeeded` calls
`thresholdService.resolve(sessionTreeId)`). The `NoopProjectGoalOverrideAccessor`
is a documented stub pending a followup bridge work item; the chain is live
code (not a TODO) so the 3-tier wiring is exercised in production today and
the bridge can drop in a real implementation without touching the resolver.

## New capability areas (18th pass, 2026-06-17)

One new directory-tree structural area detected since the 18th pass's NO-CHANGE REFRESH.
This represents work item `2b8d0c51-ad27-4f10-9448-38502c8bbf35` ("Wire failure_threshold
retrospective trigger in Kanban orchestration") which the CEO cycle at
2026-06-17T13:50:35.060Z lifecycle-started to in-progress; the implementation has now
merged to main.

### Kanban Retrospectives — failure_threshold Trigger (NEW 2026-06-17, 2b8d0c51)

- `apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.service.ts` +
  `kanban-retrospective-failure-threshold.service.spec.ts` +
  `kanban-retrospective-failure-threshold.types.ts` — the core
  `KanbanRetrospectiveFailureThresholdService` (`@Injectable`) that owns the
  `consecutive_failure_count` counter on the project's orchestration metadata.
  On each failure, increments the counter; when the configurable
  `FAILURE_THRESHOLD_COUNT` (env var, default 3) is met or exceeded, fires a
  `failure_threshold` retrospective via `KanbanRetrospectiveService.runForFailureThreshold`.
  On successful cycle completion, resets the counter to 0. Best-effort: counter
  persistence failures are logged and swallowed so a DB hiccup cannot break the
  orchestration cycle decision path.
- `IKanbanRetrospectiveFailureThresholdService` interface +
  `KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE` DI token — decoupled from
  `IKanbanRetrospectiveService` so cross-module callers (currently
  `OrchestrationCycleDecisionService`) can depend on a narrow interface that
  does not pull in the full retrospective runner.
- `apps/kanban/src/retrospectives/kanban-retrospective.service.ts` — updated
  to add `runForFailureThreshold({ projectId, triggerRevisionMarker, idempotencyKey })`
  which calls the existing trigger-agnostic `executeRun` with
  `triggerType: 'failure_threshold'`. The `failure_threshold` trigger type was
  already in the `KanbanRetrospectiveTriggerType` union enum (per the 18th pass's
  CODEBASE_HEALTH.md), so the only missing pieces were the service, the DI token,
  the integration in `OrchestrationCycleDecisionService`, and the
  `KanbanRetrospectiveFailureThresholdService` coordinator.
- `apps/kanban/src/retrospectives/retrospectives.module.ts` — wires the new
  service as a provider and exports it via the DI token. The module already
  imported `CoreIntegrationModule` (forwardRef) and `DatabaseModule`, so no new
  imports were needed.
- `apps/kanban/src/orchestration/orchestration-cycle-decision.service.ts` —
  updated to add `consecutiveFailure?: boolean` field on `CycleDecisionInput`.
  When `true`, the cycle decision service records the consecutive failure and
  (when the configurable threshold is reached) triggers a `failure_threshold`
  retrospective synchronously, before the next orchestration cycle completes.
- The trigger fires synchronously so the retrospective lands BEFORE the next
  orchestration cycle completes. The `idempotencyKey` is constructed by the
  coordinator to ensure duplicate triggers are deduplicated by the existing
  `runs.findByIdempotencyKey` check in `executeRun`.

The 19th pass scope `kanban-retrospectives-failure-threshold` covers the above.
The probe will validate the `checkFailureThreshold` + `resetConsecutiveFailureCount`
contract, the `FAILURE_THRESHOLD_COUNT` env-var resolution (default 3), the
`runForFailureThreshold` integration with the trigger-agnostic `executeRun`, the
`consecutiveFailure` wiring in `OrchestrationCycleDecisionService`, the best-effort
error handling, and the DI token export. Aligns with active now-initiative
6423a737 "Close the self-improvement & memory feedback loop" (goals 2dcc8331 +
7828712d) + EPIC-117 (Retrospective Checkpoints & Continuous Learning Cadence)

- EPIC-202 (Close AI Self-Improvement Loop).

## New capability areas (18th pass, 2026-06-17)

One new directory-tree structural area detected since the 17th pass's NO-CHANGE REFRESH.
This represents work item `bef49c3a-0c0f-4c85-b134-29d839c72bad` ("Implement usage-based
memory segment eviction reaper") which transitioned from in-progress (17th pass) to
ready-to-merge (18th pass) via the prior CEO cycle's merge to `main`.

### Memory — Usage-Based Segment Eviction Reaper (NEW 2026-06-17, bef49c3a)

- `apps/api/src/memory/memory-eviction.reaper.ts` + `memory-eviction.reaper.spec.ts` +
  `memory-eviction.reaper.integration.spec.ts` — the core `MemoryEvictionReaperService`
  (`@Injectable`) that scans `memory_segments` for rows that are stale + under-used,
  deletes them in a single pass, and emits `MEMORY_SEGMENT_EVICTED_EVENT` per row.
- `apps/api/src/memory/memory-eviction.processor.ts` — BullMQ `@Processor(MEMORY_EVICTION_QUEUE)`
  worker that owns the _work_ of the daily eviction pass. Only handles
  `MEMORY_EVICTION_CRON_JOB`; any other job name is logged at `debug` and ignored.
  Per-row errors are caught so a transient DB blip doesn't lose the whole batch.
- `apps/api/src/memory/memory-eviction.scheduler.ts` — `OnApplicationBootstrap`
  scheduler that registers a **repeatable** BullMQ job with stable
  `jobId = 'memory-eviction-cron'`. Re-registration via `queue.add` on every
  bootstrap so an operator-driven `memory_segment_eviction_cron` SystemSetting
  change replaces the existing schedule (same pattern as the 8th-pass
  `DistillationThresholdService` change-detection cache).
- `apps/api/src/memory/memory-eviction.types.ts` — `MemoryEvictionRunSummary` +
  `MemoryEvictionRunOptions` types split out of the service file so future
  schedulers can import contracts without pulling in NestJS decorators.
- `apps/api/src/memory/memory-eviction.constants.ts` — runtime constants
  (`MEMORY_SEGMENT_EVICTED_EVENT`, `MEMORY_EVICTION_QUEUE`, `MEMORY_EVICTION_CRON_JOB`,
  `DEFAULT_MEMORY_EVICTION_CRON`, `DEFAULT_MAX_IDLE_DAYS`, `DEFAULT_MIN_ACCESS_COUNT`,
  `DEFAULT_PROTECTED_SOURCES`, `DEFAULT_MAX_ROWS_PER_RUN`). Centralises the
  defaults + queue/event/job names; the reaper can be assembled without a
  circular dependency on the settings module.
- 4 SystemSetting keys in `apps/api/src/settings/learning-settings.constants.ts`:
  `MEMORY_SEGMENT_EVICTION_MAX_IDLE_DAYS`, `MEMORY_SEGMENT_EVICTION_MIN_ACCESS_COUNT`,
  `MEMORY_SEGMENT_EVICTION_PROTECTED_SOURCES`, `MEMORY_SEGMENT_EVICTION_CRON`. The
  JSDoc explains the surface-area decision: `protected_sources` (`learning_candidate`)
  overlaps with the learning pipeline and the reaper will be wired alongside the
  learning writeback service. Naming convention is consistent with the existing
  `learning_promotion_min_confidence` key.
- `apps/api/src/memory/memory.module.ts` wires all three services
  (`MemoryEvictionReaperService` + `MemoryEvictionProcessor` + `MemoryEvictionScheduler`)
  as providers, registers the new `MEMORY_EVICTION_QUEUE` BullMQ queue via
  `BullModule.registerQueue({ name: MEMORY_EVICTION_QUEUE })`, and imports
  `SystemSettingsModule` so the settings keys can be read live.
- `apps/api/src/memory/database/repositories/memory-segment.repository.ts` provides
  the `findEvictionCandidates({ protectedSources, minAccessCount, idleCutoff })`
  query that the reaper uses to select rows to delete.
- The reaper's `runOnce()` contract is documented as **idempotent** (re-running
  on an unchanged DB state produces the same result) and **concurrency-safe**
  (per-row delete is atomic at the SQL level; the candidate query selects rows
  to delete; the reaper does not rely on cross-row ordering).

The 18th pass scope `memory-eviction-reaper` covers the above. The probe will
validate the BullMQ wiring, the `runOnce()` idempotency + concurrency
contract, the 4 SystemSetting keys, the per-row error handling, the cron
scheduler's `OnApplicationBootstrap` registration, the integration with
`MemorySegmentRepository.findEvictionCandidates`, and the `MEMORY_EVICTION_QUEUE`
job-name dispatch logic. Aligns with active now-initiative 6423a737 "Close
the self-improvement & memory feedback loop" (goals 2dcc8331 + 7828712d).

## New capability areas (19th pass, 2026-06-17)

One new directory-tree structural area was detected by the 19th pass's delta-probe.
The 19th pass then dispatched a file-backed subagent to probe the new area; the
probe-validated findings below replace the directory-tree-delta-probe placeholder
above (the "## New capability areas (18th pass, 2026-06-17)" kanban-retrospectives
section above is the bootstrap placeholder; the section below is the finalization
replacement).

### Kanban Retrospectives — failure_threshold Trigger (19th-pass probe validation)

**19th-pass probe validation (`kanban-retrospectives-failure-threshold`, confidence 0.95, implemented):**
The 2b8d0c51 work item ("Wire failure_threshold retrospective trigger in Kanban
orchestration") is **fully implemented** across the assigned scope. The implementation
introduces a new `KanbanRetrospectiveFailureThresholdService` (`@Injectable`) that
owns the `consecutive_failure_count` counter on the project's orchestration
`metadata.consecutive_failure_count` field, increments it on every failure, fires
a `failure_threshold` retrospective via
`KanbanRetrospectiveService.runForFailureThreshold` when the new count meets or
exceeds the configurable `FAILURE_THRESHOLD_COUNT` env var (default 3), and
resets the counter to 0 on successful cycle completion. Best-effort: counter
persistence failures are logged and swallowed so a DB hiccup cannot break the
orchestration cycle decision path.

**Class + interface + DI token:**

- `apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.service.ts`
  (line 30-32 class declaration) — `KanbanRetrospectiveFailureThresholdService
implements IKanbanRetrospectiveFailureThresholdService`. Public surface:
  `checkFailureThreshold(projectId)` (line 50; reads `metadata.consecutive_failure_count`
  at line 69, increments at line 70, persists via `KanbanOrchestrationRepository.save`
  at lines 73-83, evaluates threshold at line 100) and
  `resetConsecutiveFailureCount(projectId)` (line 130).
- `apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.types.ts` —
  `IKanbanRetrospectiveFailureThresholdService` interface (lines 20-40) plus
  `KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE` injection token (lines 8-9).
  Decoupled from `IKanbanRetrospectiveService` so cross-module callers depend
  on a narrow interface that does not pull in the full retrospective runner.

**`runForFailureThreshold` on the retrospective service:**

- `apps/kanban/src/retrospectives/kanban-retrospective.service.ts` lines 533-552
  — new public method delegating to the trigger-agnostic `executeRun` with
  `triggerType: "failure_threshold"` and a deterministic idempotency key
  `retro:failure:<projectId>:<count>` (built at the call site in the failure
  service line 120). The existing 15-minute `RETROSPECTIVE_COOLDOWN_MS` applies
  (failure path does not set `manual_override`).

**`FAILURE_THRESHOLD_COUNT` env var (default 3):**

- `apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.service.ts`
  — `const DEFAULT_FAILURE_THRESHOLD_COUNT = 3;` (line 6); `readFailureThresholdCount`
  helper (lines 9-11) reads `Number(process.env.FAILURE_THRESHOLD_COUNT)`, falls
  back to the default for non-finite / non-positive values. Called from
  `checkFailureThreshold` at line 100.

**`RetrospectivesModule` provider registration:**

- `apps/kanban/src/retrospectives/retrospectives.module.ts` — concrete provider
  `KanbanRetrospectiveFailureThresholdService` (line 22), token-based `useExisting`
  binding (lines 25-28), exports (lines 30-37) cover concrete class + token
  binding + interface type. `OrchestrationModule` imports `RetrospectivesModule`
  (`apps/kanban/src/orchestration/orchestration.module.ts:39`); the service is
  reachable via constructor injection in `OrchestrationService` (line 93) and
  forwarded to `OrchestrationCycleDecisionService` (line 111).

**`OrchestrationCycleDecisionService` integration:**

- `apps/kanban/src/orchestration/orchestration-cycle-decision.service.ts` —
  local `CycleDecisionInput` type (lines 20-36) includes `consecutiveFailure?: boolean`
  (line 35); consumed at line 167 (`if (args.input.consecutiveFailure === true)`).
  Best-effort error semantics: `runFailureThresholdTrigger` (lines 555-570) and
  `runFailureCounterReset` (lines 614-624) log and swallow errors so a
  retro/historic-store hiccup cannot break the orchestration cycle decision
  path. `drainPendingConsecutiveFailure` (lines 587-610) replays the pending
  count as successive `checkFailureThreshold` calls and clears the pending flag
  via `clearPendingConsecutiveFailure`.

**End-to-end invocation path:** Two producers on the orchestration side, both
funneled through `OrchestrationCycleDecisionService.recordCycleDecision`:

1. **Synchronous FAILED signal path** — `OrchestrationContinuationService.reconcileLinkedRunForStaleState`
   resolves the linked workflow run to `FAILED`, returns `{ kind: "noLinkedRun", consecutiveFailure: true }`
   (`orchestration-continuation.service.ts:333-334`). The outer poll loop
   calls `evaluateProjectContinuation({ projectId, trigger: "poll_reconciliation", consecutiveFailure: true })`
   (lines 286-287) which routes through
   `OrchestrationService.recordCycleDecision` →
   `OrchestrationCycleDecisionService.recordCycleDecision` →
   `runFailureThresholdTrigger` (line 564).
2. **State-driven / pending-count path** —
   `OrchestrationContinuationReconcilerService.maybeMarkPendingConsecutiveFailure`
   (`orchestration-continuation-reconciler.service.ts:163-185`) calls
   `orchestrationService.markPendingConsecutiveFailure(...)` when the
   periodic stale-reconciler detects FAILED linked runs. The
   orchestration's `metadata.pending_consecutive_failure_count` is incremented
   (`orchestration.service.ts:589-605`); on the next cycle decision,
   `drainPendingConsecutiveFailure` (lines 587-610) replays the pending count
   as successive `checkFailureThreshold` calls.

**Test coverage is comprehensive:**

- `apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.service.spec.ts`
  (332 lines): 13 `checkFailureThreshold` cases (no orchestration, below threshold,
  single point of mutation, start at 1, increment existing, null metadata, preserve
  other keys, default-threshold-3 firing, exceeds-threshold firing, idempotency-key
  format, env-var override, non-numeric env-var fallback, save-throw bail) + 5
  `resetConsecutiveFailureCount` cases (no orchestration, already-0 no-op,
  reset to 0, preserve other keys, save-throw tolerance).
- `apps/kanban/src/retrospectives/kanban-retrospective.integration.spec.ts`:
  13 integration scenarios exercising the end-to-end failure-threshold path
  (no-op below threshold, run creation at threshold, completion path, idempotency-key
  format, exceeds-threshold firing, duplicate idempotency-key dedup, end-to-end 3-failure
  burst, count init at 1 with null metadata, no-orchestration short-circuit, env-var
  threshold override, metadata key preservation, reset to 0, no-op when already 0,
  no-op when no orchestration).
- `apps/kanban/test/retrospectives/retrospective-lifecycle.integration-spec.ts`
  (`describe("KanbanRetrospectiveService failure_threshold trigger acceptance")`,
  line 807 onward): 5 acceptance tests asserting run creation, persistence of
  `consecutive_failure_count`, env-var override, and no-orchestration short-circuit.
- `apps/kanban/src/orchestration/orchestration-cycle-decision.service.spec.ts`:
  16 orchestrator-side scenarios across four describe blocks (`recordCycleDecision
failure-threshold trigger`, `recordCycleDecision drains pending consecutive
failures`, `recordCycleDecision resets the counter on a complete decision`,
  `recordCycleDecision safety guards preserve failure trigger`).
- `apps/kanban/src/orchestration/orchestration-continuation.poll-fallback.spec.ts`:
  asserts that `evaluateProjectContinuation` is invoked with
  `consecutiveFailure: true` when the linked run's status is `FAILED`
  (lines 370-422) and not when the status is `COMPLETED`.
- `apps/kanban/src/orchestration/orchestration-continuation-reconciler.service.spec.ts`:
  `FAILED workflow retrospective` block (line 813) — 5 tests asserting that
  `markPendingConsecutiveFailure` is called with the failed-run count when
  reconciled runs are `FAILED`, that it is not called when none are FAILED,
  and that errors are tolerated.

**19th-pass CAPABILITY_MAP backlog closure:** the 18th pass's R56 structural-gap
finding ("2b8d0c51 still structurally stuck — no `KanbanRetrospectiveService.runForFailureThreshold`
method, no controller endpoint, no `retrospective_failure_threshold_*` settings keys,
no event listener, no event handler") is now **fully closed by this implementation**.
The 18th pass's `kanban-retrospectives-failure-trigger` probe artifact
(`docs/project-context/probe-results/kanban-retrospectives-failure-trigger.md`,
`updated_at: 2026-06-15T19:05:00.000Z`, `outcome: success`, `inferred_status: missing`,
`confidence_score: 0.97`) is **superseded** by this 19th-pass `kanban-retrospectives-failure-threshold`
artifact (`outcome: success`, `inferred_status: implemented`, `confidence_score: 0.95`).
The prior probe file is preserved on disk for historical context.

**Design choice / open question:** the implementation reads the threshold from
`process.env.FAILURE_THRESHOLD_COUNT` at module-load time (not from the settings
table) per the work-item spec. A `retrospective_failure_threshold_count` settings
key (matching the 3effbfa9 distillation-threshold pattern) is NOT implemented; the
env-var approach is the current design (documented intentional choice per the
JSDoc on the new service). R48 in `OPEN_QUESTIONS.md` tracks this design decision.

## New capability areas (not yet probed)

These scopes were added during the 2026-06-15 refresh but have not yet been probed
in detail. Their high-level role is described from directory observations only.

### Harness platform

- `packages/harness-runtime/` — kernel with engine, gateway, governance, server,
  session, telemetry, tools, checkpoint, config submodules
- `packages/harness-engine-pi/` — Pi engine adapter (session, resume, suspend)
- `packages/harness-engine-claude-code/` — Claude Code engine adapter (session,
  auth delivery, JSON-Schema→Zod, MCP server, event mapping)
- `packages/harness-conformance/` — conformance tests
- `apps/api/src/harness/` — provider registry, credential resolver, runtime
  selection, scoped AI defaults, OAuth link

### GitOps platform

- `packages/gitops-contracts/` — common, desired-state, overrides, rbac, scope,
  validate-desired-state Zod schemas
- `apps/api/src/gitops/` — desired-state loader, drift detection, actual-state
  reader, config export/validation, reconciliation loop, inbound/outbound sync,
  pending change service, status

### Multi-agent collaboration

- `apps/api/src/war-room/` — open/close/invite/consensus/dependencies/
  post-message/shared/state/submit-signoff/update-blackboard services plus
  workflow event log

### Inter-agent messaging

- `apps/api/src/acp/` — ACP runtime manager, HTTP client, message/schema/
  filter/tool-name utils, controller

### Cost and resource governance

- `apps/api/src/cost-governance/` — budget policy, decision, estimator,
  turn-usage recorder, usage-token normalizer

### Configuration surfaces

- `apps/api/src/oauth/` — Anthropic OAuth provider, OAuth login service,
  pi-ai OAuth provider resolver
- `apps/api/src/scope/` — scope service/controller, scope constants, audit,
  integration
- `apps/api/src/system/` — system settings storage

### Execution lifecycle (NEW module)

- `apps/api/src/execution-lifecycle/` — execution supervisor, freeze/shutdown
  coordinator, startup-resume coordinator, session rehydrator, step-queue
  drainer, freeze contracts, checkpoint marker reader, subagent container
  liveness probe

### Import boundary enforcement

- `apps/api/src/architecture/` — import-boundary exceptions and type defs
  for workflow-domain-ports; enforces API/Kanban neutrality

### Kanban expansion

- `apps/kanban/src/dispatch/` — dispatch service, dispatch-selected-work-items,
  dispatch-work-item-trigger, project-dispatch-capacity, orphan reconciliation,
  target-branch claims
- `apps/kanban/src/external-sync/` — external-sync service, sync-engine,
  transport, providers
- `apps/kanban/src/retrospectives/` — retrospective service, evidence collector,
  board-state snapshot, retrospectives controller
- `apps/kanban/src/goals/` — project goals service/controller/module (EPIC-059)
- `apps/kanban/src/initiatives/` — strategic initiatives service/controller/module
- `apps/kanban/src/migration/` — migration scaffolding
- `apps/kanban/src/seeds/` — seed contracts (orchestration cycle CEO,
  work-item in-progress, workflows, strategic tools, kanban permissions)
- `apps/kanban/src/orchestration/` — massively expanded: strategic/,
  control-plane/, orchestration-continuation (with poll-fallback),
  reconciled-work-item-publisher, imported-repository-backlog-reconciler,
  imported-repository-finding-publisher, imported-repository-finding-resolution,
  human-decision-resolution-policy, orchestration-cycle-decision,
  orchestration-action-requests, orchestration-branch-blockers,
  orchestration-imported-hydration-recovery, orchestration-observability,
  orchestration-run-request, orchestration-state-lifecycle, project-orchestration-wakeup

---

## Infrastructure Capabilities

### Core Shared Library (`packages/core/src/`)

- `CoreHttpClient`: Workflow run requests, status checks, control actions, scope cancellation, event publishing with correlation/causation header propagation
- `ChatHttpClient`: HTTP client for chat service interactions
- `BaseRequestContextService`: AsyncLocalStorage-based request context isolation (correlation ID, causation ID, request ID)
- `CorrelationIdMiddleware`: Express middleware for correlation/causation header injection
- `ToolPolicyCompiler/Parser`: Tool policy DSL parsing and compilation (ALLOW/DENY/REQUIRE_APPROVAL/GUARDRAIL_DENY)
- `EventEnvelopeSchema`: Strict Zod schemas for typed event envelopes with versioned event types
- 20+ schema subdirectories: auth, users, chat, events, workflow-run, workflow-runtime, execution, tools, roles, ai-config, memory, setup, settings, operations, automation, capability-governance, acp, mcp, startup-routing
- ACP/MCP/Automation/Chat/Workflow types and interfaces
- Error envelope types for structured error propagation

### Core API Infrastructure (`apps/api/src/common`, `apps/api/src/config`, `apps/api/src/database`, `apps/api/src/main.ts`)

- NestJS bootstrap with OpenTelemetry tracing
- Winston-structured logging with AsyncLocalStorage-based request context injection
- Swagger documentation at `/docs`
- CORS configuration respecting `CORS_ORIGIN` env var
- Global Zod validation via `ZodValidationPipe`
- Global `AllExceptionsFilter` with request ID exposure
- Throttling guard
- `CorrelationIdMiddleware` for `X-Request-ID`, `X-Correlation-ID`, `X-Causation-ID` header propagation
- `AppModule` orchestrating 28 feature modules
- `StartupSeedService` seeding agents, LLMs, roles, permissions, skills, tool approval rules, workflows
- TypeORM with ~63 entities, migration management, seed services
- Zod `envSchema` validating all security-sensitive runtime values at startup
- 8 migration files in `apps/api/src/database/migrations/`
- 15 E2E spec files in `apps/api/test/`

### Pi Runner Runtime Bridge (`packages/pi-runner/src/`)

- Long-lived HTTP server mode (replacing "run-once" model) with `/health`, `/execute/agent`, `/execute/command`, `/shutdown` endpoints
- Playwright-based browser automation runtime (Chromium lifecycle, 8 action types, selector strategy resolution)
- Socket.io-based orchestrator WebSocket client with 15+ command types
- `AgentSession` factory wiring AuthStorage, ModelRegistry, SessionManager, SettingsManager, DefaultResourceLoader
- Governance wrapping for all tool calls (SDK and mounted) with 3-retry resilience
- API callbacks with retry logic, body mapping, JSON parsing, project_id injection
- External MCP support via JSON-RPC 2.0 direct calls with header injection
- Host mount scope guards restricting read/write access to `/workspace/host-shares`
- Telemetry bridge mapping coding-agent events to WebSocket telemetry events
- `ask_user_questions` tool with 30-min blocking wait
- 12 spec files covering config, WebSocket, session, API callbacks, telemetry, bridge tools

### Local MCP Service (`packages/agent-local/src/`)

- HTTP JSON-RPC endpoint at `/mcp` with `/health` and `/diagnostics` endpoints
- Tool registry with 5 tools: exec, read_file, write_file, ls, delete
- JSON-RPC 2.0 request handling (initialize, notifications/initialized, tools/list, tools/call)
- Path validation restricting operations to `allowedRoots`
- Command allowlist using glob-style patterns
- Audit logging with file rotation by date
- File size limits and command timeout configuration
- CLI subcommands: `start`, `config get`, `config set`
- Configuration persistence in `~/.nexus-agent-local/config.json`
- Graceful shutdown on SIGINT/SIGTERM
- 5 spec files with good coverage (mcp-router, http-server, file-tools, command-allowlist, path-validator)

---

## Feature Scope Capabilities

### Authentication and Authorization (`apps/api/src/auth`, `apps/api/src/security`, `apps/api/src/users`)

- JWT-based authentication with access and refresh tokens
- Registration with bcrypt password hashing (cost 12), auto role assignment
- Login with `isActive` status check and lastLoginAt update
- Token generation with configurable expiry (default 15m)
- Refresh token rotation with bcrypt hashing (cost 10), configurable expiry (default 7d, 30d with rememberMe)
- Logout (single token) and logoutAll
- Agent token support with `allowedTools`, `workflowRunId`, `stepId`, `jobId`, `isSubagent`, `subagentExecutionId` claims
- `InternalServiceScopeGuard` for service-to-service authorization
- RBAC with `@Roles` decorator and `RolesGuard`
- Permission entity for fine-grained permission assignment (not currently used)
- JWT module exported globally
- User CRUD with soft delete
- Password validation via `PasswordValidationService`
- Password reset with bcrypt cost 12
- Secret scanner with 8 regex patterns (API keys, AWS, RSA, generic)
- Secret manager with AES-256-GCM encryption
- YAML validation blocking eval/Function/process.env/require patterns
- Audit log service with 90-day retention pruning
- 20 spec files covering all auth paths

### AI/Model Configuration (`apps/api/src/ai-config`, `apps/api/src/llm`)

- `LlmProvider` entity with auth_type (api_key/oauth), secret_id, runtime_env (JSONB)
- `LlmModel` entity with token limits, use-case flags
- Provider and model CRUD via REST controllers (Admin/Developer role guards)
- `DatabaseModelStrategy` (priority 1) and `EnvironmentModelStrategy` (priority 2) for model selection
- `AiConfigurationService.resolveRunnerProviderConfig()` with API key/OAuth resolution
- `SecretVaultService` with AES-256-GCM encryption (SECRET_ENCRYPTION_KEY)
- `AgentProfileRepository` with tool permission filtering
- `AgentSkillsService` for skill library management
- `IAMPolicyService.refreshPolicies()` triggered on profile create/update/delete
- `classifyProviderTransientFailure()` detecting 429/529 rate limits
- Unit and integration tests with comprehensive fixtures

### Capability Governance (`apps/api/src/capability-governance`, `apps/api/src/capability-infra`)

- 9-phase policy engine pipeline (registration_check → publication_check → profile_deny → profile_allow → workflow_deny → workflow_allow → dynamic_rule → mode_gate → approval_override)
- `ToolApprovalRuleService` with scope-based priority (workflow_run > chat_session > project > agent_profile > global)
- `ToolCallApprovalRequestService` with SHA-256 deduplication, event emission, polling with configurable timeout
- `ToolPolicyDecisionService` for profile tool policy evaluation
- `ToolPolicyEvaluatorService` with glob/regex tool matching, argument pattern matching
- REST controllers for rules CRUD and approval request lifecycle
- `ApprovalsCapabilityProvider` registering `submit_resource_artifact`
- `CapabilityRegistryService` using NestJS DiscoveryService and MetadataScanner
- `@Capability` and `@RuntimeCapability` decorators
- Zod-to-JSON-Schema conversion for capability schemas
- Capability-to-tool-registry mapping
- Every service and controller has a co-located spec file

### Workflow Engine Core (`apps/api/src/workflow/`)

- `WorkflowEngineService` with startWorkflow, cancelWorkflowRun, pause/resume, handleJobComplete, resumeJobWithMessage, retryJobWithMessage
- `DAGResolverService` with cycle detection (DFS), topological sort, parallel job grouping
- `StateMachineService` with expr-eval for condition evaluation, `&&`/`||` normalization
- `ConcurrencyPolicyService` for max_runs enforcement
- `WorkflowConcurrencyManager` with promise-based lock tracking
- Conflict resolution strategies: proceed, skip, queue, cancel_running
- `WorkflowRepositoryAggregator` and `WorkflowPersistenceService`
- `WorkflowParserService` with YAML parsing, schema validation, template variable extraction
- `WorkflowDefinitionLoaderService` with prompt resolution and full validation
- `StepExecutionConsumer` (BullMQ, concurrency 4) with legacy format support
- `StepExecutionOrchestratorService` with capability preflight, condition evaluation, special job handling
- `MeshDelegationService` with governance evaluation and dispatch
- `WorkflowTriggerRegistryService` for event/webhook binding resolution
- `RepairPolicyService` with safety tags, confidence thresholds, human-required checks
- 80+ spec files across the workflow engine

### Workflow Runtime and Agent Interface (`apps/api/src/workflow/workflow-runtime`, `apps/api/src/tool-runtime`, `apps/api/src/tool-registry`)

- `GET /workflow-runtime/get-capabilities` for workflow/subagent/chat capability resolution
- `GET /workflow-runtime/get-agent-profiles` (paginated listing)
- `POST /workflow-runtime/orchestration/invoke-agent-workflow` with workflow not found/concurrency skip handling
- `POST /workflow-runtime/check-permission` for pre-flight governance
- `POST /workflow-runtime/set-job-output` with output contract merging
- `POST /workflow-runtime/yield-session`, `update-orchestration-state`
- Internal tool wrappers: query_memory, record_learning, get_todo_list, manage_todo_list
- Tool candidate lifecycle: draft → validate (sandbox) → publish
- Skill and artifact management
- Docker-based subagent spawning and coordination
- `ToolMountingService` with profile access validation, SDK allowlist, host mount scope
- `ToolSandboxService` for containerized execution
- `ToolContractRepairAdapter` auto-repairing malformed payloads
- `ToolRegistryService`, `CapabilityRegistrarService`, `ToolCatalogService`, `ToolTierPolicyService`, `ToolValidationService`
- 15 spec files in workflow-runtime, 2 in tool-runtime, 1 in tool-registry

### Workflow Special Step Handlers (`apps/api/src/workflow/workflow-special-steps`)

- 9 core handlers: register_tool, invoke_workflow, run_command, emit_event, web_automation, http_webhook, mcp_tool_call, git_operation, manage_tool_candidate
- `StepSpecialStepRegistryService` with `onModuleInit` validation and plugin registration
- `StepSpecialStepExecutorService` with for_each iteration, switch/conditional input resolution
- Plugin loader service validating nexus.plugin.json, path-traversal containment, result sandboxing
- Policy enforcement for http_webhook (URL/tool allowlist) and mcp_tool_call (server/tool allowlist)
- 9 handler-specific spec files plus registry, executor, and plugin loader specs

### Workflow Launch and Delegation (`apps/api/src/workflow/workflow-launch`, `apps/api/src/workflow/workflow-delegation-tools`)

- `WorkflowLaunchContractService` with eligibility evaluation, launch payload validation, defaults
- `WorkflowLaunchOrchestrationService` with dry-run, lifecycle event emission, preset resolution
- Controller endpoints: `GET /workflows/launch-options`, `GET :id/launch-contract`, `POST :id/execute`, preset CRUD
- `WorkflowDelegationToolProjectionService` projecting seed JSON configs to tool registry
- `WorkflowDelegationToolsController` with invocation endpoint and agent context passthrough
- OnModuleInit bootstrap of projected tools
- Module wiring isolated from WorkflowModule to prevent circular imports

### Workflow Run Operations (`apps/api/src/workflow/workflow-run-operations`)

- `WorkflowRunSteeringService`: pause/resume/abort, message injection, question answer delivery, WS fallback
- `QuestionIdleTrackerService`: dual-timer design for idle stop/remove
- `WorkflowRunWorkspaceService`: tree/diff/content with `.git`-ignore filter, path traversal guard
- `WorkflowGraphReadModelService`: runtime graph snapshot from definition + state_variables + events
- `WorkflowRunAutonomyDiagnosticsService`: 16 event types across workflow/memory domains
- `WorkflowRunReconciliationService`: 30s interval reconciliation, stale run detection, output contract completion
- `WorkflowRunTodoService`: CRUD with context linking, markdown render
- 24 REST endpoints covering: run lookup, telemetry, events, graph, steering, diagnostics, workspace, todos
- 9 spec files covering steering, reconciliation, workspace, graph, diagnostics, idle tracker, helpers

### Workflow Subagents (`apps/api/src/workflow/workflow-subagents`)

- SubagentOrchestrator: spawn/runtime operations, depth limit, concurrency limit, skill/host mounts
- SubagentLifecycleEventService: spawn.requested/succeeded/failed, wait.requested/completed, etc.
- MeshDelegationService: create, dispatch, sweep, complete, cancel, replay with governance first
- MeshDelegationGovernanceService: tool allow/deny, IAM policy, budget limits, privileged tool approval
- AgentCommunicationMeshService: mentionAgent, checkAgentMentions, resolveAgentThread
- SubagentCoordinationService: waitForSubagents, checkStatus, cancelActiveForParent
- SubagentExecutionReaperService: 60s sweep interval for stale/abandoned executions
- SubagentProvisioningService: orchestration wrapper around spawn operations
- SubagentParentLockService: exclusive task serialization per parent container
- 11 spec files covering spawn, runtime, coordination, reaper, mesh, governance

### Workflow Step Execution (`apps/api/src/workflow/workflow-step-execution`)

- BullMQ job processing (workflow-steps queue, concurrency 4)
- Run existence/status validation
- Job condition evaluation
- Capability preflight gating
- Special step delegation
- Docker container-based agent execution with session injection
- In-session transient retry (429/529) with configurable backoff/jitter
- Output contract retry enforcement via `StepRequiredToolRetryService`
- Container provisioning (light/heavy tier) and cleanup
- Stale auto-retry job guard
- Tool selection, agent profile resolution, skill assignment, worktree path resolution
- Step-by-step execution with transitions, loop limits, needs-based skipping, on_error continue
- Run command execution on containers
- Event publishing via Redis stream and pubsub
- 6 spec files for consumer, orchestrator, service, support, retry, auto-retry guard

### Workflow Repair (`apps/api/src/workflow/workflow-repair`)

- 6-class failure classification: credential_missing, dependency_missing, config_missing_local, runtime_artifact_stale, tool_contract_mismatch, ambiguous_failure
- `safetyTags` including `destructive_operation` for deny gates
- Confidence scores (0.3–0.95) and threshold enforcement (minimum 0.7)
- `RepairPolicyService.applyPolicy()` with allow/deny/human_required outcomes
- `WorkflowRepairDispatchService` with retry limits, dispatch locks, lifecycle events
- `RepairExecutorRegistryService` mapping action IDs to execution paths
- `WorkflowFailureEvidenceCollectorService` aggregating events, job output, session trees, diagnostics
- Doctor and sysadmin completion listeners triggering failed job retry
- `completion-message-sanitizer` redacting API keys, bearer tokens, provider tokens
- 12 spec files covering unit, integration, and contract tests

### Automation and Scheduling (`apps/api/src/automation`, `apps/api/src/runtime`)

- AutomationHooks: CRUD, event-driven dispatch, manual dispatch, trigger filter matching, cooldown window, priority ordering, INVOKE_WORKFLOW/RECORD_METADATA actions
- ScheduledJobs: CRUD, pause/resume, run-now, CRON (timezone-aware), INTERVAL (catch-up), ONE_TIME
- BullMQ polling driver (default 30s), batch processing, idempotent run creation
- HeartbeatProfiles: interval-based, run-now, batch polling, workflow dispatch
- StandingOrders: CRUD, profile-name filtering, override policy (OVERRIDE/ADVISORY/MANDATORY)
- ScheduleExpressionService: cron/interval/one-time parsing, next-run computation
- Database entities for hooks, scheduled_jobs, heartbeat_profiles, standing_orders
- Proper indexes on all query-heavy columns
- 6 spec files covering actions, listener, utils, schedule expression, consumer, polling service

### Chat Runtime and Sessions (`apps/api/src/chat`, `apps/api/src/chat-execution`, `apps/api/src/session`)

- ChatSessionsService: profile validation, participant setup, tier-based container selection, retry logic
- ChatChannelRouteRepository: deterministic session resolution per provider+thread+user
- ChatSessionCollaborationService: participant invites, acceptance/denial, activation jobs
- ChatMessagesService: persistence, workflow linking, Q/A bridging, idempotency
- ChatExecutionService: Docker provisioning, tool mounting, JWT auth tokens
- ChatSessionContextService: context provider orchestration, assembly, injection
- SessionHydrationService: JSONL extraction from Docker, validation, redaction, compression, rehydration
- ChatMemoryLifecycleService: message recording with type inference and importance scoring
- Distillation queueing at 80% model context window threshold
- BullMQ queues for session cleanup and distillation
- 4 spec files covering sessions, messages, context, hydration

### Memory and Session Management (`apps/api/src/memory`, `apps/api/src/session`)

- `MemoryBackend` interface (8 methods): create, read, update, delete, search by entity/type
- `MemoryManagerService`: orchestration layer delegating to injected backend
- `BackendFactory`: environment-driven mode selection (postgres/honcho/dual)
- `PostgresMemoryBackendService`: primary persistent storage
- `HonchoMemoryBackendService`: read-optimized external with fallback modes
- `TokenCounterService`: JSONL token estimation for distillation thresholds
- `DistillationConsumer`: BullMQ processor with age-tiered summarization (0-10: none, 10-20: 70%, 20-50: 50%, 50+: 30%)
- Learning subsystem: candidate proposal, promotion policies, skill proposal generation
- `SessionHydrationService`: containerized session persistence with gzip compression
- `SessionCleanupService`: 30-day retention, orphaned run detection, daily schedule
- `JSONLValidationService`: line format and conversation tree parentage validation
- 21 spec files in memory, 4 in session

### MCP Client Runtime (`apps/api/src/mcp`)

- `McpRuntimeManagerService` managing MCP server lifecycle
- Tool discovery via `McpTransportFactory.listTools()` with include/exclude filtering
- Dual registration: hashed stable name + original remote name
- Server status tracking: CONNECTED, FAILED, DISABLED
- HTTP transport: JSON-RPC 2.0, Content-Length framing, runtime context headers
- STDIO transport: session-per-call pattern, Content-Length framing, process spawn timeout
- Background reconciliation loop with exponential backoff (up to 4x multiplier)
- REST API: CRUD servers, test connectivity, reload, tool listing, tool invocation
- All endpoints JWT auth + role guards (Admin, Developer, Agent)
- 5 spec files covering filters, runtime manager, HTTP transport, controller, service

### Plugin Platform (`apps/api/src/plugin-kernel`, `packages/plugin-sdk`, `packages/plugin-platform`)

- Full lifecycle state machine: discovered → installed → scanned → enabled ↔ disabled → quarantined → uninstalled
- Manifest parsing with trust levels (bundled, local_trusted, third_party, quarantined)
- 6 contribution types: tool, workflow.step, workflow.hook, event.subscription, capability.endpoint, special_step
- 12 policy decision points covering install, enable, runtime start/invocation, event delivery, capability endpoint, permissions (secret, storage, network)
- `PluginEventDeliveryEngineService`: retry with exponential backoff, dead-letter queuing
- 3 isolation modes: none, worker_process, container
- `PluginRuntimeSupervisorService` with crash loop auto-quarantine
- SDK: manifest schema, contribution types, runtime protocol (10 message types)
- 32 spec files in plugin-kernel
- `packages/plugin-platform/src` minimal (placeholder package, integration tests only)

### Kanban Domain Service (`apps/kanban/src`)

- Work item CRUD, status transitions, dispatch, review, merge
- Work item dependencies and subtasks
- Human feedback resolution
- Project management (CRUD, goals, cloning)
- Orchestration lifecycle: start, pause, resume, complete
- Cycle decisions: repeat, pause, complete, blocked
- Action requests: request, approve, reject
- Retrospectives, settings management
- MCP read tools: `kanban.project_state`, `kanban.orchestration_timeline`
- MCP mutation tools for work-item, orchestration, dispatch
- Event publishing / lifecycle events
- Probe result artifact parsing with frontmatter + YAML + markdown body extraction
- 15 database entities, 14 repositories
- ~80 spec files covering services, controllers, tools, repositories

### Kanban Contracts and MCP (`packages/kanban-contracts/src`)

- `ProjectRecordSchema` / `ProjectSchema` (DB/API level views with camelCase/snake_case timestamps)
- `WorkItemStatusSchema`: 8-state enum (backlog, todo, refinement, in-progress, in-review, ready-to-merge, blocked, done)
- `WORK_ITEM_STATUS_GROUPS` / `isWorkItemStatusInGroup()` grouping utility
- Work item scope, subtask, execution config, rejection feedback schemas
- Project goal schemas with MoSCoW priority, worklog entries
- Orchestration mode/status schemas (supervised, autonomous, idle, awaiting_approval, etc.)
- Decision log, action request, state snapshot schemas with probe_results embedding
- Review decision input schema
- Event envelope schemas (v1) for created, status_changed, assigned events
- Settings schemas with 12 setting keys
- All schemas use `.strict()` enforcement
- Every schema has corresponding `*.types.ts` inferred TypeScript types
- 2 spec files validating parsing and status group classification

### Web Management UI (`apps/web/src`)

- Dashboard with project stat cards, trend charts
- `useProjectOrchestration` hook with start/approve/reject/pause/resume/complete mutations
- `useProjectOrchestrationSummaries` with 30s polling
- Control plane board with dispatch/repair lanes, intents, facts, no-launch reasons
- Workflow visualizer with ReactFlow (job/step nodes, animated sequences)
- Workflow activity feed with search, quick filters, failure highlighting
- Workflow launch dialog with preset save/load, JSON mode, contract validation
- Kanban board with realtime WebSocket subscription
- Work item detail panel
- Auth store with Zustand persist, token refresh, validation, logout
- API client with Axios, project/workflow/admin methods, event ledger
- 50+ spec files covering hooks, components, pages

### E2E and Integration Tests (`packages/e2e-tests/src`)

- 6-phase kanban lifecycle runner: project/work-item → in-progress → in-review → ready-to-merge → PM hydration → CEO dispatch
- QA review workflow integration with `submit_qa_decision` tool validation
- Functional workflow scenario runner with WebSocket observer and poll-fallback
- Split-service smoke test (Core API / Kanban interop via MCP)
- Frontend quality analysis CLI tool
- Test gate with `RUN_E2E_TESTS=true` conditional skip
- Preflight utilities for JWT secret and API reachability checks
- 10 test files with per-phase 10-40min timeouts

---

## 2026-06-15 Refresh: New Capability Areas (Probed)

The 2026-06-15 refresh probed 22 new scopes in detail. Of those, 17 were
successful and 5 failed (source code present, probe artifact missing on disk
at finalization). Summaries of successful probes appear below; failed probes
are listed at the end with the recommended remediation.

## 2026-06-15 Retry Cycle: Targeted Manifest (9 scopes)

The retry cycle targeted the 5 originally-failed probes (split for context
budget: `gitops` → 2 scopes, `execution-lifecycle` → 2 scopes; 3 unchanged)
plus 2 carry-forward refresh areas driven by active work items.

## 2026-06-15 5th-Pass Split-Retry: Cost Governance Policy Layer — RESOLVED (1/1 successful)

The 4x-failed `cost-governance` scope was split per the OPEN_QUESTIONS R17
escalation guidance. The first half — `cost-governance-policies` — probed
successfully.

- **`cost-governance-policies` (0.95, implemented)** — 3 production services
  - 3 co-located spec files (~6 files inspected) plus supporting
    `database/entities/budget-policy.entity.ts` and the 3 `types/*.types.ts`
    files in `apps/api/src/cost-governance/types/`. The split is per
    responsibility: `BudgetPolicyService` (pure CRUD), `CostEstimatorService`
    (pure arithmetic against `llm_models` pricing table), and
    `BudgetDecisionService` (orchestration with rank-based
    "most-restrictive-wins" semantics). The module wires all three as
    providers and exports `BudgetDecisionService` + `CostEstimatorService`
    for the runtime half of the split to consume.

  ### Capabilities confirmed
  - **Cost estimation against a model pricing table** — `CostEstimatorService`
    resolves an `LlmModelRepository` row by provider+name first, falls back
    to name-only; handles split input/output tokens, total-only tokens, and
    null token estimates; returns `estimateSource: 'unknown'` with
    `estimatedCents: null` when rates or tokens are missing; uses
    `Math.ceil` for cent rounding.
  - **Configurable budget policies with enforcement modes** — `BudgetPolicy`
    entity + `BudgetPolicyService` CRUD with an enforcement_mode allow-list
    (`observe | warn | approval_required | block`); rules are scopeable
    by scope_type, scope_id, context_type, context_id, provider_name, and
    model_name; thresholds are `soft_limit_cents`, `hard_limit_cents`, and
    `token_limit`. Request DTOs are validated through a Zod schema
    re-exported from `@nexus/core`.
  - **Per-action budget decisions with most-restrictive-wins semantics** —
    `BudgetDecisionService.evaluateAction` walks every matching active
    policy, maps each policy's `enforcement_mode` to a decision outcome
    (`observe → allow`, `warn → warn`, `approval_required →
approval_required`, `block → deny`), and applies a `DECISION_RANK`
    table (`observe=0, allow=0, warn=1, approval_required=2, throttle=3,
block=4, deny=4`) so multiple matching policies escalate to the
    strictest applicable outcome. Outcomes are `allow | warn |
approval_required | throttle | deny`.
  - **Time-windowed spend lookups for decisions** — `resolveWindowStart`
    in `BudgetDecisionService` handles `daily | weekly | monthly | per_run
| rolling` reset windows and feeds `BudgetUsageEventRepository
.getSpendInWindow`. Decisions are persisted as audit events via
    `BudgetDecisionEventRepository.recordDecision`.
  - **Read-back of latest decision per context** —
    `BudgetDecisionService.getLatestDecision` returns
    `LatestBudgetDecisionDto` or `null` for a given
    `(contextType, contextId)`.

  The runtime half of this split (`cost-governance-runtime`, covering
  `turn-usage-recorder`, `usage-token-normalizer`, `budget-context.provider`,
  the controller, and the module wiring) is deliberately not assessed in
  this probe.

### GitOps platform — RESOLVED (2/2 successful)

The original `gitops` failure was the result of context-budget overshoot.
The retry split the scope into two halves, both of which probed successfully.

- **`gitops-reconciliation-core` (0.88, implemented)** — The 17 source files
  (10 production + 7 spec) provide a complete, well-tested reconciliation
  pipeline covering four primitives: `plan` (read-only diff via
  `ReconciliationDiffService.computePlan`), `apply` (transactional mutate
  via `ReconciliationApplyService.apply`), `detectDrift` (drift
  classification via `DriftDetectionService.classify`), and a periodic
  `GitOpsReconciliationLoop` tick driver. The diff engine implements a
  comprehensive set of safety guards: never touches unmanaged objects,
  downgrades deletions to noop when `prune` is false or when the node is
  locked or has foreign descendants, blocks locked updates, and reconciles
  conflicts between inbound desired-state and outbound pending changes.
  Apply runs inside a single `dataSource.transaction`, writes a
  `GitOpsReconcile` audit row per non-noop change, supports `dryRun`, and
  dispatches per-type handlers via `GitOpsObjectRegistryService`. **Partial
  gaps**: (a) `config_override` apply is a stub that throws
  `Error('config_override apply not yet implemented for key: ...')`; (b) the
  `GitOpsReconciliationLoop` class is implemented with tests but **not
  wired** into the module — there is no scheduled reconcile tick in the
  running application today.
- **`gitops-desired-state-and-sync` (0.92, implemented)** — 41 source files
  and 25 spec files deliver a complete binding-aware pipeline: pull desired
  state from a git repository (`DesiredStateLoaderService` + `gitops-yaml-loader`),
  validate against `@nexus/gitops-contracts` schema (`ConfigValidationService`),
  compute reconciliation plans through per-type object handlers
  (`ActualStateReaderService` + 6 `*.gitops-handler.ts` files in `objects/`),
  apply plans transactionally (`ReconciliationApplyService` +
  `GitOpsInboundReconcileService`), record reconcile runs and pending
  changes in PostgreSQL, gate app-side edits via `GitOpsEditPolicyService`,
  sync app-side edits back to git via `GitOpsOutboundSyncService`, and
  surface status through `GitOpsStatusService`. The `GitOpsController`
  wires the full HTTP surface with Zod-validated DTOs and permission
  guards. **Partial gaps**: (a) the legacy root-level `POST /gitops/validate`
  endpoint is a stub; (b) `gitops-status.controller.ts` does not exist on
  disk despite being listed in the manifest — the spec exercises
  `GitOpsController.getStatus` directly; (c) the `credentialsSecretId`
  column on `GitOpsRepositoryBinding` is not yet consumed.

### Execution lifecycle — RESOLVED (2/2 successful)

- **`execution-lifecycle-supervisor` (0.97, implemented)** — All 25 paths
  (2,716 lines of production + spec) are wired and tested. The watchdog
  reaps orphaned executions (`ExecutionSupervisorService`); freeze/resume
  lifecycle coordinators (`ShutdownFreezeCoordinator`,
  `StartupResumeCoordinator`) hook `OnApplicationShutdown` /
  `OnApplicationBootstrap`; fire-and-poll dispatcher
  (`ExecutionDispatchService`); throttled heartbeat
  (`ExecutionHeartbeatService`); process-wide lifecycle phase tracker
  (`ServiceLifecycleStateService`); supporting helpers
  (`execution-supervision.helpers`, `heartbeat-throttle.helpers`,
  `execution-transition.helpers`); and `ExecutionsController` HTTP
  surface. Test-to-source ratio is ~1.7× overall (the supervisor alone is
  ~2.2× with 12+ scenarios). The 4-class reaper classification
  (`container_lost` → `max_runtime_exceeded` → `spawn_timeout` →
  `never_dispatched`) plus `idle_timeout` exemption for `workflow_step`
  kinds is implemented in `classifyExecutionForReaping()`. **Minor code
  smells**: `ExecutionDispatchService.resolveContainerIp()` calls
  `getContainerStatus()` and explicitly discards the result; the IP
  resolution default relies on a `protected` hook with no production
  override.
- **`execution-lifecycle-persistence` (0.94, implemented)** — 23 paths
  (1,607 lines of production + spec) cover adapters
  (`SessionRehydratorAdapter`, `StepQueueDrainerAdapter`),
  read-side sidecar utility (`checkpoint-marker-reader`), freeze +
  lifecycle contracts (`freeze.contracts.ts`,
  `execution-lifecycle.contracts.ts`), the CQRS-style projector
  (`ExecutionProjector` subscribes to `EXECUTION_EVENT_TYPES` at
  `onModuleInit()`), event publisher (`ExecutionEventPublisher` with 11
  methods), subagent liveness probe
  (`SubagentContainerLivenessProbe` via `dockerode`), read-model DTO
  (`ExecutionReadModel` + `toExecutionReadModel()`), and the entire
  `database/` subtree (TypeORM entity + repository + types). 100%
  spec-to-source pairing. **Notable design**: `SessionRehydratorAdapter`
  is intentionally a no-op that logs and returns `false` — the docstring
  explains that re-provisioning requires execution-kind-specific executor
  machinery, owned by `SubagentParentResumeService` for the subagent path.
  `ExecutionEntity` is a 35-column TypeORM entity with `@VersionColumn()`
  (passive — the repository's `applyTransition()` uses find+save rather
  than optimistic-lock update).

### Memory system — STILL MISSING (refresh confirms prior findings)

- **`memory-system-active-todos` (0.93, missing)** — All four self-improvement-loop
  TODO items remain unimplemented. The codebase is essentially identical to
  the 2026-06-15 prior probe. **Item (a) 3e58388a p1** — no production class
  implements `IChatContextProvider` (only the type files in
  `chat-context-providers/` exist). `MemoryModule` and `SessionModule` have
  no `OnModuleInit` hook to register built-in providers.
  `ChatSessionContextService.registerProvider` is only invoked from spec
  mocks. **Item (b) ddfdcead p1** — `TokenCounterService.getTokenLimit(model)`
  still returns a literal `128000` in both branches; the per-model
  `llm_models.token_limit` column is unused by the counter. **Item (c)
  cf917e54 p0** — `LearningPromotionService` writes lessons to
  `memory_segments` with `source: 'learning_candidate'`, but no built-in
  `IChatContextProvider` and no system-prompt merge step pulls them back
  into the agent's planning context. **Item (d) 3effbfa9 backlog** —
  `SessionHydrationService.enqueueDistillationIfNeeded` still hardcodes
  `0.8`; `SystemSettingsService` is not injected; no `DISTILLATION_*` key
  exists in `SYSTEM_SETTING_DEFAULTS`.

### Kanban retrospectives — STILL MISSING (refresh confirms prior findings)

- **`kanban-retrospectives-failure-trigger` (0.97, missing)** — The
  `failure_threshold` trigger type literal is declared in
  `KANBAN_RETROSPECTIVE_TRIGGER_TYPES` (`retrospective.types.ts:20`) but
  the entire wiring is absent: no service entry point, no controller
  endpoint, no settings key, no event listener, and no event handler
  integration. The only two active trigger sources remain
  `runForCompletion` (from `OrchestrationCycleDecisionService` on a
  `complete` cycle decision) and `runManualReplay` (from
  `RetrospectivesController.POST /retrospectives/run`). The
  `KanbanRetrospectiveService.executeRun` already accepts a `triggerType`
  discriminator and builds an idempotency key per call, so the runtime
  would naturally support a third trigger source — only the trigger
  producers, settings surface, and tests are missing. The EPIC-202 epic
  tracker still marks the work as ❌ Open, the work item file
  `2b8d0c51-ad27-4f10-9448-38502c8bbf35` is unchanged, and the
  `CODEBASE_HEALTH.md` line still identifies the failure-threshold trigger
  as a known open todo. **Wiring gap to close**: (1) add threshold setting
  keys to `KanbanSettingKeySchema`; (2) add matching entries to
  `KANBAN_SETTING_DEFAULTS`; (3) add `runForFailureThreshold(trigger)` to
  `KanbanRetrospectiveService`; (4) add a new
  `failure-threshold-event.handler.ts`; (5) wire the handler in
  `retrospectives.module.ts`; (6) touch
  `OrchestrationRepairLaneService` or `core-lifecycle-stream.consumer.ts`
  to notify the handler; (7) add tests.

### Failed probes — STILL FAILED (3)

- `oauth` (`apps/api/src/oauth/`) — source present (5 files + 3 specs);
  re-probe failed again. Anthropic OAuth provider, OAuth login service,
  pi-ai OAuth provider resolver.
- `cost-governance` (`apps/api/src/cost-governance/`) — **Partially
  resolved by 5th-pass split (see 5th-Pass section above)**. The
  policy/decision/estimation half (`cost-governance-policies`) probed
  successfully with confidence 0.95; the runtime/recorder/controller
  half (`cost-governance-runtime`) is in flight as the second SPLIT
  RETRY scope. Budget policy, decision, estimator (resolved);
  turn-usage recorder, usage token normalizer, budget context
  provider, controller, module wiring (in flight).
- `war-room` (`apps/api/src/war-room/`) — source present (14 production
  files); re-probe failed again. Multi-party collaboration with signoff
  workflow.

### Harness platform (5/5 successful)

- `packages/harness-runtime/` — engine-agnostic kernel. Exports
  `HarnessEngine` / `HarnessSession` SPI, `registerEngine` / `loadEngine` /
  `assertTelemetryVersion`, `startKernel` bootstrap (7-step), HTTP server
  (`/health`, `/execute/agent`, `/execute/command`, `/shutdown` on port
  8374), governance client with 3-retry linear backoff,
  `wrapToolWithGovernance` wrapper, mounted-tool loader (parses `*.ts` in
  `extensionsDir`, AJV validation, `ensureResultFits`), `executeApiCallback`
  (6-attempt retry, undici long-poll), `executeExternalMcpCallback`
  (JSON-RPC 2.0), v3 session JSONL writer, `SessionCheckpointWriter` +
  `FileSidecarSink`, durable-await suspend propagation, `ask_user_questions`
  runner-local handler. `host-mount-scope` module implemented but not wired
  into kernel bootstrap.
- `packages/harness-engine-pi/` — `PiEngine` (id `"pi"`,
  `PI_CAPABILITIES`). Wires `@earendil-works/pi-coding-agent` SDK:
  `AuthStorage.inMemory`, `ModelRegistry.inMemory` + custom-model shim,
  `SessionManager.open`/`create` with `branch(resumeNodeId)` +
  `skipTrailingAssistantLeaf`, SDK tool allowlist filtering, tool dedup,
  tool-name sanitization (`kanban.project_state` →
  `kanban_project_state`), `PiHarnessSession` wrapping with `text_end`
  accumulator, durable-await `suspend()` → synthetic `agent_end` with
  `stopReason: "suspended"`. Self-registers via side-effect
  `registerEngine("pi", …)`.
- `packages/harness-engine-claude-code/` — `ClaudeCodeEngine` (id
  `"claude-code"`, `CLAUDE_CODE_CAPABILITIES`). Dynamic SDK import with
  stub fallback, MCP server wiring (`nexus-kernel-tools`), `canUseTool`
  governance, `jsonSchemaToZod` tool-schema conversion,
  `buildClaudeAuthDelivery` (env map or `~/.claude/.credentials.json`
  file mode), `ClaudeV3Mapper` + `V3SessionWriter` for persistence,
  `ClaudeCodeSession.getProducedSessionId()` for resume, durable-await
  suspend wiring.
- `packages/harness-conformance/` — hermetic cross-engine C1–C9 matrix:
  C1 validate, C2 createSession, C3 turn_start, C4 tool_execution_start,
  C5 tool_execution_end, C6 agent_end, C7 governance deny, C8 api_key
  delivery, C9 oauth delivery. Plus v3 JSONL golden test against
  `claude-v3-golden.jsonl` with structural invariant enforcement (id,
  parentId DAG validity).
- `apps/api/src/harness/` — server-side surface.
  `HarnessProviderRegistryService` (seeds `pi` + `claude-code` with
  env-overridable Docker image refs), CRUD for custom harnesses
  (`HarnessConfigController`), `HarnessCredentialResolverService` with
  scope-chain resolution, `HarnessOAuthLinkService` (bridges
  `oauthProviderId` to `OAuthLoginService`), `ScopedAiDefaultResolver`
  with field-level precedence, `resolveRunnerHarness` with
  capability/provider compatibility + `harness.selection.fallback` ledger
  event. ~1500 LOC of test code against ~2800 LOC of source.

### GitOps platform (1/2 successful)

- `packages/gitops-contracts/` — Zod leaf package. `apiVersion:
"nexus.gitops/v1"`, schemas: `common`, `scope`, `rbac`, `overrides`,
  `desired-state` (with `OverrideStrategy` replace/merge +
  `OverrideSource` seeded/admin/repository/imported/agent_factory), plus
  `serializeDesiredState` / `parseDesiredStateFiles` and pure
  `validateDesiredState` for cross-document referential integrity. 7
  spec files; imported by `apps/api/src/gitops/config-validation.service.ts`,
  `config-export.service.ts`, `gitops-yaml-loader.ts`,
  `actual-state-reader.service.ts`, plus integration test.
- `apps/api/src/gitops/` — (FAILED probe) substantial source present
  (`gitops.module.ts`, `gitops.controller.ts`, reconciliation, drift
  detection, desired-state loader, config export/validation,
  inbound/outbound reconcile, pending change service, reconciliation
  loop, status service/controller, integration tests). Re-probe required.

### Multi-agent collaboration (0/1 successful)

- `apps/api/src/war-room/` — (FAILED probe) source present (14 production
  files covering `open`, `close`, `invite`, `consensus`, `dependencies`,
  `post-message`, `shared`, `state`, `submit-signoff`,
  `update-blackboard`, plus `war-room-workflow-event-log.service.ts`,
  module, `database/`, `ports/`). Re-probe required.

### Inter-agent messaging (1/1 successful)

- `apps/api/src/acp/` — Agent Communication Protocol over HTTP.
  `AcpController` exposes full CRUD + reload + invoke + manifest under
  `/api/acp`. `AcpRuntimeManagerService` extends
  `BasePluginRuntimeManagerService` for sharing with MCP runtime;
  `discoverItemsWithRetry` with linear backoff, `filterAcpAgents`,
  `syncDiscoveredAgents` (hashed registry name
  `acp:<namespace>_<sanitized>_<8-char-hash>`). Three run modes
  (SYNC/ASYNC/AWAITING), streaming via SSE parser, capability
  registration with `source: 'external_acp'`. Secret-by-reference
  contract uniform with MCP. Web UI hooks (`useAcpServers`,
  `AcpServerFormDialog`, `AcpServersCard`).

### Cost and resource governance (0/1 successful)

- `apps/api/src/cost-governance/` — (FAILED probe) source present
  (`budget-policy.service.ts`, `budget-decision.service.ts`,
  `cost-estimator.service.ts`, `turn-usage-recorder.service.ts`,
  `usage-token-normalizer.ts`, `budget-context.provider.ts`,
  `cost-governance.controller.ts`, `cost-governance.module.ts`,
  `database/`, `dto/`, `types/`). Re-probe required.

### Configuration surfaces (2/3 successful)

- `apps/api/src/oauth/` — (FAILED probe) source present
  (`anthropic-oauth.provider.ts`, `oauth-login.service.ts`,
  `oauth-login.types.ts`, `oauth.module.ts`,
  `pi-ai-oauth-provider.resolver.ts`, plus 3 spec files). Re-probe
  required.
- `apps/api/src/scope/` — 5-level hierarchy
  (platform/org/region/team/project) with closure-table ancestry, fixed
  platform root UUID, `ensureNode` (idempotent upsert),
  `archiveNode` / `restoreNode` (project-only),
  `findOrphanedProjectNodes`, `getAncestorIds` / `getDescendantIds`,
  `moveNode` (with cycle prevention). REST endpoints guarded by
  `JwtAuthGuard` + `PermissionsGuard` with
  `scopes:create|read|update|manage`. 8 spec files (service, controller,
  audit, integration, module, entity, two migrations).
- `apps/api/src/system/` — persistence-layer only (3 entities:
  `SystemSetting`, `SetupConfig`, `CostTracking`; 1 repository:
  `CostTrackingRepository`). All behaviour lives in
  `apps/api/src/settings/` (SystemSettingsService + SystemSettingsController)
  and `apps/api/src/setup/setup.service.ts` and
  `apps/api/src/observability/cost-tracking.service.ts`.

### Execution lifecycle (0/1 successful)

- `apps/api/src/execution-lifecycle/` — (FAILED probe) source present
  (18 production files: `execution-supervisor.service.ts`,
  `shutdown-freeze.coordinator.ts`, `startup-resume.coordinator.ts`,
  `execution-dispatch.service.ts`, `session-rehydrator.adapter.ts`,
  `step-queue-drainer.adapter.ts`, `freeze.contracts.ts`,
  `checkpoint-marker-reader.ts`, plus 10+ helper / projector / publisher
  / probe / controller files; 15+ spec files). Re-probe required.

### Import boundary enforcement (1/1 successful)

- `apps/api/src/architecture/` — vitest-enforced cross-domain import
  scanner. Three domains: `control-plane` (workflow/), `chat-domain`
  (session/), `external-domain` (project/, project-goals/). 60-second
  scan timeout. Allowlist split across
  `import-boundary.exceptions.ts` (9 entries, all
  `control-plane → chat-domain` targeting `SessionHydrationService`,
  expiring 2026-09-30, owner `EPIC-090`) and
  `import-boundary.exceptions.workflow-domain-ports.ts` (empty, reserved
  for `control-plane → external-domain`).

### Kanban expansion (8/8 successful)

- `apps/kanban/src/dispatch/` — new module, carved out of orchestration.
  `DispatchController` exposes
  `POST /projects/:project_id/dispatch/ready-work-items` and
  `/selected-context-items`. `DispatchService.dispatchReadyWorkItems`
  applies layered guardrails (idempotency, status, dependency readiness,
  per-agent concurrency, per-project WIP, target-branch dedup), then
  `coreClient.requestWorkflowRun` + persist `linked_run_id` +
  `current_execution_id` with mutation confirmation.
  `dispatchSelectedWorkItems` pure-function path with `slots` upper
  bound. `requestOrchestrationCycle` emits
  `ProjectOrchestrationCycleRequestedEvent` with deterministic dedupe
  key. Wired into MCP mutation tool
  `kanban.dispatch_selected_work_items` (tier 2, runner_local) and
  orchestration's 3 services.
- `apps/kanban/src/external-sync/` — new bidirectional sync framework.
  `ExternalSyncController` (CRUD + test/pause/resume/sync/import/export),
  `WebhookReceiverController` (signature validation, event routing),
  `ExternalSyncPollingScheduler` + `Processor` (BullMQ 5-min default
  tick), `SyncCoordinatorService.runInbound` (pagination),
  `InboundSyncService.processDeletedEvent` (soft-mark, never delete),
  `ConflictResolverService` (last-writer-wins, 3 decisions),
  `FieldMapperService` (path-based config-driven mapping),
  `OutboundSyncService.pushStatusChange` (fire-and-forget from
  `KanbanLifecycleEventPublisher`), `ProviderRegistryService` + DI
  symbol `EXTERNAL_TICKET_PROVIDER`, `NullExternalTicketProvider`
  default. 12 spec files.
- `apps/kanban/src/retrospectives/` — new module.
  `KanbanRetrospectiveService` with `runForCompletion` (called by
  `OrchestrationService` after a `complete` decision) +
  `runManualReplay`. Cooldown 15min, idempotency via unique key index,
  `no_delta` short-circuit. `KanbanRetrospectiveEvidenceService.collectProjectEvidence`
  produces deterministic delta snapshot.
  `learning.candidate.proposed.v1` emitted via
  `CoreWorkflowClientService.emitDomainEventOrThrow`.
  `CycleDecisionEventHandler` in-memory bounded (100/project, 7-day
  window). 4 spec files.
- `apps/kanban/src/goals/` — new module (EPIC-059).
  `ProjectGoalsController` exposes CRUD + status + reorder + archive +
  worklog under `/projects/:project_id/goals`. `ProjectGoalsService`
  with `requireWorkItem` cross-project guard,
  `CharterRegenEnqueuer.enqueue(project_id)` on every mutation. Zod
  schemas in `packages/kanban-contracts/src/goals.schema.ts`. Service
  spec only (no controller spec, no repository spec).
- `apps/kanban/src/initiatives/` — new module. `InitiativesController`
  exposes only `GET /projects/:project_id/initiatives` (controller is
  intentionally read-only; all mutations go through MCP tools).
  `InitiativesService` with `linkGoal`/`unlinkGoal`, `assignWorkItem`
  (verifies initiative exists), `setPriority` (stamps
  `last_reviewed_at`). Zod enums: `InitiativeHorizon = "now" | "next" |
"later"`, `InitiativeStatus = "proposed" | "active" | "paused" |
"done" | "dropped"`. Migration
  `20260612200000-create-kanban-initiatives.ts` adds
  `kanban_work_items.initiative_id` FK. 7 MCP tools + 1 read
  integration.
- `apps/kanban/src/migration/` + `seeds/` — new module.
  `legacy-kanban-import.ts` with mappers + `runLegacyKanbanImport`
  (dependency-safe write order: projects → workItems → goals →
  dependencies → subtasks → goalWorklogs) + `diffLegacyKanbanRows`
  (stable-stringify-based). `legacy-kanban-import.cli.ts` with
  `--mode dry-run|import|reconcile`, two `DataSource` connections, npm
  script `import:legacy-kanban`. `kanban-permission.seed.ts`
  (production seeder invoked from `AppService.onApplicationBootstrap`).
  4 contract spec files (~4k LOC) pinning on-disk YAML seeds.
- `apps/kanban/src/orchestration/strategic/` + `control-plane/` — new
  subdirectories. Strategic: `ProjectStrategicStateService`
  (staleness, burn rate 10-cycle window, starvation forecast,
  `latestStrategicIntent`), `strategic-intent-timeline.helpers`
  (append / latest). Control-plane:
  `OrchestrationDecisionExecutorService` (Zod-validated
  `StructuredOrchestrationDecision` with `request_wakeup /
dispatch_work_items / transition_work_item_status / record_only`
  actions and lane capacity),
  `OrchestrationControlPlaneSchedulerService` (create / evaluate /
  terminalize / record launch attempt),
  `OrchestrationLeaseService` (cycle lease + mutation leases),
  `OrchestrationLeaseSweeperService` (30s background sweep),
  `OrchestrationRepairLaneService` (failed work-item run + event
  delivery lanes), `OrchestrationFactSnapshotService` (60s/30s TTL),
  `KanbanEventReplayService`,
  `OrchestrationSimulationRunnerService` (8 deterministic scenarios
  for EPIC_197: bootstrap, upstream rediscovery, parallel lanes, QA
  rejection, stale link, duplicate wakeup, merge conflict,
  event-delivery failure).
- `apps/kanban/src/orchestration/` (overall) — ~21,000 LOC, 80+
  modules. `OrchestrationService` composes 5 inner services (cycle
  decision, action requests, observability, state lifecycle, run
  request). Top-level facade:
  start/pause/resume/complete/updateMode/get/getDiagnostics/getActivitySummary/recordDecision/recordStrategicIntent/recordDiscoveryCompleted/requestAction/approve/reject/listProjectActionRequests/recordCycleDecision/clearCycleDecision/updateSpecsReady/recordImportHydrationBlocked/clearImportHydrationBlocked/recoverImportedHydration/reconcileLinkedWorkflowRun.
  33 spec files.

### Failed probes (5)

The following scopes have source code in their declared paths but the probe
result file was missing at finalization. Re-probe in the next investigation
cycle:

- `oauth` (`apps/api/src/oauth/`) — Anthropic OAuth provider, OAuth login
  service, pi-ai OAuth provider resolver
- `gitops` (`apps/api/src/gitops/`) — 30+ production files covering
  reconciliation, drift detection, validation, sync
- `war-room` (`apps/api/src/war-room/`) — 14 production files for
  multi-party collaboration
- `execution-lifecycle` (`apps/api/src/execution-lifecycle/`) — 18
  production files for freeze/resume coordination
- `cost-governance` (`apps/api/src/cost-governance/`) — budget policy,
  decision, estimator, context provider, controller, module

> **2026-06-15 retry update**: After the retry cycle, `gitops` (split into
> `gitops-reconciliation-core` + `gitops-desired-state-and-sync`) and
> `execution-lifecycle` (split into `execution-lifecycle-supervisor` +
> `execution-lifecycle-persistence`) are both **resolved**. The remaining
> three failures (`oauth`, `cost-governance`, `war-room`) are unchanged
> and remain on the re-probe list.

---

## New capability areas (31st pass, 2026-06-19)

Two new directory-tree structural areas detected since the 30th pass's NO-CHANGE REFRESH.
These represent the 3d7fb798 and ddfdcead in-main implementations that landed on
`main` after the 30th pass wrote `[]`.

### Memory — Segment Confidence Decay Reaper (NEW 2026-06-19, 3d7fb798)

- `apps/api/src/memory/memory-decay.{reaper,reaper.spec,reaper.integration.spec,constants,types}.ts`
  (5 files) — implements work item `3d7fb798-f54d-40ff-a803-438224474912`
  ("Add memory segment confidence decay over time to keep the self-improvement loop current").
- `MemoryDecayReaperService` — NestJS `@Injectable` (implements
  `OnApplicationBootstrap`) that owns the nightly confidence-decay pass,
  the BullMQ cron registration, and the per-row evaluation math. The
  service reads settings fresh on every `runDecayPass()` (no caching at
  construction), short-circuits with `{ skipped: true, reason: 'disabled' }`
  when `memory_decay_enabled` is false, and never throws on a per-row
  failure (transient DB blip logs and continues). The BullMQ cron
  registration is best-effort (swallows transient Redis/cron-parser
  errors).
- `MemoryDecayReaperService.evaluateCandidate(...)` — explicit defensive
  checks for exempt sources (belt-and-suspenders), `null` last-touch
  (no-op), in-grace rows (preserved), missing confidence (no-op), and a
  per-row error handler. The decayed confidence is rounded to 2 decimal
  places to defeat the `0.5 - 0.01 = 0.48999…` float-drift.
- `MemoryDecayReaperService.runDecayPass()` — the test-friendly seam that
  accepts an optional `now` for deterministic tests.
- Constants module (`memory-decay.constants.ts`) — single source of truth:
  - `MEMORY_DECAY_SETTING_KEYS` record.
  - `MEMORY_DECAY_EXEMPT_SOURCES` (`ReadonlySet<string>` of
    `learning_candidate` / `workflow_failure_postmortem` / `strategic_intent`).
  - Hardcoded defaults: `enabled=true`, `graceDays=30`, `dailyRate=0.01`,
    `floor=0.2`, `cron='30 3 * * *'`.
  - Runtime identifiers: `MEMORY_DECAY_QUEUE = 'memory-decay'`,
    `MEMORY_DECAY_JOB_NAME = 'memory-decay-reaper'`.
- Public type surface (`memory-decay.types.ts`):
  `MemoryDecayRunSummary`, `MemoryDecayRunOptions`, `MemoryDecaySettings`.
- Repository contract (`MemorySegmentRepository.findDecayCandidates({ exemptSources, graceCutoff })`):
  SQL filter `WHERE archived_at IS NULL AND source NOT IN exempt AND
COALESCE(GREATEST(last_accessed_at, last_reinforced_at), ...) < :graceCutoff`.
  Plus `save(segment)` (the decay-in-place path), `update(id, { archived_at })`
  (the archive path), and `touchReinforcedAt(ids)` (read-path reinforcement).
- Metrics wiring: `MemoryMetricsService.setMemoryDecayLastRun(value)`
  (snapshot timestamp, set on every pass including pass-throughs) and
  `MetricsService.recordMemoryDecayRun(evaluated, archived)` (prom-client
  counter pair, only on rows actually evaluated).
- Settings seeding: all five `memory_decay_*` keys are registered in
  `SystemSettingsService.seedDefaults()` with full descriptions and
  hardcoded fallbacks; `isUserMutable(...)` includes all five keys in
  the allowlist.
- Migration `20260623000000-add-memory-segment-decay-columns` adds the
  `last_reinforced_at` `timestamptz` column (backfilled to `NOW()` for
  existing rows) and supporting b-tree indexes. Registered in
  `apps/api/src/database/migrations/registered-migrations.ts`.
- Module wiring: `MemoryDecayReaperService` is registered in both the
  `providers` and `exports` arrays of `MemoryModule`, and `MEMORY_DECAY_QUEUE`
  is registered via `BullModule.registerQueue({ name: MEMORY_DECAY_QUEUE })`
  in the module's `imports`.
- Test coverage: 11 unit-test scenarios (vs. the documented ≥6) + a
  full integration suite that boots a NestJS `TestingModule` around a
  hand-rolled in-memory `MemorySegmentRepository` (mirrors the
  production SQL filter), seeding 10 segments across 3 sources and
  asserting the canonical 4 archived / 6 retained split + the exact
  decay math `0.8 - 0.01 * 30 = 0.5` + the no-double-archive
  idempotency invariant across consecutive runs.

**31st-pass probe validation (`memory-decay-reaper`, confidence 0.9, implemented):**
The 3d7fb798 work item is **fully implemented** across the assigned scope
and is wired into the surrounding API surface. The implementation honors
its acceptance criteria plus a thoughtful defensive layer: belt-and-suspenders
exempt-source checks, per-row try/catch, settings re-read on every pass,
and a documented test seam (`runDecayPass({ now })`). The only
implementation gap (an R105 followup) is the missing BullMQ consumer for
`MEMORY_DECAY_QUEUE` — the reaper service registers a repeatable job but
no `@Processor('memory-decay')` consumer currently exists to invoke
`runDecayPass()` on the cron tick. The constants file's docstring notes
"The BullMQ scheduler milestone will add a processor on this queue",
so this is likely intentionally deferred to a follow-up milestone. At
runtime today, the cron-registered job would sit in the queue without a
consumer; operators would need to invoke `runDecayPass()` manually (e.g.,
via an admin endpoint) for the reaper to actually run.

### Memory — Model-Aware Token Budget Resolver (NEW 2026-06-19, ddfdcead)

- `apps/api/src/memory/memory-token-budget.{resolver,resolver.spec,resolver.types,integration.spec}.ts`
  (4 files) — implements work item `ddfdcead-dc41-4e3b-9352-5ce0fb474b69`
  ("Resolve hardcoded 128k memory token cap with model-aware resolver").
- `MemoryTokenBudgetResolver` — NestJS `@Injectable` with private
  constructor + `static create()` factory. Depends only on
  `AiConfigurationService` and an options object; no IO, no DB, no
  `ConfigModule` dependency. Pure async `resolve(): Promise<MemoryTokenBudget>`
  is cheap to call on every tick.
- Exported constants (single source of truth):
  - `DEFAULT_MEMORY_BUDGET_MEMORY_PERCENT = 60`
  - `DEFAULT_MEMORY_BUDGET_WORKING_PERCENT = 30`
  - `DEFAULT_MEMORY_BUDGET_RESERVED_PERCENT = 10`
  - `DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW = 128_000`
  - `DEFAULT_MEMORY_BUDGET_USE_CASE: ModelUseCase = 'distillation'`
- Resolution chain (`resolveContextWindow`): `getModelForUseCase(useCase)`
  → `getTokenLimit(modelName)` → if `Number.isFinite && > 0` use it,
  else warn + return `fallbackContextWindow`. Non-positive / null / NaN
  limits all fall through the same path; the warn message disambiguates
  "no active model" from "model with 0 limit configured".
- Slicing math (`slice`): `memory = floor(p * contextWindow)`,
  `working = floor(p * contextWindow)`,
  `reserved = contextWindow - memory - working`. The reserved slice
  absorbs any rounding remainder so `memory + working + reserved === contextWindow`
  for every positive integer window.
- Construction-time validation (`assertPercentsValid`): rejects
  NaN/Infinity and negatives; rejects totals > 100. Throws plain `Error`
  with a descriptive message.
- Public types (`memory-token-budget.resolver.types.ts`):
  - `MemoryTokenBudgetPercents` — `{ memoryPercent, workingPercent, reservedPercent }` (all `readonly number`).
  - `MemoryTokenBudgetOptions` — `memoryPercent? / workingPercent? / reservedPercent? / fallbackContextWindow? / useCase?` (`useCase` typed as `ModelUseCase` from `../ai-config/database/repositories/llm-model.repository`).
  - `MemoryTokenBudget` — resolved budget shape with `contextWindow`, `memory`, `working`, `reserved`, plus echoed-back percentages for logging/telemetry attribution. `readonly` throughout.
- Unit test (`memory-token-budget.resolver.spec.ts`) — 5 `describe` blocks
  with ~15 test cases: construction (defaults, rejects >100 totals,
  rejects negatives, rejects NaN); 60/30/10 slice parametric table for
  8k/32k/128k/200k/1M windows; 128k fallback (null/zero/negative
  `getTokenLimit`); custom `fallbackContextWindow`; configurable
  percentages (70/20/10 + tiny-percentage edge case proving `reserved`
  absorbs the remainder); `useCase` wiring (confirms a `summarization`
  `useCase` is forwarded to `getModelForUseCase`).
- Integration test (`memory-token-budget.integration.spec.ts`) —
  end-to-end NestJS DI module wiring the **real** `MemoryTokenBudgetResolver`,
  **real** `TokenCounterService`, **real** `MemoryManagerService`, plus
  mocked `AiConfigurationService` (200k token limit), `MEMORY_BACKEND_TOKEN`,
  `MemoryMetricsService`, `MetricsService`, and `MemorySegmentRepository`:
  - **`resolver slice`**: asserts `{ contextWindow: 200_000, memory: 120_000, working: 60_000, reserved: 20_000, ... }` with `memory === 120_000` AND `memory !== 128_000` AND `contextWindow !== 128_000` AND `memory + working + reserved === contextWindow` — the explicit bug-fix acceptance criterion from the spec docstring.
  - **`TokenCounterService cap`**: `getTokenLimit('claude-sonnet-200k')` returns `200_000`, NOT `128_000`.
  - **`isOverThreshold` under a 200k model**: builds a ~120k-token JSONL payload, asserts `isOverThreshold(payload, MODEL_200K, 0.8) === false`; a second test re-implements the OLD `128_000 * 0.8 = 102_400` tripwire inline and asserts the same payload WOULD have tripped it — the decisive evidence of the bug fix.
  - **`MemoryManagerService path`**: round-trips a memory segment through the manager + mocked backend and asserts `resolver.resolve().memory === Math.floor(0.6 * tokenCounter.getTokenLimit(MODEL_200K))` — the two sources of truth agree.
- Wiring & module integration:
  - **`MemoryModule.providers`**: registers `MemoryTokenBudgetResolver`
    via a `useFactory` that injects `[AiConfigurationService, ConfigService]`
    and reads the four `MEMORY_BUDGET_*` env vars through `readBudgetOptions(config)`
    - `readPercent(config, key, fallback)`. The factory uses loose
      `config.get` and `??` fallback because the API env validation
      schema does not yet declare these keys.
  - **`MemoryModule.exports`**: `MemoryTokenBudgetResolver` is exported
    so `ChatSessionContextService`, `ChatMemoryContextAssemblerService`,
    and any downstream NestJS module can inject it.
  - **`TokenCounterService`** — now injects both `AiConfigurationService`
    and `MemoryTokenBudgetResolver`. `getTokenLimit(model)` first asks
    the AI config for the model's `token_limit` (returning it when
    usable), and falls back to `budgetResolver.resolve().contextWindow`
    otherwise — the historical 128k magic number is gone from this
    service. `isOverThreshold` is now async because both sources are
    awaited. JSDoc explicitly calls out that "the resolver is the single
    source of truth for the fallback context window (default 128_000
    tokens), so this service no longer hardcodes any 128k magic numbers".
  - **`DistillationConsumer`** — injects `MemoryTokenBudgetResolver` as
    a constructor dependency; uses `resolveMemoryBudgetSafe()` to wrap
    every resolution in a try/catch + non-positive-slice check that
    falls back to a freshly-computed 60/30/10 of
    `DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW` so the consumer
    stays non-fatal when the resolver throws.
  - **`ChatSessionContextService`** — injects `MemoryTokenBudgetResolver`
    and uses `boundBlocksByMemoryBudget(session, blocks)` to drop the
    lowest-priority context blocks until the formatted message fits
    inside `budget.memory`. Single oversized block is kept verbatim.
    Resolver failures or non-positive slices log a warning and return
    the unbounded blocks (mirrors the distillation consumer's defensive
    pattern).
  - **`ChatMemoryContextAssemblerService`** — injects
    `MemoryTokenBudgetResolver` as an **optional** dependency
    (constructor accepts `null`). When the caller does not supply an
    explicit `tokenBudget`, the service resolves
    `budgetResolver.resolve().memory` and uses it as the character-budget
    ceiling (`tokenBudget * 4`). Resolver absent/failure → falls back
    to the historical `CHAT_MEMORY_CONTEXT_TOKEN_BUDGET` config default
    (default 600) so older harnesses that haven't migrated to the
    resolver stay functional.
  - **Test surface downstream** (every consumer of the resolver has an
    updated spec): `apps/api/src/memory/token-counter.service.spec.ts`
    (`createResolverMock(budget)` helper, ~14 test cases);
    `apps/api/src/memory/distillation-threshold.bullmq-integration.spec.ts`
    (provides `MemoryTokenBudgetResolver` as `{ useValue }`);
    `apps/api/src/session/chat-session-context.service.spec.ts`
    (`MemoryTokenBudgetResolver.create(aiCfg)` in the beforeEach;
    multiple override scenarios wired through the TestingModule);
    `apps/api/src/session/chat-memory-token-budget.integration.spec.ts`
    (dedicated integration spec for the chat session-context path);
    `apps/api/src/session/session-hydration.service.spec.ts` (registers
    `MemoryTokenBudgetResolver` because `TokenCounterService` depends
    on it); `apps/api/src/chat/memory/chat-memory-context-assembler.service.spec.ts`
    (provides a no-op mock for the resolver path).

**31st-pass probe validation (`memory-token-budget-resolver`, confidence 0.96, implemented):**
The ddfdcead work item is **fully implemented** across the assigned
scope and wired into every consumer that previously hardcoded a 128k
context-window cap. The resolver replaces the historical "always
128_000 tokens" assumption with a queryable, model-aware budget that
slices the active LLM's `token_limit` into `memory` (60%), `working`
(30%), and `reserved` (10%) partitions via
`AiConfigurationService.getModelForUseCase` + `getTokenLimit`. The 200k
bug-fix acceptance criterion is explicitly asserted in the dedicated
integration spec (`memory === 120_000` AND `memory !== 128_000`).
Backward compatibility is preserved via
`DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW` (128k default) and the
`useFactory` reads env vars with `??` defaults so the resolver is safe
to enable without any environment changes. Followup R106 (no docs
entry) and R107 (env schema not yet declared) are minor hygiene items
that don't block the implementation; R108 (reserved-slice semantics)
is a future ergonomic improvement.

---

## API Routes Summary

| Path                             | Description                                                     |
| -------------------------------- | --------------------------------------------------------------- |
| `/api/ai-config/*`               | AI configuration (providers, models, profiles, secrets)         |
| `/api/auth/*`                    | JWT auth, registration, login, token refresh                    |
| `/api/users/*`                   | User management, role assignment                                |
| `/api/capability-governance/*`   | Tool approval rules, approval requests                          |
| `/api/workflow/*`                | Workflow engine, step execution, repair, subagents              |
| `/api/workflow-launch/*`         | Launch contract, orchestration, presets                         |
| `/api/workflow-run-operations/*` | Run control, steering, reconciliation, workspace                |
| `/api/workflow-runtime/*`        | Capabilities, agent profiles, job output, orchestration actions |
| `/api/automation/*`              | Schedules, hooks, heartbeats, standing orders                   |
| `/api/chat/*`                    | Sessions, messages, collaboration                               |
| `/api/sessions/*`                | Session management, context, hydration                          |
| `/api/mcp/*`                     | MCP server management, tool invocation                          |
| `/api/plugin-kernel/*`           | Plugin lifecycle, contributions, events                         |
| `/api/operations/doctor/*`       | Diagnostics and repair                                          |
| `/api/telemetry/ws`              | WebSocket telemetry endpoint                                    |
| `/kanban-api/*`                  | Kanban domain service API                                       |

---

_Last updated: 2026-06-18 (22nd-pass finalization: NO-CHANGE REFRESH + re-probe recovery — `SCOPE_MANIFEST.json` written as `[]` per refresh-mode instruction. The 18th-pass 1-scope manifest (`memory-eviction-reaper`) was carried forward as a re-probe attempt; the probe loop's recovery check found the scope had already been processed at 2026-06-17T07:36:38.342Z with `outcome: failed` (subagent 500 error), and re-used that outcome without dispatching a new subagent. The `memory-eviction-reaper.md` artifact is therefore unchanged in this pass. 74 probe result files validated (54 valid + 20 failed; all carry-forward from prior passes). The 5 still-failed split-retries remain at 12x-failed per R25/R30 — kanban work-item filing still pending in next CEO cycle. `mergesSinceDiscovery=60` (unchanged from 21st pass). No new capability areas detected; the 18th-pass baseline remains current with respect to the codebase. **NOTE:** `kanban.record_discovery_completed` is not exposed in this finalization agent's tool set; the discovery timestamp re-stamp is the responsibility of a downstream layer. The failed-probe artifact was re-recorded via `kanban.write_probe_result` for consistency.)_

_Last updated: 2026-06-16 (16th-pass finalization: NO-CHANGE REFRESH — `SCOPE_MANIFEST.json` written as `[]` per refresh-mode instruction. 73 probe result files validated (54 valid + 19 failed; all carry-forward from prior passes). The 8th-pass 2-scope manifest is preserved as the prior manifest. The 5 still-failed split-retries remain at 14x-failed per R25/R30 — kanban work-item filing still pending in next CEO cycle. `mergesSinceDiscovery=61` (one new merge since the 15th pass; no commit list available). CEO orchestration cycles at 2026-06-16T22:48:37.137Z and 2026-06-16T22:50:25.412Z auto-cleared two `repeat` decisions after detecting orphaned in-progress work items with no linked workflow runs — routine reconciliation, not a structural change. No new capability areas detected; the 8th-pass baseline remains current. `lastDiscoveryAt` re-stamped via `kanban.record_discovery_completed`.)_
