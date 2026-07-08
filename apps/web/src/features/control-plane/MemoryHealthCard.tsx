import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  MemoryMetricsBackendLabel,
  MemoryMetricsDistillationLastRun,
  MemoryMetricsDistillationOutcome,
  MemoryMetricsLearningConvergenceSnapshot,
  MemoryMetricsLearningLastPromoted,
  MemoryMetricsResponse,
  MemoryMetricsWriteOutcome,
} from "@/lib/api/memory.types";

interface MemoryHealthCardProps {
  readonly snapshot: MemoryMetricsResponse | undefined;
  /**
   * Forwarded from `useMemoryMetrics().isLoading` so the new
   * `LearningConvergenceSection` can render its own loading
   * indicator during background refetches when the previous
   * snapshot is still cached (work item
   * 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 4 — WebUI
   * convergence section).
   *
   * The card-level "Loading…" placeholder still fires when
   * `snapshot` is `undefined` (initial fetch), so this flag
   * only matters inside the convergence section.
   */
  readonly isLoading?: boolean;
}

const BACKEND_LABELS: ReadonlyArray<MemoryMetricsBackendLabel> = [
  "postgres",
  "honcho",
];

const WRITE_OUTCOME_LABELS: ReadonlyArray<MemoryMetricsWriteOutcome> = [
  "success",
  "failure",
];

const DISTILLATION_OUTCOME_LABELS: ReadonlyArray<MemoryMetricsDistillationOutcome> =
  ["success", "failure"];

const CARD_DESCRIPTION =
  "Per-backend memory observability counters and distillation outcome metrics.";

export function MemoryHealthCard({
  snapshot,
  isLoading,
}: Readonly<MemoryHealthCardProps>) {
  if (!snapshot) {
    return <MemoryHealthCardLoading />;
  }

  return (
    <Card className="border-dashed">
      <MemoryHealthCardHeader />
      <CardContent className="space-y-5">
        <BackendWritesSection snapshot={snapshot} />
        <BackendReadsSection snapshot={snapshot} />
        <ActiveSegmentsSection snapshot={snapshot} />
        <DistillationSection snapshot={snapshot} />
        <LearningSection snapshot={snapshot} />
        <LearningConvergenceSection snapshot={snapshot} isLoading={isLoading} />
        <p className="text-right text-xs text-muted-foreground">
          generated_at {snapshot.generated_at}
        </p>
      </CardContent>
    </Card>
  );
}

function MemoryHealthCardLoading() {
  return (
    <Card className="border-dashed">
      <MemoryHealthCardHeader />
      <CardContent>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </CardContent>
    </Card>
  );
}

function MemoryHealthCardHeader() {
  return (
    <CardHeader className="space-y-2 pb-4">
      <CardTitle className="text-base">Memory Health</CardTitle>
      <p className="text-sm text-muted-foreground">{CARD_DESCRIPTION}</p>
    </CardHeader>
  );
}

function BackendWritesSection({
  snapshot,
}: {
  readonly snapshot: MemoryMetricsResponse;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Backend writes</h3>
      <div className="space-y-2">
        {BACKEND_LABELS.map((backend) => (
          <BackendWriteRow
            key={backend}
            backend={backend}
            counts={snapshot.backend?.write?.total?.[backend]}
          />
        ))}
      </div>
    </section>
  );
}

