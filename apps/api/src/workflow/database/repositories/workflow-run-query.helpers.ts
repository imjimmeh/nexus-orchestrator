import type { SelectQueryBuilder } from 'typeorm';
import { WorkflowRun } from '../entities/workflow-run.entity';

const WORKFLOW_ALIAS = 'w';

export function ensureWorkflowDefinitionJoined(
  queryBuilder: SelectQueryBuilder<WorkflowRun>,
): void {
  const hasJoin = queryBuilder.expressionMap?.joinAttributes?.some(
    (joinAttribute) => joinAttribute.alias.name === WORKFLOW_ALIAS,
  );
  if (!hasJoin) {
    queryBuilder.leftJoin(
      'workflows',
      WORKFLOW_ALIAS,
      'w.id::text = wr.workflow_id',
    );
  }
}

export function applyWorkflowRunSourceTypeFilter(
  queryBuilder: SelectQueryBuilder<WorkflowRun>,
  sourceType: string | undefined,
): void {
  const sourceTypes = sourceType
    ?.split(',')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0);

  if (!sourceTypes?.length) {
    return;
  }

  ensureWorkflowDefinitionJoined(queryBuilder);
  queryBuilder.andWhere('w.source_type IN (:...sourceTypes)', { sourceTypes });
}
