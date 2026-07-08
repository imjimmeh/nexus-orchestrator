-- Purge polluted learning/memory data for one project. Backup-first + transactional.
-- Usage: docker exec -e PGPASSWORD=nexus_password -i nexus-postgres \
--   psql -U nexus -d nexus_orchestrator -v pid="'458935f0-213e-4bbe-89d1-8883e0efa9ad'" \
--   -f - < scripts/ops/purge-project-learning-data.sql
\set ON_ERROR_STOP on
BEGIN;

-- Resolve the working sets once into temp tables.
CREATE TEMP TABLE _cand AS
  SELECT id FROM learning_candidates
  WHERE scope_type IN ('project','kanban_project') AND scope_id = :pid;
CREATE TEMP TABLE _seg AS
  SELECT id FROM memory_segments
  WHERE entity_type = 'project' AND entity_id = :pid;

-- Timestamped backups (suffix is fixed here; rename if you run repeatedly).
CREATE TABLE IF NOT EXISTS _bak_learning_candidates_458935f0 AS
  SELECT * FROM learning_candidates WHERE id IN (SELECT id FROM _cand);
CREATE TABLE IF NOT EXISTS _bak_memory_segments_458935f0 AS
  SELECT * FROM memory_segments WHERE id IN (SELECT id FROM _seg);
CREATE TABLE IF NOT EXISTS _bak_skill_proposals_458935f0 AS
  SELECT * FROM skill_improvement_proposals WHERE learning_candidate_id IN (SELECT id FROM _cand);

SELECT 'pre-delete candidates' AS label, count(*) FROM _cand
UNION ALL SELECT 'pre-delete segments', count(*) FROM _seg;

-- Ordered deletes (respects FK: skill_improvement_proposals.learning_candidate_id → learning_candidates.id ON DELETE SET NULL).
-- signal_weight_history is GLOBAL — never delete it.
DELETE FROM memory_embeddings
  WHERE (owner_type='learning_candidate' AND owner_id IN (SELECT id FROM _cand))
     OR (owner_type='memory_segment'    AND owner_id IN (SELECT id FROM _seg));

DELETE FROM memory_segment_feedback
  WHERE segment_id IN (SELECT id FROM _seg);

DELETE FROM skill_improvement_proposals
  WHERE learning_candidate_id IN (SELECT id FROM _cand);

DELETE FROM retrospective_queue
  WHERE scope_id = :pid;

DELETE FROM runtime_feedback_signal_groups
  WHERE (scope_type IN ('project','kanban_project') AND scope_id = :pid)
     OR (candidate_id IN (SELECT id FROM _cand));

DELETE FROM learning_candidates
  WHERE id IN (SELECT id FROM _cand);

DELETE FROM memory_segments
  WHERE id IN (SELECT id FROM _seg);

SELECT 'post-delete candidates' AS label,
       (SELECT count(*) FROM learning_candidates WHERE scope_type IN ('project','kanban_project') AND scope_id = :pid) AS n
UNION ALL SELECT 'post-delete segments',
       (SELECT count(*) FROM memory_segments WHERE entity_type='project' AND entity_id = :pid);

COMMIT;