function BackendWriteRow({
  backend,
  counts,
}: {
  readonly backend: MemoryMetricsBackendLabel;
  readonly counts: Record<MemoryMetricsWriteOutcome, number>;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {backend}
      </p>
      <div className="flex flex-wrap gap-2">
        {WRITE_OUTCOME_LABELS.map((outcome) => (
          <Badge key={outcome} variant="outline">
            {outcome} {counts[outcome].toString()}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function BackendReadsSection({
  snapshot,
}: {
  readonly snapshot: MemoryMetricsResponse;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Backend reads</h3>
      <div className="space-y-2">
        {BACKEND_LABELS.map((backend) => (
          <BackendReadRow
            key={backend}
            backend={backend}
            total={snapshot.backend?.read?.total?.[backend]}
            summary={snapshot.backend?.read?.latency_ms?.[backend]}
          />
        ))}
      </div>
    </section>
  );
}

function BackendReadRow({
  backend,
  total,
  summary,
}: {
  readonly backend: MemoryMetricsBackendLabel;
  readonly total: number;
  readonly summary: MemoryMetricsResponse["backend"]["read"]["latency_ms"][MemoryMetricsBackendLabel];
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {backend}
      </p>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">total {total.toString()}</Badge>
        <LatencyBadge summary={summary} />
      </div>
    </div>
  );
}

function LatencyBadge({
  summary,
}: {
  readonly summary: MemoryMetricsResponse["backend"]["read"]["latency_ms"][MemoryMetricsBackendLabel];
}) {
  if (summary.count === 0) {
    return <Badge variant="outline">latency 0 reads</Badge>;
  }

  const average = summary.sum / summary.count;
  return (
    <Badge variant="outline">
      latency count {summary.count.toString()} · sum {summary.sum.toString()} ·
      avg {average.toFixed(1)}
    </Badge>
  );
}

function ActiveSegmentsSection({
  snapshot,
}: {
  readonly snapshot: MemoryMetricsResponse;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Active segments</h3>
      <div className="space-y-2">
        {BACKEND_LABELS.map((backend) => (
          <ActiveSegmentsRow
            key={backend}
            backend={backend}
            sources={snapshot.backend?.active_segments?.total?.[backend]}
          />
        ))}
      </div>
    </section>
  );
}

function ActiveSegmentsRow({
  backend,
  sources,
}: {
  readonly backend: MemoryMetricsBackendLabel;
  readonly sources: Record<string, number>;
}) {
  const entries = Object.entries(sources);
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {backend}
      </p>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No active segments recorded.
        </p>
      ) : (
        <dl className="grid gap-1 text-sm sm:grid-cols-2">
          {entries.map(([source, count]) => (
            <div
              key={`${backend}-${source}`}
              className="flex items-center justify-between rounded-md border bg-background px-3 py-1.5"
            >
              <dt className="text-muted-foreground">{source}</dt>
              <dd className="font-medium">{count.toString()}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function DistillationSection({
  snapshot,
}: {
  readonly snapshot: MemoryMetricsResponse;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Distillation completed</h3>
      <div className="flex flex-wrap gap-2">
        {DISTILLATION_OUTCOME_LABELS.map((outcome) => (
          <Badge
            key={outcome}
            variant={
              outcome === "failure" &&
              snapshot.distillation.completed_total.failure > 0
                ? "destructive"
                : "outline"
            }
          >
            {outcome}{" "}
            {snapshot.distillation.completed_total[outcome].toString()}
          </Badge>
        ))}
      </div>
      <DistillationLastRun last={snapshot.distillation.last} />
    </section>
  );
}

function DistillationLastRun({
  last,
}: {
  readonly last: MemoryMetricsDistillationLastRun | null;
}) {
  if (!last) {
    return (
      <div className="rounded-md border bg-background p-3 text-sm text-muted-foreground">
        no distillations yet
      </div>
    );
  }

  return (
    <div className="space-y-1 rounded-md border bg-background p-3 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Last distillation
      </p>
      <dl className="grid gap-1 sm:grid-cols-2">
        <DefinitionRow label="Model" value={last.model} />
        <DefinitionRow
          label="Compression ratio"
          value={last.compression_ratio.toString()}
        />
        <DefinitionRow
          label="Tokens before"
          value={last.tokens_before.toString()}
        />
        <DefinitionRow
          label="Tokens after"
          value={last.tokens_after.toString()}
        />
        <DefinitionRow
          label="Duration (ms)"
          value={last.duration_ms.toString()}
        />
        <DefinitionRow label="Completed at" value={last.completed_at} />
      </dl>
    </div>
  );
}

function LearningSection({
  snapshot,
}: {
  readonly snapshot: MemoryMetricsResponse;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Learning promoted</h3>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">
          total {snapshot.learning.promoted_total.toString()}
        </Badge>
      </div>
      <LearningLastPromoted last={snapshot.learning.last_promoted} />
    </section>
  );
}

function LearningLastPromoted({
  last,
}: {
  readonly last: MemoryMetricsLearningLastPromoted | null;
}) {
  if (!last) {
    return (
      <div className="rounded-md border bg-background p-3 text-sm text-muted-foreground">
        no promotions yet
      </div>
    );
  }

  return (
    <div className="space-y-1 rounded-md border bg-background p-3 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Last promoted
      </p>
      <dl className="grid gap-1 sm:grid-cols-2">
        <DefinitionRow label="Candidate" value={last.candidate_id} />
        <DefinitionRow label="Confidence" value={last.confidence.toString()} />
        <DefinitionRow label="Scope" value={last.scope} />
        <DefinitionRow
          label="Source decision"
          value={last.source_decision_id}
        />
        <DefinitionRow label="Promoted at" value={last.promoted_at} />
      </dl>
    </div>
  );
}

function DefinitionRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LearningConvergenceSection({
  snapshot,
  isLoading,
}: {
  readonly snapshot: MemoryMetricsResponse;
  readonly isLoading: boolean | undefined;
}) {
  const convergence = snapshot.learning?.convergence ?? {};
  const entries = Object.entries(convergence);

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Learning convergence</h3>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading convergence…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No convergence data yet.
        </p>
      ) : (
        <dl className="space-y-2">
          {entries.map(([scope, snapshot]) => (
            <LearningConvergenceRow
              key={scope}
              scope={scope}
              snapshot={snapshot}
            />
          ))}
        </dl>
      )}
    </section>
  );
}

function LearningConvergenceRow({
  scope,
  snapshot,
}: {
  readonly scope: string;
  readonly snapshot: MemoryMetricsLearningConvergenceSnapshot;
}) {
  return (
    <div className="space-y-1 rounded-md border bg-background p-3 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {scope}
      </p>
      <dl className="grid gap-1 sm:grid-cols-2">
        <DefinitionRow label="Ratio" value={snapshot.ratio.toFixed(2)} />
        <DefinitionRow
          label="Successes / runs"
          value={`${snapshot.successes_after_lesson.toString()} / ${snapshot.runs_after_lesson.toString()}`}
        />
        <DefinitionRow
          label="Window (days)"
          value={snapshot.window_days.toString()}
        />
        <DefinitionRow label="Computed at" value={snapshot.computed_at} />
      </dl>
    </div>
  );
}
