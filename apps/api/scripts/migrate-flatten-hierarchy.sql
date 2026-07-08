-- EPIC-043: Flatten hierarchical work items into dependency-only graph.
-- Idempotent migration for production environments (synchronize=false).

-- 1) Add scope hint column.
ALTER TABLE work_items
ADD COLUMN IF NOT EXISTS scope VARCHAR(10) NOT NULL DEFAULT 'standard';

-- 2) Preserve former epic intent by marking them as large scope.
UPDATE work_items
SET scope = 'large'
WHERE type = 'epic';

-- 3) Convert parent-child links into dependency edges.
INSERT INTO work_item_dependencies (id, work_item_id, depends_on_work_item_id)
SELECT gen_random_uuid(), wi.id, wi.parent_id
FROM work_items wi
WHERE wi.parent_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM work_item_dependencies wid
    WHERE wid.work_item_id = wi.id
      AND wid.depends_on_work_item_id = wi.parent_id
  );

-- 4) Drop obsolete hierarchy columns.
ALTER TABLE work_items DROP COLUMN IF EXISTS parent_id;
ALTER TABLE work_items DROP COLUMN IF EXISTS type;
