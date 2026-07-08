import * as prometheus from 'prom-client';

/**
 * Memory-lifecycle instruments (decay reaper + postmortem
 * writeback listener).
 *
 * Registers three counters against the global `prom-client`
 * registry: the nightly decay reaper's evaluated-segment
 * counter, the decay reaper's archived-segment counter, and
 * the workflow-failure postmortem writeback listener's
 * recorded-event counter. Originally defined in
 * `apps/api/src/observability/metrics.service.ts` as
 * `MetricsService.registerMemoryLifecycleMetrics()`; this
 * file is a faithful verbatim extraction of that body so the
 * metric names, label names, and help strings remain
 * byte-identical to the previous in-class definition.
 *
 * Returned as a 3-tuple so the caller can assign them to the
 * matching readonly fields on `MetricsService`.
 */
export function registerMemoryLifecycleMetrics(): readonly [
  prometheus.Counter,
  prometheus.Counter,
  prometheus.Counter,
] {
  const memoryDecayEvaluatedTotal = new prometheus.Counter({
    name: 'nexus_memory_decay_evaluated_total',
    help: 'Total number of memory segments evaluated by the nightly MemoryDecayReaper',
  });

  const memoryDecayArchivedTotal = new prometheus.Counter({
    name: 'nexus_memory_decay_archived_total',
    help: 'Total number of memory segments archived (archived_at set) by the nightly MemoryDecayReaper',
  });

  const workflowPostmortemRecordedTotal = new prometheus.Counter({
    name: 'nexus_workflow_postmortem_recorded_total',
    help: 'Total number of workflow-failure postmortem writeback events processed by the WorkflowFailurePostmortemListener (work item 5743ac93-456d-41b3-ae5b-0ca2554318da), labelled by outcome',
    labelNames: ['outcome'],
  });

  return [
    memoryDecayEvaluatedTotal,
    memoryDecayArchivedTotal,
    workflowPostmortemRecordedTotal,
  ] as const;
}
